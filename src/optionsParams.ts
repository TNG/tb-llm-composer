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
  confirmMovesBeforeApplying: boolean; // show a confirmation popup to review moves; if false, move automatically
}

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
  confirmMovesBeforeApplying: true,
};

export async function getPluginOptions(): Promise<Options> {
  const stored = (await browser.storage.sync.get("options"))?.options;
  // Never hand out DEFAULT_OPTIONS itself: callers such as the options page mutate what they get back
  // before storing it, which would permanently corrupt the shipped defaults in that context.
  return stored ? { ...DEFAULT_OPTIONS, ...stored } : { ...DEFAULT_OPTIONS };
}
