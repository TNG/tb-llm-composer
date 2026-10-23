import { getPlainTextSignature, replaceForeignSignatures } from "./emailHelpers";

import Tab = browser.tabs.Tab;

const cacheName = "ORIGINAL_TAB_CONVERSATION";

export async function getOriginalTabConversationCacheContent(): Promise<{
  [key: number]: string;
}> {
  const rawCache = await browser.storage.local.get(cacheName);
  return rawCache[cacheName] || {};
}

export async function getOriginalTabConversation(tabId: number): Promise<string | undefined> {
  console.log("LLM-CONVO-CACHE: Retrieving original convo for tab", tabId);
  return (await getOriginalTabConversationCacheContent())[tabId];
}

/**
 * The cached reply quote for `tabId`, with any other identity's signature replaced by `identity`'s.
 * The cache is filled when the composer opens, so switching the From identity afterwards would otherwise
 * write the previous identity's signature back into the reply.
 */
export async function getOriginalTabConversationForIdentity(
  tabId: number,
  identity: browser.identities.MailIdentity,
): Promise<string | undefined> {
  const cached = await getOriginalTabConversation(tabId);
  if (!cached) return cached;
  let others: string[] = [];
  try {
    others = (await browser.identities.list())
      .filter((other) => other.id !== identity.id)
      .map(getPlainTextSignature)
      .filter((signature): signature is string => !!signature);
  } catch (e) {
    console.warn("LLM-CONVO-CACHE: could not list identities to fix up the reply signature", e);
  }
  return replaceForeignSignatures(cached, getPlainTextSignature(identity), others);
}

export async function updateOriginalTabCache(tabId: number, content: string): Promise<void> {
  const cache = await getOriginalTabConversationCacheContent();
  console.log("LLM-CONVO-CACHE: Adding content for tab", tabId);
  cache[tabId] = content;
  await browser.storage.local.set({ [cacheName]: cache });
}

export async function deleteFromOriginalTabCache(tabId: number): Promise<void> {
  const cache = await getOriginalTabConversationCacheContent();
  console.log("LLM-CONVO-CACHE: Removing content for tab", tabId);
  delete cache[tabId];
  await browser.storage.local.set({ [cacheName]: cache });
}

export async function clearOriginalTabCache(): Promise<void> {
  console.log("LLM-CONVO-CACHE: Reset");
  await browser.storage.local.remove(cacheName);
}

export async function storeOriginalReplyText(tab: Tab): Promise<void> {
  if (tab.id) {
    const tabDetails = await browser.compose.getComposeDetails(tab.id);
    if (!tabDetails.isPlainText) {
      throw new Error("HTML mails are not supported");
    }

    const trimmedContent = tabDetails.plainTextBody?.trim() || "";

    if (tabDetails.type === "reply" && tabDetails.plainTextBody) {
      await updateOriginalTabCache(tab.id, trimmedContent);
    }
  }
}
