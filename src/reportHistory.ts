import { type LlmApiRequestMessage, LlmRoles } from "./llmConnection";

/**
 * Shrinking of old tool results in a report conversation.
 *
 * Every agent step re-sends the whole conversation, so traces of long runs re-sent 10–14× their final
 * context. Once the context is large, results the model has had several steps to digest are replaced
 * by stubs that keep the ids (and, for bodies, the citation metadata). Tool results are cached per
 * report, so re-calling a tool with identical arguments restores the full result instantly.
 */

/** Below this many conversation characters nothing is compacted (and the prompt cache stays intact). */
const COMPACT_THRESHOLD_CHARS = 60_000;
/** Search-like results are compacted once this many assistant turns followed them. */
const SEARCH_RESULT_MAX_AGE = 3;
/** Message bodies are kept longer: they are the report's actual source material. */
const BODY_RESULT_MAX_AGE = 6;
/** Results this small are left alone; a stub would save next to nothing. */
const MIN_COMPACTABLE_CHARS = 1_000;

const SEARCH_TOOLS = new Set(["search_messages", "get_thread"]);

interface MetadataEntry {
  id: number;
  date?: string;
  from?: string;
  subject?: string;
}

/**
 * Compact old, large tool results in place once the conversation exceeds the size threshold. Everything
 * eligible is compacted in one go, so the prompt prefix then stays stable (cacheable) for a while.
 */
export function compactReportHistory(conversation: LlmApiRequestMessage[]): void {
  const totalChars = conversation.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  if (totalChars < COMPACT_THRESHOLD_CHARS) return;

  let laterAssistantTurns = 0;
  let savedChars = 0;
  for (let i = conversation.length - 1; i >= 0; i--) {
    const message = conversation[i];
    if (message.role === LlmRoles.ASSISTANT) {
      laterAssistantTurns++;
      continue;
    }
    const stub = compactToolResult(message, laterAssistantTurns);
    if (stub !== null) {
      savedChars += (message.content?.length ?? 0) - stub.length;
      conversation[i] = { ...message, content: stub };
    }
  }
  if (savedChars > 0) {
    console.log(`REPORT: compacted old tool results (savedChars=${savedChars}, totalChars=${totalChars})`);
  }
}

/** The stub replacing one tool result, or null when it should stay as is. */
function compactToolResult(message: LlmApiRequestMessage, age: number): string | null {
  const content = message.content;
  if (message.role !== LlmRoles.TOOL || !content || content.length < MIN_COMPACTABLE_CHARS) return null;
  const isSearch = SEARCH_TOOLS.has(message.name ?? "");
  const isBodies = message.name === "get_messages";
  if (!(isSearch && age >= SEARCH_RESULT_MAX_AGE) && !(isBodies && age >= BODY_RESULT_MAX_AGE)) return null;

  let parsed: { hits?: MetadataEntry[]; messages?: MetadataEntry[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const entries = parsed.hits ?? parsed.messages;
  if (!Array.isArray(entries)) return null;

  if (isSearch) {
    return JSON.stringify({
      compacted: `${message.name} result from an earlier step, shortened to save context. Call ${message.name} again with the same arguments to see it in full (instant, cached).`,
      ids: entries.map((e) => e.id),
    });
  }
  return JSON.stringify({
    compacted:
      "Message bodies from an earlier step, removed to save context. Call get_messages again with the same " +
      "arguments to re-read them (usually served instantly from cache).",
    messages: entries.map(({ id, date, from, subject }) => ({ id, date, from, subject })),
  });
}
