import { createPopupWindow } from "./popupSize";
import type { ConversationSummary } from "./summary";

/** A summary handed off to its popup, plus the compose tab the answer is written into. */
export interface StoredSummary extends ConversationSummary {
  tabId: number;
}

// storage.session survives background suspension but is cleared on restart; fall back to storage.local.
// Resolved lazily so importing this module does not require the browser global.
const summaryStore = () => browser.storage.session ?? browser.storage.local;
const summaryStorageKey = (summaryKey: string) => `conversationSummary:${summaryKey}`;

// Maps an open summary window to its handoff key so the stored summary is dropped when it closes.
const summaryKeysByWindow = new Map<number, string>();

export async function loadSummary(summaryKey: string): Promise<StoredSummary | undefined> {
  const key = summaryStorageKey(summaryKey);
  const stored = await summaryStore().get(key);
  return stored?.[key] as StoredSummary | undefined;
}

export async function deleteSummary(summaryKey: string): Promise<void> {
  await summaryStore().remove(summaryStorageKey(summaryKey));
}

/** Persist the summary under a fresh handoff key and open the summary popup for it. */
export async function openSummaryWindow(tabId: number, summary: ConversationSummary): Promise<void> {
  // summary.html sits next to the options page in public/; resolve it relative to that page so the path
  // is correct in both the repo and the packaged build.
  const optionsPage = browser.runtime.getManifest().options_ui?.page ?? "public/options.html";
  const summaryUrl = new URL("summary.html", browser.runtime.getURL(optionsPage));

  const summaryKey = crypto.randomUUID();
  summaryUrl.searchParams.set("summaryKey", summaryKey);
  const stored: StoredSummary = { ...summary, tabId };
  await summaryStore().set({ [summaryStorageKey(summaryKey)]: stored });

  const win = await createPopupWindow("summary", summaryUrl.href, 640, 720);
  if (win.id !== undefined) {
    summaryKeysByWindow.set(win.id, summaryKey);
  }
}

/** Drop the stored summary of a window that was closed. */
export function forgetSummaryWindow(windowId: number): void {
  const summaryKey = summaryKeysByWindow.get(windowId);
  if (summaryKey !== undefined) {
    summaryKeysByWindow.delete(windowId);
    void deleteSummary(summaryKey).catch(() => {});
  }
}
