import { type AgenticProgress, LlmRoles, runAgenticLlm } from "./llmConnection";
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
  priorReport?: string;
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
 * Run an agentic report generation for the given request. Validates search capabilities first,
 * then loops the LLM with email-search tools, and returns the final plain-text report.
 */
export async function generateReport(
  request: ReportRequest,
  abortSignal: AbortSignal,
  onProgress?: (progress: AgenticProgress) => void,
): Promise<string> {
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
      `promptChars=${request.prompt.length}, hasPriorReport=${Boolean(request.priorReport?.trim())})`,
  );

  // Hard requirement: fail loudly if the mailbox cannot be searched the way we need.
  await assertSearchCapabilities(scope);
  console.log("REPORT: search capability probe succeeded");

  const messages = [
    { role: LlmRoles.SYSTEM, content: REPORT_SYSTEM_PROMPT },
    { role: LlmRoles.USER, content: buildScopePreamble(request) },
  ];

  if (request.priorReport?.trim()) {
    messages.push({
      role: LlmRoles.USER,
      content:
        "Here is the previous report. Refine it according to the new instructions below rather than " +
        `starting from scratch:\n\n${request.priorReport.trim()}`,
    });
  }

  messages.push({ role: LlmRoles.USER, content: `Report request:\n${request.prompt}` });

  const handlers = createReportToolHandlers(scope);
  console.log(
    `REPORT: entering agentic loop (maxSteps=${options.reportMaxSteps}, maxSearchResults=${scope.maxSearchResults})`,
  );

  try {
    const rawReport = await runAgenticLlm(
      messages,
      reportToolDefinitions,
      handlers,
      abortSignal,
      options.reportMaxSteps,
      onProgress,
    );
    const finalReport = options.strip_think_tag ? stripThinkTags(rawReport) : rawReport;

    console.log(
      "REPORT: generation completed " +
        `(elapsedMs=${Date.now() - startedAt}, rawChars=${rawReport.length}, finalChars=${finalReport.length}, ` +
        `strippedThinkTags=${options.strip_think_tag})`,
    );

    return finalReport;
  } catch (e) {
    console.error(`REPORT: generation failed after ${Date.now() - startedAt}ms`, e);
    throw e;
  }
}
