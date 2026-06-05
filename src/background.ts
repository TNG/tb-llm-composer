import { getActiveMailFolder, getAllFolderPaths, organiseCurrentFolder } from "./emailOrganising";
import { handleKeepAliveAlarm } from "./keepAlive";
import { executeLlmAction, type LlmPluginAction } from "./llmButtonClickHandling";
import { addLlmActionsToMenu, enableSummarizeMenuEntryIfReply, handleMenuClickListener } from "./menu";
import { notifyOnError, timedNotification } from "./notifications";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";
import { generateReport, type ReportRequest } from "./reportGeneration";

import Tab = browser.tabs.Tab;

// it is VERY important that this is the first line of the file.
// Otherwise, the shortcuts may not work if the background script is not running (which is after 90s of idling or so)
browser.commands.onCommand.addListener((command: string, tab: Tab) =>
  executeLlmAction(command as LlmPluginAction, tab),
);

// Keep the background page alive during long-running LLM requests
browser.alarms.onAlarm.addListener(handleKeepAliveAlarm);

browser.tabs.onCreated.addListener(async (tab: Tab) => {
  await storeOriginalReplyText(tab);
  await enableSummarizeMenuEntryIfReply(tab);
});

browser.tabs.onRemoved.addListener(deleteFromOriginalTabCache);
browser.menus.onClicked.addListener(handleMenuClickListener);

// ── Organise-folder action (popup shown in mail tabs) ─────────────────────────
// Only one organise run happens at a time; a second trigger cancels it.
let organiseAbortController: AbortController | null = null;

/** Update the action icon/title to reflect organise loading/idle state. */
async function setOrganiseActionState(loading: boolean) {
  try {
    if (loading) {
      await browser.action.setTitle({ title: "LLM Composer — organising… (open menu to cancel)" });
      await browser.action.setIcon({ path: { 32: "icons/loader-32px.gif" } });
    } else {
      await browser.action.setTitle({ title: "LLM Composer (dev)" });
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
    organiseAbortController.abort(new DOMException("User cancelled organise folder", "AbortError"));
    organiseAbortController = null;
    await setOrganiseActionState(false);
    return;
  }

  const abortController = new AbortController();
  organiseAbortController = abortController;
  await setOrganiseActionState(true);

  await notifyOnError(async () => {
    try {
      await organiseCurrentFolder(abortController.signal);
    } finally {
      if (organiseAbortController === abortController) {
        organiseAbortController = null;
      }
      await setOrganiseActionState(false);
    }
  });
}

// ── Create-report flow ────────────────────────────────────────────────────────
// One AbortController per report window, keyed by the window id.
const reportAbortControllers = new Map<number, AbortController>();

/** Open the report window, seeding it with the active folder context via URL params. */
async function openReportWindow(): Promise<void> {
  const folder = await getActiveMailFolder();
  const params = new URLSearchParams();
  if (folder?.accountId) params.set("accountId", folder.accountId);
  if (folder?.path) params.set("path", folder.path);
  if (folder?.name) params.set("name", folder.name);

  await browser.windows.create({
    type: "popup",
    url: `build/public/reports.html?${params.toString()}`,
    width: 640,
    height: 720,
  });
}

async function runReport(windowId: number, request: ReportRequest): Promise<{ report?: string; error?: string }> {
  // Cancel any previous run for this window before starting a new one.
  reportAbortControllers.get(windowId)?.abort(new DOMException("Superseded by a new report", "AbortError"));

  const abortController = new AbortController();
  reportAbortControllers.set(windowId, abortController);
  try {
    const report = await generateReport(request, abortController.signal);
    return { report };
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return { error: "Report generation was cancelled." };
    }
    console.error("REPORT: generation failed:", e);
    return { error: (e as Error).message };
  } finally {
    if (reportAbortControllers.get(windowId) === abortController) {
      reportAbortControllers.delete(windowId);
    }
  }
}

// Clean up an in-flight report when its window is closed.
browser.windows.onRemoved.addListener((windowId: number) => {
  const controller = reportAbortControllers.get(windowId);
  if (controller) {
    controller.abort(new DOMException("Report window closed", "AbortError"));
    reportAbortControllers.delete(windowId);
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

// ── Runtime messages (options page + action popup + report window) ─────────────
type ReportFolderPayload = { accountId: string; path: string } | null;

type RuntimeRequestMessage =
  | { type: "get-folder-paths" }
  | { type: "organise-folder-toggle" }
  | { type: "open-report-window" }
  | { type: "get-active-folder" }
  | { type: "generate-report"; windowId: number; request: ReportRequest }
  | { type: "cancel-report"; windowId: number };

function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "get-folder-paths" ||
    type === "organise-folder-toggle" ||
    type === "open-report-window" ||
    type === "get-active-folder" ||
    type === "generate-report" ||
    type === "cancel-report"
  );
}

// Handle requests that need background-context APIs.
browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeRequestMessage(message)) {
    return false;
  }

  switch (message.type) {
    case "get-folder-paths":
      return getAllFolderPaths();

    case "organise-folder-toggle":
      return toggleOrganiseFolder().then(() => ({ ok: true }));

    case "open-report-window":
      return openReportWindow().then(() => ({ ok: true }));

    case "get-active-folder":
      return getActiveMailFolder().then((folder): { folder: ReportFolderPayload } => ({
        folder: folder?.accountId && folder?.path ? { accountId: folder.accountId, path: folder.path } : null,
      }));

    case "generate-report":
      return runReport(message.windowId, message.request);

    case "cancel-report": {
      const controller = reportAbortControllers.get(message.windowId);
      controller?.abort(new DOMException("User cancelled report", "AbortError"));
      reportAbortControllers.delete(message.windowId);
      return Promise.resolve({ ok: true });
    }

    default:
      return false;
  }
});
