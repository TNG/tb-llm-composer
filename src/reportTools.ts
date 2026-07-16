import { extractTextFromPart, getFoldersForAccount, resolveFolderPath } from "./emailOrganising";
import type { LlmToolDefinition, LlmToolHandler } from "./llmConnection";

const MAX_EMAIL_BODY_CHARS = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Folder/time scope for a single report run, derived from the report window inputs. */
export interface ReportScope {
  folderOnly: boolean;
  folder: { accountId: string; path: string } | null;
  /** When folder-only, also search the account's Sent folder(s) so replies stay in scope. */
  includeSent: boolean;
  defaultDays: number;
  maxSearchResults: number;
}

type QueryInfo = browser.messages._QueryQueryInfo & { folderId?: string };

/** Compact metadata shape returned by `search_messages` (no bodies, to stay token-frugal). */
interface SearchHit {
  id: number;
  date: string;
  author: string;
  recipients: string[];
  subject: string;
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
        "messages, then call get_message for the few whose bodies you actually need.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Full-text search terms (optional)." },
          author: { type: "string", description: "Filter by sender address/name (optional)." },
          subject: { type: "string", description: "Filter by subject (case-insensitive substring; optional)." },
          fromDays: {
            type: "number",
            description: "Only include messages from the last N days (optional; defaults to the run's day window).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_message",
      description: "Fetch the plain-text body (truncated) of a single message by its numeric id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "The message id from search_messages." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

/** Build tool handlers bound to a specific report scope. */
export function createReportToolHandlers(scope: ReportScope): Record<string, LlmToolHandler> {
  return {
    search_messages: (args) => handleSearchMessages(args, scope),
    get_message: (args) => handleGetMessage(args),
  };
}

async function handleSearchMessages(args: Record<string, unknown>, scope: ReportScope): Promise<SearchHit[]> {
  const startedAt = Date.now();
  const queryInfo: QueryInfo = {};

  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (query) queryInfo.fullText = query;

  const author = typeof args.author === "string" ? args.author.trim() : "";
  if (author) queryInfo.author = author;

  // `browser.messages.query`'s `subject` is an exact full-string match, so passing a partial term
  // (e.g. "Schulung") finds nothing. Filter subjects as a case-insensitive substring client-side instead.
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const subjectFilter = subject ? subject.toLowerCase() : "";

  const fromDays = typeof args.fromDays === "number" && args.fromDays > 0 ? args.fromDays : scope.defaultDays;
  if (fromDays > 0) {
    queryInfo.fromDate = new Date(Date.now() - fromDays * DAY_MS);
  }

  // A folder-only search runs once per in-scope folder (target folder, plus Sent when the user
  // opted in). An all-folders search runs a single unrestricted query.
  const folderRefs = await resolveSearchFolders(scope);

  const hits: SearchHit[] = [];
  const seenIds = new Set<number>();
  let pageCount = 0;
  for (const folderRef of folderRefs) {
    if (hits.length >= scope.maxSearchResults) {
      break;
    }
    const folderQuery: QueryInfo = { ...queryInfo };
    if (folderRef?.folderId) {
      folderQuery.folderId = folderRef.folderId;
    } else if (folderRef?.folder) {
      folderQuery.folder = folderRef.folder;
    }

    let page = await browser.messages.query(folderQuery);
    pageCount++;
    collectHits(page.messages, hits, seenIds, scope.maxSearchResults, subjectFilter);
    while (page.id && hits.length < scope.maxSearchResults) {
      page = await browser.messages.continueList(page.id);
      pageCount++;
      collectHits(page.messages, hits, seenIds, scope.maxSearchResults, subjectFilter);
    }
  }

  const fromDateText = queryInfo.fromDate instanceof Date ? queryInfo.fromDate.toISOString().slice(0, 10) : "(none)";
  console.log(
    "REPORT: search_messages completed " +
      `(query='${query || ""}', author='${author || ""}', subject='${subject || ""}', fromDate=${fromDateText}, ` +
      `folderOnly=${scope.folderOnly}, includeSent=${scope.includeSent}, folders=${folderRefs.length}, ` +
      `pages=${pageCount}, hits=${hits.length}/${scope.maxSearchResults}, elapsedMs=${Date.now() - startedAt})`,
  );
  return hits;
}

/** A resolved folder to search, expressed as an id (preferred) or a MailFolder object. */
type FolderRef = { folderId?: string; folder?: browser.folders.MailFolder };

function toFolderRef(folder: browser.folders.MailFolder): FolderRef {
  const folderWithId = folder as browser.folders.MailFolder & { id?: string };
  return folderWithId.id ? { folderId: folderWithId.id } : { folder };
}

/**
 * Resolve which folders a search should cover. Returns `[null]` (unrestricted) for an
 * all-folders search, or the target folder — plus the account's Sent folder(s) when
 * `includeSent` is set — for a folder-only search.
 */
async function resolveSearchFolders(scope: ReportScope): Promise<Array<FolderRef | null>> {
  if (!scope.folderOnly || !scope.folder) {
    return [null];
  }

  console.log(`REPORT: search_messages resolving folder scope '${scope.folder.path}'`);
  const target = await resolveFolderPath(scope.folder.path);
  if (!target) {
    throw new Error(`Could not resolve the active folder "${scope.folder.path}" for a folder-only search.`);
  }

  const refs: FolderRef[] = [toFolderRef(target)];
  if (scope.includeSent) {
    const sentFolders = await findSentFolders(scope.folder.accountId);
    for (const sent of sentFolders) {
      if (sent.path !== target.path) {
        refs.push(toFolderRef(sent));
      }
    }
    console.log(`REPORT: search_messages including ${refs.length - 1} Sent folder(s) in scope`);
  }
  return refs;
}

/** Return the Sent folder(s) for an account, matching either the legacy `type` or `specialUse`. */
async function findSentFolders(accountId: string): Promise<browser.folders.MailFolder[]> {
  try {
    const account = await browser.accounts.get(accountId);
    if (!account) {
      return [];
    }
    const folders = await getFoldersForAccount(account);
    const sent: browser.folders.MailFolder[] = [];
    collectSentFolders(folders, sent);
    return sent;
  } catch (e) {
    console.warn("REPORT: could not resolve Sent folder(s) for account", accountId, e);
    return [];
  }
}

function collectSentFolders(folders: browser.folders.MailFolder[], out: browser.folders.MailFolder[]): void {
  for (const folder of folders) {
    if (folderIsSent(folder)) {
      out.push(folder);
    }
    collectSentFolders(folder.subFolders ?? [], out);
  }
}

function folderIsSent(folder: browser.folders.MailFolder): boolean {
  // `type` is the legacy field; newer Thunderbird uses the `specialUse` string array.
  const withUse = folder as browser.folders.MailFolder & { type?: string; specialUse?: string[] };
  return withUse.type === "sent" || (Array.isArray(withUse.specialUse) && withUse.specialUse.includes("sent"));
}

function collectHits(
  messages: browser.messages.MessageHeader[],
  out: SearchHit[],
  seenIds: Set<number>,
  cap: number,
  subjectFilter: string,
): void {
  for (const msg of messages) {
    if (out.length >= cap) {
      break;
    }
    if (msg.id === undefined || seenIds.has(msg.id)) {
      continue;
    }
    if (subjectFilter && !(msg.subject ?? "").toLowerCase().includes(subjectFilter)) {
      continue;
    }
    seenIds.add(msg.id);
    out.push({
      id: msg.id,
      date: msg.date ? new Date(msg.date).toISOString() : "",
      author: msg.author ?? "",
      recipients: msg.recipients ?? [],
      subject: msg.subject ?? "(no subject)",
    });
  }
}

async function handleGetMessage(args: Record<string, unknown>): Promise<{
  id: number;
  date: string;
  author: string;
  subject: string;
  body: string;
}> {
  const startedAt = Date.now();
  const id = typeof args.id === "number" ? args.id : Number(args.id);
  if (!Number.isFinite(id)) {
    throw new Error("get_message requires a numeric 'id'.");
  }

  console.log(`REPORT: get_message loading id=${id}`);
  let header: browser.messages.MessageHeader;
  let full: browser.messages.MessagePart;
  try {
    header = await browser.messages.get(id);
    full = await browser.messages.getFull(id);
  } catch (e) {
    // The model sometimes invents or reuses a stale id. Return a clear, recoverable hint instead of
    // a bare "Message not found" so it falls back to ids actually returned by search_messages.
    console.warn(`REPORT: get_message could not load id=${id}:`, e);
    throw new Error(
      `No message exists with id ${id}. Only call get_message with an 'id' returned by a recent ` +
        `search_messages result; do not guess ids. Run search_messages again if you need valid ids.`,
    );
  }
  const rawBody = extractTextFromPart(full);
  const body = rawBody.slice(0, MAX_EMAIL_BODY_CHARS);

  console.log(
    `REPORT: get_message loaded id=${id} (bodyChars=${body.length}, truncated=${rawBody.length > MAX_EMAIL_BODY_CHARS}, elapsedMs=${Date.now() - startedAt})`,
  );

  return {
    id,
    date: header.date ? new Date(header.date).toISOString() : "",
    author: header.author ?? "",
    subject: header.subject ?? "(no subject)",
    body,
  };
}
