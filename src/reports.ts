import { getAllFolderPaths, resolveFolderPath } from "./emailOrganising";
import type { AgenticProgress } from "./llmConnection";
import { getPluginOptions } from "./optionsParams";
import type { ReportRequest } from "./reportGeneration";
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
// Whether a report already exists in this window. When true, "Create" refines by continuing
// the existing agent conversation; "New report" clears it to start fresh.
let hasReport = false;

// The folder a single-folder search targets. Defaults to the folder that was open when the
// window was launched, but the user can pick another via the folder picker.
let selectedFolder: { accountId: string; path: string; name: string } | null = folderContext
  ? { accountId: folderContext.accountId, path: folderContext.path, name: folderName || folderContext.path }
  : null;

const folderOnlyInput = getInputElement("#folder-only");
const daysInput = getInputElement("#days");
const folderSelectBtn = document.querySelector<HTMLButtonElement>("#folder-select-btn");
const selectedFolderNameEl = document.querySelector<HTMLSpanElement>("#selected-folder-name");
const folderPickerEl = document.querySelector<HTMLElement>("#folder-picker");
const folderListEl = document.querySelector<HTMLDivElement>("#folder-list");
const promptInput = document.querySelector<HTMLTextAreaElement>("#prompt");
const outputArea = document.querySelector<HTMLTextAreaElement>("#report-output");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const progressEl = document.querySelector<HTMLDivElement>("#progress");
const progressTextEl = document.querySelector<HTMLSpanElement>("#progress-text");
const abortBtn = getButtonElement("#abort-btn");
const createBtn = getButtonElement("#create-btn");
const copyBtn = getButtonElement("#copy-btn");
const newReportBtn = getButtonElement("#new-report-btn");
const saveTxtBtn = getButtonElement("#save-txt-btn");
const saveMdBtn = getButtonElement("#save-md-btn");
const scopeNote = document.querySelector<HTMLParagraphElement>("#scope-note");
const savedPromptsSelect = document.querySelector<HTMLSelectElement>("#saved-prompts");
const promptNameInput = getInputElement("#prompt-name");
const savePromptBtn = getButtonElement("#save-prompt-btn");
const deletePromptBtn = getButtonElement("#delete-prompt-btn");

init().catch((e) => console.error("REPORT-WINDOW: initialization failed", e));

async function init(): Promise<void> {
  const current = await browser.windows.getCurrent();
  windowId = current.id;

  const options = await getPluginOptions();
  daysInput.value = `${options.reportDefaultDays}`;

  if (!folderContext) {
    // No folder context (e.g. opened without an active mail folder): search everywhere.
    folderOnlyInput.checked = false;
    folderOnlyInput.disabled = true;
  }
  if (selectedFolderNameEl) selectedFolderNameEl.textContent = selectedFolder?.name ?? "Current folder";
  updateScopeControls();

  folderOnlyInput.addEventListener("change", updateScopeControls);
  folderSelectBtn?.addEventListener("click", toggleFolderList);
  createBtn.addEventListener("click", onCreate);
  // Enter sends the prompt (chat-style); Shift+Enter inserts a newline.
  promptInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !busy) {
      event.preventDefault();
      void onCreate();
    }
  });
  abortBtn.addEventListener("click", onAbort);
  copyBtn.addEventListener("click", onCopy);
  newReportBtn.addEventListener("click", onNewReport);
  saveTxtBtn.addEventListener("click", () => saveReport("txt"));
  saveMdBtn.addEventListener("click", () => saveReport("md"));

  savedPromptsSelect?.addEventListener("change", onSelectSavedPrompt);
  savePromptBtn.addEventListener("click", onSavePrompt);
  deletePromptBtn.addEventListener("click", onDeleteSavedPrompt);
  await refreshSavedPrompts();

  // Live progress updates streamed from the background while a report is generated.
  browser.runtime.onMessage?.addListener((message: unknown) => {
    const progressMessage = message as { type?: string; windowId?: number; progress?: AgenticProgress };
    if (progressMessage?.type === "report-progress" && progressMessage.windowId === windowId) {
      renderProgress(progressMessage.progress);
    }
  });

  setStatus("Ready.");
}

function renderProgress(progress?: AgenticProgress): void {
  if (!progressTextEl || !progress) return;
  const { llmCalls, toolCalls, phase } = progress;
  const llmLabel = `${llmCalls} LLM call${llmCalls === 1 ? "" : "s"}`;
  const toolLabel = `${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`;
  progressTextEl.textContent = `${phase} · ${llmLabel} · ${toolLabel}`;
}

async function onAbort(): Promise<void> {
  if (!busy) return;
  await browser.runtime.sendMessage({ type: "cancel-report", windowId });
  setStatus("Cancelling…");
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
  setStatus(`Saved prompt "${name}".`);
}

/** Delete the currently selected saved prompt. */
async function onDeleteSavedPrompt(): Promise<void> {
  const name = savedPromptsSelect?.value ?? "";
  if (!name) return;
  await deletePrompt(name);
  await refreshSavedPrompts();
  setStatus(`Deleted prompt "${name}".`);
}

/** Keep the folder picker and scope note consistent with the folder-only toggle. */
function updateScopeControls(): void {
  const single = folderOnlyInput.checked && !!folderContext;
  // The folder picker only applies to a single-folder search.
  if (folderPickerEl) folderPickerEl.hidden = !single;
  if (!single) closeFolderList();
  updateScopeNote();
}

function updateScopeNote(): void {
  if (!scopeNote) return;
  if (folderOnlyInput.checked && folderContext) {
    const name = selectedFolder?.name ?? folderName;
    scopeNote.textContent = `Scope: "${name}" only (use get_thread to follow replies into other folders).`;
  } else {
    scopeNote.textContent = "Scope: all folders.";
  }
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
    paths = await loadFolderPaths();
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
  let accountId = folderContext?.accountId ?? "";
  let name = path;
  try {
    const folder = await resolveFolderPath(path);
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
  updateScopeNote();
}

/** Load all folder paths, falling back to the background script if the direct API call fails. */
async function loadFolderPaths(): Promise<string[]> {
  try {
    return await getAllFolderPaths();
  } catch (directError) {
    console.warn("REPORT-WINDOW: direct folder-path lookup failed, trying background fallback:", directError);
  }
  const response = await browser.runtime.sendMessage({ type: "get-folder-paths" });
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

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

async function onCreate(): Promise<void> {
  if (busy) {
    // The button acts as a stop control while a report is being generated.
    await browser.runtime.sendMessage({ type: "cancel-report", windowId });
    setStatus("Cancelling…");
    return;
  }

  const prompt = promptInput?.value.trim() ?? "";
  if (!prompt) {
    setStatus("Please enter a report request first.");
    return;
  }

  const days = daysInput.valueAsNumber > 0 ? daysInput.valueAsNumber : 30;
  const folderOnly = folderOnlyInput.checked && !!folderContext;
  const targetFolder = selectedFolder ?? folderContext;
  // With a report already present, keep talking to the same agent instead of starting over.
  const continueConversation = hasReport;

  const request: ReportRequest = {
    prompt,
    days,
    folderOnly,
    folder: targetFolder ? { accountId: targetFolder.accountId, path: targetFolder.path } : null,
  };

  setBusy(true);
  // Progress row (spinner + live counters) now conveys generation state.
  setStatus("");
  try {
    const response = (await browser.runtime.sendMessage({
      type: "generate-report",
      windowId,
      request,
      continueConversation,
    })) as {
      report?: string;
      error?: string;
    };
    if (response?.error) {
      setStatus(`Error: ${response.error}`);
      return;
    }
    if (outputArea) outputArea.value = response?.report ?? "";
    hasReport = true;
    newReportBtn.hidden = false;
    setStatus("Report ready. Type a follow-up and click Create to refine it, or start a new report.");
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`);
  } finally {
    setBusy(false);
  }
}

/** Clear the current report and its agent conversation so the next Create starts from scratch. */
async function onNewReport(): Promise<void> {
  if (busy) return;
  await browser.runtime.sendMessage({ type: "reset-report", windowId }).catch(() => {});
  hasReport = false;
  newReportBtn.hidden = true;
  if (outputArea) outputArea.value = "";
  if (promptInput) promptInput.value = "";
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

/** Download the current report as a text or markdown file via a temporary object URL. */
function saveReport(extension: "txt" | "md"): void {
  const content = outputArea?.value ?? "";
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
  if (!outputArea?.value) {
    setStatus("Nothing to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(outputArea.value);
    setStatus("Report copied to clipboard.");
  } catch {
    // Fallback for environments without async clipboard access.
    outputArea.select();
    document.execCommand("copy");
    setStatus("Report copied to clipboard.");
  }
}
