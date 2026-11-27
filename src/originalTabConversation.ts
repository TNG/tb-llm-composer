import { getPlainTextSignature, replaceSignature } from "./emailHelpers";

import Tab = browser.tabs.Tab;

const cacheName = "ORIGINAL_TAB_CONVERSATION";

/** A reply's quote as cached when its composer opened, with the identity it was opened as. */
export interface CachedReply {
  content: string;
  identityId?: string;
}

export async function getOriginalTabConversationCacheContent(): Promise<{
  [key: number]: CachedReply;
}> {
  const rawCache = await browser.storage.local.get(cacheName);
  return rawCache[cacheName] || {};
}

async function getCachedReply(tabId: number): Promise<CachedReply | undefined> {
  console.log("LLM-CONVO-CACHE: Retrieving original convo for tab", tabId);
  const entry: CachedReply | string | undefined = (await getOriginalTabConversationCacheContent())[tabId];
  // Entries cached by earlier versions are the bare quote, without the identity.
  return typeof entry === "string" ? { content: entry } : entry;
}

export async function getOriginalTabConversation(tabId: number): Promise<string | undefined> {
  return (await getCachedReply(tabId))?.content;
}

/**
 * The cached reply quote for `tabId`, with the signature of the identity it was opened as replaced by
 * `identity`'s. The cache is filled when the composer opens, so switching the From identity afterwards
 * would otherwise write the previous identity's signature back into the reply.
 */
export async function getOriginalTabConversationForIdentity(
  tabId: number,
  identity: browser.identities.MailIdentity,
): Promise<string | undefined> {
  const cached = await getCachedReply(tabId);
  if (!cached?.identityId || cached.identityId === identity.id) return cached?.content;
  let opened: browser.identities.MailIdentity | null = null;
  try {
    opened = await browser.identities.get(cached.identityId);
  } catch (e) {
    console.warn("LLM-CONVO-CACHE: could not read the reply's original identity", e);
  }
  const openedSignature = opened ? getPlainTextSignature(opened) : undefined;
  return replaceSignature(cached.content, openedSignature, getPlainTextSignature(identity));
}

export async function updateOriginalTabCache(tabId: number, content: string, identityId?: string): Promise<void> {
  const cache = await getOriginalTabConversationCacheContent();
  console.log("LLM-CONVO-CACHE: Adding content for tab", tabId);
  cache[tabId] = { content, identityId };
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
      await updateOriginalTabCache(tab.id, trimmedContent, tabDetails.identityId);
    }
  }
}
