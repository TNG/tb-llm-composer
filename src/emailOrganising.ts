import { isLlmTextCompletionResponse, LlmRoles, sendContentToLlm } from "./llmConnection";
import { timedNotification } from "./notifications";
import { type FolderRule, getPluginOptions } from "./optionsParams";
import { stripHtml } from "./utils";

const BATCH_ORGANISING_SYSTEM_PROMPT = `You are an email organisation assistant.
You will be given:
- A numbered list of folder categories with descriptions
- Multiple emails, each with a stable numeric id

Organise each email into exactly one folder index (1-based), or null when no folder fits.

Respond with JSON only in this exact shape:
{"classifications":[{"id":123,"folder":1},{"id":124,"folder":null}]}

Rules:
- Use only folder indexes that exist in the provided folder list
- Keep every provided id exactly once in the output
- No markdown, no prose, no code fences.`;

const MAX_EMAIL_BODY_CHARS = 1200;
const BATCH_SIZE = 15;

type MessageForOrganising = {
  message: browser.messages.MessageHeader;
  refId: number;
  sender: string;
  subject: string;
  body: string;
};

/** The folder an organise run reads from (also the undo/keep-in-place target). */
export interface MoveSource {
  accountId: string;
  path: string;
  name: string;
}

/** Outcome of an automatic organise run: honest per-email tallies. */
export interface OrganiseResult {
  moved: number;
  keptInPlace: number;
  errors: number;
  aborted: boolean;
}

/** A destination folder offered in the confirmation popup, index-aligned with the configured rules. */
export interface OrganiseFolderOption {
  path: string;
  name: string;
}

/** One email in the confirmation popup, with the folder the model proposed (null = keep in place). */
export interface OrganisePlanEntry {
  messageId: number;
  author: string;
  subject: string;
  proposedFolderIndex: number | null;
}

/**
 * A proposed organisation the user confirms before anything moves. `resolvedFolders` (live MailFolder
 * objects, index-aligned with `folders`) is kept in the background only — the popup receives just the
 * serialisable `entries`, `folders`, and source name.
 */
export interface OrganisePlan {
  entries: OrganisePlanEntry[];
  folders: OrganiseFolderOption[];
  resolvedFolders: Array<browser.folders.MailFolder | null>;
  source: MoveSource | null;
}

/** A confirmed assignment from the popup: which folder each message should go to (null = keep in place). */
export interface OrganiseAssignment {
  messageId: number;
  folderIndex: number | null;
}

/** Mutable per-run state shared across chunk classifications (e.g. whether the endpoint accepts JSON mode). */
interface ClassifyRunState {
  jsonModeSupported: boolean;
}

function buildBatchOrganisingPrompt(rules: FolderRule[], messages: MessageForOrganising[]): string {
  const folderList = rules.map((rule, index) => `${index + 1}. ${rule.folderPath} — ${rule.description}`).join("\n");
  const emailBlocks = messages
    .map(
      (entry) =>
        `ID: ${entry.refId}\nFrom: ${entry.sender}\nSubject: ${entry.subject}\nBody:\n${entry.body.slice(0, MAX_EMAIL_BODY_CHARS)}`,
    )
    .join("\n\n-----\n\n");
  return `Folders:\n${folderList}\n\nEmails:\n${emailBlocks}`;
}

function chunk<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize));
  }
  return chunks;
}

/**
 * Parse an LLM classification response into a map of message id → folder index (0-based, null for
 * unclassified). `parsedOk` distinguishes a genuine, understood reply (even if every email was left
 * unclassified) from an unparseable one, so callers can retry the latter instead of silently treating
 * a broken reply as "no folder fits".
 */
function parseBatchOrganisingResponse(
  rawResponse: string,
  expectedIds: number[],
  rulesCount: number,
): { classifications: Map<number, number | null>; parsedOk: boolean } {
  const result = new Map<number, number | null>(expectedIds.map((id) => [id, null]));
  const parseInput = extractJsonObject(rawResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(parseInput);
  } catch {
    return { classifications: result, parsedOk: false };
  }

  const organisationDecisions =
    parsed && typeof parsed === "object" && "classifications" in parsed
      ? (parsed as { classifications?: unknown }).classifications
      : undefined;

  if (!Array.isArray(organisationDecisions)) {
    return { classifications: result, parsedOk: false };
  }

  for (const item of organisationDecisions) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const maybeId = (item as { id?: unknown }).id;
    if (typeof maybeId !== "number" || !result.has(maybeId)) {
      continue;
    }

    const maybeFolder = (item as { folder?: unknown }).folder;
    if (maybeFolder === null || maybeFolder === "NONE") {
      result.set(maybeId, null);
      continue;
    }

    if (typeof maybeFolder === "number" && maybeFolder >= 1 && maybeFolder <= rulesCount) {
      result.set(maybeId, maybeFolder - 1);
    }
  }

  return { classifications: result, parsedOk: true };
}

/** Extract JSON object from raw response, stripping think tags and handling markdown code fences. */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();

  const withoutThinkTags = trimmed
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .trim();

  if (withoutThinkTags.startsWith("{")) {
    return withoutThinkTags;
  }

  const codeFenceMatch = withoutThinkTags.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch?.[1]) {
    return codeFenceMatch[1].trim();
  }

  const firstBrace = withoutThinkTags.indexOf("{");
  const lastBrace = withoutThinkTags.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return withoutThinkTags.slice(firstBrace, lastBrace + 1).trim();
  }

  return withoutThinkTags;
}

/** Get folder list for account, using folders API if account.folders is unavailable (MV3 quirk). */
export async function getFoldersForAccount(
  account: browser.accounts.MailAccount,
): Promise<browser.folders.MailFolder[]> {
  // In MV3, accounts.list() may omit account.folders; fetch folder tree via folders API.
  if (account.folders && account.folders.length > 0) {
    return account.folders;
  }
  // browser.folders.getSubFolders expects a MailFolder (the account's root folder),
  // not the MailAccount object itself — passing the account throws
  // "Incorrect argument types for folders.getSubFolders".
  const rootFolder = account.rootFolder;
  if (!rootFolder) {
    return [];
  }
  // Prefer the canonical MailFolderId string when available. In recent
  // Thunderbird versions the rootFolder object returned by accounts.list()
  // may not validate against the MailFolder schema expected by
  // getSubFolders (causing "Incorrect argument types"), whereas the plain
  // id string is always accepted. Fall back to the object for older builds.
  const folderRef = rootFolder.id ?? rootFolder;
  try {
    return await browser.folders.getSubFolders(folderRef, true);
  } catch (e) {
    console.warn("ORGANISE: Could not read folders for account", account.id, e);
    return [];
  }
}

/** Resolve a folderPath string like "/INBOX/Work" to a MailFolder object. */
export async function resolveFolderPath(folderPath: string): Promise<browser.folders.MailFolder | null> {
  const accounts = await browser.accounts.list(true);
  for (const account of accounts) {
    const foundInRoot = account.rootFolder?.path === folderPath ? account.rootFolder : null;
    if (foundInRoot) return foundInRoot;

    const accountFolders = await getFoldersForAccount(account);
    const found = findFolderInTree(accountFolders, folderPath);
    if (found) return found;
  }
  return null;
}

function findFolderInTree(folders: browser.folders.MailFolder[], path: string): browser.folders.MailFolder | null {
  for (const folder of folders) {
    if (folder.path === path) return folder;
    const sub = findFolderInTree(folder.subFolders ?? [], path);
    if (sub) return sub;
  }
  return null;
}

/** Return a flat list of all folder paths across all accounts (for diagnostics / options UI). */
export async function getAllFolderPaths(): Promise<string[]> {
  const accounts = await browser.accounts.list(true);
  const paths = new Set<string>();

  for (const account of accounts) {
    if (account.rootFolder?.path) {
      paths.add(account.rootFolder.path);
    }
    collectPaths(await getFoldersForAccount(account), paths);
  }

  return Array.from(paths);
}

function collectPaths(folders: browser.folders.MailFolder[], out: Set<string>) {
  for (const f of folders) {
    out.add(f.path);
    collectPaths(f.subFolders ?? [], out);
  }
}

/**
 * Return the active mail tab's displayed folder across normal mail windows. Unlike a
 * `currentWindow` query this ignores extension popup windows, so it keeps working when the
 * caller was triggered from the action popup or a report window.
 */
export async function getActiveMailFolder(): Promise<browser.folders.MailFolder | undefined> {
  const mailTabs = await browser.mailTabs.query({ active: true });
  for (const mailTab of mailTabs) {
    if (mailTab.displayedFolder) {
      return mailTab.displayedFolder;
    }
  }
  return undefined;
}

function isIncorrectMessagesListArgumentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Incorrect argument types for messages.list");
}

function isIncorrectMessagesMoveArgumentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Incorrect argument types for messages.move");
}

/** List folder messages, trying folder ID first for newer Thunderbird builds, then fallback to MailFolder object. */
async function listFolderMessages(
  displayedFolder: browser.folders.MailFolder,
): Promise<Awaited<ReturnType<typeof browser.messages.list>>> {
  const folderWithId = displayedFolder as browser.folders.MailFolder & { id?: string };

  // In newer Thunderbird builds, messages.list is more reliable when using the
  // canonical folder id string instead of a MailFolder object.
  if (folderWithId.id) {
    try {
      return await browser.messages.list(folderWithId.id as unknown as browser.folders.MailFolder);
    } catch (error) {
      if (!isIncorrectMessagesListArgumentError(error)) {
        throw error;
      }
      console.warn("ORGANISE: messages.list rejected folder id, retrying with MailFolder object", error);
    }
  }

  if (!displayedFolder.accountId || !displayedFolder.path) {
    throw new Error("Could not resolve the currently displayed folder.");
  }

  // Build a minimal serialisable MailFolder shape for strict schema validation.
  const folderObject: browser.folders.MailFolder = {
    accountId: displayedFolder.accountId,
    path: displayedFolder.path,
    name: displayedFolder.name ?? displayedFolder.path,
  };

  return browser.messages.list(folderObject);
}

/** Move one or more messages to target folder, trying folder ID first, then fallback to MailFolder object. */
export async function moveMessagesToFolder(
  messageIds: number[],
  targetFolder: browser.folders.MailFolder,
): Promise<void> {
  const folderWithId = targetFolder as browser.folders.MailFolder & { id?: string };
  if (folderWithId.id) {
    try {
      await browser.messages.move(messageIds, folderWithId.id as unknown as browser.folders.MailFolder);
      return;
    } catch (error) {
      if (!isIncorrectMessagesMoveArgumentError(error)) {
        throw error;
      }
      console.warn("ORGANISE: messages.move rejected folder id, retrying with MailFolder object", error);
    }
  }

  const fallbackFolder: browser.folders.MailFolder = {
    accountId: targetFolder.accountId,
    path: targetFolder.path,
    name: targetFolder.name,
  };
  await browser.messages.move(messageIds, fallbackFolder);
}

/** Shared setup for both organise paths: everything needed before classification. */
interface PreparedOrganise {
  rules: FolderRule[];
  resolvedFolders: Array<browser.folders.MailFolder | null>;
  source: MoveSource | null;
  messages: MessageForOrganising[];
}

/**
 * Validate configuration, resolve destination folders, read the displayed folder's messages, and load
 * their (cleaned) bodies. Throws with an actionable message for misconfiguration; returns null (after a
 * notification) when there is nothing to organise.
 */
async function prepareOrganise(): Promise<PreparedOrganise | null> {
  const options = await getPluginOptions();
  const rules = options.folderSortingRules ?? [];

  if (rules.length === 0) {
    throw new Error("No folder organisation rules configured. Please add rules in the extension options.");
  }

  // Resolve destination folders up front so we can warn early about bad paths.
  const resolvedFolders: Array<browser.folders.MailFolder | null> = await Promise.all(
    rules.map((r: FolderRule) => resolveFolderPath(r.folderPath)),
  );

  const unresolvedPaths = rules
    .filter((_: FolderRule, i: number) => resolvedFolders[i] === null)
    .map((r: FolderRule) => r.folderPath);
  if (unresolvedPaths.length > 0) {
    const available = await getAllFolderPaths();
    console.warn("ORGANISE: Could not resolve folder paths:", unresolvedPaths);
    console.info("ORGANISE: Available folder paths:", available);
    throw new Error(
      `Could not find these folder paths: ${unresolvedPaths.join(", ")}\n\n` +
        `Available paths:\n${available.join("\n")}\n\n` +
        `Please update your folder organisation rules in the extension options.`,
    );
  }

  // Get active mail tab and its current folder.
  const sourceFolder = await getActiveMailFolder();
  if (!sourceFolder) {
    throw new Error("No folder is currently displayed. Open a mail folder first.");
  }

  console.log("ORGANISE: displayedFolder raw:", JSON.stringify(sourceFolder));

  // Collect all messages (the API pages results).
  const allMessages: browser.messages.MessageHeader[] = [];
  let page = await listFolderMessages(sourceFolder);
  allMessages.push(...page.messages);
  while (page.id) {
    page = await browser.messages.continueList(page.id);
    allMessages.push(...page.messages);
  }

  if (allMessages.length === 0) {
    await timedNotification("Organise Folder", "The folder is empty — nothing to organise.", 5000);
    return null;
  }

  // Fetch bodies in bounded batches (reusing the classifier's BATCH_SIZE) rather than firing one
  // getFull per message at once, which would flood the API on large folders.
  const messages: MessageForOrganising[] = [];
  let index = 0;
  for (const batch of chunk(allMessages, BATCH_SIZE)) {
    const built = await Promise.all(
      batch.map(async (msg, offset) => {
        let body = "";
        try {
          if (msg.id !== undefined) {
            const full = await browser.messages.getFull(msg.id);
            body = cleanEmailBody(extractTextFromPart(full));
          }
        } catch {
          body = "";
        }

        return {
          message: msg,
          refId: msg.id ?? -(index + offset + 1),
          sender: msg.author ?? "",
          subject: msg.subject ?? "(no subject)",
          body,
        };
      }),
    );
    index += batch.length;
    messages.push(...built);
  }

  const source: MoveSource | null =
    sourceFolder.accountId && sourceFolder.path
      ? { accountId: sourceFolder.accountId, path: sourceFolder.path, name: sourceFolder.name ?? sourceFolder.path }
      : null;

  return { rules, resolvedFolders, source, messages };
}

/**
 * Classify and move the displayed folder's messages automatically, one chunk at a time so already-
 * classified emails move immediately (durable if the run is aborted mid-way). Shows a summary
 * notification. Used when the user has NOT opted into confirming moves.
 */
export async function organiseCurrentFolder(
  abortSignal: AbortSignal,
  onProgress?: (percent: number) => void | Promise<void>,
): Promise<OrganiseResult> {
  const prepared = await prepareOrganise();
  if (!prepared) {
    return { moved: 0, keptInPlace: 0, errors: 0, aborted: false };
  }
  const { rules, resolvedFolders, source, messages } = prepared;

  const chunks = chunk(messages, BATCH_SIZE);
  let moved = 0;
  let keptInPlace = 0;
  let errors = 0;
  let processed = 0;
  let aborted = false;
  const classifyState: ClassifyRunState = { jsonModeSupported: true };

  await reportProgress(onProgress, 0);

  for (const entriesChunk of chunks) {
    if (abortSignal.aborted) {
      aborted = true;
      break;
    }

    let classified: { classifications: Map<number, number | null>; ok: boolean };
    try {
      classified = await classifyChunk(rules, entriesChunk, abortSignal, classifyState);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        aborted = true;
        break;
      }
      // A failed request means we could not classify this batch at all — count it as errors, not
      // as a deliberate decision to keep the emails in place.
      console.warn("ORGANISE: LLM call failed for batch", e);
      errors += entriesChunk.length;
      processed += entriesChunk.length;
      await reportProgress(onProgress, Math.round((processed / messages.length) * 100));
      continue;
    }

    if (!classified.ok) {
      // The endpoint replied but we could not understand it even after a retry — surface as errors.
      errors += entriesChunk.length;
      processed += entriesChunk.length;
      await reportProgress(onProgress, Math.round((processed / messages.length) * 100));
      continue;
    }

    const chunkResult = await moveClassifiedMessages(
      entriesChunk,
      classified.classifications,
      resolvedFolders,
      source?.path,
      abortSignal,
    );
    moved += chunkResult.moved;
    keptInPlace += chunkResult.keptInPlace;
    errors += chunkResult.errors;
    aborted = aborted || chunkResult.aborted;

    processed += entriesChunk.length;
    await reportProgress(onProgress, Math.round((processed / messages.length) * 100));

    if (aborted) break;
  }

  await notifyOrganiseSummary({ moved, keptInPlace, errors, aborted });
  return { moved, keptInPlace, errors, aborted };
}

/**
 * Classify the displayed folder's messages WITHOUT moving anything, returning a plan the user confirms
 * (and edits) in the popup before any move happens. Used when the user has opted into confirming moves.
 * Returns null when there is nothing to organise.
 */
export async function planOrganiseCurrentFolder(
  abortSignal: AbortSignal,
  onProgress?: (percent: number) => void | Promise<void>,
): Promise<OrganisePlan | null> {
  const prepared = await prepareOrganise();
  if (!prepared) {
    return null;
  }
  const { rules, resolvedFolders, source, messages } = prepared;

  const chunks = chunk(messages, BATCH_SIZE);
  const assignments = new Map<number, number | null>();
  const classifyState: ClassifyRunState = { jsonModeSupported: true };
  let processed = 0;

  await reportProgress(onProgress, 0);

  for (const entriesChunk of chunks) {
    if (abortSignal.aborted) {
      break;
    }
    try {
      const classified = await classifyChunk(rules, entriesChunk, abortSignal, classifyState);
      if (classified.ok) {
        for (const entry of entriesChunk) {
          assignments.set(entry.refId, classified.classifications.get(entry.refId) ?? null);
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        break;
      }
      // Leave this batch unassigned (proposed "keep in place"); the user can still assign it manually.
      console.warn("ORGANISE: classification failed for batch (plan)", e);
    }
    processed += entriesChunk.length;
    await reportProgress(onProgress, Math.round((processed / messages.length) * 100));
  }

  const folders: OrganiseFolderOption[] = rules.map((rule, index) => ({
    path: rule.folderPath,
    name: resolvedFolders[index]?.name ?? rule.folderPath,
  }));

  // Only movable messages (those with an id) can appear in the plan.
  const entries: OrganisePlanEntry[] = messages
    .filter((entry) => entry.message.id !== undefined)
    .map((entry) => ({
      messageId: entry.message.id as number,
      author: entry.sender,
      subject: entry.subject,
      proposedFolderIndex: assignments.get(entry.refId) ?? null,
    }));

  return { entries, folders, resolvedFolders, source };
}

/** Apply the user-confirmed assignments from the confirmation popup and show a summary notification. */
export async function applyOrganisePlan(
  assignments: OrganiseAssignment[],
  resolvedFolders: Array<browser.folders.MailFolder | null>,
  source: MoveSource | null,
  abortSignal: AbortSignal,
): Promise<OrganiseResult> {
  const result = await executeMoves(assignments, resolvedFolders, source?.path, abortSignal);
  await notifyOrganiseSummary(result);
  return result;
}

/** Show the standard end-of-run summary notification. */
async function notifyOrganiseSummary(result: OrganiseResult): Promise<void> {
  const errorSuffix = result.errors > 0 ? ` ${result.errors} email(s) could not be processed.` : "";
  await timedNotification(
    result.aborted ? "Organise Folder Aborted" : "Organise Folder Complete",
    result.aborted
      ? `Aborted. Moved ${result.moved} email(s) so far. ${result.keptInPlace} email(s) kept in place.${errorSuffix}`
      : `Moved ${result.moved} email(s). ${result.keptInPlace} email(s) kept in place.${errorSuffix}`,
    10000,
  );
}

async function reportProgress(
  onProgress: ((percent: number) => void | Promise<void>) | undefined,
  percent: number,
): Promise<void> {
  try {
    await onProgress?.(percent);
  } catch (e) {
    console.warn("ORGANISE: progress callback failed", e);
  }
}

/** Result of one LLM classification attempt for a chunk. */
interface ClassificationAttempt {
  classifications: Map<number, number | null>;
  /** True when the reply was understood (valid JSON with a classifications array). */
  ok: boolean;
  /** The raw reply text, or null when the endpoint returned an error / no content. */
  raw: string | null;
  /** True when the endpoint itself rejected the request (error response / no content). */
  endpointError: boolean;
}

/** Send one classification request and interpret the reply. */
async function requestClassification(
  messages: Parameters<typeof sendContentToLlm>[0],
  expectedIds: number[],
  rulesCount: number,
  abortSignal: AbortSignal,
  useJsonMode: boolean,
): Promise<ClassificationAttempt> {
  const fallback = new Map<number, number | null>(expectedIds.map((id) => [id, null]));

  const response = await sendContentToLlm(messages, abortSignal, useJsonMode ? { type: "json_object" } : undefined);

  if (!isLlmTextCompletionResponse(response)) {
    console.warn("ORGANISE: LLM error response for batch", response);
    return { classifications: fallback, ok: false, raw: null, endpointError: true };
  }

  const firstChoice = Array.isArray(response.choices) ? response.choices[0] : undefined;
  const raw = firstChoice && typeof firstChoice.message?.content === "string" ? firstChoice.message.content : null;
  if (raw === null) {
    console.error("ORGANISE: LLM batch response missing choices[0].message.content", response);
    return { classifications: fallback, ok: false, raw: null, endpointError: true };
  }
  console.log("ORGANISE: LLM batch reply:", raw);

  const { classifications, parsedOk } = parseBatchOrganisingResponse(raw, expectedIds, rulesCount);
  return { classifications, ok: parsedOk, raw, endpointError: false };
}

/**
 * Classify a single chunk of messages via the LLM, mapping refId → folder index (null when unclassified).
 * A first attempt asks for JSON output mode; if the reply is unparseable (or the endpoint rejects JSON
 * mode) it retries once with a corrective instruction. `ok` is false only when both attempts fail, so
 * callers can report those emails as errors rather than as deliberate "kept in place" decisions.
 */
async function classifyChunk(
  rules: FolderRule[],
  entriesChunk: MessageForOrganising[],
  abortSignal: AbortSignal,
  state: ClassifyRunState,
): Promise<{ classifications: Map<number, number | null>; ok: boolean }> {
  const expectedIds = entriesChunk.map((entry) => entry.refId);
  const messages = [
    { role: LlmRoles.SYSTEM, content: BATCH_ORGANISING_SYSTEM_PROMPT },
    { role: LlmRoles.USER, content: buildBatchOrganisingPrompt(rules, entriesChunk) },
  ];

  // Attempt 1: prefer JSON output mode, unless a previous chunk showed the endpoint rejects it.
  // Some endpoints reject the `response_format` field with an HTTP error (a thrown exception rather
  // than an error response), so guard the call: if JSON mode was on, treat any failure as "endpoint
  // does not support JSON mode", disable it, and fall through to a plain-text retry.
  let first: ClassificationAttempt | null = null;
  try {
    first = await requestClassification(messages, expectedIds, rules.length, abortSignal, state.jsonModeSupported);
  } catch (e) {
    if ((e as Error).name === "AbortError" || (e as Error).name === "TimeoutError") {
      throw e;
    }
    if (!state.jsonModeSupported) {
      throw e; // Not a JSON-mode issue — let the caller record this batch as an error.
    }
    console.warn("ORGANISE: request failed with JSON output mode on; retrying without it", e);
  }

  if (first?.ok) {
    return { classifications: first.classifications, ok: true };
  }

  // If JSON mode was on and the endpoint threw or returned an error (as opposed to merely producing an
  // unparseable reply), assume it does not support JSON mode and stop asking for the rest of the run.
  if (state.jsonModeSupported && (first === null || first.endpointError)) {
    console.warn("ORGANISE: disabling JSON output mode for the remainder of this run");
    state.jsonModeSupported = false;
  }

  // Attempt 2: plain-text retry. Show the model its unparseable reply (when we have one) and insist on JSON.
  const retryMessages = [...messages];
  if (first?.raw != null) {
    retryMessages.push({ role: LlmRoles.ASSISTANT, content: first.raw });
    retryMessages.push({
      role: LlmRoles.USER,
      content:
        "Your previous reply could not be parsed. Respond again with ONLY the JSON object described earlier — " +
        "no prose, no code fences, no <think> block.",
    });
  }
  const second = await requestClassification(retryMessages, expectedIds, rules.length, abortSignal, false);
  return { classifications: second.classifications, ok: second.ok };
}

/** Turn a chunk's classifications into move decisions and execute them (used by the automatic path). */
async function moveClassifiedMessages(
  entries: MessageForOrganising[],
  organisation: Map<number, number | null>,
  resolvedFolders: Array<browser.folders.MailFolder | null>,
  sourceFolderPath: string | undefined,
  abortSignal: AbortSignal,
): Promise<OrganiseResult> {
  const decisions: OrganiseAssignment[] = [];
  let keptInPlace = 0;
  let errors = 0;

  for (const entry of entries) {
    const folderIndex = organisation.get(entry.refId) ?? null;
    if (folderIndex === null) {
      keptInPlace++;
      continue;
    }
    if (entry.message.id === undefined) {
      console.warn(`ORGANISE: Message without id cannot be moved (subject: "${entry.subject}")`);
      errors++;
      continue;
    }
    decisions.push({ messageId: entry.message.id, folderIndex });
  }

  const result = await executeMoves(decisions, resolvedFolders, sourceFolderPath, abortSignal);
  return {
    moved: result.moved,
    keptInPlace: keptInPlace + result.keptInPlace,
    errors: errors + result.errors,
    aborted: result.aborted,
  };
}

/**
 * Execute a set of move decisions. Messages bound for the same folder move together in one API call; if
 * a batch fails it is retried per-message so one bad message does not sink the rest. A decision with a
 * null folder, or one that targets the source folder, is counted as "kept in place". Returns honest
 * tallies (moved / kept in place / errors).
 */
async function executeMoves(
  decisions: OrganiseAssignment[],
  resolvedFolders: Array<browser.folders.MailFolder | null>,
  sourceFolderPath: string | undefined,
  abortSignal: AbortSignal,
): Promise<OrganiseResult> {
  let moved = 0;
  let keptInPlace = 0;
  let errors = 0;

  // Group movable messages by target folder index, preserving order, so we can move each group at once.
  const groups = new Map<number, number[]>();
  for (const decision of decisions) {
    if (decision.folderIndex === null) {
      keptInPlace++;
      continue;
    }

    const targetFolder = resolvedFolders[decision.folderIndex];
    if (!targetFolder) {
      console.warn(`ORGANISE: Target folder not found for index ${decision.folderIndex} — treating as error`);
      errors++;
      continue;
    }

    // A rule pointing back at the folder being organised would be a no-op move — leave it in place.
    if (sourceFolderPath !== undefined && targetFolder.path === sourceFolderPath) {
      keptInPlace++;
      continue;
    }

    const group = groups.get(decision.folderIndex) ?? [];
    group.push(decision.messageId);
    groups.set(decision.folderIndex, group);
  }

  for (const [folderIndex, ids] of groups) {
    if (abortSignal.aborted) {
      return { moved, keptInPlace, errors, aborted: true };
    }

    const targetFolder = resolvedFolders[folderIndex] as browser.folders.MailFolder;
    try {
      await moveMessagesToFolder(ids, targetFolder);
      moved += ids.length;
      console.log(`ORGANISE: Moved ${ids.length} message(s) -> ${targetFolder.path}`);
    } catch (batchError) {
      // Batch move failed — retry each message individually so successes still count.
      console.warn("ORGANISE: Batch move failed, retrying messages individually", ids, batchError);
      for (const id of ids) {
        // Stop issuing further moves once cancellation is requested; already-attempted ids stay counted.
        if (abortSignal.aborted) {
          return { moved, keptInPlace, errors, aborted: true };
        }
        try {
          await moveMessagesToFolder([id], targetFolder);
          moved++;
        } catch (e) {
          console.warn("ORGANISE: Failed to move message", id, e);
          errors++;
        }
      }
    }
  }

  return { moved, keptInPlace, errors, aborted: false };
}

// Markers that introduce quoted history in a reply/forward. Everything from the first match onward is
// dropped so the classifier sees the new message, not the thread it is replying to.
const QUOTED_HISTORY_MARKERS: RegExp[] = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^_{5,}/m, // Outlook's underscore separator above the quoted "From:" block
  /^On .+ wrote:\s*$/im,
  /^Am .+ schrieb .+:\s*$/im, // German Thunderbird reply header
  /^From:\s.+$/im, // forwarded/inline header block
  /^Von:\s.+$/im,
];

/**
 * Trim an email body down to the signal that matters for classification: drop quoted reply/forward
 * history and quote-prefixed lines, collapse whitespace, and cap the length. Reply chains otherwise
 * bury the actual new content under older quoted messages, which skews classification.
 */
export function cleanEmailBody(raw: string): string {
  let text = raw;

  // Cut everything from the earliest quoted-history marker onward.
  let cutAt = text.length;
  for (const marker of QUOTED_HISTORY_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cutAt) {
      cutAt = match.index;
    }
  }
  text = text.slice(0, cutAt);

  // Drop remaining quote-prefixed lines ("> ...") that precede any marker.
  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Fall back to the head of the original text if stripping left nothing usable.
  const cleaned = text.length > 0 ? text : raw.trim();
  return cleaned.slice(0, MAX_EMAIL_BODY_CHARS);
}

/** Recursively extract text (plain or stripped HTML) from message part hierarchy. */
export function extractTextFromPart(part: browser.messages.MessagePart): string {
  if (part.contentType === "text/plain" && part.body) {
    return part.body;
  }
  if (part.contentType === "text/html" && part.body) {
    return stripHtml(part.body);
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const text = extractTextFromPart(sub);
      if (text) return text;
    }
  }
  return "";
}
