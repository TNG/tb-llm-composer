import { type AgenticProgress, type LlmApiRequestMessage, LlmRoles, runAgenticLlm } from "./llmConnection";
import { getPluginOptions } from "./optionsParams";
import {
  assertSearchCapabilities,
  createReportToolHandlers,
  type ReportScope,
  reportToolDefinitions,
} from "./reportTools";
import { stripThinkTags } from "./utils";

export interface ReportRequest {
  prompt: string;
  days: number;
  folderOnly: boolean;
  /** When folder-only, also search the account's Sent folder(s) to follow conversations. */
  includeSent?: boolean;
  folder: { accountId: string; path: string } | null;
}

/**
 * A report generation result plus the state needed to continue the same agent conversation:
 * the full message history and the scope its tools are bound to.
 */
export interface ReportSession {
  report: string;
  messages: LlmApiRequestMessage[];
  scope: ReportScope;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const REPORT_SYSTEM_PROMPT = `You are an email-analysis assistant that produces reports from a user's mailbox.

Work agentically:
- Use the provided tools to gather ONLY the information you need.
- Be token-frugal: prefer search_messages (compact metadata) and only call get_message for the
  few messages whose bodies you truly need.
- search_messages returns no bodies — you must call get_message to read content.

When you have enough information, stop calling tools and write the final report as your message
content. The report must be self-contained, well-structured plain text that the user can copy
elsewhere. Do not include tool-call chatter or your reasoning in the final report.`;

/** Build the scope-describing user preamble for the run. */
function buildScopePreamble(request: ReportRequest): string {
  const scopeText = request.folderOnly && request.folder ? `only the folder "${request.folder.path}"` : "all folders";
  const runDate = new Date();
  const fromDate = new Date(runDate.getTime() - request.days * DAY_MS);
  return [
    `Search scope: ${scopeText}.`,
    `Time window: messages from the last ${request.days} day(s) by default.`,
    `Default date range (computed now): ${toLocalDateYmd(fromDate)} to ${toLocalDateYmd(runDate)}.`,
    `Report run date: ${toLocalDateYmd(runDate)}.`,
    "If your report includes a date range or generated-on line, use these exact dates.",
  ].join("\n");
}

function toLocalDateYmd(date: Date): string {
  const yyyy = `${date.getFullYear()}`;
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Start a fresh agentic report generation for the given request. Validates search capabilities
 * first, then loops the LLM with email-search tools. Returns the report plus the conversation
 * state (messages + scope) so it can be continued via {@link continueReport}.
 */
export async function generateReport(
  request: ReportRequest,
  abortSignal: AbortSignal,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<ReportSession> {
  const startedAt = Date.now();
  const options = await getPluginOptions();

  const scope: ReportScope = {
    folderOnly: request.folderOnly,
    folder: request.folder,
    includeSent: request.includeSent ?? false,
    defaultDays: request.days,
    maxSearchResults: options.reportMaxSearchResults,
  };

  console.log(
    "REPORT: starting generation " +
      `(days=${request.days}, folderOnly=${request.folderOnly}, folder=${request.folder?.path ?? "(all)"}, ` +
      `promptChars=${request.prompt.length})`,
  );

  // Hard requirement: fail loudly if the mailbox cannot be searched the way we need.
  await assertSearchCapabilities(scope);
  console.log("REPORT: search capability probe succeeded");

  const messages: LlmApiRequestMessage[] = [
    { role: LlmRoles.SYSTEM, content: REPORT_SYSTEM_PROMPT },
    { role: LlmRoles.USER, content: buildScopePreamble(request) },
    { role: LlmRoles.USER, content: `Report request:\n${request.prompt}` },
  ];

  return runReportLoop(messages, scope, options.reportMaxSteps, startedAt, abortSignal, onProgress);
}

/**
 * Continue an existing report conversation: append the user's refinement as a new turn and keep
 * looping the same agent (with its accumulated context and tool history) instead of starting over.
 */
export async function continueReport(
  session: { messages: LlmApiRequestMessage[]; scope: ReportScope },
  prompt: string,
  abortSignal: AbortSignal,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<ReportSession> {
  const startedAt = Date.now();
  const options = await getPluginOptions();

  console.log(
    `REPORT: continuing conversation (priorMessages=${session.messages.length}, promptChars=${prompt.length})`,
  );

  const messages: LlmApiRequestMessage[] = [
    ...session.messages,
    {
      role: LlmRoles.USER,
      content:
        "Refine the previous report according to the following instructions, reusing what you already " +
        `gathered and only searching again if needed:\n${prompt}`,
    },
  ];

  return runReportLoop(messages, session.scope, options.reportMaxSteps, startedAt, abortSignal, onProgress);
}

/** Shared agentic loop for both fresh and continued report runs. */
async function runReportLoop(
  messages: LlmApiRequestMessage[],
  scope: ReportScope,
  maxSteps: number,
  startedAt: number,
  abortSignal: AbortSignal,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<ReportSession> {
  const options = await getPluginOptions();
  const handlers = createReportToolHandlers(scope);
  console.log(`REPORT: entering agentic loop (maxSteps=${maxSteps}, maxSearchResults=${scope.maxSearchResults})`);

  try {
    const { report: rawReport, messages: finalMessages } = await runAgenticLlm(
      messages,
      reportToolDefinitions,
      handlers,
      abortSignal,
      maxSteps,
      onProgress,
    );
    const finalReport = options.strip_think_tag ? stripThinkTags(rawReport) : rawReport;

    console.log(
      "REPORT: generation completed " +
        `(elapsedMs=${Date.now() - startedAt}, rawChars=${rawReport.length}, finalChars=${finalReport.length}, ` +
        `strippedThinkTags=${options.strip_think_tag})`,
    );

    return { report: finalReport, messages: finalMessages, scope };
  } catch (e) {
    console.error(`REPORT: generation failed after ${Date.now() - startedAt}ms`, e);
    throw e;
  }
}
