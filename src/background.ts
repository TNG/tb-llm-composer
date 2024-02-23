// This is directly copied from the example composer plugin from thunderbird:
// https://github.com/thunderbird/sample-extensions/blob/master/manifest_v3/composeBody/background.js

// Thunderbird can terminate idle backgrounds in manifest v3.
// Any listener directly added during add-on startup will be registered as a
// persistent listener and the background will wake up (restart) each time the
// event is fired.

import {
  isLlmTextcompletionResponse,
  LlmTextCompletionResponse,
  sentContentToLlm,
  TgiErrorResponse
} from "./llmConnection";

const LLM_DISABLED_TEXT = "LLM Support for HTML Mails is not yet supported\n\n";

function addParagraphToHtml(htmlBody: string, text: string) {
  const htmlTabWithBody = new DOMParser().parseFromString(htmlBody, "text/html");
  const newParagraph = htmlTabWithBody.createElement("p");
  newParagraph.textContent = text;
  htmlTabWithBody.body.prepend(newParagraph);
  return new XMLSerializer().serializeToString(htmlTabWithBody);
}

function handleLlmSuccessResponse(tabId: number, emailBody: string, response: LlmTextCompletionResponse) {
  const updatedBody = emailBody + "\n" + response.generated_text;
  browser.compose.setComposeDetails(tabId, {
    plainTextBody: updatedBody,
  });
}

function handleLlmErrorResponse(response: TgiErrorResponse) {
  console.warn(response);
}

browser.composeAction.onClicked.addListener(async (tab) => {
  const openTabId = tab.id || 12312093;
  const tabDetails = await browser.compose.getComposeDetails(openTabId);
  if (tabDetails.isPlainText) {
    let plainTextBody = tabDetails.plainTextBody;
    if (plainTextBody) {
      const response = await sentContentToLlm(plainTextBody);
      if (isLlmTextcompletionResponse(response)) {
        handleLlmSuccessResponse(openTabId, plainTextBody, response as LlmTextCompletionResponse);
      } else {
        handleLlmErrorResponse(response as TgiErrorResponse);
      }
    }
  } else {
    const html = addParagraphToHtml(tabDetails.body || "", LLM_DISABLED_TEXT);
    browser.compose.setComposeDetails(openTabId, { body: html });
  }
});
