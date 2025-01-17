import { isLlmTextCompletionResponse, LlmTextCompletionResponse, sendContentToLlm, TgiErrorResponse } from "./llmConnection";
import { notifyOnError, timedNotification } from "./notifications";
import { getSentMessages } from "./retrieveSentContext";
import { getFirstRecipientMailAddress } from "./emailHelpers";
import { getOriginalTabConversation } from "./originalTabConversation";
import { getEmailGenerationContext, getEmailGenerationPrompt } from "./promptAndContext";
import { getPluginOptions } from "./options";
import Tab = browser.tabs.Tab;
import IconPath = browser._manifest.IconPath;

const LLM_HTML_NOT_IMPLEMENTED_TEXT: string = "LLM Support for HTML Mails is not yet implemented";
const DEFAULT_ICONS: IconPath = { 64: "icons/icon-64px.png" };

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

async function withButtonLoading(tabId: number, callback: () => Promise<any>) {
  await browser.composeAction.disable(tabId);
  await browser.composeAction.setIcon({ path: { 32: "icons/loader-32px.gif" } });
  await callback();
  await browser.composeAction.enable(tabId);
  await browser.composeAction.setIcon({ path: DEFAULT_ICONS });
}

async function getOldMessagesToFirstRecipient(tabDetails: browser.compose.ComposeDetails) {
  const recipient = getFirstRecipientMailAddress(tabDetails);

  return recipient ? await getSentMessages(recipient.toString()) : [];
}

async function communicateWithLlm(openTabId: number, tabDetails: browser.compose.ComposeDetails) {
  const oldMessages = await getOldMessagesToFirstRecipient(tabDetails);
  const context = await getEmailGenerationContext(oldMessages, await getPluginOptions());

  const previousConversation = await getOriginalTabConversation(openTabId);
  const prompt = await getEmailGenerationPrompt(tabDetails, previousConversation);

  const response = await sendContentToLlm(context, prompt);
  if (isLlmTextCompletionResponse(response)) {
    await handleLlmSuccessResponse(openTabId, response as LlmTextCompletionResponse);
  } else {
    handleLlmErrorResponse(response as TgiErrorResponse);
  }
}

async function handleLlmSuccessResponse(tabId: number, response: LlmTextCompletionResponse) {
  const tabDetails = await browser.compose.getComposeDetails(tabId);
  const identity = await browser.identities.get(tabDetails.identityId as string);
  const signature: string | undefined = identity.signature;

  const originalContent = await getOriginalTabConversation(tabId);
  const cleanedUpGeneratedEmail = await getCleanedUpGeneratedEmail(response, signature);
  const fullEmail = `${cleanedUpGeneratedEmail}${originalContent ? `\n\n${originalContent}` : ""}${!originalContent ? `\n\n${signature} ` : ""}`;

  await browser.compose.setComposeDetails(tabId, {
    plainTextBody: fullEmail,
  });
}

async function getCleanedUpGeneratedEmail(response: LlmTextCompletionResponse, signature: string | undefined) {
  const responseWithoutSignature = signature
    ? response.choices[0].message.content.replace(signature, "")
    : response.choices[0].message.content;

  return responseWithoutSignature.replace(/^\s*/, "");
}

function handleLlmErrorResponse(response: TgiErrorResponse) {
  throw Error("LLM responded with an error: " + response.error.message);
}
