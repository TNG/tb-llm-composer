import { llmActionClickHandler } from "./llmButtonClickHandling";
import { deleteFromOriginalTabCache, storeOriginalReplyText } from "./originalTabConversation";

browser.composeAction.onClicked.addListener(llmActionClickHandler);

browser.tabs.onCreated.addListener(storeOriginalReplyText);
browser.tabs.onRemoved.addListener(deleteFromOriginalTabCache);
