import { llmActionClickHandler } from "./llmButtonClickHandling";

browser.composeAction.onClicked.addListener(llmActionClickHandler);
