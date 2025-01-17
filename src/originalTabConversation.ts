import Tab = browser.tabs.Tab;

const cacheName = "ORIGINAL_TAB_CONVERSATION";

export async function getOriginalTabConversationCacheContent(): Promise<{ [key: number]: string }> {
  const rawCache = await browser.storage.local.get(cacheName);
  return rawCache[cacheName] || {};
}

export async function getOriginalTabConversation(tabId: number): Promise<string> {
  console.log("LLM-CONVO-CACHE: Retrieving original convo for tab", tabId);
  return (await getOriginalTabConversationCacheContent())[tabId];
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

export async function storeOriginalReplyText(tab: Tab) {
  if (tab.id) {
    const tabDetails = await browser.compose.getComposeDetails(tab.id);
    if (tabDetails.type === "reply" && tabDetails.plainTextBody) {
      await updateOriginalTabCache(tab.id, tabDetails.plainTextBody.trim());
    }
  }
}
