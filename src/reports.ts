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
const busyImg = document.querySelector<HTMLImageElement>("#busy");
const createBtn = getButtonElement("#create-btn");
const copyBtn = getButtonElement("#copy-btn");
const saveTxtBtn = getButtonElement("#save-txt-btn");
const saveMdBtn = getButtonElement("#save-md-btn");
const scopeNote = document.querySelector<HTMLParagraphElement>("#scope-note");

void init();

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
  copyBtn.addEventListener("click", onCopy);
  saveTxtBtn.addEventListener("click", () => saveReport("txt"));
  saveMdBtn.addEventListener("click", () => saveReport("md"));
  setStatus("Ready.");
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
  busyImg?.classList.toggle("show", value);
}

function setStatus(text: string): void {
  if (!statusEl) return;
  // Keep the busy image; replace only the trailing text node.
  const tail = statusEl.lastChild;
  if (tail && tail.nodeType === Node.TEXT_NODE) {
    tail.textContent = text;
  } else {
    statusEl.appendChild(document.createTextNode(text));
  }
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
  link.download = `llm-composer-report.${extension}`;
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
