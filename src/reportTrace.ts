import type { LlmApiRequestBody, LlmApiRequestMessage, LlmTextCompletionResponse } from "./llmConnection";
import { timedNotification } from "./notifications";
import type { Options } from "./optionsParams";

/**
 * Development-only tracing of report generation.
 *
 * A trace records everything a single report run sent to and received from the LLM — full prompts,
 * every tool call with its arguments and result, timings and token usage — and writes it as one JSON
 * file per run into `<download folder>/llm-composer-trace/`. It exists so a real-world folder of runs can be
 * analysed afterwards for wasted tokens, redundant searches and slow steps.
 *
 * Tracing is compiled out of every normal build: `__TRACE_BUILD__` is defined `false` by webpack, so
 * Terser drops the code and the `downloads` permission is not requested. Of the two packages `pnpm run
 * ship` produces, only `llm-thunderbird-trace.xpi` traces; both carry the same add-on id, so they replace
 * each other on install and share the same settings.
 *
 * PRIVACY: a trace contains the raw email content the model saw. The files stay local, but treat them
 * as a copy of the mailbox excerpt used for that report.
 */

/** Injected by webpack's DefinePlugin; absent (hence the `typeof` guard) under Vitest. */
declare const __TRACE_BUILD__: boolean | undefined;

/** True only in the tracing build packaged as `llm-thunderbird-trace.xpi`. */
export function isTraceBuild(): boolean {
  return typeof __TRACE_BUILD__ !== "undefined" && __TRACE_BUILD__ === true;
}

/** Sub-directory of Thunderbird's download folder the trace files are written to. */
const TRACE_DIR = "llm-composer-trace";
/** Per-field cap so one huge mail body cannot produce an unreadable multi-hundred-MB file. */
const MAX_FIELD_CHARS = 200_000;
/** Hard cap on recorded events; a runaway loop should not exhaust memory. */
const MAX_EVENTS = 5_000;

export type TraceOutcome = "success" | "error" | "cancelled";

/** What kind of run is being traced. */
export type TraceKind = "report" | "refine" | "refine-no-search";

export interface TraceRequestInfo {
  prompt: string;
  days: number;
  folderOnly: boolean;
  folderPath: string | null;
}

interface TraceEvent {
  seq: number;
  at: string;
  elapsedMs: number;
  type: string;
  [key: string]: unknown;
}

/** Truncate long strings, marking how much was dropped, so a trace stays readable. */
function clamp(value: string): string {
  if (value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS)}…[truncated ${value.length - MAX_FIELD_CHARS} chars]`;
}

/** Strip the API token from the options snapshot; everything else is useful for analysis. */
function redactOptions(options: Options): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...options, hasApiToken: Boolean(options.api_token) };
  delete snapshot.api_token;
  return snapshot;
}

function serialiseMessage(message: LlmApiRequestMessage): Record<string, unknown> {
  return {
    role: message.role,
    chars: message.content?.length ?? 0,
    content: message.content === null ? null : clamp(message.content),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.name ? { name: message.name } : {}),
  };
}

/**
 * Collects the events of one run. Conversations are append-only, so each LLM request records only the
 * messages appended since the previous one (plus the full-conversation size) — logging the whole
 * history every step would make the file grow quadratically while adding nothing new.
 */
export class ReportTrace {
  private readonly events: TraceEvent[] = [];
  private readonly startedAtMs: number;
  private seq = 0;
  private droppedEvents = 0;
  private loggedMessages = 0;
  private llmCalls = 0;
  private toolCalls = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private llmMs = 0;
  private toolMs = 0;
  private requestChars = 0;
  private responseChars = 0;
  private toolResultChars = 0;
  private lastLlmRequestAt = 0;
  private lastToolCallAt = 0;
  private outcome: TraceOutcome = "error";
  private errorMessage?: string;
  private report?: string;
  private finishedAtMs?: number;

  constructor(
    readonly kind: TraceKind,
    private readonly request: TraceRequestInfo,
    private readonly options: Options,
    now: number,
  ) {
    this.startedAtMs = now;
  }

  private push(type: string, data: Record<string, unknown>): void {
    if (this.events.length >= MAX_EVENTS) {
      this.droppedEvents++;
      return;
    }
    const at = Date.now();
    this.seq++;
    this.events.push({
      seq: this.seq,
      at: new Date(at).toISOString(),
      elapsedMs: at - this.startedAtMs,
      type,
      ...data,
    });
  }

  /** Record an outgoing chat-completion request (only the messages appended since the last one). */
  llmRequest(url: string, body: LlmApiRequestBody): void {
    this.lastLlmRequestAt = Date.now();
    const messages = body.messages ?? [];
    const appended = messages.slice(this.loggedMessages);
    this.loggedMessages = messages.length;
    const bodyChars = JSON.stringify(body).length;
    this.requestChars += bodyChars;
    // Everything on the body except the (separately recorded) conversation and tool schemas.
    const params: Record<string, unknown> = { ...body };
    delete params.messages;
    delete params.tools;
    this.push("llm-request", {
      url,
      bodyChars,
      conversationMessages: messages.length,
      conversationChars: messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0),
      appendedMessages: appended.map(serialiseMessage),
      tools: body.tools?.map((tool) => tool.function.name) ?? [],
      params,
    });
  }

  /** Record a completed chat-completion response. */
  llmResponse(response: LlmTextCompletionResponse, responseChars: number): void {
    const durationMs = this.lastLlmRequestAt ? Date.now() - this.lastLlmRequestAt : 0;
    this.llmMs += durationMs;
    this.llmCalls++;
    this.responseChars += responseChars;
    const usage = response.usage;
    if (usage) {
      this.promptTokens += usage.prompt_tokens ?? 0;
      this.completionTokens += usage.completion_tokens ?? 0;
      this.totalTokens += usage.total_tokens ?? 0;
    }
    const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
    const content = choice?.message?.content ?? null;
    this.push("llm-response", {
      durationMs,
      responseChars,
      model: response.model,
      usage: usage ?? null,
      finishReason: choice?.finish_reason ?? null,
      content: content === null ? null : clamp(content),
      toolCalls:
        choice?.message?.tool_calls?.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: clamp(call.function.arguments ?? ""),
        })) ?? [],
    });
  }

  /** Record a failed chat-completion request (network error, timeout, abort, HTTP error). */
  llmError(error: unknown): void {
    const durationMs = this.lastLlmRequestAt ? Date.now() - this.lastLlmRequestAt : 0;
    this.llmMs += durationMs;
    this.push("llm-error", {
      durationMs,
      name: (error as Error)?.name ?? "Error",
      message: clamp((error as Error)?.message ?? String(error)),
    });
  }

  /** Record a tool invocation requested by the model. */
  toolCall(name: string, args: Record<string, unknown>): void {
    this.lastToolCallAt = Date.now();
    this.push("tool-call", { name, args });
  }

  /** Record the result a tool handler returned; `result` is the JSON string handed back to the model. */
  toolResult(name: string, result: string): void {
    const durationMs = this.lastToolCallAt ? Date.now() - this.lastToolCallAt : 0;
    this.toolMs += durationMs;
    this.toolCalls++;
    this.toolResultChars += result.length;
    this.push("tool-result", { name, durationMs, resultChars: result.length, result: clamp(result) });
  }

  /** Free-form marker (phase changes, budget exhaustion, capability probes). */
  note(message: string, data: Record<string, unknown> = {}): void {
    this.push("note", { message, ...data });
  }

  /** Close the trace with its outcome. */
  finish(outcome: TraceOutcome, detail: { report?: string; error?: unknown } = {}): void {
    this.finishedAtMs = Date.now();
    this.outcome = outcome;
    if (detail.report !== undefined) this.report = clamp(detail.report);
    if (detail.error !== undefined) {
      this.errorMessage = clamp((detail.error as Error)?.message ?? String(detail.error));
    }
  }

  /** Short, filesystem-safe name derived from the prompt, used in the file name. */
  slug(): string {
    const slug = this.request.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return slug || "report";
  }

  toJson(): Record<string, unknown> {
    const finishedAtMs = this.finishedAtMs ?? Date.now();
    return {
      schema: "llm-composer-trace/1",
      kind: this.kind,
      outcome: this.outcome,
      ...(this.errorMessage ? { error: this.errorMessage } : {}),
      startedAt: new Date(this.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - this.startedAtMs,
      request: this.request,
      options: redactOptions(this.options),
      totals: {
        llmCalls: this.llmCalls,
        toolCalls: this.toolCalls,
        promptTokens: this.promptTokens,
        completionTokens: this.completionTokens,
        totalTokens: this.totalTokens,
        // Wall time split: how much of the run was the model thinking vs. the mailbox being searched.
        llmMs: this.llmMs,
        toolMs: this.toolMs,
        requestChars: this.requestChars,
        responseChars: this.responseChars,
        toolResultChars: this.toolResultChars,
        ...(this.droppedEvents ? { droppedEvents: this.droppedEvents } : {}),
      },
      ...(this.report !== undefined ? { report: this.report } : {}),
      events: this.events,
    };
  }
}

/** The run currently being traced, if any. Runs are sequential per background page. */
let activeTrace: ReportTrace | undefined;

/** The trace to feed events into, or `undefined` when tracing is off. */
export function currentTrace(): ReportTrace | undefined {
  return isTraceBuild() ? activeTrace : undefined;
}

/**
 * Run `work` with tracing active, writing a trace file when it ends (including on error or cancel).
 * A pass-through in normal builds, and never lets a tracing problem break the report itself.
 */
export async function withReportTrace<T extends { report: string }>(
  kind: TraceKind,
  request: TraceRequestInfo,
  options: Options,
  work: () => Promise<T>,
): Promise<T> {
  if (!isTraceBuild()) return work();

  const trace = new ReportTrace(kind, request, options, Date.now());
  activeTrace = trace;
  try {
    const result = await work();
    trace.finish("success", { report: result.report });
    return result;
  } catch (e) {
    trace.finish((e as Error)?.name === "AbortError" ? "cancelled" : "error", { error: e });
    throw e;
  } finally {
    activeTrace = undefined;
    // A trace that silently fails to appear is worse than no tracing at all — it looks like the build
    // works. Surface the failure where the user is already looking, not only in the console.
    await writeTraceFile(trace).catch((e) => {
      console.error("TRACE: failed to write trace file:", e);
      void timedNotification("LLM Composer trace not written", (e as Error)?.message ?? String(e), 15000);
    });
  }
}

/** Minimal shape of the `downloads` API; typed locally so normal builds need no extra type import. */
interface DownloadsApi {
  download(options: {
    url: string;
    filename?: string;
    conflictAction?: "uniquify" | "overwrite" | "prompt";
    saveAs?: boolean;
  }): Promise<number>;
  search(query: { id: number }): Promise<Array<{ filename?: string }>>;
}

/**
 * `llm-composer-trace/<local timestamp>-<kind>-<slug>.json`, relative to Thunderbird's download folder
 * (Settings ▸ General ▸ Files & Attachments — often the Desktop, not "Downloads"). The stamp is local
 * time so file names line up with the clock the reports were run against.
 */
function traceFileName(trace: ReportTrace, at: number): string {
  const local = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  const stamp = local.toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `${TRACE_DIR}/${stamp}-${trace.kind}-${trace.slug()}.json`;
}

async function writeTraceFile(trace: ReportTrace): Promise<void> {
  const downloads = (browser as unknown as { downloads?: DownloadsApi }).downloads;
  if (!downloads) {
    // Reached when a non-tracing build somehow runs this code, or the permission was revoked.
    throw new Error("browser.downloads is unavailable — install llm-thunderbird-trace.xpi (pnpm run ship).");
  }
  const json = JSON.stringify(trace.toJson(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  try {
    const filename = traceFileName(trace, Date.now());
    const id = await downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
    // Report the absolute path: the target is Thunderbird's download folder, which is easy to guess wrong.
    const [item] = await downloads.search({ id }).catch(() => []);
    console.log(`TRACE: wrote ${item?.filename ?? filename} (${json.length} chars)`);
  } finally {
    // The download reads the blob asynchronously; revoking immediately can truncate a large file.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
