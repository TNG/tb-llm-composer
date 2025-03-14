import {
  COMPOSE_MENU_ENTRY,
  SUMMARIZE_MENU_ENTRY,
  addMenuEntry,
  enableSummarizeMenuEntryIfReply,
  handleMenuClickListener,
} from "./menu";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";
import Tab = browser.tabs.Tab;

browser.tabs.onCreated.addListener(async (tab: Tab) => {
  await storeOriginalReplyText(tab);
  await enableSummarizeMenuEntryIfReply(tab);
});

browser.tabs.onRemoved.addListener(deleteFromOriginalTabCache);

browser.menus.onClicked.addListener(handleMenuClickListener);
await addMenuEntry(SUMMARIZE_MENU_ENTRY);
await addMenuEntry(COMPOSE_MENU_ENTRY);
