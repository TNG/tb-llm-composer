import type { OrganiseAssignment, OrganiseFolderOption, OrganisePlanEntry } from "./emailOrganising";
import { getButtonElement } from "./utils";

interface OrganisePlanResponse {
  // False when the plan is missing/expired (as opposed to present but empty).
  found: boolean;
  entries: OrganisePlanEntry[];
  folders: OrganiseFolderOption[];
  sourceName: string;
}

const PAGE_SIZE = 20;

// Handoff key set by the background when opening this window; identifies the plan to load/apply.
const planKey = new URLSearchParams(location.search).get("planKey") ?? "";
let windowId: number | undefined;
let planEntries: OrganisePlanEntry[] = [];
let planFolders: OrganiseFolderOption[] = [];
let currentPage = 0;
// The confirmed destination per message id (null = keep in place). Persisted across page changes so
// choices made on one page survive navigating away — rows for other pages are not in the DOM.
const assignmentsByMessageId = new Map<number, number | null>();

const listEl = document.querySelector<HTMLDivElement>("#move-list");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const subtitleEl = document.querySelector<HTMLParagraphElement>("#subtitle");
const pagerEl = document.querySelector<HTMLDivElement>("#pager");
const pagerTextEl = document.querySelector<HTMLSpanElement>("#pager-text");
const applyBtn = getButtonElement("#apply-btn");
const cancelBtn = getButtonElement("#cancel-btn");
const prevBtn = getButtonElement("#prev-btn");
const nextBtn = getButtonElement("#next-btn");

init().catch((e) => {
  console.error("ORGANISE-CONFIRM: initialization failed", e);
  setStatus("Could not load the proposed moves.");
});

async function init(): Promise<void> {
  const current = await browser.windows.getCurrent();
  windowId = current.id;

  applyBtn.addEventListener("click", () => void onApply());
  cancelBtn.addEventListener("click", () => void browser.windows.remove(windowId as number).catch(() => {}));
  prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
  nextBtn.addEventListener("click", () => goToPage(currentPage + 1));

  const plan = await loadPlan();
  render(plan);
}

/**
 * Fetch the plan by its handoff key. The plan is persisted before this window opens, but storage
 * propagation can lag slightly — retry a few times until it is found before giving up.
 */
async function loadPlan(): Promise<OrganisePlanResponse> {
  let response: OrganisePlanResponse = { found: false, entries: [], folders: [], sourceName: "" };
  for (let attempt = 0; attempt < 5; attempt++) {
    response = (await browser.runtime.sendMessage({
      type: "get-organise-plan",
      planKey,
    })) as OrganisePlanResponse;
    if (response?.found) {
      return response;
    }
    await delay(120);
  }
  return response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render(plan: OrganisePlanResponse): void {
  planEntries = plan.entries;
  planFolders = plan.folders;
  currentPage = 0;
  assignmentsByMessageId.clear();
  for (const entry of planEntries) {
    assignmentsByMessageId.set(entry.messageId, entry.proposedFolderIndex);
  }

  if (subtitleEl && plan.sourceName) {
    subtitleEl.textContent =
      `Choose where each email from "${plan.sourceName}" should go, then click OK. ` +
      "Close this window to cancel — nothing moves until you confirm.";
  }

  if (planEntries.length === 0) {
    if (listEl) listEl.replaceChildren();
    setStatus(plan.found ? "No movable emails to show." : "This organisation plan is no longer available.");
    applyBtn.disabled = true;
    if (pagerEl) pagerEl.hidden = true;
    return;
  }

  renderPage();
}

function pageCount(): number {
  return Math.max(1, Math.ceil(planEntries.length / PAGE_SIZE));
}

function goToPage(page: number): void {
  const clamped = Math.min(Math.max(page, 0), pageCount() - 1);
  if (clamped === currentPage) return;
  currentPage = clamped;
  renderPage();
}

/** Render the current page of rows plus the pager and status line. */
function renderPage(): void {
  if (!listEl) return;
  listEl.replaceChildren();

  const start = currentPage * PAGE_SIZE;
  const pageEntries = planEntries.slice(start, start + PAGE_SIZE);
  for (const entry of pageEntries) {
    listEl.appendChild(buildRow(entry));
  }
  listEl.scrollTop = 0;

  const total = planEntries.length;
  const to = Math.min(start + PAGE_SIZE, total);
  setStatus(`Showing ${start + 1}–${to} of ${total} email${total === 1 ? "" : "s"}.`);

  if (pagerEl) {
    const pages = pageCount();
    pagerEl.hidden = pages <= 1;
    if (pagerTextEl) pagerTextEl.textContent = `Page ${currentPage + 1} of ${pages}`;
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage >= pages - 1;
  }
}

/** Build one row: subject + author plus a destination dropdown reflecting the current assignment. */
function buildRow(entry: OrganisePlanEntry): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "move-row";

  const info = document.createElement("div");
  info.className = "move-info";

  const subject = document.createElement("div");
  subject.className = "move-subject";
  subject.textContent = entry.subject || "(no subject)";
  subject.title = entry.subject || "(no subject)";

  const author = document.createElement("div");
  author.className = "move-author";
  author.textContent = entry.author || "(unknown sender)";
  author.title = entry.author || "";

  info.append(subject, author);

  const select = document.createElement("select");
  select.className = "move-select";
  // Name the control for screen readers by the email it applies to.
  select.setAttribute("aria-label", `Destination for "${entry.subject || "(no subject)"}"`);

  // "Keep in place" is the null option; each folder is an option whose value is its index.
  const keep = document.createElement("option");
  keep.value = "";
  keep.textContent = "Keep in place";
  select.appendChild(keep);

  planFolders.forEach((folder, index) => {
    const option = document.createElement("option");
    option.value = `${index}`;
    option.textContent = folder.name || folder.path;
    option.title = folder.path;
    select.appendChild(option);
  });

  const assigned = assignmentsByMessageId.get(entry.messageId) ?? null;
  select.value = assigned === null ? "" : `${assigned}`;
  select.addEventListener("change", () => {
    assignmentsByMessageId.set(entry.messageId, select.value === "" ? null : Number(select.value));
  });

  row.append(info, select);
  return row;
}

async function onApply(): Promise<void> {
  applyBtn.disabled = true;
  cancelBtn.disabled = true;
  setStatus("Applying moves…");

  const assignments: OrganiseAssignment[] = planEntries.map((entry) => ({
    messageId: entry.messageId,
    folderIndex: assignmentsByMessageId.get(entry.messageId) ?? null,
  }));

  try {
    const response = (await browser.runtime.sendMessage({
      type: "apply-organise-plan",
      planKey,
      assignments,
    })) as { ok: boolean; error?: string };

    if (response?.ok) {
      // The background shows the summary notification; close the window.
      await browser.windows.remove(windowId as number).catch(() => {});
    } else {
      applyBtn.disabled = false;
      cancelBtn.disabled = false;
      setStatus(`Could not apply moves: ${response?.error ?? "unknown error"}`);
    }
  } catch (e) {
    applyBtn.disabled = false;
    cancelBtn.disabled = false;
    setStatus(`Could not apply moves: ${(e as Error).message}`);
  }
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}
