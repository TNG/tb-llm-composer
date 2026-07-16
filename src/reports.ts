import type { AgenticProgress } from "./llmConnection";
import { getPluginOptions } from "./optionsParams";
import type { ReportRequest } from "./reportGeneration";
import { getButtonElement, getInputElement } from "./utils";

const params = new URLSearchParams(window.location.search);
const folderContext =
  params.get("accountId") && params.get("path")
    ? { accountId: params.get("accountId") as string, path: params.get("path") as string }
    : null;
const folderName = params.get("name") ?? folderContext?.path ?? "";

let windowId: number | undefined;
let busy = false;
let lastReport = "";

const folderOnlyInput = getInputElement("#folder-only");
const daysInput = getInputElement("#days");
const promptInput = document.querySelector<HTMLTextAreaElement>("#prompt");
const outputArea = document.querySelector<HTMLTextAreaElement>("#report-output");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const progressEl = document.querySelector<HTMLDivElement>("#progress");
const progressTextEl = document.querySelector<HTMLSpanElement>("#progress-text");
const abortBtn = getButtonElement("#abort-btn");
const createBtn = getButtonElement("#create-btn");
const copyBtn = getButtonElement("#copy-btn");
const saveTxtBtn = getButtonElement("#save-txt-btn");
const saveMdBtn = getButtonElement("#save-md-btn");
const scopeNote = document.querySelector<HTMLParagraphElement>("#scope-note");

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
  updateScopeNote();

  folderOnlyInput.addEventListener("change", updateScopeNote);
  createBtn.addEventListener("click", onCreate);
  abortBtn.addEventListener("click", onAbort);
  copyBtn.addEventListener("click", onCopy);
  saveTxtBtn.addEventListener("click", () => saveReport("txt"));
  saveMdBtn.addEventListener("click", () => saveReport("md"));

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

function updateScopeNote(): void {
  if (!scopeNote) return;
  if (folderOnlyInput.checked && folderContext) {
    scopeNote.textContent = `Scope: "${folderName}" only.`;
  } else {
    scopeNote.textContent = "Scope: all folders.";
  }
}

function setBusy(value: boolean): void {
  busy = value;
  // While generating, the send button turns into a stop control (Copilot-style),
  // so it must stay enabled to allow cancelling.
  createBtn.classList.toggle("busy", value);
  createBtn.title = value ? "Stop generating" : "Create report";
  createBtn.setAttribute("aria-label", value ? "Stop generating" : "Create report");
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

  const request: ReportRequest = {
    prompt,
    days,
    folderOnly,
    folder: folderContext,
    priorReport: lastReport || undefined,
  };

  setBusy(true);
  setStatus("Generating report… this may take a while.");
  try {
    const response = (await browser.runtime.sendMessage({ type: "generate-report", windowId, request })) as {
      report?: string;
      error?: string;
    };
    if (response?.error) {
      setStatus(`Error: ${response.error}`);
      return;
    }
    lastReport = response?.report ?? "";
    if (outputArea) outputArea.value = lastReport;
    setStatus("Report ready. Refine the prompt and click Create to iterate.");
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`);
  } finally {
    setBusy(false);
  }
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
