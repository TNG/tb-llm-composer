import { rememberPopupSize } from "./popupSize";
import { formatAnswerInstructions, type OpenPoint, type OpenPointAnswer } from "./summary";
import { getButtonElement, getInputElement } from "./utils";

interface SummaryResponse {
  found: boolean;
  summary: string;
  openPoints: OpenPoint[];
}

// Handoff key set by the background when opening this window; identifies the summary to show.
const summaryKey = new URLSearchParams(location.search).get("summaryKey") ?? "";
let windowId: number | undefined;
let openPoints: OpenPoint[] = [];

const statusEl = getInputElement<HTMLParagraphElement>("#status");
const summaryEl = getInputElement<HTMLParagraphElement>("#summary-text");
const pointsSection = getInputElement<HTMLElement>("#points-section");
const pointsForm = getInputElement<HTMLFormElement>("#points");
const extraSection = getInputElement<HTMLElement>("#extra-section");
const extraInput = getInputElement<HTMLTextAreaElement>("#extra");
const writeBtn = getButtonElement("#write-btn");
const closeBtn = getButtonElement("#close-btn");

init().catch((e) => {
  console.error("SUMMARY: initialization failed", e);
  setStatus("Could not load the summary.");
});

async function init(): Promise<void> {
  windowId = (await browser.windows.getCurrent()).id;
  rememberPopupSize("summary");

  closeBtn.addEventListener("click", closeWindow);
  writeBtn.addEventListener("click", () => void onWrite());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWindow();
    if (event.key === "Enter" && !event.isComposing && (event.ctrlKey || event.metaKey) && !writeBtn.disabled) {
      void onWrite();
    }
  });
  // Enter in a lone detail field would otherwise submit the form (GET) and reload the page.
  pointsForm.addEventListener("submit", (event) => event.preventDefault());

  const response = (await browser.runtime.sendMessage({ type: "get-summary", summaryKey })) as SummaryResponse;
  if (!response?.found) {
    setStatus("This summary is no longer available.");
    return;
  }
  render(response);
}

function render(response: SummaryResponse): void {
  openPoints = response.openPoints;
  statusEl.hidden = true;
  summaryEl.textContent = response.summary || "(no summary)";
  summaryEl.hidden = false;

  pointsForm.replaceChildren(...openPoints.map(buildPoint));
  pointsSection.hidden = openPoints.length === 0;
  extraSection.hidden = false;
  writeBtn.disabled = false;
  // Start where the user acts first: the first open point, else the free-form instructions.
  (pointsForm.querySelector<HTMLElement>("input, textarea") ?? extraInput).focus();
}

/** Build one open point: a list of radio/checkbox rows for choices, a text box for open questions. */
function buildPoint(point: OpenPoint, index: number): HTMLFieldSetElement {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "point";

  const legend = document.createElement("legend");
  legend.textContent = `${index + 1}. ${point.question}`;
  if (point.type === "multi") {
    const hint = document.createElement("span");
    hint.className = "point-hint";
    hint.textContent = "(select all that apply)";
    legend.append(hint);
  }
  fieldset.append(legend);

  if (point.type === "text") {
    const textarea = document.createElement("textarea");
    textarea.name = `point-${index}-text`;
    textarea.rows = 2;
    textarea.placeholder = "Your answer";
    textarea.setAttribute("aria-label", point.question);
    fieldset.append(textarea);
    return fieldset;
  }

  const list = document.createElement("div");
  list.className = "options";
  for (const option of point.options) {
    const label = document.createElement("label");
    label.className = "option";
    const input = document.createElement("input");
    input.type = point.type === "single" ? "radio" : "checkbox";
    input.name = `point-${index}`;
    input.value = option;
    const text = document.createElement("span");
    text.textContent = option;
    label.append(input, text);
    list.append(label);
  }

  const note = document.createElement("input");
  note.type = "text";
  note.className = "note";
  note.name = `point-${index}-text`;
  note.placeholder = "Add a detail (optional)";
  note.setAttribute("aria-label", `Detail for "${point.question}"`);

  fieldset.append(list, note);
  return fieldset;
}

function collectAnswers(): OpenPointAnswer[] {
  return openPoints.map((_point, index) => {
    const selected = Array.from(
      pointsForm.querySelectorAll<HTMLInputElement>(`input[name="point-${index}"]:checked`),
      (input) => input.value,
    );
    const textEl = pointsForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="point-${index}-text"]`);
    return { selected, text: textEl?.value ?? "" };
  });
}

async function onWrite(): Promise<void> {
  writeBtn.disabled = true;
  const instructions = formatAnswerInstructions(openPoints, collectAnswers(), extraInput.value);
  try {
    const response = (await browser.runtime.sendMessage({
      type: "write-summary-answer",
      summaryKey,
      instructions,
    })) as { ok: boolean; error?: string };
    if (response?.ok) {
      closeWindow();
      return;
    }
    showError(response?.error ?? "unknown error");
  } catch (e) {
    showError((e as Error).message);
  }
  writeBtn.disabled = false;
}

function showError(message: string): void {
  setStatus(`Could not write the answer: ${message}`);
  statusEl.scrollIntoView({ block: "nearest" });
}

function setStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function closeWindow(): void {
  if (windowId !== undefined) void browser.windows.remove(windowId).catch(() => {});
}
