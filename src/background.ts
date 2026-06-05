import { getAllFolderPaths, organiseCurrentFolder } from "./emailOrganising";
import { handleKeepAliveAlarm } from "./keepAlive";
import { executeLlmAction, type LlmPluginAction } from "./llmButtonClickHandling";
import { addLlmActionsToMenu, enableSummarizeMenuEntryIfReply, handleMenuClickListener } from "./menu";
import { notifyOnError, timedNotification } from "./notifications";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";

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

// ── Organise-folder action (shown in mail tabs) ───────────────────────────────
// Thunderbird MV3 uses browser.action; guard in case the API is not available.
const organiseAbortControllers = new Map<number, AbortController>();

/** Get clicked tab ID, falling back to active tab if none provided. */
async function resolveClickedTabId(tab?: Tab): Promise<number | undefined> {
  if (tab?.id !== undefined) {
    return tab.id;
  }

  // Thunderbird may invoke action clicks without a tab payload in some contexts.
  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
  return activeTabs[0]?.id;
}

/** Update compose action icon and title to reflect loading/idle state. */
async function setOrganiseActionState(loading: boolean) {
  try {
    if (loading) {
      await browser.action.setTitle({ title: "Cancel Organise Folder (click to stop)" });
      await browser.action.setIcon({ path: { 32: "icons/loader-32px.gif" } });
    } else {
      await browser.action.setTitle({ title: "Organise Folder with LLM (dev)" });
      await browser.action.setIcon({
        path: { 16: "icons/icon-16px.png", 32: "icons/icon-32px.png", 64: "icons/icon-64px.png" },
      });
    }
  } catch (e) {
    console.warn("ORGANISE: Could not update action icon/title:", e);
  }
}

if (browser.action?.onClicked) {
  console.log("ORGANISE: Registering browser.action.onClicked listener");
  browser.action.onClicked.addListener(async (tab?: Tab) => {
    console.log("ORGANISE: Action button clicked, tab:", tab?.id);
    const tabId = await resolveClickedTabId(tab);
    if (tabId === undefined) {
      console.error("ORGANISE: No tabId on click");
      await timedNotification(
        "LLM Composer",
        "Could not detect the active tab for organise folder. Please click the button in a mail tab.",
        7000,
      );
      return;
    }

    // Second click = cancel
    if (organiseAbortControllers.has(tabId)) {
      console.log("ORGANISE: Aborting existing organise-folder run for tab", tabId);
      organiseAbortControllers.get(tabId)?.abort(new DOMException("User cancelled organise folder", "AbortError"));
      organiseAbortControllers.delete(tabId);
      await setOrganiseActionState(false);
      return;
    }

    const abortController = new AbortController();
    organiseAbortControllers.set(tabId, abortController);
    await setOrganiseActionState(true);

    await notifyOnError(async () => {
      try {
        await organiseCurrentFolder(abortController.signal);
      } finally {
        organiseAbortControllers.delete(tabId);
        await setOrganiseActionState(false);
      }
    });
  });
} else {
  console.error("ORGANISE: browser.action.onClicked is not available in this Thunderbird version.");
  timedNotification("LLM Composer", "Organise folder button requires Thunderbird 128 or later.", 10000);
}

// Register menu entries without blocking listener registration; this keeps
// click handlers responsive when MV3 wakes the background script on demand.
void addLlmActionsToMenu().catch((e) => {
  console.error("BACKGROUND: Failed to add LLM actions to menu:", e);
});

type RuntimeRequestMessage = {
  type: "get-folder-paths";
};

function isRuntimeRequestMessage(value: unknown): value is RuntimeRequestMessage {
  if (!value || typeof value !== "object") return false;
  return (value as { type?: unknown }).type === "get-folder-paths";
}

// Handle options-page requests that need background-context APIs.
browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isRuntimeRequestMessage(message)) {
    return false;
  }
  return getAllFolderPaths();
});
