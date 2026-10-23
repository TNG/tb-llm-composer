import { getAllFolderPaths, resolveFolderPath } from "./emailOrganising";
import type { AgenticProgress } from "./llmConnection";
import { getPluginOptions } from "./optionsParams";
import { rememberPopupSize } from "./popupSize";
import type { ReportRequest } from "./reportGeneration";
import { renderReportHtml, stripCitations } from "./reportMarkdown";
import { deletePrompt, getSavedPrompts, savePrompt } from "./reportPrompts";
import { getButtonElement, getInputElement } from "./utils";

const params = new URLSearchParams(window.location.search);
const folderContext =
  params.get("accountId") && params.get("path")
    ? { accountId: params.get("accountId") as string, path: params.get("path") as string }
    : null;
const folderName = params.get("name") ?? folderContext?.path ?? "";

let windowId: number | undefined;
let busy = false;
// The report's raw markdown (with `email:` citation links) is the source of truth for copy/export;
// the output area shows a rendered HTML version of it.
let currentReportText = "";
// Every generated/refined report is kept as a version until "New report" clears them, so the user can
// step back and forth. `historyIndex` is the version currently shown (and used for copy/export).
let reportHistory: string[] = [];
let historyIndex = -1;
// Whether a report already exists in this window. When true, "Create" refines by continuing
// the existing agent conversation; "New report" clears it to start fresh.
let hasReport = false;

// The folder a single-folder search targets. Defaults to the folder that was open when the
// window was launched, but the user can pick another via the folder picker.
let selectedFolder: { accountId: string; path: string; name: string } | null = folderContext
  ? { accountId: folderContext.accountId, path: folderContext.path, name: folderName || folderContext.path }
  : null;

type AccountInfo = { id: string; name: string; type?: string };
// The listed mail accounts, in Thunderbird's order, and the ones the report searches. Defaults to the
// account of the folder the window was opened from (or every listed account without a folder context).
let accounts: AccountInfo[] = [];
// Whether `accounts` is every account; if some are hidden, "all listed" must be sent as an explicit list.
let listsEveryAccount = true;
let selectedAccountIds = new Set<string>();
// The user's last single-folder choice, restored when going back from several accounts to one.
let folderOnlyPreferred = true;

const folderOnlyInput = getInputElement("#folder-only");
const daysInput = getInputElement("#days");
const folderSelectBtn = document.querySelector<HTMLButtonElement>("#folder-select-btn");
const selectedFolderNameEl = document.querySelector<HTMLSpanElement>("#selected-folder-name");
const folderPickerEl = document.querySelector<HTMLElement>("#folder-picker");
const folderListEl = document.querySelector<HTMLDivElement>("#folder-list");
const accountSelectBtn = document.querySelector<HTMLButtonElement>("#account-select-btn");
const selectedAccountsNameEl = document.querySelector<HTMLSpanElement>("#selected-accounts-name");
const accountListEl = document.querySelector<HTMLDivElement>("#account-list");
const folderScopeControl = document.querySelector<HTMLElement>("#folder-scope-control");
const promptInput = document.querySelector<HTMLTextAreaElement>("#prompt");
const outputArea = document.querySelector<HTMLElement>("#report-output");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const progressEl = document.querySelector<HTMLDivElement>("#progress");
const progressTextEl = document.querySelector<HTMLSpanElement>("#progress-text");
const createBtn = getButtonElement("#create-btn");
const copyBtn = getButtonElement("#copy-btn");
const newReportBtn = getButtonElement("#new-report-btn");
const saveTxtBtn = getButtonElement("#save-txt-btn");
const saveMdBtn = getButtonElement("#save-md-btn");
const savedPromptsSelect = document.querySelector<HTMLSelectElement>("#saved-prompts");
const promptNameInput = getInputElement("#prompt-name");
const savePromptBtn = getButtonElement("#save-prompt-btn");
const deletePromptBtn = getButtonElement("#delete-prompt-btn");
const noSearchInput = getInputElement("#no-search");
const refineControl = document.querySelector<HTMLElement>("#refine-control");
const versionNav = document.querySelector<HTMLElement>("#version-nav");
const versionLabel = document.querySelector<HTMLSpanElement>("#version-label");
const prevVersionBtn = getButtonElement("#prev-version");
const nextVersionBtn = getButtonElement("#next-version");

init().catch((e) => console.error("REPORT-WINDOW: initialization failed", e));

async function init(): Promise<void> {
  const current = await browser.windows.getCurrent();
  windowId = current.id;

  // Reopen at whatever size this window ends up with, so the next open never has to be corrected.
  rememberPopupSize("report");

  const options = await getPluginOptions();
  daysInput.value = `${options.reportDefaultDays}`;

  if (!folderContext) {
    // No folder context (e.g. opened without an active mail folder): search every folder by default.
    folderOnlyPreferred = false;
  }
  if (selectedFolderNameEl) selectedFolderNameEl.textContent = selectedFolder?.name ?? "Choose folder";
  try {
    const allAccounts = await loadAccounts();
    accounts = options.reportIncludeLocalFolders ? allAccounts : allAccounts.filter((a) => !isLocalFoldersAccount(a));
    listsEveryAccount = accounts.length === allAccounts.length;
  } catch (e) {
    console.error("REPORT-WINDOW: could not load accounts", e);
  }
  const startAccountId = folderContext?.accountId;
  const hasStartAccount = !!startAccountId && accounts.some((a) => a.id === startAccountId);
  selectedAccountIds = new Set(hasStartAccount ? [startAccountId] : accounts.map((a) => a.id));
  // The launch folder is in a hidden account (Local Folders), so it cannot be the single-folder target.
  if (!hasStartAccount) folderOnlyPreferred = false;
  updateScopeControls();

  folderOnlyInput.addEventListener("change", () => {
    folderOnlyPreferred = folderOnlyInput.checked;
    updateScopeControls();
  });
  folderSelectBtn?.addEventListener("click", toggleFolderList);
  accountSelectBtn?.addEventListener("click", toggleAccountList);
  accountListEl?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAccountList();
      accountSelectBtn?.focus();
    }
  });
  createBtn.addEventListener("click", onCreate);
  // Enter sends the prompt (chat-style); Shift+Enter inserts a newline.
  promptInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !busy) {
      event.preventDefault();
      void onCreate();
    }
  });
  copyBtn.addEventListener("click", onCopy);
  newReportBtn.addEventListener("click", onNewReport);
  saveTxtBtn.addEventListener("click", () => saveReport("txt"));
  saveMdBtn.addEventListener("click", () => saveReport("md"));
  // Open/Reply on an inline email citation chip (event-delegated over the rendered report).
  outputArea?.addEventListener("click", onReportOutputClick);
  // Step through report versions kept for this session.
  prevVersionBtn.addEventListener("click", () => showVersion(historyIndex - 1));
  nextVersionBtn.addEventListener("click", () => showVersion(historyIndex + 1));

  savedPromptsSelect?.addEventListener("change", onSelectSavedPrompt);
  savePromptBtn.addEventListener("click", onSavePrompt);
  deletePromptBtn.addEventListener("click", onDeleteSavedPrompt);
  await refreshSavedPrompts();

  // Progress updates and the final result are streamed from the background over runtime messages
  // (not as the reply to generate-report), so a long run can never hang on a torn-down channel.
  browser.runtime.onMessage?.addListener((message: unknown) => {
    const msg = message as {
      type?: string;
      windowId?: number;
      progress?: AgenticProgress;
      report?: string;
      error?: string;
    };
    if (msg?.windowId !== windowId) return;
    if (msg.type === "report-progress") {
      renderProgress(msg.progress);
    } else if (msg.type === "report-result") {
      onReportResult(msg);
    }
  });

  setStatus("Ready.");
}

/** Handle the finished report (or error/cancellation) pushed by the background. */
function onReportResult(result: { report?: string; error?: string }): void {
  // Ignore stray or duplicate results that arrive when we are not generating.
  if (!busy) return;
  setBusy(false);
  if (result.error) {
    setStatus(`Error: ${result.error}`);
    return;
  }
  const report = result.report ?? "";
  // An empty report would render as a blank panel and refuse to copy/save, so never announce it as
  // ready — and never push it as a version, which would bury the report the user already has.
  if (!report.trim()) {
    setStatus("The model returned an empty report. Nothing was changed — try again or adjust your request.");
    return;
  }
  pushReportVersion(report);
  hasReport = true;
  newReportBtn.hidden = false;
  // A report now exists, so reveal the "refine without search" option.
  if (refineControl) refineControl.hidden = false;
  setStatus("Report ready. Type a follow-up and click Create to refine it, or start a new report.");
}

function renderProgress(progress?: AgenticProgress): void {
  if (!progressTextEl || !progress) return;
  const { llmCalls, toolCalls, phase } = progress;
  const llmLabel = `${llmCalls} LLM call${llmCalls === 1 ? "" : "s"}`;
  const toolLabel = `${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`;
  progressTextEl.textContent = `${phase} · ${llmLabel} · ${toolLabel}`;
}

/** Rebuild the saved-prompts dropdown from storage, optionally selecting `selectedName`. */
async function refreshSavedPrompts(selectedName = ""): Promise<void> {
  if (!savedPromptsSelect) return;
  const prompts = await getSavedPrompts();

  savedPromptsSelect.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = prompts.length ? "Saved prompts…" : "No saved prompts";
  savedPromptsSelect.appendChild(placeholder);

  for (const prompt of prompts) {
    const option = document.createElement("option");
    option.value = prompt.name;
    option.textContent = prompt.name;
    savedPromptsSelect.appendChild(option);
  }

  savedPromptsSelect.value = selectedName;
  deletePromptBtn.disabled = !savedPromptsSelect.value;
}

/** Load the selected saved prompt into the prompt field. */
async function onSelectSavedPrompt(): Promise<void> {
  const name = savedPromptsSelect?.value ?? "";
  deletePromptBtn.disabled = !name;
  if (!name) return;

  const prompt = (await getSavedPrompts()).find((p) => p.name === name);
  if (prompt && promptInput) {
    promptInput.value = prompt.text;
    promptNameInput.value = prompt.name;
    setStatus(`Loaded prompt "${name}".`);
  }
}

/** Save the current prompt text under the name in the name field. */
async function onSavePrompt(): Promise<void> {
  const name = promptNameInput.value.trim();
  const text = promptInput?.value ?? "";
  if (!name) {
    setStatus("Enter a name to save this prompt.");
    promptNameInput.focus();
    return;
  }
  if (!text.trim()) {
    setStatus("Nothing to save — the prompt is empty.");
    return;
  }
  await savePrompt(name, text);
  await refreshSavedPrompts(name);
  setStatus(`Saved prompt "${name}".`, 5000);
}

/** Delete the currently selected saved prompt. */
async function onDeleteSavedPrompt(): Promise<void> {
  const name = savedPromptsSelect?.value ?? "";
  if (!name) return;
  await deletePrompt(name);
  await refreshSavedPrompts();
  setStatus(`Deleted prompt "${name}".`);
}

/** The one selected account, or null when several are selected (or the account list is unavailable). */
function singleSelectedAccount(): string | null {
  return selectedAccountIds.size === 1 ? [...selectedAccountIds][0] : null;
}

/**
 * Keep the folder toggle and picker consistent with the account selection: a single folder belongs to
 * one account, so several selected accounts force (and lock) an all-folders search.
 */
function updateScopeControls(): void {
  const account = singleSelectedAccount();
  folderOnlyInput.disabled = account === null;
  folderOnlyInput.checked = account !== null && folderOnlyPreferred;
  if (folderScopeControl) {
    folderScopeControl.title = account === null ? "Several accounts are always searched across all their folders" : "";
  }
  // The picked folder must live in the searched account.
  if (account !== null && selectedFolder && selectedFolder.accountId !== account) {
    selectedFolder = null;
    if (selectedFolderNameEl) selectedFolderNameEl.textContent = "Choose folder";
  }
  const single = folderOnlyInput.checked;
  // The folder picker only applies to a single-folder search.
  if (folderPickerEl) folderPickerEl.hidden = !single;
  if (!single) closeFolderList();
  renderAccountSummary();
}

// ── Account picker ──────────────────────────────────────────────────────────────

/** Show the selected accounts on the picker button, e.g. "Work", "Work + 1" or "All accounts". */
function renderAccountSummary(): void {
  const chosen = accounts.filter((a) => selectedAccountIds.has(a.id));
  let label = "All accounts";
  if (chosen.length === 1) label = chosen[0].name;
  else if (chosen.length > 1 && chosen.length < accounts.length) label = `${chosen[0].name} + ${chosen.length - 1}`;
  if (selectedAccountsNameEl) selectedAccountsNameEl.textContent = label;
  // With a single account there is nothing to choose.
  if (accountSelectBtn) accountSelectBtn.disabled = accounts.length <= 1;
  if (accountSelectBtn) {
    accountSelectBtn.title = chosen.map((a) => a.name).join(", ") || "Choose which accounts to search";
  }
}

/** Accordion toggle for the account list (mirrors the folder list). */
function toggleAccountList(): void {
  if (!accountListEl) return;
  if (accountListEl.childElementCount > 0) {
    closeAccountList();
    return;
  }
  closeFolderList();
  renderAccountList();
}

function closeAccountList(): void {
  accountListEl?.replaceChildren();
  accountListEl?.setAttribute("hidden", "");
  accountSelectBtn?.setAttribute("aria-expanded", "false");
}

/** Render an "All accounts" row plus one checkbox row per account. */
function renderAccountList(focusIndex?: number): void {
  if (!accountListEl) return;
  accountListEl.replaceChildren();
  accountListEl.removeAttribute("hidden");
  accountSelectBtn?.setAttribute("aria-expanded", "true");
  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "model-row";
    empty.textContent = "No accounts found — every account is searched.";
    accountListEl.appendChild(empty);
    return;
  }

  const rows: HTMLLabelElement[] = [];
  if (accounts.length > 1) {
    const allChecked = accounts.every((a) => selectedAccountIds.has(a.id));
    rows.push(
      accountRow("All accounts", allChecked, "all-accounts", (checked) => {
        // Unticking "All" falls back to the launch account (or the first one) — never to nothing.
        const fallback = folderContext?.accountId ?? accounts[0].id;
        selectedAccountIds = new Set(checked ? accounts.map((a) => a.id) : [fallback]);
      }),
    );
  }
  for (const account of accounts) {
    rows.push(
      accountRow(account.name, selectedAccountIds.has(account.id), "", (checked) => {
        if (checked) {
          selectedAccountIds.add(account.id);
        } else if (selectedAccountIds.size > 1) {
          selectedAccountIds.delete(account.id);
        } else {
          setStatus("Select at least one account.", 4000);
        }
      }),
    );
  }
  rows.forEach((row, index) => {
    row.querySelector("input")?.addEventListener("change", () => {
      // Re-rendering replaces the focused checkbox; keep keyboard focus on the same row.
      renderAccountList(index);
      updateScopeControls();
    });
  });
  accountListEl.append(...rows);
  if (focusIndex !== undefined) rows[focusIndex]?.querySelector("input")?.focus();
}

/** One checkbox row for the account list. */
function accountRow(
  label: string,
  checked: boolean,
  extraClass: string,
  onToggle: (checked: boolean) => void,
): HTMLLabelElement {
  const row = document.createElement("label");
  row.className = `model-row account-row ${extraClass}`.trim();
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onToggle(box.checked));
  const name = document.createElement("span");
  name.className = "model-id";
  name.textContent = label;
  row.append(box, name);
  return row;
}

/** Thunderbird's "Local Folders" pseudo-account ("none" in older APIs, "local" in MV3). */
function isLocalFoldersAccount(account: AccountInfo): boolean {
  return account.type === "none" || account.type === "local";
}

/** Load the mail accounts, falling back to the background script if the direct API call fails. */
async function loadAccounts(): Promise<AccountInfo[]> {
  try {
    const list = await browser.accounts.list(false);
    return list.map((a) => ({ id: a.id, name: a.name, type: a.type }));
  } catch (directError) {
    console.warn("REPORT-WINDOW: direct account lookup failed, trying background fallback:", directError);
  }
  const response = await browser.runtime.sendMessage({ type: "get-accounts" });
  if (!Array.isArray(response)) throw new Error("Invalid account response from background script.");
  return response as AccountInfo[];
}

// ── Folder picker ───────────────────────────────────────────────────────────────

/** Accordion toggle for the folder list: closed → load and show; open → hide. */
async function toggleFolderList(): Promise<void> {
  if (!folderListEl) return;
  if (folderListEl.childElementCount > 0) {
    closeFolderList();
    return;
  }
  await populateFolderList();
}

function closeFolderList(): void {
  folderListEl?.replaceChildren();
  folderListEl?.setAttribute("hidden", "");
}

/** Render every mailbox folder path as a row with an arrow button that selects it (like the options list). */
async function populateFolderList(): Promise<void> {
  if (!folderListEl) return;
  folderListEl.replaceChildren();
  folderListEl.removeAttribute("hidden");

  let paths: string[];
  try {
    paths = await loadFolderPaths(singleSelectedAccount() ?? undefined);
  } catch (e) {
    console.error("REPORT-WINDOW: could not load folder paths", e);
    setStatus("Could not load folders.");
    closeFolderList();
    return;
  }

  for (const path of paths) {
    const row = document.createElement("div");
    row.className = "model-row";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.title = `Search "${path}"`;

    const id = document.createElement("span");
    id.className = "model-id";
    id.textContent = path;
    row.appendChild(id);

    const activate = () => void selectFolder(path);
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });

    folderListEl.appendChild(row);
  }
}

/** Select `path` as the single-folder target, resolving its account and display name. */
async function selectFolder(path: string): Promise<void> {
  let accountId = singleSelectedAccount() ?? folderContext?.accountId ?? "";
  let name = path;
  try {
    const folder = await resolveFolderPath(path, accountId || undefined);
    if (folder) {
      accountId = folder.accountId ?? accountId;
      name = folder.name ?? path;
    }
  } catch (e) {
    console.warn("REPORT-WINDOW: could not resolve folder account for", path, e);
  }
  selectedFolder = { accountId, path, name };
  if (selectedFolderNameEl) selectedFolderNameEl.textContent = name;
  closeFolderList();
}

/** Load `accountId`'s (or every) folder path, falling back to the background script if the direct API call fails. */
async function loadFolderPaths(accountId?: string): Promise<string[]> {
  try {
    return await getAllFolderPaths(accountId);
  } catch (directError) {
    console.warn("REPORT-WINDOW: direct folder-path lookup failed, trying background fallback:", directError);
  }
  const response = await browser.runtime.sendMessage({ type: "get-folder-paths", accountId });
  if (!Array.isArray(response) || response.some((path) => typeof path !== "string")) {
    throw new Error("Invalid folder path response from background script.");
  }
  return response as string[];
}

function setBusy(value: boolean): void {
  busy = value;
  // While generating, the send button turns into a stop control (Copilot-style),
  // so it must stay enabled to allow cancelling.
  createBtn.classList.toggle("busy", value);
  const idleTitle = hasReport ? "Refine report" : "Create report";
  createBtn.title = value ? "Stop generating" : idleTitle;
  createBtn.setAttribute("aria-label", value ? "Stop generating" : idleTitle);
  // Show the progress row (spinner + counters + Stop button) only while generating.
  progressEl?.toggleAttribute("hidden", !value);
  if (value) {
    renderProgress({ llmCalls: 0, toolCalls: 0, phase: "Starting…" });
  }
}

let statusClearTimer: ReturnType<typeof setTimeout> | undefined;

/** Set the status line. With `autoClearMs`, revert to "Ready." after that delay (for transient confirmations). */
function setStatus(text: string, autoClearMs?: number): void {
  if (statusEl) statusEl.textContent = text;
  // Any new status supersedes a pending auto-clear.
  if (statusClearTimer !== undefined) {
    clearTimeout(statusClearTimer);
    statusClearTimer = undefined;
  }
  if (autoClearMs) {
    statusClearTimer = setTimeout(() => {
      if (statusEl) statusEl.textContent = "Ready.";
      statusClearTimer = undefined;
    }, autoClearMs);
  }
}

async function onCreate(): Promise<void> {
  if (busy) {
    // The button acts as a stop control while a report is being generated. Fire-and-forget: the run
    // ends by pushing a `report-result` (cancelled) message, which clears the busy state.
    void browser.runtime.sendMessage({ type: "cancel-report", windowId }).catch(() => {});
    setStatus("Cancelling…");
    return;
  }

  const prompt = promptInput?.value.trim() ?? "";
  if (!prompt) {
    setStatus("Please enter a report request first.");
    return;
  }

  const days = daysInput.valueAsNumber > 0 ? daysInput.valueAsNumber : 30;
  const folderOnly = folderOnlyInput.checked && !folderOnlyInput.disabled;
  if (folderOnly && !selectedFolder) {
    setStatus("Choose a folder to search, or switch to all folders.");
    return;
  }
  const targetFolder = folderOnly ? selectedFolder : null;
  // Every account selected (none hidden by the options) = no restriction, which also covers accounts
  // added after the window opened.
  const chosenAccounts = accounts.filter((a) => selectedAccountIds.has(a.id));
  const restrictAccounts = chosenAccounts.length < accounts.length || !listsEveryAccount;
  // With a report already present, keep talking to the same agent instead of starting over.
  const continueConversation = hasReport;
  // Only meaningful when refining an existing report; the checkbox is disabled until then.
  const noSearch = hasReport && noSearchInput.checked;

  const request: ReportRequest = {
    prompt,
    days,
    folderOnly,
    folder: targetFolder ? { accountId: targetFolder.accountId, path: targetFolder.path } : null,
    accountIds: restrictAccounts ? chosenAccounts.map((a) => a.id) : [],
    accountNames: restrictAccounts ? chosenAccounts.map((a) => a.name) : [],
  };

  setBusy(true);
  // Progress row (spinner + live counters) now conveys generation state.
  setStatus("");
  // Fire-and-forget: the result (or error) arrives via a `report-result` message handled in
  // onReportResult, so the UI never depends on a long-lived request channel that could be
  // destroyed mid-generation (which would hang the report).
  void browser.runtime
    // The displayed report travels with the request: the background is an event page and may have
    // been suspended since the last run, losing its conversation. Sending the text lets it refine
    // what the user sees instead of falling back to generating a brand-new report.
    .sendMessage({
      type: "generate-report",
      windowId,
      request,
      continueConversation,
      noSearch,
      currentReport: continueConversation ? currentReportText : undefined,
    })
    .catch((e: unknown) => {
      // The message failed to even reach the background; surface it and leave the busy state.
      setBusy(false);
      setStatus(`Error: ${(e as Error).message}`);
    });
}

/** Clear the current report and its agent conversation so the next Create starts from scratch. */
async function onNewReport(): Promise<void> {
  if (busy) return;
  await browser.runtime.sendMessage({ type: "reset-report", windowId }).catch(() => {});
  hasReport = false;
  newReportBtn.hidden = true;
  clearReport();
  if (promptInput) promptInput.value = "";
  // No report text yet again: hide and clear the "refine without search" option.
  noSearchInput.checked = false;
  if (refineControl) refineControl.hidden = true;
  // Reset the saved-prompt controls so a fresh report doesn't stay tied to a loaded preset.
  if (savedPromptsSelect) savedPromptsSelect.value = "";
  promptNameInput.value = "";
  deletePromptBtn.disabled = true;
  createBtn.title = "Create report";
  createBtn.setAttribute("aria-label", "Create report");
  setStatus("Started a new report. Enter a request and click Create.");
}

/** Current local date as YYYY-MM-DD, for use in the saved report filename. */
function localDateYmd(): string {
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Append a newly generated/refined report as a version and show it. */
function pushReportVersion(text: string): void {
  reportHistory.push(text);
  showVersion(reportHistory.length - 1);
}

/** Show the report version at `index`, updating the rendered output and the version navigation. */
function showVersion(index: number): void {
  if (index < 0 || index >= reportHistory.length) return;
  historyIndex = index;
  currentReportText = reportHistory[index];
  if (outputArea) outputArea.replaceChildren(renderReportHtml(currentReportText));
  updateVersionNav();
}

/** Keep the ‹ N / M › version navigation in sync with the history (hidden until >1 version). */
function updateVersionNav(): void {
  const count = reportHistory.length;
  if (versionNav) versionNav.hidden = count <= 1;
  if (versionLabel) versionLabel.textContent = count ? `${historyIndex + 1} / ${count}` : "";
  prevVersionBtn.disabled = historyIndex <= 0;
  nextVersionBtn.disabled = historyIndex >= count - 1;
}

/** Clear the report history and raw text, restoring the placeholder. */
function clearReport(): void {
  reportHistory = [];
  historyIndex = -1;
  currentReportText = "";
  updateVersionNav();
  if (!outputArea) return;
  const placeholder = document.createElement("p");
  placeholder.className = "report-placeholder";
  placeholder.textContent = "The generated report will appear here.";
  outputArea.replaceChildren(placeholder);
}

/** Open or reply to the email behind a clicked citation chip. */
async function onReportOutputClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>(".email-open, .email-reply");
  if (!button) return;
  const id = Number(button.dataset.emailId);
  if (!Number.isFinite(id)) return;

  const reply = button.classList.contains("email-reply");
  const response = (await browser.runtime
    .sendMessage({ type: reply ? "reply-email" : "open-email", id })
    .catch((e: unknown) => ({ error: (e as Error).message }))) as { ok?: true; error?: string } | undefined;
  if (response?.error) {
    setStatus(response.error);
  } else {
    setStatus(reply ? "Opened a reply to the cited email." : "Opened the cited email.");
  }
}

/** Download the current report as a text or markdown file via a temporary object URL. */
function saveReport(extension: "txt" | "md"): void {
  // Exports are plain text: the `email:` citation ids only resolve in this Thunderbird session.
  const content = stripCitations(currentReportText);
  if (!content) {
    setStatus("Nothing to save yet.");
    return;
  }
  const mimeType = extension === "md" ? "text/markdown" : "text/plain";
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `llm-composer-report-${localDateYmd()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Report saved as .${extension}.`);
}

async function onCopy(): Promise<void> {
  const content = stripCitations(currentReportText);
  if (!content) {
    setStatus("Nothing to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    setStatus("Report copied to clipboard.");
  } catch {
    // Fallback for environments without async clipboard access.
    const scratch = document.createElement("textarea");
    scratch.value = content;
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand("copy");
    scratch.remove();
    setStatus("Report copied to clipboard.");
  }
}
