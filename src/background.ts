import { getActiveMailFolder, getAllFolderPaths, organiseCurrentFolder } from "./emailOrganising";
import { handleKeepAliveAlarm } from "./keepAlive";
import { executeLlmAction, type LlmPluginAction } from "./llmButtonClickHandling";
import { addLlmActionsToMenu, enableSummarizeMenuEntryIfReply, handleMenuClickListener } from "./menu";
import { notifyOnError, timedNotification } from "./notifications";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";
import { generateReport, type ReportRequest } from "./reportGeneration";

import Tab = browser.tabs.Tab;
import OnClickData = browser.menus.OnClickData;

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

// The toolbar action menu (organise/report) and the compose_action menu
// (compose/summarize) share the browser.menus namespace. Route the action-menu
// entries here; delegate everything else to the LLM action handler.
browser.menus.onClicked.addListener((info: OnClickData, tab?: Tab) => {
  if (info.menuItemId === "organise-folder") {
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

/** Update the action icon/title to reflect organise loading/idle state. */
async function setOrganiseActionState(loading: boolean) {
  try {
    if (loading) {
      await browser.action.setTitle({ title: "LLM Composer — organising… (open menu to cancel)" });
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

// ── Runtime messages (options page + report window) ────────────────────────────
type ReportFolderPayload = { accountId: string; path: string } | null;

type RuntimeRequestMessage =
  | { type: "get-folder-paths" }
  | { type: "get-active-folder" }
  | { type: "generate-report"; windowId: number; request: ReportRequest }
  | { type: "cancel-report"; windowId: number };

function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "get-folder-paths" ||
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
