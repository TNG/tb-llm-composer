import Tab = browser.tabs.Tab;

const cacheName = "ORIGINAL_TAB_CONVERSATION";

export async function getOriginalTabConversationCacheContent(): Promise<{[key: number]: string}> {
  return (await browser.storage.local.get(cacheName)) || {};
}

export async function getOriginalTabConversation(tabId: number): Promise<string> {
  return (await getOriginalTabConversationCacheContent())[tabId]
}

export async function updateOriginalTabCache(tabId: number, content: string): Promise<void> {
  const cache = await getOriginalTabConversationCacheContent();
  cache[tabId] = content;
  await browser.storage.local.set({ [cacheName]: cache });
}

export async function deleteFromOriginalTabCache(tabId: number): Promise<void> {
  const cache = await getOriginalTabConversationCacheContent();
  delete cache[tabId];
  await browser.storage.local.set({ [cacheName]: cache });
}

export async function clearOriginalTabCache(): Promise<void> {
  await browser.storage.local.remove(cacheName);
}

export async function storeOriginalReplyText(tab: Tab) {
  if (tab.id) {
    const tabDetails = await browser.compose.getComposeDetails(tab.id);
    if (tabDetails.type === "reply" && tabDetails.plainTextBody) {
      const identity = await browser.identities.get(tabDetails.identityId as string);
      const previousConversationRaw = identity.signature
        ? tabDetails.plainTextBody.replace("-- \n" + identity.signature, "")
        : tabDetails.plainTextBody;
      await updateOriginalTabCache(tab.id, previousConversationRaw.trim());
    }
  }
}
