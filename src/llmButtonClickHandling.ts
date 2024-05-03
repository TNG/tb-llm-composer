import { isLlmTextcompletionResponse, LlmTextCompletionResponse, sendContentToLlm, TgiErrorResponse } from "./llmConnection";
import { notifyOnError, timedNotification } from "./notifications";
import Tab = browser.tabs.Tab;
import IconPath = browser._manifest.IconPath;

const LLM_HTML_NOT_IMPLEMENTED_TEXT: string = "LLM Support for HTML Mails is not yet implemented";
const DEFAULT_ICONS: IconPath = { 64: "icons/icon-64px.png" };

function removeUntilFirstAlphabeticalIncludingSpacesNewlines(str: string) {
  return str.replace(/^[^a-zA-Z]*[\s\n]*/, "");
}

function handleLlmSuccessResponse(tabId: number, response: LlmTextCompletionResponse) {
  const cleanedUpResponse = removeUntilFirstAlphabeticalIncludingSpacesNewlines(response.choices[0].message.content);
  browser.compose.setComposeDetails(tabId, {
    plainTextBody: cleanedUpResponse,
  });
}

function handleLlmErrorResponse(response: TgiErrorResponse) {
  throw Error("LLM responded with an error: " + response.error.message);
}

async function withButtonLoading(tabId: number, callback: () => Promise<any>) {
  await browser.composeAction.disable(tabId);
  await browser.composeAction.setIcon({ path: { 32: "icons/loader-32px.gif" } });
  await callback();
  await browser.composeAction.enable(tabId);
  await browser.composeAction.setIcon({ path: DEFAULT_ICONS });
}

async function communicateWithLlm(openTabId: number, tabDetails: browser.compose.ComposeDetails) {
  const response = await sendContentToLlm(tabDetails);
  if (isLlmTextcompletionResponse(response)) {
    handleLlmSuccessResponse(openTabId, response as LlmTextCompletionResponse);
  } else {
    handleLlmErrorResponse(response as TgiErrorResponse);
  }
}

export async function llmActionClickHandler(tab: Tab) {
  const openTabId = tab.id || 12312093;
  const tabDetails = await browser.compose.getComposeDetails(openTabId);
  if (tabDetails.isPlainText) {
    await withButtonLoading(
      openTabId,
      notifyOnError(() => communicateWithLlm(openTabId, tabDetails)),
    );
  } else {
    await timedNotification("Thunderbird LLM Extension", LLM_HTML_NOT_IMPLEMENTED_TEXT);
  }
}
