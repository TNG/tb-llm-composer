import { type LlmPluginAction, executeLlmAction } from "./llmButtonClickHandling";
import { addLlmActionsToMenu, enableSummarizeMenuEntryIfReply, handleMenuClickListener } from "./menu";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";
import Tab = browser.tabs.Tab;

// it is VERY important that this is the first line of the file.
// Otherwise, the shortcuts may not work if the background script is not running (which is after 90s of idling or so)
browser.commands.onCommand.addListener((command, tab) => executeLlmAction(command as LlmPluginAction, tab));

browser.tabs.onCreated.addListener(async (tab: Tab) => {
  await storeOriginalReplyText(tab);
  await enableSummarizeMenuEntryIfReply(tab);
});

browser.tabs.onRemoved.addListener(deleteFromOriginalTabCache);

browser.menus.onClicked.addListener(handleMenuClickListener);

await addLlmActionsToMenu();
