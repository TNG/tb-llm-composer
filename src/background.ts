import {
  applyOrganisePlan,
  getActiveMailFolder,
  getAllFolderPaths,
  type MoveSource,
  type OrganiseAssignment,
  type OrganiseFolderOption,
  type OrganisePlan,
  type OrganisePlanEntry,
  organiseCurrentFolder,
  planOrganiseCurrentFolder,
  resolveFolderPath,
} from "./emailOrganising";
import { handleKeepAliveAlarm } from "./keepAlive";
import { executeLlmAction, type LlmPluginAction } from "./llmButtonClickHandling";
import type { AgenticProgress, LlmApiRequestMessage } from "./llmConnection";
import {
  addLlmActionsToMenu,
  enableSummarizeMenuEntryIfReply,
  handleMenuClickListener,
  restoreActionMenu,
  showOrganiseProgressMenu,
  updateOrganiseProgressMenu,
} from "./menu";
import { notifyOnError, timedNotification } from "./notifications";
import { getPluginOptions } from "./optionsParams";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";
import { continueReport, continueReportWithoutSearch, generateReport, type ReportRequest } from "./reportGeneration";
import type { ReportScope } from "./reportTools";

import Tab = browser.tabs.Tab;
import OnClickData = browser.menus.OnClickData;

// it is VERY important that this is the first line of the file.
// Otherwise, the shortcuts may not work if the background script is not running (which is after 90s of idling or so)
browser.commands.onCommand.addListener((command: string, tab: Tab) => {
  // The toolbar-action commands aren't compose actions; route them to their handlers.
  if (command === "organise-folder") return void toggleOrganiseFolder();
  if (command === "create-report") return void openReportWindow();
  return void executeLlmAction(command as LlmPluginAction, tab);
});

// Keep the background page alive during long-running LLM requests
browser.alarms.onAlarm.addListener(handleKeepAliveAlarm);

browser.tabs.onCreated.addListener(async (tab: Tab) => {
  await storeOriginalReplyText(tab);
  await enableSummarizeMenuEntryIfReply(tab);
});

browser.tabs.onRemoved.addListener(deleteFromOriginalTabCache);

// The toolbar action menu (organise/report) and the compose_action menu
// (compose/summarize) share the browser.menus namespace. Route the action-menu
// entries here; delegate everything else to the LLM action handler.
browser.menus.onClicked.addListener((info: OnClickData, tab?: Tab) => {
  // "organise-folder" starts a run; "cancel-organise" (shown while a run is in
  // progress) aborts it — both go through the same toggle.
  if (info.menuItemId === "organise-folder" || info.menuItemId === "cancel-organise") {
    return void toggleOrganiseFolder();
  }
  if (info.menuItemId === "create-report") {
    return void openReportWindow();
  }
  return handleMenuClickListener(info, tab);
});

// ── Organise-folder action (popup shown in mail tabs) ─────────────────────────
// Only one organise run happens at a time; a second trigger cancels it.
let organiseAbortController: AbortController | null = null;

/** Update the action icon/title to reflect organise loading/idle state, including progress %. */
async function setOrganiseActionState(loading: boolean, percent?: number) {
  try {
    if (loading) {
      const progress = percent === undefined ? "Organising…" : `Organising… ${percent}%`;
      await browser.action.setTitle({ title: progress });
      await browser.action.setIcon({ path: { 32: "icons/loader-32px.gif" } });
    } else {
      // Read the title from the manifest so the " (dev)" suffix is present in dev
      // builds and stripped in production, matching the compose_action behaviour.
      const defaultTitle = browser.runtime.getManifest().action?.default_title ?? "LLM Composer";
      await browser.action.setTitle({ title: defaultTitle });
      await browser.action.setIcon({
        path: { 16: "icons/icon-16px.png", 32: "icons/icon-32px.png", 64: "icons/icon-64px.png" },
      });
    }
  } catch (e) {
    console.warn("ORGANISE: Could not update action icon/title:", e);
  }
}

/** Start organising the active folder, or cancel an in-flight run if one exists. */
async function toggleOrganiseFolder(): Promise<void> {
  if (organiseAbortController) {
    console.log("ORGANISE: Aborting existing organise-folder run");
    // Only signal the abort here. The in-flight run's `finally` clears organiseAbortController and
    // restores the action icon/menu — but that cleanup is guarded by `organiseAbortController ===
    // abortController`, so we must NOT null it here or that guard fails and the UI never resets
    // (spinner and "Cancel Organise" entry would stick forever, making cancel look like a no-op).
    organiseAbortController.abort(new DOMException("User cancelled organise folder", "AbortError"));
    return;
  }

  const options = await getPluginOptions();
  const confirmBeforeMoving = options.confirmMovesBeforeApplying ?? true;

  const abortController = new AbortController();
  organiseAbortController = abortController;
  await setOrganiseActionState(true, 0);
  await showOrganiseProgressMenu(0);

  const onProgress = async (percent: number) => {
    await setOrganiseActionState(true, percent);
    await updateOrganiseProgressMenu(percent);
  };

  await notifyOnError(async () => {
    try {
      if (confirmBeforeMoving) {
        // Classify only, then let the user confirm/adjust in a popup before anything moves.
        const plan = await planOrganiseCurrentFolder(abortController.signal, onProgress);
        // Classification is done and the popup takes over from here, so end the "Organising…" UI NOW,
        // while the background is still active. Deferring to `finally` is unsafe: opening the popup
        // hands focus to the new window and MV3 may suspend the idle background before the deferred
        // menu/icon calls flush — leaving the progress entry stuck (see endOrganiseUi callers).
        await endOrganiseUi(abortController);
        if (plan && !abortController.signal.aborted) {
          if (plan.entries.length === 0) {
            await timedNotification("Organise Folder", "No movable emails in this folder.", 5000);
          } else {
            await openConfirmWindow(plan);
          }
        }
      } else {
        // Classify and move automatically, in batches.
        await organiseCurrentFolder(abortController.signal, onProgress);
      }
    } finally {
      // Safety net for the automatic path and for any error/abort before the popup handoff.
      await endOrganiseUi(abortController);
    }
  });
}

/** End the organise "in progress" UI (loading icon + progress/cancel menu entry) once per run. */
async function endOrganiseUi(controller: AbortController): Promise<void> {
  // Guard on controller identity so a superseding run or a duplicate call is a no-op.
  if (organiseAbortController !== controller) return;
  organiseAbortController = null;
  await setOrganiseActionState(false);
  await restoreActionMenu();
}

// ── Organise-folder confirmation popup ──────────────────────────────────────────
// The pending plan is persisted (not just held in memory) because MV3 may suspend the background page
// while the confirmation window is open; an in-memory map would be lost by the time the user clicks OK.
// Only serialisable data is stored (entries + folder metadata + source); destination folders are
// re-resolved from their paths at apply time.
interface StoredConfirmPlan {
  entries: OrganisePlanEntry[];
  folders: OrganiseFolderOption[];
  source: MoveSource | null;
}

// storage.session survives background suspension but is cleared on browser restart (ideal here). Fall
// back to storage.local on builds without a session area.
const confirmPlanStore = browser.storage.session ?? browser.storage.local;
const confirmPlanStorageKey = (planKey: string) => `organiseConfirmPlan:${planKey}`;

// Maps an open confirmation window to its plan key so the plan can be cleaned up when the window closes.
const confirmPlanKeysByWindow = new Map<number, string>();

async function saveConfirmPlan(planKey: string, plan: StoredConfirmPlan): Promise<void> {
  await confirmPlanStore.set({ [confirmPlanStorageKey(planKey)]: plan });
}

async function loadConfirmPlan(planKey: string): Promise<StoredConfirmPlan | undefined> {
  const key = confirmPlanStorageKey(planKey);
  const stored = await confirmPlanStore.get(key);
  return stored?.[key] as StoredConfirmPlan | undefined;
}

async function deleteConfirmPlan(planKey: string): Promise<void> {
  await confirmPlanStore.remove(confirmPlanStorageKey(planKey));
}

/** Open the confirmation popup for a plan and persist it so the window can fetch and apply it. */
async function openConfirmWindow(plan: OrganisePlan): Promise<void> {
  // organiseConfirm.html sits next to the options page in public/. Resolve it relative to the options
  // page URL so the path is correct in both the repo and the packaged build (see openReportWindow).
  const optionsPage = browser.runtime.getManifest().options_ui?.page ?? "public/options.html";
  const confirmUrl = new URL("organiseConfirm.html", browser.runtime.getURL(optionsPage));

  // Persist under a generated handoff key that travels in the URL, so the plan exists before the popup
  // loads (no read-before-write race) and is never lost if the created window has no id.
  const planKey = crypto.randomUUID();
  confirmUrl.searchParams.set("planKey", planKey);
  await saveConfirmPlan(planKey, { entries: plan.entries, folders: plan.folders, source: plan.source });

  const win = await browser.windows.create({
    type: "popup",
    url: confirmUrl.href,
    width: 620,
    height: 680,
  });
  if (win.id !== undefined) {
    confirmPlanKeysByWindow.set(win.id, planKey);
  }
}

/** Apply the user-confirmed assignments for a confirmation window. */
async function applyConfirmedPlan(
  planKey: string,
  assignments: OrganiseAssignment[],
): Promise<{ ok: boolean; error?: string }> {
  const plan = await loadConfirmPlan(planKey);
  if (!plan) {
    return { ok: false, error: "This organisation plan is no longer available." };
  }
  try {
    // Re-resolve the destination folders from their paths (index-aligned with the folder options).
    const resolvedFolders = await Promise.all(plan.folders.map((folder) => resolveFolderPath(folder.path)));
    const abortController = new AbortController();
    await applyOrganisePlan(assignments, resolvedFolders, plan.source, abortController.signal);
    await deleteConfirmPlan(planKey);
    return { ok: true };
  } catch (e) {
    console.warn("ORGANISE: failed to apply confirmed plan", e);
    return { ok: false, error: (e as Error).message };
  }
}

// ── Create-report flow ────────────────────────────────────────────────────────
// One AbortController per report window, keyed by the window id.
const reportAbortControllers = new Map<number, AbortController>();

// Ongoing agent conversation per report window, so refinements can continue it instead of
// starting over. Cleared when the user starts a new report or the window closes.
const reportSessions = new Map<number, { messages: LlmApiRequestMessage[]; scope: ReportScope }>();

/** Open the report window, seeding it with the active folder context via URL params. */
async function openReportWindow(): Promise<void> {
  const folder = await getActiveMailFolder();
  const params = new URLSearchParams();
  if (folder?.accountId) params.set("accountId", folder.accountId);
  if (folder?.path) params.set("path", folder.path);
  if (folder?.name) params.set("name", folder.name);

  // reports.html sits next to the options page in public/. Resolve it relative to the options
  // page URL so the path is correct whether the extension root is the repo (paths prefixed with
  // build/) or the packaged build/ folder (prefix stripped by the manifest transform).
  const optionsPage = browser.runtime.getManifest().options_ui?.page ?? "public/options.html";
  const reportsUrl = new URL(`reports.html?${params.toString()}`, browser.runtime.getURL(optionsPage)).href;

  await browser.windows.create({
    type: "popup",
    url: reportsUrl,
    width: 640,
    height: 720,
  });
}

async function runReport(
  windowId: number,
  request: ReportRequest,
  continueConversation: boolean,
  noSearch: boolean,
): Promise<void> {
  // Cancel any previous run for this window before starting a new one.
  reportAbortControllers.get(windowId)?.abort(new DOMException("Superseded by a new report", "AbortError"));

  const abortController = new AbortController();
  reportAbortControllers.set(windowId, abortController);
  const onProgress = (progress: AgenticProgress) => {
    // Fire-and-forget progress updates to the originating report window. If the
    // window is gone there is no receiver; ignore the resulting rejection.
    void browser.runtime.sendMessage({ type: "report-progress", windowId, progress }).catch(() => {});
  };
  try {
    const existing = reportSessions.get(windowId);
    let session: Awaited<ReturnType<typeof generateReport>>;
    if (continueConversation && existing) {
      // "Refine without search" rewrites the existing report via a plain chat (no tools); the normal
      // refine continues the agentic conversation with search tools available.
      session = noSearch
        ? await continueReportWithoutSearch(existing, request.prompt, abortController.signal, onProgress)
        : await continueReport(existing, request.prompt, abortController.signal, onProgress);
    } else {
      session = await generateReport(request, abortController.signal, onProgress);
    }
    // Persist the conversation so the next refinement continues it.
    reportSessions.set(windowId, { messages: session.messages, scope: session.scope });
    postReportResult(windowId, { report: session.report });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      postReportResult(windowId, { error: "Report generation was cancelled." });
    } else {
      console.error("REPORT: generation failed:", e);
      postReportResult(windowId, { error: (e as Error).message });
    }
  } finally {
    if (reportAbortControllers.get(windowId) === abortController) {
      reportAbortControllers.delete(windowId);
    }
  }
}

/**
 * Deliver a finished report (or error) to its window over a fire-and-forget message — NOT as the
 * reply to the original generate-report call. Keeping the request channel open for the whole
 * (potentially minutes-long) run risks it being torn down mid-generation ("Actor 'Conduits'
 * destroyed…"), which would hang the popup; this decouples the result from that channel's lifetime.
 */
function postReportResult(windowId: number, payload: { report?: string; error?: string }): void {
  void browser.runtime.sendMessage({ type: "report-result", windowId, ...payload }).catch(() => {});
}

// Clean up an in-flight report and its conversation when the window is closed.
browser.windows.onRemoved.addListener((windowId: number) => {
  const controller = reportAbortControllers.get(windowId);
  if (controller) {
    controller.abort(new DOMException("Report window closed", "AbortError"));
    reportAbortControllers.delete(windowId);
  }
  reportSessions.delete(windowId);
  // Closing the confirmation window without applying cancels the plan (nothing was moved).
  const planKey = confirmPlanKeysByWindow.get(windowId);
  if (planKey !== undefined) {
    confirmPlanKeysByWindow.delete(windowId);
    void deleteConfirmPlan(planKey).catch(() => {});
  }
});

// Register menu entries without blocking listener registration; this keeps
// click handlers responsive when MV3 wakes the background script on demand.
void addLlmActionsToMenu().catch((e) => {
  console.error("BACKGROUND: Failed to add LLM actions to menu:", e);
});

if (!browser.action) {
  console.error("ORGANISE: browser.action is not available in this Thunderbird version.");
  timedNotification("LLM Composer", "The action button requires Thunderbird 128 or later.", 10000);
}

// ── Runtime messages (options page + report window) ────────────────────────────
type ReportFolderPayload = { accountId: string; path: string } | null;

type RuntimeRequestMessage =
  | { type: "get-folder-paths" }
  | { type: "get-active-folder" }
  | {
      type: "generate-report";
      windowId: number;
      request: ReportRequest;
      continueConversation?: boolean;
      noSearch?: boolean;
    }
  | { type: "cancel-report"; windowId: number }
  | { type: "reset-report"; windowId: number }
  | { type: "open-email"; id: number }
  | { type: "reply-email"; id: number }
  | { type: "get-organise-plan"; planKey: string }
  | { type: "apply-organise-plan"; planKey: string; assignments: OrganiseAssignment[] };

function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "get-folder-paths" ||
    type === "get-active-folder" ||
    type === "generate-report" ||
    type === "cancel-report" ||
    type === "reset-report" ||
    type === "open-email" ||
    type === "reply-email" ||
    type === "get-organise-plan" ||
    type === "apply-organise-plan"
  );
}

/** Open a cited email in a message tab. Ids are session-scoped, so a stale id fails gracefully. */
async function openEmail(id: number): Promise<{ ok: true } | { error: string }> {
  try {
    await browser.messageDisplay.open({ messageId: id, location: "tab", active: true });
    return { ok: true };
  } catch (e) {
    console.error(`REPORT: could not open email id=${id}:`, e);
    return { error: "That email could not be opened — it may have been moved or deleted." };
  }
}

/** Start a reply to a cited email in a new compose tab. */
async function replyToEmail(id: number): Promise<{ ok: true } | { error: string }> {
  try {
    await browser.compose.beginReply(id, "replyToSender");
    return { ok: true };
  } catch (e) {
    console.error(`REPORT: could not reply to email id=${id}:`, e);
    return { error: "Could not start a reply — the email may have been moved or deleted." };
  }
}

// Handle requests that need background-context APIs.
browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeRequestMessage(message)) {
    return false;
  }

  switch (message.type) {
    case "get-folder-paths":
      return getAllFolderPaths();

    case "get-active-folder":
      return getActiveMailFolder().then((folder): { folder: ReportFolderPayload } => ({
        folder: folder?.accountId && folder?.path ? { accountId: folder.accountId, path: folder.path } : null,
      }));

    case "generate-report":
      // Run detached and ack immediately; the outcome is delivered later via a `report-result`
      // message (see postReportResult) so the popup never awaits a long-lived request channel.
      void runReport(
        message.windowId,
        message.request,
        message.continueConversation ?? false,
        message.noSearch ?? false,
      );
      return Promise.resolve({ ok: true });

    case "cancel-report": {
      const controller = reportAbortControllers.get(message.windowId);
      controller?.abort(new DOMException("User cancelled report", "AbortError"));
      reportAbortControllers.delete(message.windowId);
      return Promise.resolve({ ok: true });
    }

    case "reset-report": {
      // Drop the stored conversation so the next report starts a fresh agent conversation.
      reportSessions.delete(message.windowId);
      return Promise.resolve({ ok: true });
    }

    case "open-email":
      return openEmail(message.id);

    case "reply-email":
      return replyToEmail(message.id);

    case "get-organise-plan":
      return loadConfirmPlan(message.planKey).then((plan) => ({
        // `found` lets the popup tell an expired/missing plan apart from a valid but empty one.
        found: plan !== undefined,
        entries: plan?.entries ?? [],
        folders: plan?.folders ?? [],
        sourceName: plan?.source?.name ?? "",
      }));

    case "apply-organise-plan":
      return applyConfirmedPlan(message.planKey, message.assignments);

    default:
      return false;
  }
});
