import { llmActionClickHandler } from "./llmButtonClickHandling";
import { storeOriginalReplyText } from "./storeOriginalReplyText";

browser.composeAction.onClicked.addListener(llmActionClickHandler);

browser.tabs.onCreated.addListener(storeOriginalReplyText);
