// This is directly copied from the example composer plugin from thunderbird:
// https://github.com/thunderbird/sample-extensions/blob/master/manifest_v3/composeBody/background.js

// Thunderbird can terminate idle backgrounds in manifest v3.
// Any listener directly added during add-on startup will be registered as a
// persistent listener and the background will wake up (restart) each time the
// event is fired.

import { isLlmTextcompletionResponse, LlmTextCompletionResponse, sentContentToLlm, TgiErrorResponse } from "./llmConnection";
import IconPath = browser._manifest.IconPath;

const LLM_DISABLED_TEXT: string = "LLM Support for HTML Mails is not yet supported\n\n";

const defaultIcons: IconPath = { 64: "icons/icon-64px.png" };

function addParagraphToHtml(htmlBody: string, text: string) {
  const htmlTabWithBody = new DOMParser().parseFromString(htmlBody, "text/html");
  const newParagraph = htmlTabWithBody.createElement("p");
  newParagraph.textContent = text;
  htmlTabWithBody.body.prepend(newParagraph);
  return new XMLSerializer().serializeToString(htmlTabWithBody);
}

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
  console.warn(response);
}

async function withErrorHandling(tabId: number, callback: () => void) {
  await browser.composeAction.disable(tabId);
  await browser.composeAction.setIcon({ path: { 32: "icons/loader-32px.gif" } });
  try {
    await callback();
    return true;
  } catch (e) {
    const notificationId = await browser.notifications.create({
      title: "Thunderbird LLM Extension Error",
      message: (e as Error).message,
      type: "basic",
    });
    setTimeout(() => browser.notifications.clear(notificationId), 2000);
    return false;
  } finally {
    await browser.composeAction.enable(tabId);
    await browser.composeAction.setIcon({ path: defaultIcons });
  }
}

browser.composeAction.onClicked.addListener(async (tab) => {
  const openTabId = tab.id || 12312093;
  const tabDetails = await browser.compose.getComposeDetails(openTabId);
  if (tabDetails.isPlainText) {
    let plainTextBody = tabDetails.plainTextBody || "";
    if (plainTextBody) {
      await withErrorHandling(openTabId, async () => {
        const response = await sentContentToLlm(plainTextBody);
        if (isLlmTextcompletionResponse(response)) {
          handleLlmSuccessResponse(openTabId, response as LlmTextCompletionResponse);
        } else {
          handleLlmErrorResponse(response as TgiErrorResponse);
        }
      });
    }
  } else {
    const html = addParagraphToHtml(tabDetails.body || "", LLM_DISABLED_TEXT);
    browser.compose.setComposeDetails(openTabId, { body: html });
  }
});
