import { extractTextFromPart, resolveFolderPath } from "./emailOrganising";
import type { LlmToolDefinition, LlmToolHandler } from "./llmConnection";

const MAX_EMAIL_BODY_CHARS = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Folder/time scope for a single report run, derived from the report window inputs. */
export interface ReportScope {
  folderOnly: boolean;
  folder: { accountId: string; path: string } | null;
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

  if (scope.folderOnly && scope.folder) {
    console.log(`REPORT: search_messages resolving folder scope '${scope.folder.path}'`);
    const folder = await resolveFolderPath(scope.folder.path);
    if (!folder) {
      throw new Error(`Could not resolve the active folder "${scope.folder.path}" for a folder-only search.`);
    }
    const folderWithId = folder as browser.folders.MailFolder & { id?: string };
    if (folderWithId.id) {
      queryInfo.folderId = folderWithId.id;
    } else {
      queryInfo.folder = folder;
    }
  }

  const hits: SearchHit[] = [];
  let pageCount = 0;
  let page = await browser.messages.query(queryInfo);
  pageCount++;
  collectHits(page.messages, hits, scope.maxSearchResults, subjectFilter);
  while (page.id && hits.length < scope.maxSearchResults) {
    page = await browser.messages.continueList(page.id);
    pageCount++;
    collectHits(page.messages, hits, scope.maxSearchResults, subjectFilter);
  }

  const fromDateText = queryInfo.fromDate instanceof Date ? queryInfo.fromDate.toISOString().slice(0, 10) : "(none)";
  console.log(
    "REPORT: search_messages completed " +
      `(query='${query || ""}', author='${author || ""}', subject='${subject || ""}', fromDate=${fromDateText}, ` +
      `folderOnly=${scope.folderOnly}, pages=${pageCount}, hits=${hits.length}/${scope.maxSearchResults}, ` +
      `elapsedMs=${Date.now() - startedAt})`,
  );
  return hits;
}

function collectHits(
  messages: browser.messages.MessageHeader[],
  out: SearchHit[],
  cap: number,
  subjectFilter: string,
): void {
  for (const msg of messages) {
    if (out.length >= cap) {
      break;
    }
    if (msg.id === undefined) {
      continue;
    }
    if (subjectFilter && !(msg.subject ?? "").toLowerCase().includes(subjectFilter)) {
      continue;
    }
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
