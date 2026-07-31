import { extractTextFromPart, resolveFolderPath } from "./emailOrganising";
import type { LlmToolDefinition, LlmToolHandler } from "./llmConnection";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Safety ceiling on how many headers aggregate_messages will enumerate (local paging, no bodies). */
const MAX_AGGREGATE_SCAN = 5000;
/** IMAP message reads can stall or fail mid-stream; bound each read with this timeout. */
const MESSAGE_READ_TIMEOUT_MS = 20_000;

/**
 * Await a mailbox read (get/getFull), rejecting if it stalls past {@link MESSAGE_READ_TIMEOUT_MS} or
 * the run is aborted. IMAP body streaming can hang or throw ("Error while streaming message … Status
 * …"); without this guard the whole report loop would block on one bad message and Stop could not
 * interrupt it. Aborts reject with an AbortError so callers can propagate cancellation.
 */
function guardedRead<T>(operation: Promise<T>, abortSignal: AbortSignal, what: string): Promise<T> {
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
      reject(new Error(`${what} timed out after ${MESSAGE_READ_TIMEOUT_MS / 1000}s`));
    }, MESSAGE_READ_TIMEOUT_MS);
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

/** Compact metadata shape returned by search/thread tools (no bodies, to stay token-frugal). */
interface SearchHit {
  id: number;
  date: string;
  author: ParsedAddress;
  recipients: ParsedAddress[];
  subject: string;
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
        "narrow the query (add filters or shorten the time window) rather than reporting on a partial set.",
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
        "can be read; any ids beyond the budget are returned in `skipped` — summarize with what you have.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "number" },
            description: "Message ids from a recent search_messages / get_thread result.",
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
  return {
    search_messages: (args) => handleSearchMessages(args, scope, abortSignal),
    get_messages: (args) => handleGetMessages(args, budget, abortSignal),
    get_thread: (args) => handleGetThread(args, scope, abortSignal),
    aggregate_messages: (args) => handleAggregateMessages(args, scope, abortSignal),
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

async function handleSearchMessages(
  args: Record<string, unknown>,
  scope: ReportScope,
  abortSignal: AbortSignal,
): Promise<{ hits: SearchHit[]; returned: number; truncated: boolean }> {
  const startedAt = Date.now();
  const filters = buildFilters(args, scope.defaultDays);
  const queryInfo = filtersToQueryInfo(filters);

  // search_messages honours the folder-only scope; an all-folders search is unrestricted.
  const folderRef = await resolveTargetFolder(scope);
  if (folderRef?.folderId) queryInfo.folderId = folderRef.folderId;

  const { hits, truncated } = await collectHeaders(
    queryInfo,
    scope.maxSearchResults,
    filters.subjectFilter,
    abortSignal,
  );

  console.log(
    "REPORT: search_messages completed " +
      `(query='${filters.fullText ?? ""}', author='${filters.author ?? ""}', subject='${filters.subjectFilter}', ` +
      `folderOnly=${scope.folderOnly}, returned=${hits.length}/${scope.maxSearchResults}, truncated=${truncated}, ` +
      `elapsedMs=${Date.now() - startedAt})`,
  );
  return { hits, returned: hits.length, truncated };
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
 * matching messages exist beyond the cap so the model can choose to narrow instead of guessing.
 */
async function collectHeaders(
  queryInfo: QueryInfo,
  cap: number,
  subjectFilter: string,
  abortSignal: AbortSignal,
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  const hits: SearchHit[] = [];
  const seenIds = new Set<number>();
  let truncated = false;

  let page = await browser.messages.query(queryInfo);
  for (;;) {
    throwIfAborted(abortSignal);
    for (const msg of page.messages) {
      if (msg.id === undefined || seenIds.has(msg.id)) continue;
      if (subjectFilter && !(msg.subject ?? "").toLowerCase().includes(subjectFilter)) continue;
      if (hits.length >= cap) {
        truncated = true;
        break;
      }
      seenIds.add(msg.id);
      hits.push(toHit(msg));
    }
    if (truncated || !page.id) break;
    page = await browser.messages.continueList(page.id);
  }
  return { hits, truncated };
}

function toHit(msg: browser.messages.MessageHeader): SearchHit {
  return {
    id: msg.id as number,
    date: msg.date ? new Date(msg.date).toISOString() : "",
    author: parseAddress(msg.author ?? ""),
    recipients: (msg.recipients ?? []).map(parseAddress),
    subject: msg.subject ?? "(no subject)",
  };
}

async function handleGetMessages(
  args: Record<string, unknown>,
  budget: BodyBudget,
  abortSignal: AbortSignal,
): Promise<{
  messages: Array<{
    id: number;
    date: string;
    author: ParsedAddress;
    recipients: ParsedAddress[];
    subject: string;
    body: string;
  }>;
  skipped: Array<{ id: number; reason: string }>;
}> {
  const startedAt = Date.now();
  const rawIds = Array.isArray(args.ids) ? args.ids : [];
  const ids = rawIds.map((v) => (typeof v === "number" ? v : Number(v))).filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    throw new Error("get_messages requires a non-empty 'ids' array of numeric message ids.");
  }

  const messages: Array<{
    id: number;
    date: string;
    author: ParsedAddress;
    recipients: ParsedAddress[];
    subject: string;
    body: string;
  }> = [];
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
      const body = extractTextFromPart(full);
      messages.push({
        id,
        date: header.date ? new Date(header.date).toISOString() : "",
        author: parseAddress(header.author ?? ""),
        recipients: (header.recipients ?? []).map(parseAddress),
        subject: header.subject ?? "(no subject)",
        body,
      });
      budget.bodiesRemaining -= 1;
      budget.charsRemaining -= body.length;
    } catch (e) {
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

  const relatedIds = new Set<string>();
  for (const key of ["message-id", "references", "in-reply-to"]) {
    for (const value of headers[key] ?? []) {
      for (const mid of parseMessageIds(value)) relatedIds.add(mid);
    }
  }
  if (header.headerMessageId) relatedIds.add(header.headerMessageId);

  const hits: SearchHit[] = [];
  const seenIds = new Set<number>();
  const cap = scope.maxSearchResults;

  // 1) Precise ancestors/self: resolve each referenced Message-ID to a mailbox message.
  for (const messageId of relatedIds) {
    if (hits.length >= cap) break;
    throwIfAborted(abortSignal);
    try {
      const page = await browser.messages.query({ headerMessageId: messageId } as QueryInfo);
      for (const msg of page.messages) {
        if (msg.id !== undefined && !seenIds.has(msg.id) && hits.length < cap) {
          seenIds.add(msg.id);
          hits.push(toHit(msg));
        }
      }
    } catch (e) {
      console.warn(`REPORT: get_thread headerMessageId lookup failed for ${messageId}:`, e);
    }
  }

  // 2) Siblings/replies (incl. Sent): messages sharing the normalized subject. fullText narrows the
  // scan server-side; we then keep only exact normalized-subject matches.
  const norm = normalizeSubject(header.subject ?? "");
  if (norm && hits.length < cap) {
    const { hits: subjectHits } = await collectHeaders({ fullText: norm } as QueryInfo, cap * 2, "", abortSignal);
    for (const hit of subjectHits) {
      if (hits.length >= cap) break;
      if (!seenIds.has(hit.id) && normalizeSubject(hit.subject) === norm) {
        seenIds.add(hit.id);
        hits.push(hit);
      }
    }
  }

  hits.sort((a, b) => a.date.localeCompare(b.date));
  const truncated = hits.length >= cap;

  console.log(
    `REPORT: get_thread id=${id} related=${relatedIds.size} messages=${hits.length} truncated=${truncated} ` +
      `elapsedMs=${Date.now() - startedAt}`,
  );
  return { messages: hits, truncated };
}

async function handleAggregateMessages(
  args: Record<string, unknown>,
  scope: ReportScope,
  abortSignal: AbortSignal,
): Promise<{
  groupBy: string;
  totalMatched: number;
  scanned: number;
  capped: boolean;
  groups: Array<{ key: string; count: number }>;
}> {
  const startedAt = Date.now();
  const groupBy = typeof args.groupBy === "string" ? args.groupBy : "author";
  const filters = buildFilters(args, scope.defaultDays);
  const queryInfo = filtersToQueryInfo(filters);

  const folderRef = await resolveTargetFolder(scope);
  if (folderRef?.folderId) queryInfo.folderId = folderRef.folderId;

  const counts = new Map<string, number>();
  let scanned = 0;
  let capped = false;
  const seenIds = new Set<number>();

  let page = await browser.messages.query(queryInfo);
  outer: for (;;) {
    throwIfAborted(abortSignal);
    for (const msg of page.messages) {
      if (msg.id === undefined || seenIds.has(msg.id)) continue;
      if (filters.subjectFilter && !(msg.subject ?? "").toLowerCase().includes(filters.subjectFilter)) continue;
      seenIds.add(msg.id);
      scanned++;
      for (const key of groupKeys(msg, groupBy)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (scanned >= MAX_AGGREGATE_SCAN) {
        capped = true;
        break outer;
      }
    }
    if (!page.id) break;
    page = await browser.messages.continueList(page.id);
  }

  const groups = [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  console.log(
    `REPORT: aggregate_messages groupBy=${groupBy} scanned=${scanned} groups=${groups.length} capped=${capped} ` +
      `elapsedMs=${Date.now() - startedAt}`,
  );
  return { groupBy, totalMatched: scanned, scanned, capped, groups };
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
