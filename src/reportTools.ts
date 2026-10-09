import { extractTextFromPart, resolveFolderPath } from "./emailOrganising";
import type { LlmToolDefinition, LlmToolHandler } from "./llmConnection";
import { cleanReportBody } from "./reportBodyCleanup";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Safety ceiling on how many headers aggregate_messages will enumerate (local paging, no bodies). */
const MAX_AGGREGATE_SCAN = 5000;
/** IMAP message reads can stall or fail mid-stream; bound each read with this timeout. */
const MESSAGE_READ_TIMEOUT_MS = 20_000;
/** Searches (query/continueList) can hang on IMAP/Gloda; bound every page with this timeout. */
const QUERY_TIMEOUT_MS = 25_000;
/**
 * Full-text pages get a shorter bound: on IMAP they either answer within seconds or stall until any
 * timeout, so waiting the full {@link QUERY_TIMEOUT_MS} only delays the fallback.
 */
const FULL_TEXT_QUERY_TIMEOUT_MS = 10_000;
/** How far before the earliest known thread message get_thread scans for same-subject siblings. */
const THREAD_SUBJECT_LOOKBACK_DAYS = 14;
/** Recipients listed per search hit; the rest is only counted, to keep hit lists compact. */
const MAX_HIT_RECIPIENTS = 3;
/**
 * How many References/In-Reply-To ids get_thread resolves with individual queries. Long threads carry
 * dozens of ids and each lookup is a full mailbox search, so only the nearest ancestors are resolved.
 */
const MAX_THREAD_REFERENCE_LOOKUPS = 12;

/**
 * Await a mailbox read (get/getFull), rejecting if it stalls past {@link MESSAGE_READ_TIMEOUT_MS} or
 * the run is aborted. IMAP body streaming can hang or throw ("Error while streaming message … Status
 * …"); without this guard the whole report loop would block on one bad message and Stop could not
 * interrupt it. Aborts reject with an AbortError so callers can propagate cancellation.
 */
function guardedRead<T>(
  operation: Promise<T>,
  abortSignal: AbortSignal,
  what: string,
  timeoutMs: number = MESSAGE_READ_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(new DOMException("Report generation cancelled", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    function cleanup() {
      clearTimeout(timer);
      abortSignal.removeEventListener("abort", onAbort);
    }
    function onAbort() {
      cleanup();
      reject(new DOMException("Report generation cancelled", "AbortError"));
    }
    timer = setTimeout(() => {
      cleanup();
      const error = new Error(`${what} timed out after ${timeoutMs / 1000}s`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
    abortSignal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Throw an AbortError if the run has been cancelled; used to break out of paging loops promptly. */
function throwIfAborted(abortSignal: AbortSignal): void {
  if (abortSignal.aborted) throw new DOMException("Report generation cancelled", "AbortError");
}

type MessagePage = Awaited<ReturnType<typeof browser.messages.query>>;

/** Marker returned by {@link guardedQuery} when a page stalled past its timeout. */
const TIMED_OUT = Symbol("timed out");

/** A search page, or why there is none: query/continueList return an error string on failure. */
type GuardedPage = MessagePage | string | null | typeof TIMED_OUT;

function isFailedPage(page: GuardedPage): page is string | null | typeof TIMED_OUT {
  return page === null || page === TIMED_OUT || typeof page === "string";
}

/**
 * Run one search page (query/continueList) under a timeout + abort guard. Returns {@link TIMED_OUT}
 * when the page stalled and `null` when it failed, so callers can return a partial (truncated) result
 * instead of the whole report run hanging on a single unresponsive search. Cancellation still
 * propagates as an AbortError.
 */
async function guardedQuery(
  run: () => Promise<MessagePage>,
  abortSignal: AbortSignal,
  what: string,
  timeoutMs: number = QUERY_TIMEOUT_MS,
): Promise<GuardedPage> {
  try {
    return await guardedRead<MessagePage>(run(), abortSignal, what, timeoutMs);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    console.warn(`REPORT: ${what} failed:`, e);
    return (e as Error).name === "TimeoutError" ? TIMED_OUT : null;
  }
}

/** Folder/time scope for a single report run, derived from the report window inputs. */
export interface ReportScope {
  folderOnly: boolean;
  folder: { accountId: string; path: string } | null;
  defaultDays: number;
  maxSearchResults: number;
  /** Max number of full message bodies get_messages may serve across the whole run. */
  maxMessageBodies: number;
  /** Run-level ceiling on summed body characters served by get_messages. */
  maxTotalBodyChars: number;
}

type QueryInfo = browser.messages._QueryQueryInfo & { folderId?: string };

/** A raw From/To header value parsed into its display name, address, and domain. */
export interface ParsedAddress {
  name: string;
  address: string;
  domain: string;
}

/**
 * Parse a raw address header ("Name <local@domain>", "<local@domain>", or "local@domain") into
 * structured parts so the model gets a reliable `domain` instead of re-parsing the free-form string.
 */
export function parseAddress(raw: string): ParsedAddress {
  const text = (raw ?? "").trim();
  const angle = text.match(/^(.*)<([^>]*)>\s*$/);
  let name = "";
  let address = "";
  if (angle) {
    name = angle[1]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();
    address = angle[2].trim();
  } else if (text.includes("@")) {
    address = text;
  } else {
    name = text;
  }
  const at = address.lastIndexOf("@");
  const domain =
    at >= 0
      ? address
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  return { name, address, domain };
}

/** Render an address header compactly: "Name <address>", or whichever part exists. */
export function formatAddress(raw: string): string {
  const { name, address } = parseAddress(raw);
  if (!address) return name;
  return name && name.toLowerCase() !== address.toLowerCase() ? `${name} <${address}>` : address;
}

/** Compact metadata shape returned by search/thread tools (no bodies, to stay token-frugal). */
interface SearchHit {
  id: number;
  /** ISO date at minute precision, e.g. "2026-09-11T09:36Z". */
  date: string;
  from: string;
  /** The first {@link MAX_HIT_RECIPIENTS} recipient addresses. */
  to: string[];
  /** Total recipient count, present only when `to` was shortened. */
  toCount?: number;
  subject: string;
}

/** A get_messages entry: hit metadata plus the cleaned body. */
interface MessageWithBody extends SearchHit {
  body: string;
  /** Characters of quoted earlier messages removed from `body` (absent when nothing was cut). */
  quotedChars?: number;
}

/**
 * Mailbox state shared by every run bound to the same scope object, i.e. a report and its refinements:
 * whether full-text search is known to stall, and a cache of tool results keyed by name + arguments.
 */
interface ReportToolState {
  fullTextUnavailable: boolean;
  cache: Map<string, Promise<unknown>>;
}

const toolStates = new WeakMap<ReportScope, ReportToolState>();

function toolStateFor(scope: ReportScope): ReportToolState {
  let state = toolStates.get(scope);
  if (!state) {
    state = { fullTextUnavailable: false, cache: new Map() };
    toolStates.set(scope, state);
  }
  return state;
}

/** Mutable per-run budget shared by all get_messages calls so full bodies stay bounded. */
interface BodyBudget {
  bodiesRemaining: number;
  charsRemaining: number;
}

/** Common metadata filters accepted by search_messages and aggregate_messages. */
interface MessageFilters {
  fullText?: string;
  author?: string;
  recipients?: string;
  fromDate?: Date;
  toDate?: Date;
  read?: boolean;
  attachment?: boolean;
  flagged?: boolean;
  subjectFilter: string;
}

/**
 * Verify that `browser.messages.query` accepts the parameters the report tools rely on
 * (`fromDate`, `author`, `fullText`). Throws a clear error if querying is unavailable/broken.
 */
export async function assertSearchCapabilities(scope: ReportScope): Promise<void> {
  try {
    const probe: QueryInfo = {
      fromDate: new Date(Date.now() - DAY_MS),
      author: "capability-probe@example.invalid",
      fullText: "capability-probe",
    };
    await browser.messages.query(probe);
    console.log("REPORT: search capability probe query succeeded");
  } catch (e) {
    throw new Error(
      `Email search is not available on this Thunderbird build (browser.messages.query failed for ` +
        `fromDate/author/fullText): ${(e as Error).message}. The report feature cannot run.`,
    );
  }
  // Touch scope so callers always pass it (folder is validated lazily during search).
  void scope.folderOnly;
}

/** JSON-schema tool definitions advertised to the model. */
export const reportToolDefinitions: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_messages",
      description:
        "Search emails and return compact metadata only (no bodies). Use this first to find relevant " +
        "messages, then call get_messages for the bodies you actually need. If the result is `truncated`, " +
        "narrow the query (add filters or shorten the time window) rather than reporting on a partial set. " +
        "If it is `timedOut`, the mailbox search stalled — follow its `note` instead of retrying similar terms.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full-text search terms (optional)." },
          author: { type: "string", description: "Filter by sender address/name (optional)." },
          recipient: { type: "string", description: "Filter by a recipient address/name (optional)." },
          subject: { type: "string", description: "Filter by subject (case-insensitive substring; optional)." },
          fromDays: {
            type: "number",
            description: "Only include messages from the last N days (optional; defaults to the run's day window).",
          },
          toDays: {
            type: "number",
            description: "Only include messages older than N days, for a bounded window (optional).",
          },
          unread: { type: "boolean", description: "If true, only unread messages (optional)." },
          flagged: { type: "boolean", description: "If true, only flagged/starred messages (optional)." },
          hasAttachment: { type: "boolean", description: "If true, only messages with attachments (optional)." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_messages",
      description:
        "Fetch the full plain-text bodies of one or more messages by id. Prefer a single batched call " +
        "over many single-id calls. There is a per-report budget on how many bodies (and total characters) " +
        "can be read; any ids beyond the budget are returned in `skipped` — summarize with what you have. " +
        "Quoted reply history is cut from bodies (its size is in `quotedChars`); read the thread's other " +
        "messages instead, or pass includeQuoted only when the quoted part is not available otherwise.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "number" },
            description: "Message ids from a recent search_messages / get_thread result.",
          },
          includeQuoted: {
            type: "boolean",
            description: "If true, keep the quoted earlier messages in each body (optional; costs more budget).",
          },
        },
        required: ["ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_thread",
      description:
        "Return the metadata of all messages in the same conversation as the given message id (across all " +
        "folders, including your own Sent replies). Returns metadata only — call get_messages for bodies.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "A message id from a recent search result." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aggregate_messages",
      description:
        "Count matching messages grouped by a field, without reading bodies. Use for statistics like " +
        "'how many emails per sender' or 'message volume per day' instead of enumerating results yourself.",
      parameters: {
        type: "object",
        properties: {
          groupBy: {
            type: "string",
            enum: ["author", "recipient", "domain", "recipientDomain", "day", "subject"],
            description:
              "Field to group the counts by. Use 'domain'/'recipientDomain' to group by the sender's / " +
              "recipients' email domain (e.g. volume per company), rather than the full address.",
          },
          query: { type: "string", description: "Full-text search terms (optional)." },
          author: { type: "string", description: "Filter by sender address/name (optional)." },
          recipient: { type: "string", description: "Filter by a recipient address/name (optional)." },
          subject: { type: "string", description: "Filter by subject (case-insensitive substring; optional)." },
          fromDays: { type: "number", description: "Only include messages from the last N days (optional)." },
          toDays: { type: "number", description: "Only include messages older than N days (optional)." },
        },
        required: ["groupBy"],
        additionalProperties: false,
      },
    },
  },
];

/** Build tool handlers bound to a specific report scope, sharing one body budget across the run. */
export function createReportToolHandlers(
  scope: ReportScope,
  // The run's abort signal, so message reads can time out / be cancelled instead of stalling the loop.
  abortSignal: AbortSignal = new AbortController().signal,
): Record<string, LlmToolHandler> {
  const budget: BodyBudget = {
    bodiesRemaining: scope.maxMessageBodies,
    charsRemaining: scope.maxTotalBodyChars,
  };
  const state = toolStateFor(scope);
  return {
    search_messages: cached(state, "search_messages", (args) => handleSearchMessages(args, scope, state, abortSignal)),
    // A result with budget-skipped ids is not cached: a refinement starts with a fresh budget.
    get_messages: cached(
      state,
      "get_messages",
      (args) => handleGetMessages(args, budget, abortSignal),
      (result) => result.skipped.length === 0,
    ),
    get_thread: cached(state, "get_thread", (args) => handleGetThread(args, scope, abortSignal)),
    aggregate_messages: cached(state, "aggregate_messages", (args) =>
      handleAggregateMessages(args, scope, state, abortSignal),
    ),
  };
}

/**
 * Memoise a tool by name + arguments for the lifetime of the scope (a report and its refinements), so a
 * repeated call is answered instantly and a repeated get_messages spends no body budget. Concurrent
 * identical calls share one in-flight promise; failures and results rejected by `cacheable` are dropped.
 */
function cached<T>(
  state: ReportToolState,
  name: string,
  handler: (args: Record<string, unknown>) => Promise<T>,
  cacheable: (result: T) => boolean = () => true,
): LlmToolHandler {
  return (args) => {
    const key = `${name}:${JSON.stringify(args, Object.keys(args).sort())}`;
    const hit = state.cache.get(key);
    if (hit) {
      console.log(`REPORT: ${name} served from cache`);
      return hit;
    }
    const pending = handler(args);
    state.cache.set(key, pending);
    pending.then(
      (result) => {
        if (!cacheable(result)) state.cache.delete(key);
      },
      () => state.cache.delete(key),
    );
    return pending;
  };
}

/** Build the shared query filters from tool args, using the run's default day window as a fallback. */
function buildFilters(args: Record<string, unknown>, defaultDays: number): MessageFilters {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const filters: MessageFilters = { subjectFilter: str(args.subject).toLowerCase() };

  const fullText = str(args.query);
  if (fullText) filters.fullText = fullText;
  const author = str(args.author);
  if (author) filters.author = author;
  const recipient = str(args.recipient);
  if (recipient) filters.recipients = recipient;

  const fromDays = typeof args.fromDays === "number" && args.fromDays > 0 ? args.fromDays : defaultDays;
  if (fromDays > 0) filters.fromDate = new Date(Date.now() - fromDays * DAY_MS);
  if (typeof args.toDays === "number" && args.toDays > 0) {
    filters.toDate = new Date(Date.now() - args.toDays * DAY_MS);
  }

  // `unread` in MV3 is expressed via the `read` query field.
  if (typeof args.unread === "boolean") filters.read = !args.unread;
  if (typeof args.flagged === "boolean") filters.flagged = args.flagged;
  if (typeof args.hasAttachment === "boolean") filters.attachment = args.hasAttachment;

  return filters;
}

/** Translate parsed filters into a `browser.messages.query` info object (subject is filtered client-side). */
function filtersToQueryInfo(filters: MessageFilters): QueryInfo {
  const queryInfo: QueryInfo = {};
  if (filters.fullText) queryInfo.fullText = filters.fullText;
  if (filters.author) queryInfo.author = filters.author;
  if (filters.recipients) queryInfo.recipients = filters.recipients;
  if (filters.fromDate) queryInfo.fromDate = filters.fromDate;
  if (filters.toDate) queryInfo.toDate = filters.toDate;
  if (filters.read !== undefined) queryInfo.read = filters.read;
  if (filters.flagged !== undefined) queryInfo.flagged = filters.flagged;
  if (filters.attachment !== undefined) queryInfo.attachment = filters.attachment;
  return queryInfo;
}

/** search_messages result; `note` explains a stalled or degraded search to the model. */
interface SearchResult {
  hits: SearchHit[];
  returned: number;
  truncated: boolean;
  timedOut?: boolean;
  note?: string;
}

const FULL_TEXT_FALLBACK_NOTE =
  "Full-text search stalls on this mailbox, so it is disabled for this report: your query terms were matched " +
  "against subject, sender and recipients only (any term, best matches first). Message bodies were NOT " +
  "searched — narrow with author/recipient/subject filters, or read candidates with get_messages.";

async function handleSearchMessages(
  args: Record<string, unknown>,
  scope: ReportScope,
  state: ReportToolState,
  abortSignal: AbortSignal,
): Promise<SearchResult> {
  const startedAt = Date.now();
  const filters = buildFilters(args, scope.defaultDays);
  const queryInfo = filtersToQueryInfo(filters);

  // search_messages honours the folder-only scope; an all-folders search is unrestricted.
  const folderRef = await resolveTargetFolder(scope);
  if (folderRef?.folderId) queryInfo.folderId = folderRef.folderId;

  const result = await searchWithFullTextFallback(queryInfo, filters, scope.maxSearchResults, state, abortSignal);

  console.log(
    "REPORT: search_messages completed " +
      `(query='${filters.fullText ?? ""}', author='${filters.author ?? ""}', subject='${filters.subjectFilter}', ` +
      `folderOnly=${scope.folderOnly}, returned=${result.hits.length}/${scope.maxSearchResults}, ` +
      `truncated=${result.truncated}, timedOut=${result.timedOut ?? false}, elapsedMs=${Date.now() - startedAt})`,
  );
  return result;
}

/**
 * Run a search, degrading gracefully when full-text search stalls (common on IMAP): the first stall
 * disables full-text for the rest of the scope, and the terms are matched client-side against headers.
 */
async function searchWithFullTextFallback(
  queryInfo: QueryInfo,
  filters: MessageFilters,
  cap: number,
  state: ReportToolState,
  abortSignal: AbortSignal,
): Promise<SearchResult> {
  const fullText = filters.fullText;
  if (fullText && !state.fullTextUnavailable) {
    const scan = await collectHeaders(queryInfo, cap, filters.subjectFilter, abortSignal, FULL_TEXT_QUERY_TIMEOUT_MS);
    if (!scan.timedOut) return { hits: scan.hits, returned: scan.hits.length, truncated: scan.truncated };
    state.fullTextUnavailable = true;
    console.warn("REPORT: full-text search timed out; matching query terms against headers from now on");
    if (scan.hits.length > 0) {
      return {
        hits: scan.hits,
        returned: scan.hits.length,
        truncated: true,
        timedOut: true,
        note:
          "The full-text search stalled, so these hits are partial; full-text search is now disabled for " +
          "this report. Further query terms are matched against subject, sender and recipients only.",
      };
    }
  }
  if (fullText) {
    const { fullText: _unused, ...headerQuery } = queryInfo;
    const scan = await collectHeaderMatches(headerQuery, fullText, cap, filters.subjectFilter, abortSignal);
    return {
      hits: scan.hits,
      returned: scan.hits.length,
      truncated: scan.truncated,
      ...(scan.timedOut ? { timedOut: true } : {}),
      note: FULL_TEXT_FALLBACK_NOTE,
    };
  }
  const scan = await collectHeaders(queryInfo, cap, filters.subjectFilter, abortSignal);
  return {
    hits: scan.hits,
    returned: scan.hits.length,
    truncated: scan.truncated,
    ...(scan.timedOut ? { timedOut: true, note: "The mailbox search stalled; these results may be incomplete." } : {}),
  };
}

/** A resolved folder to search, expressed as its folder id (required for the MV3 query API). */
type FolderRef = { folderId: string };

/** Resolve the single target folder for a folder-only search, or null for an all-folders search. */
async function resolveTargetFolder(scope: ReportScope): Promise<FolderRef | null> {
  if (!scope.folderOnly || !scope.folder) {
    return null;
  }
  const target = await resolveFolderPath(scope.folder.path);
  if (!target) {
    throw new Error(`Could not resolve the active folder "${scope.folder.path}" for a folder-only search.`);
  }
  // The MV3 query API restricts folders by id only; without one we would silently widen the
  // folder-only search to every folder, so fail loudly instead.
  const withId = target as browser.folders.MailFolder & { id?: string };
  if (!withId.id) {
    throw new Error(`The folder "${scope.folder.path}" has no id, so a folder-only search cannot be restricted to it.`);
  }
  return { folderId: withId.id };
}

/**
 * Page through a query collecting compact metadata up to `cap`. Reports `truncated` when more
 * matching messages exist beyond the cap (or a page failed, so a partial scan is not presented as a
 * complete set), and `timedOut` when a page stalled.
 */
async function collectHeaders(
  queryInfo: QueryInfo,
  cap: number,
  subjectFilter: string,
  abortSignal: AbortSignal,
  timeoutMs: number = QUERY_TIMEOUT_MS,
): Promise<{ hits: SearchHit[]; truncated: boolean; timedOut: boolean }> {
  const hits: SearchHit[] = [];
  let full = false;
  const { complete, timedOut } = await scanHeaders(queryInfo, abortSignal, timeoutMs, (msg) => {
    if (subjectFilter && !(msg.subject ?? "").toLowerCase().includes(subjectFilter)) return true;
    if (hits.length >= cap) {
      full = true;
      return false;
    }
    hits.push(toHit(msg));
    return true;
  });
  return { hits, truncated: full || !complete, timedOut };
}

/**
 * Visit every distinct message a query returns, page by page, until `visit` returns false. A failed or
 * stalled page ends the scan; `complete` is false whenever it ended early for any reason.
 */
async function scanHeaders(
  queryInfo: QueryInfo,
  abortSignal: AbortSignal,
  timeoutMs: number,
  visit: (msg: browser.messages.MessageHeader) => boolean,
): Promise<{ complete: boolean; timedOut: boolean }> {
  const seenIds = new Set<number>();
  let page = await guardedQuery(() => browser.messages.query(queryInfo), abortSignal, "search messages", timeoutMs);
  for (;;) {
    throwIfAborted(abortSignal);
    if (isFailedPage(page)) return { complete: false, timedOut: page === TIMED_OUT };
    for (const msg of page.messages) {
      if (msg.id === undefined || seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      if (!visit(msg)) return { complete: false, timedOut: false };
    }
    if (!page.id) return { complete: true, timedOut: false };
    const listId = page.id;
    page = await guardedQuery(
      () => browser.messages.continueList(listId),
      abortSignal,
      "continue message search",
      timeoutMs,
    );
  }
}

/** Lower-case and fold accents/umlauts (ü and ue → u, ß → ss) so "Würth" and "Wuerth" compare equal. */
function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/([aou])e/g, "$1");
}

/** Searchable header text of a message: subject, sender and all recipients. */
function headerText(msg: browser.messages.MessageHeader): string {
  return foldForMatch(
    [msg.subject ?? "", msg.author ?? "", ...(msg.recipients ?? []), ...(msg.ccList ?? [])].join("\n"),
  );
}

/** Split full-text query terms for client-side matching; one-letter terms only add noise. */
function queryTerms(fullText: string): string[] {
  return [...new Set(foldForMatch(fullText).split(/[\s,;"']+/))].filter((t) => t.length >= 2);
}

/**
 * Client-side stand-in for a stalled full-text search: scan the (otherwise filtered) headers and keep
 * messages whose subject/sender/recipients contain any query term, ranked by matched terms then date.
 */
async function collectHeaderMatches(
  queryInfo: QueryInfo,
  fullText: string,
  cap: number,
  subjectFilter: string,
  abortSignal: AbortSignal,
): Promise<{ hits: SearchHit[]; truncated: boolean; timedOut: boolean }> {
  const terms = queryTerms(fullText);
  const matches: Array<{ score: number; hit: SearchHit }> = [];
  let scanned = 0;
  const { complete, timedOut } = await scanHeaders(queryInfo, abortSignal, QUERY_TIMEOUT_MS, (msg) => {
    if (subjectFilter && !(msg.subject ?? "").toLowerCase().includes(subjectFilter)) return true;
    const text = headerText(msg);
    const score = terms.filter((t) => text.includes(t)).length;
    if (score > 0) matches.push({ score, hit: toHit(msg) });
    return ++scanned < MAX_AGGREGATE_SCAN;
  });
  matches.sort((a, b) => b.score - a.score || b.hit.date.localeCompare(a.hit.date));
  return {
    hits: matches.slice(0, cap).map((m) => m.hit),
    truncated: !complete || matches.length > cap,
    timedOut,
  };
}

/** ISO timestamp at minute precision ("2026-09-11T09:36Z"); seconds cost tokens but add no meaning. */
function compactDate(date: Date | string | number | undefined): string {
  return date ? `${new Date(date).toISOString().slice(0, 16)}Z` : "";
}

function toHit(msg: browser.messages.MessageHeader): SearchHit {
  const recipients = (msg.recipients ?? []).map((r) => {
    const { name, address } = parseAddress(r);
    return address || name;
  });
  return {
    id: msg.id as number,
    date: compactDate(msg.date),
    from: formatAddress(msg.author ?? ""),
    to: recipients.slice(0, MAX_HIT_RECIPIENTS),
    ...(recipients.length > MAX_HIT_RECIPIENTS ? { toCount: recipients.length } : {}),
    subject: msg.subject ?? "(no subject)",
  };
}

async function handleGetMessages(
  args: Record<string, unknown>,
  budget: BodyBudget,
  abortSignal: AbortSignal,
): Promise<{
  messages: MessageWithBody[];
  skipped: Array<{ id: number; reason: string }>;
}> {
  const startedAt = Date.now();
  const rawIds = Array.isArray(args.ids) ? args.ids : [];
  const ids = rawIds.map((v) => (typeof v === "number" ? v : Number(v))).filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    throw new Error("get_messages requires a non-empty 'ids' array of numeric message ids.");
  }
  const includeQuoted = args.includeQuoted === true;

  const messages: MessageWithBody[] = [];
  const skipped: Array<{ id: number; reason: string }> = [];

  for (const id of ids) {
    // Stop serving new bodies once either budget is spent; each served body is always complete.
    if (budget.bodiesRemaining <= 0 || budget.charsRemaining <= 0) {
      skipped.push({
        id,
        reason: "Body budget for this report reached. Summarize with the messages already gathered.",
      });
      continue;
    }
    // Reserve the body slot before awaiting, so parallel get_messages calls cannot overspend it.
    budget.bodiesRemaining -= 1;
    try {
      const header = await guardedRead<browser.messages.MessageHeader>(
        browser.messages.get(id),
        abortSignal,
        `read message ${id}`,
      );
      const full = await guardedRead<browser.messages.MessagePart>(
        browser.messages.getFull(id),
        abortSignal,
        `stream message ${id}`,
      );
      const { body, quotedChars } = cleanReportBody(extractTextFromPart(full), header.subject ?? "", includeQuoted);
      messages.push({ ...toHit(header), id, body, ...(quotedChars > 0 ? { quotedChars } : {}) });
      budget.charsRemaining -= body.length;
    } catch (e) {
      budget.bodiesRemaining += 1;
      // Cancellation must stop the whole run; anything else (missing id, IMAP stream failure, timeout)
      // just skips this one message so the report can proceed with what it has.
      if ((e as Error).name === "AbortError") throw e;
      console.warn(`REPORT: get_messages could not load id=${id}:`, e);
      skipped.push({
        id,
        reason: `Could not read message ${id} (${(e as Error).message}). It may be unavailable/offline — continue with the other messages.`,
      });
    }
  }

  console.log(
    `REPORT: get_messages loaded=${messages.length} skipped=${skipped.length} ` +
      `(bodiesRemaining=${budget.bodiesRemaining}, charsRemaining=${budget.charsRemaining}, elapsedMs=${Date.now() - startedAt})`,
  );
  return { messages, skipped };
}

/** Strip leading reply/forward prefixes (Re:, AW:, Fwd:, WG: …) so a thread's messages normalise alike. */
function normalizeSubject(subject: string): string {
  let s = (subject ?? "").trim();
  for (;;) {
    const stripped = s.replace(/^(re|aw|fwd?|wg|antw)(\[\d+\])?\s*:\s*/i, "").trim();
    if (stripped === s) break;
    s = stripped;
  }
  return s.toLowerCase();
}

/** Parse a header value holding one or more angle-bracketed message-ids into a clean list. */
function parseMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  return (value.match(/<[^>]+>/g) ?? [value.trim()]).map((m) => m.replace(/[<>]/g, "").trim()).filter(Boolean);
}

async function handleGetThread(
  args: Record<string, unknown>,
  scope: ReportScope,
  abortSignal: AbortSignal,
): Promise<{ messages: SearchHit[]; truncated: boolean }> {
  const startedAt = Date.now();
  const id = typeof args.id === "number" ? args.id : Number(args.id);
  if (!Number.isFinite(id)) {
    throw new Error("get_thread requires a numeric 'id'.");
  }

  let header: browser.messages.MessageHeader;
  try {
    header = await guardedRead<browser.messages.MessageHeader>(
      browser.messages.get(id),
      abortSignal,
      `read message ${id}`,
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // A timeout means the message likely exists but the read stalled — distinguish it from a
    // genuinely invalid id so the model doesn't retry with a "better" id that won't help.
    if (/timed out/i.test((e as Error).message)) {
      throw new Error(
        `Reading message ${id} timed out. The message may exist but could not be read in time; try again or pick a different message. (${(e as Error).message})`,
      );
    }
    throw new Error(
      `No message exists with id ${id}. Use an id returned by a recent search_messages call. (${(e as Error).message})`,
    );
  }

  // The full message is only needed to read References/In-Reply-To. IMAP body streaming can stall or
  // fail ("Error while streaming message … Status …"); if it does, fall back to a subject-only thread
  // lookup rather than failing the whole tool.
  const headers: Record<string, string[]> = {};
  try {
    const full = await guardedRead<browser.messages.MessagePart>(
      browser.messages.getFull(id),
      abortSignal,
      `stream message ${id}`,
    );
    Object.assign(headers, (full.headers ?? {}) as Record<string, string[]>);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    console.warn(`REPORT: get_thread could not stream headers for id=${id}; using subject-only lookup:`, e);
  }

  const selfIds = new Set<string>();
  for (const value of headers["message-id"] ?? []) {
    for (const mid of parseMessageIds(value)) selfIds.add(mid);
  }
  if (header.headerMessageId) selfIds.add(header.headerMessageId);

  // References lists ancestors oldest-first and can hold dozens of ids; each one costs a full mailbox
  // search, so keep only the nearest ancestors (the tail) within the lookup budget.
  const ancestorIds: string[] = [];
  for (const key of ["references", "in-reply-to"]) {
    for (const value of headers[key] ?? []) {
      for (const mid of parseMessageIds(value)) {
        if (!selfIds.has(mid) && !ancestorIds.includes(mid)) ancestorIds.push(mid);
      }
    }
  }
  const droppedRefs = Math.max(0, ancestorIds.length - MAX_THREAD_REFERENCE_LOOKUPS);
  const lookupIds = [...selfIds, ...ancestorIds.slice(droppedRefs)];

  const hits: SearchHit[] = [];
  const seenIds = new Set<number>();
  const cap = scope.maxSearchResults;

  // The requested message always belongs to its own thread; seeding it keeps the result useful even if
  // every lookup below stalls or comes back empty.
  if (typeof header.id === "number") {
    seenIds.add(header.id);
    hits.push(toHit(header));
  }

  // 1) Precise ancestors/self: resolve each referenced Message-ID to a mailbox message. Each lookup is
  // guarded, so one unresponsive search degrades the thread instead of wedging the report run.
  let lookupFailed = false;
  for (const messageId of lookupIds) {
    if (hits.length >= cap) break;
    const page = await guardedQuery(
      () => browser.messages.query({ headerMessageId: messageId } as QueryInfo),
      abortSignal,
      `thread lookup for ${messageId}`,
    );
    // A failed or stalled page means the thread is missing an ancestor, so it must not be reported as complete.
    if (isFailedPage(page)) {
      lookupFailed = true;
      continue;
    }
    for (const msg of page.messages) {
      if (msg.id !== undefined && !seenIds.has(msg.id) && hits.length < cap) {
        seenIds.add(msg.id);
        hits.push(toHit(msg));
      }
    }
  }

  // 2) Siblings/replies (incl. Sent): messages sharing the normalized subject. A full-text query here
  // stalled on IMAP for every call (~25s each), so this is a header-only scan bounded to the thread's
  // time span: from shortly before its earliest known message (or the run window, if earlier) onwards.
  const norm = normalizeSubject(header.subject ?? "");
  let subjectTruncated = false;
  if (norm && hits.length < cap) {
    const knownDates = hits.map((h) => Date.parse(h.date)).filter(Number.isFinite);
    const earliest = Math.min(Date.now(), ...knownDates) - THREAD_SUBJECT_LOOKBACK_DAYS * DAY_MS;
    const fromDate = new Date(Math.min(earliest, Date.now() - scope.defaultDays * DAY_MS));
    const scan = await collectHeaders({ fromDate } as QueryInfo, cap * 2, norm, abortSignal);
    subjectTruncated = scan.truncated;
    for (const hit of scan.hits) {
      if (hits.length >= cap) break;
      if (!seenIds.has(hit.id) && normalizeSubject(hit.subject) === norm) {
        seenIds.add(hit.id);
        hits.push(hit);
      }
    }
  }

  hits.sort((a, b) => a.date.localeCompare(b.date));
  const truncated = hits.length >= cap || droppedRefs > 0 || subjectTruncated || lookupFailed;

  console.log(
    `REPORT: get_thread id=${id} lookups=${lookupIds.length} droppedRefs=${droppedRefs} ` +
      `lookupFailed=${lookupFailed} ` +
      `messages=${hits.length} truncated=${truncated} elapsedMs=${Date.now() - startedAt}`,
  );
  return { messages: hits, truncated };
}

async function handleAggregateMessages(
  args: Record<string, unknown>,
  scope: ReportScope,
  state: ReportToolState,
  abortSignal: AbortSignal,
): Promise<{
  groupBy: string;
  totalMatched: number;
  scanned: number;
  capped: boolean;
  groups: Array<{ key: string; count: number }>;
  note?: string;
}> {
  const startedAt = Date.now();
  const groupBy = typeof args.groupBy === "string" ? args.groupBy : "author";
  const filters = buildFilters(args, scope.defaultDays);
  const queryInfo = filtersToQueryInfo(filters);

  const folderRef = await resolveTargetFolder(scope);
  if (folderRef?.folderId) queryInfo.folderId = folderRef.folderId;

  const countMatches = async (info: QueryInfo, terms: string[] | null, timeoutMs: number) => {
    const counts = new Map<string, number>();
    let scanned = 0;
    let reachedCap = false;
    const { complete, timedOut } = await scanHeaders(info, abortSignal, timeoutMs, (msg) => {
      if (filters.subjectFilter && !(msg.subject ?? "").toLowerCase().includes(filters.subjectFilter)) return true;
      if (terms) {
        const text = headerText(msg);
        if (!terms.some((t) => text.includes(t))) return true;
      }
      scanned++;
      for (const key of groupKeys(msg, groupBy)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      reachedCap = scanned >= MAX_AGGREGATE_SCAN;
      return !reachedCap;
    });
    // A failed or stalled page flags the scan as capped so a partial aggregate is not reported as complete.
    return { counts, scanned, capped: reachedCap || !complete, timedOut };
  };

  // Like search_messages, a stalled full-text aggregate falls back to matching terms against headers.
  let result =
    filters.fullText && state.fullTextUnavailable
      ? undefined
      : await countMatches(queryInfo, null, filters.fullText ? FULL_TEXT_QUERY_TIMEOUT_MS : QUERY_TIMEOUT_MS);
  if (filters.fullText && result?.timedOut) state.fullTextUnavailable = true;
  let note: string | undefined;
  if (!result || (filters.fullText && result.timedOut && result.scanned === 0)) {
    const { fullText: _unused, ...headerQuery } = queryInfo;
    result = await countMatches(headerQuery, queryTerms(filters.fullText ?? ""), QUERY_TIMEOUT_MS);
    note = FULL_TEXT_FALLBACK_NOTE;
  }
  const { counts, scanned, capped } = result;

  const groups = [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  console.log(
    `REPORT: aggregate_messages groupBy=${groupBy} scanned=${scanned} groups=${groups.length} capped=${capped} ` +
      `fullTextFallback=${note !== undefined} elapsedMs=${Date.now() - startedAt}`,
  );
  return { groupBy, totalMatched: scanned, scanned, capped, groups, ...(note ? { note } : {}) };
}

/** Derive the grouping key(s) for a message under the requested `groupBy`. */
function groupKeys(msg: browser.messages.MessageHeader, groupBy: string): string[] {
  switch (groupBy) {
    case "recipient":
      return (msg.recipients ?? []).length ? (msg.recipients as string[]) : ["(none)"];
    case "domain":
      return [parseAddress(msg.author ?? "").domain || "(none)"];
    case "recipientDomain": {
      // Count each distinct recipient domain once per message.
      const domains = new Set(((msg.recipients ?? []) as string[]).map((r) => parseAddress(r).domain).filter(Boolean));
      return domains.size ? [...domains] : ["(none)"];
    }
    case "day":
      return [msg.date ? new Date(msg.date).toISOString().slice(0, 10) : "(no date)"];
    case "subject":
      return [normalizeSubject(msg.subject ?? "") || "(no subject)"];
    default:
      return [msg.author ?? "(unknown)"];
  }
}
