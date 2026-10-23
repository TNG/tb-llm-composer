export interface LlmParameters {
  max_new_tokens?: number;
  temperature?: number;
  stop?: [string];
  best_of?: number;
  repetition_penalty?: number;
  return_full_text?: boolean;
  seed?: number;
  truncate?: number;
  typical_p?: number;
  watermark?: boolean;
  decoder_input_details?: boolean;
  stream?: boolean;
  model?: string;
  use_cache?: boolean;
  logprobs?: number;
  chat_template_kwargs?: Record<string, unknown>;
}

export interface FolderRule {
  folderPath: string; // e.g. "/INBOX/Work"
  description: string; // free-text description for the LLM
}

/** Message field a pre-filter rule matches against. */
export type PreFilterField = "from" | "to" | "subject" | "body";

/** How a pre-filter rule compares its `value` against the chosen field (all case-insensitive). */
export type PreFilterOperator = "contains" | "notContains" | "is" | "regex";

/**
 * A deterministic rule applied to a folder's messages *before* anything is sent to the LLM.
 * Thunderbird's own message filters cannot be invoked from a WebExtension, so these mirror the
 * useful subset locally: matched messages are moved to `targetFolderPath` (or, when that is empty,
 * simply left where they are) and never reach the classifier.
 */
export interface PreFilterRule {
  field: PreFilterField;
  operator: PreFilterOperator;
  value: string;
  targetFolderPath: string; // e.g. "/INBOX/Newsletters"; "" = keep in place, just skip the LLM
}

/** The LLM-backed features; in advanced mode each can use its own endpoint. */
export type LlmFeature = "compose" | "summarize" | "report" | "organise";

export const LLM_FEATURES: ReadonlyArray<{ value: LlmFeature; label: string }> = [
  { value: "compose", label: "Compose" },
  { value: "summarize", label: "Summarize" },
  { value: "report", label: "Report" },
  { value: "organise", label: "Organise folder" },
];

/** Features whose output honours the strip-<think> setting; organise always strips (it must parse JSON). */
export type ThinkTagFeature = Exclude<LlmFeature, "organise">;

/** Connection settings for one OpenAI-compatible endpoint. */
export interface EndpointSettings {
  model: string; // endpoint URL (named like Options.model for backwards compatibility)
  api_token?: string;
  timeout?: number; // milliseconds, undefined means no timeout
  params: LlmParameters;
}

/** A per-feature endpoint; only used in advanced mode while `enabled` and with a non-empty URL. */
export interface FeatureEndpointOverride extends EndpointSettings {
  enabled: boolean;
}

export interface Options {
  model: string;
  api_token?: string;
  context_window: number;
  include_recent_mails: boolean;
  recentMailsCount: number; // how many recent sent mails to the recipient to feed as style context
  strip_think_tag: boolean;
  params: LlmParameters;
  llmContext: string;
  subjectContext: string;
  timeout?: number; // Timeout in milliseconds, undefined means no timeout
  folderSortingRules: FolderRule[];
  preFilterRules: PreFilterRule[]; // run before classification; matched mails skip the LLM
  reportMaxSteps: number; // upper bound on agentic tool-calling iterations
  reportMaxSearchResults: number; // cap on messages returned by a single search_messages call
  reportMaxMessageBodies: number; // cap on full message bodies fetched per report run (via get_messages)
  reportMaxTotalBodyChars: number; // run-level ceiling on summed body characters served by get_messages
  reportDefaultDays: number; // prefilled "days in the past" value in the report window
  reportDisableThinking: boolean; // send chat_template_kwargs.enable_thinking=false on every report step
  confirmMovesBeforeApplying: boolean; // show a confirmation popup to review moves; if false, move automatically
  showAdvancedOptions: boolean; // the settings below only apply while this is on
  featureEndpoints: Partial<Record<LlmFeature, FeatureEndpointOverride>>;
  stripThinkTagByFeature: Partial<Record<ThinkTagFeature, boolean>>; // unset = use strip_think_tag
  summaryContext: string; // summarize system prompt; the JSON answer format is appended automatically
  reportSystemPrompt: string;
  organiseSystemPrompt: string; // the JSON answer format is appended automatically
}

/** The advanced-only system prompts; outside advanced mode their defaults are used. */
export type AdvancedPromptKey = "summaryContext" | "reportSystemPrompt" | "organiseSystemPrompt";

export const DEFAULT_PARAMS: LlmParameters = {};

export const DEFAULT_OPTIONS: Options = {
  model: "",
  context_window: 4096,
  params: DEFAULT_PARAMS,
  strip_think_tag: true,
  llmContext:
    "I need to write an email.\n" +
    "The email should be concise.\n" +
    "Structure the response as: an opening greeting (optionally with the recipient's name, or omit it if that fits the context), then the body, then a closing sign-off, then my name without the mail signature.\n" +
    "If older messages with this person are provided, match the greeting and sign-off style, tone, and language I have used with them before.\n" +
    "Do not include a subject line; start directly with the greeting.\n" +
    "Respond with only the email text as plain text, with no brackets, quotes, labels, or placeholders.",
  subjectContext:
    "I need a concise subject for an email I am writing, in the same language as the email.\n" +
    "Respond with only the subject line as plain text, with no brackets, quotes, or labels.",
  include_recent_mails: true,
  recentMailsCount: 2,
  folderSortingRules: [],
  preFilterRules: [],
  reportMaxSteps: 20,
  reportMaxSearchResults: 50,
  reportMaxMessageBodies: 25,
  reportMaxTotalBodyChars: 60000,
  reportDefaultDays: 30,
  reportDisableThinking: false,
  confirmMovesBeforeApplying: true,
  showAdvancedOptions: false,
  featureEndpoints: {},
  stripThinkTagByFeature: {},
  summaryContext:
    "I want to reply to an email. Give me a short summary of the previous conversation " +
    "and list the open points I need to cover in my answer.\n" +
    "Phrase each question so I can answer it directly, and keep options short. " +
    "Write the summary, questions and options in the language of the conversation.",
  reportSystemPrompt: `You are an email-analysis assistant that produces reports from a user's mailbox.

Work agentically:
- Use the provided tools to gather ONLY the information you need.
- Be token-frugal: start with search_messages (compact metadata). For statistics (counts, volume
  per sender/day), use aggregate_messages instead of listing messages yourself. To report by
  company/organisation, group by 'domain' (sender) or 'recipientDomain' rather than full addresses.
- search_messages / get_messages return the sender as 'from' ("Name <address>") and up to three
  recipient addresses in 'to' ('toCount' gives the total when there are more).
- search_messages / get_thread / aggregate_messages return no bodies — call get_messages to read
  content, batching all the ids you need into a single call rather than one call per message.
- To follow a conversation (including your own Sent replies), call get_thread with any message id.
- If a search result is 'truncated', narrow the query; if get_messages returns 'skipped' ids, the
  per-report body budget is spent — write the report with what you already have.

When you have enough information, stop calling tools and write the final report as your message
content. The report must be self-contained and well-structured. You may use light Markdown
(headings, bold, bullet/numbered lists, and pipe tables for tabular data). Do not include tool-call
chatter or your reasoning in the final report.

Cite the emails behind your statements so the reader can open them:
- When a statement rests on one or more specific emails, cite each with an inline Markdown link of
  the form [short label](email:<id>), placed right after the statement it supports.
- <id> MUST be the numeric message id returned by search_messages / get_messages / get_thread.
  Never invent ids; only cite emails you actually retrieved.
- Keep the label short and human — e.g. the sender plus subject: [Alice — "Re: Invoice"](email:12345).
- Cite the actual source message(s); if several support one point, add several links in a row.

Example: The February invoice was resolved on the 3rd [Alice — "Re: Invoice"](email:12345), and
shipping confirmed the next day [Bob — "Shipping"](email:12346).`,
  organiseSystemPrompt:
    "You are an email organisation assistant.\n" +
    "You will be given:\n" +
    "- A numbered list of folder categories with descriptions\n" +
    "- Multiple emails, each with a stable numeric id\n\n" +
    "Organise each email into exactly one folder index (1-based), or null when no folder fits.",
};

export async function getPluginOptions(): Promise<Options> {
  const stored = (await browser.storage.sync.get("options"))?.options;
  // Never hand out DEFAULT_OPTIONS itself: callers such as the options page mutate what they get back
  // before storing it, which would permanently corrupt the shipped defaults in that context.
  return stored ? { ...DEFAULT_OPTIONS, ...stored } : { ...DEFAULT_OPTIONS };
}

/**
 * The endpoint a feature should call: its own override in advanced mode (when enabled and given a URL),
 * otherwise the main endpoint.
 */
export function getEndpointSettings(options: Options, feature: LlmFeature): EndpointSettings {
  const override = options.showAdvancedOptions ? options.featureEndpoints?.[feature] : undefined;
  if (override?.enabled && override.model.trim()) {
    return { model: override.model, api_token: override.api_token, timeout: override.timeout, params: override.params };
  }
  return { model: options.model, api_token: options.api_token, timeout: options.timeout, params: options.params };
}

/** The effective advanced-only system prompt: the stored text in advanced mode (unless blank), else the default. */
export function getAdvancedPrompt(options: Options, key: AdvancedPromptKey): string {
  const stored = options[key];
  return options.showAdvancedOptions && stored?.trim() ? stored : DEFAULT_OPTIONS[key];
}

/** Whether to strip <think> blocks from a feature's output: its own setting in advanced mode, else the global one. */
export function shouldStripThinkTag(options: Options, feature: ThinkTagFeature): boolean {
  const own = options.showAdvancedOptions ? options.stripThinkTagByFeature?.[feature] : undefined;
  return own ?? options.strip_think_tag ?? true;
}
