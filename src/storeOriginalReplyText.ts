import Tab = browser.tabs.Tab;

export const ORIGINAL_TAB_CONVERSATION: { [tab_id: string]: string } = {};

export async function storeOriginalReplyText(tab: Tab): Promise<void> {
  const openTabId = tab.id || 12312093;
  const composeDetails = await browser.compose.getComposeDetails(openTabId);

  if (composeDetails.type === "reply") {
    const tabDetails = await browser.compose.getComposeDetails(openTabId);

    if (tabDetails.plainTextBody) {
      const identity = await browser.identities.get(tabDetails.identityId as string);
      const previousConversationRaw = identity.signature
        ? tabDetails.plainTextBody.replace("-- \n" + identity.signature, "")
        : tabDetails.plainTextBody;

      ORIGINAL_TAB_CONVERSATION[openTabId] = previousConversationRaw.trim();

      return;
    }
  }

  delete ORIGINAL_TAB_CONVERSATION[openTabId];
}
