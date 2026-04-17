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

function parseBatchOrganisingResponse(
  rawResponse: string,
  expectedIds: number[],
  rulesCount: number,
): Map<number, number | null> {
  const result = new Map<number, number | null>(expectedIds.map((id) => [id, null]));
  const parseInput = extractJsonObject(rawResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(parseInput);
  } catch {
    return result;
  }

  const organisationDecisions =
    parsed && typeof parsed === "object" && "classifications" in parsed
      ? (parsed as { classifications?: unknown }).classifications
      : undefined;

  if (!Array.isArray(organisationDecisions)) {
    return result;
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

  return result;
}

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

async function getFoldersForAccount(account: browser.accounts.MailAccount): Promise<browser.folders.MailFolder[]> {
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
async function resolveFolderPath(folderPath: string): Promise<browser.folders.MailFolder | null> {
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

function isIncorrectMessagesListArgumentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Incorrect argument types for messages.list");
}

function isIncorrectMessagesMoveArgumentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Incorrect argument types for messages.move");
}

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

async function moveMessageToFolder(messageId: number, targetFolder: browser.folders.MailFolder): Promise<void> {
  const folderWithId = targetFolder as browser.folders.MailFolder & { id?: string };
  if (folderWithId.id) {
    try {
      await browser.messages.move([messageId], folderWithId.id as unknown as browser.folders.MailFolder);
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
  await browser.messages.move([messageId], fallbackFolder);
}

export async function organiseCurrentFolder(abortSignal: AbortSignal): Promise<void> {
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
  const mailTabs = await browser.mailTabs.query({ active: true, currentWindow: true });
  const mailTab = mailTabs[0];
  if (!mailTab?.displayedFolder) {
    throw new Error("No folder is currently displayed. Open a mail folder first.");
  }

  const sourceFolder = mailTab.displayedFolder;
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
    return;
  }

  const messagesForOrganising: MessageForOrganising[] = await Promise.all(
    allMessages.map(async (msg, index) => {
      let body = "";
      try {
        if (msg.id !== undefined) {
          const full = await browser.messages.getFull(msg.id);
          body = extractTextFromPart(full);
        }
      } catch {
        body = "";
      }

      return {
        message: msg,
        refId: msg.id ?? -(index + 1),
        sender: msg.author ?? "",
        subject: msg.subject ?? "(no subject)",
        body,
      };
    }),
  );

  const organisationByRefId = new Map<number, number | null>();
  for (const entriesChunk of chunk(messagesForOrganising, BATCH_SIZE)) {
    if (abortSignal.aborted) break;

    const userPrompt = buildBatchOrganisingPrompt(rules, entriesChunk);
    try {
      const response = await sendContentToLlm(
        [
          { role: LlmRoles.SYSTEM, content: BATCH_ORGANISING_SYSTEM_PROMPT },
          { role: LlmRoles.USER, content: userPrompt },
        ],
        abortSignal,
      );

      if (!isLlmTextCompletionResponse(response)) {
        console.warn("ORGANISE: LLM error response for batch", response);
        for (const entry of entriesChunk) {
          organisationByRefId.set(entry.refId, null);
        }
        continue;
      }

      const firstChoice = Array.isArray(response.choices) ? response.choices[0] : undefined;
      const rawBatchResponse =
        firstChoice && typeof firstChoice.message?.content === "string" ? firstChoice.message.content : null;
      if (rawBatchResponse === null) {
        console.error("ORGANISE: LLM batch response missing choices[0].message.content", response);
        for (const entry of entriesChunk) {
          organisationByRefId.set(entry.refId, null);
        }
        continue;
      }
      console.log("ORGANISE: LLM batch reply:", rawBatchResponse);

      const parsed = parseBatchOrganisingResponse(
        rawBatchResponse,
        entriesChunk.map((entry) => entry.refId),
        rules.length,
      );
      for (const [refId, ruleIndex] of parsed.entries()) {
        organisationByRefId.set(refId, ruleIndex);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      console.warn("ORGANISE: LLM call failed for batch", e);
      for (const entry of entriesChunk) {
        organisationByRefId.set(entry.refId, null);
      }
    }
  }

  let moved = 0;
  let skipped = 0;

  for (const entry of messagesForOrganising) {
    if (abortSignal.aborted) break;

    const responseIndex = organisationByRefId.get(entry.refId) ?? null;
    if (responseIndex === null) {
      skipped++;
      continue;
    }

    const targetFolder = resolvedFolders[responseIndex];
    if (!targetFolder) {
      console.warn(
        `ORGANISE: Target folder not found for rule "${rules[responseIndex].folderPath}" — keeping in place`,
      );
      skipped++;
      continue;
    }

    if (entry.message.id === undefined) {
      console.warn(`ORGANISE: Message without id cannot be moved (subject: "${entry.subject}")`);
      skipped++;
      continue;
    }

    try {
      await moveMessageToFolder(entry.message.id, targetFolder);
      moved++;
      console.log(`ORGANISE: Moved "${entry.subject}" -> ${rules[responseIndex].folderPath}`);
    } catch (e) {
      console.warn("ORGANISE: Failed to move message", entry.message.id, e);
      skipped++;
    }
  }

  await timedNotification(
    "Organise Folder Complete",
    `Moved ${moved} email(s). ${skipped} email(s) kept in place.`,
    10000,
  );
}

function extractTextFromPart(part: browser.messages.MessagePart): string {
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
