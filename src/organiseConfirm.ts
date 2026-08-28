import type { OrganiseAssignment, OrganiseFolderOption, OrganisePlanEntry } from "./emailOrganising";
import { rememberPopupSize } from "./popupSize";
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
// Every entry in the plan, including pre-filter matches — this is what OK applies.
let planEntries: OrganisePlanEntry[] = [];
// The subset shown as reviewable rows: the LLM's proposals only, grouped by destination.
let listedEntries: OrganisePlanEntry[] = [];
let planFolders: OrganiseFolderOption[] = [];
let currentPage = 0;
// The confirmed destination per message id (null = keep in place). Persisted across page changes so
// choices made on one page survive navigating away — rows for other pages are not in the DOM.
const assignmentsByMessageId = new Map<number, number | null>();

const listEl = document.querySelector<HTMLDivElement>("#move-list");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const subtitleEl = document.querySelector<HTMLParagraphElement>("#subtitle");
const preFilterSummaryEl = document.querySelector<HTMLParagraphElement>("#prefilter-summary");
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

  // Reopen at whatever size this window ends up with, so the next open never has to be corrected.
  rememberPopupSize("organiseConfirm");

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

/** Sort key for an entry's group: folders in their configured order, "keep in place" last. */
function groupRank(folderIndex: number | null): number {
  return folderIndex === null ? planFolders.length : folderIndex;
}

/**
 * Header text for a group. Groups are formed from each entry's INITIAL proposal and never re-sorted,
 * so a row the user has since reassigned stays put — "Proposed:" keeps the header honest about what it
 * describes; the row's own dropdown is the current destination.
 */
function groupLabel(folderIndex: number | null): string {
  if (folderIndex === null) return "Proposed: Keep in place";
  const folder = planFolders[folderIndex];
  return folder ? `Proposed: ${folder.name || folder.path}` : "Proposed: Keep in place";
}

function folderLabel(folderIndex: number): string {
  const folder = planFolders[folderIndex];
  return folder ? folder.name || folder.path : "an unknown folder";
}

/**
 * Summarise what the deterministic pre-filter rules claimed as a single line ("3 to Newsletters,
 * 1 kept in place"). Those decisions need no review — the rules are the user's own and exact — so
 * they stay out of the row list, which is reserved for the LLM's guesses.
 */
function renderPreFilterSummary(entries: OrganisePlanEntry[]): void {
  if (!preFilterSummaryEl) return;
  if (entries.length === 0) {
    preFilterSummaryEl.hidden = true;
    preFilterSummaryEl.textContent = "";
    return;
  }

  const countByFolder = new Map<number, number>();
  let keptInPlace = 0;
  for (const entry of entries) {
    if (entry.proposedFolderIndex === null) {
      keptInPlace++;
      continue;
    }
    countByFolder.set(entry.proposedFolderIndex, (countByFolder.get(entry.proposedFolderIndex) ?? 0) + 1);
  }

  const parts = Array.from(countByFolder.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([folderIndex, count]) => `${count} to ${folderLabel(folderIndex)}`);
  if (keptInPlace > 0) parts.push(`${keptInPlace} kept in place`);

  preFilterSummaryEl.textContent = `Pre-filter rules matched ${entries.length} email${
    entries.length === 1 ? "" : "s"
  }: ${parts.join(", ")}. They move when you click OK.`;
  preFilterSummaryEl.hidden = false;
}

function render(plan: OrganisePlanResponse): void {
  planFolders = plan.folders;
  // Every entry is applied on OK, but only the LLM's proposals are listed for review; pre-filter
  // matches are deterministic and get the summary line above the list instead.
  planEntries = plan.entries;
  // Group the emails by the destination the model proposed. Sorting happens once, here: later manual
  // changes only update the assignment map, so rows never jump around under the user's cursor.
  listedEntries = plan.entries
    .filter((entry) => !entry.viaPreFilter)
    .sort((a, b) => groupRank(a.proposedFolderIndex) - groupRank(b.proposedFolderIndex));
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

  renderPreFilterSummary(plan.entries.filter((entry) => entry.viaPreFilter));

  if (listedEntries.length === 0) {
    if (listEl) listEl.replaceChildren();
    if (pagerEl) pagerEl.hidden = true;
    if (!plan.found) {
      setStatus("This organisation plan is no longer available.");
      applyBtn.disabled = true;
    } else if (planEntries.length === 0) {
      setStatus("No movable emails to show.");
      applyBtn.disabled = true;
    } else {
      // Nothing for the LLM to propose, but the pre-filter moves above still need confirming.
      setStatus("Every email was handled by your pre-filter rules.");
    }
    return;
  }

  renderPage();
}

function pageCount(): number {
  return Math.max(1, Math.ceil(listedEntries.length / PAGE_SIZE));
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
  const pageEntries = listedEntries.slice(start, start + PAGE_SIZE);
  // A header precedes each non-empty group; the group spanning a page break is re-labelled at the top
  // of the next page so every row on screen stays attributable to a destination.
  let lastRank: number | undefined;
  for (const entry of pageEntries) {
    const rank = groupRank(entry.proposedFolderIndex);
    if (rank !== lastRank) {
      listEl.appendChild(buildGroupHeader(entry.proposedFolderIndex));
      lastRank = rank;
    }
    listEl.appendChild(buildRow(entry));
  }
  listEl.scrollTop = 0;

  const total = listedEntries.length;
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

/** Build the sticky header introducing the rows the model assigned to one destination. */
function buildGroupHeader(folderIndex: number | null): HTMLDivElement {
  const header = document.createElement("div");
  header.className = "move-group";
  header.textContent = groupLabel(folderIndex);
  if (folderIndex !== null) {
    header.title = planFolders[folderIndex]?.path ?? "";
  }
  return header;
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
