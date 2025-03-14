import { getFirstRecipientMailAddress } from "./emailHelpers";
import {
  type LlmTextCompletionResponse,
  type TgiErrorResponse,
  isLlmTextCompletionResponse,
  sendContentToLlm,
} from "./llmConnection";
import { notifyOnError, timedNotification } from "./notifications";
import { getPluginOptions } from "./options";
import { getOriginalTabConversation } from "./originalTabConversation";
import { getEmailGenerationContext, getEmailGenerationPrompt, getSummaryPromptAndContext } from "./promptAndContext";
import { getSentMessages } from "./retrieveSentContext";
import Tab = browser.tabs.Tab;
import IconPath = browser._manifest.IconPath;

const LLM_HTML_NOT_IMPLEMENTED_TEXT: string = "LLM Support for HTML Mails is not yet implemented";
const DEFAULT_ICONS: IconPath = { 64: "icons/icon-64px.png" };

export async function llmActionClickHandler(tab: Tab, communicateWithLlm: (tabID: number) => Promise<void>) {
  const openTabId = tab.id;
  if (openTabId === undefined) {
    //This should NOT happen and should be a thunderbird bug.
    console.error("No tabId found for detail request");
    throw Error("no tabId");
  }

  const tabDetails = await browser.compose.getComposeDetails(openTabId);
  if (tabDetails.isPlainText) {
    await withButtonLoading(openTabId, () => notifyOnError(() => communicateWithLlm(openTabId)));
  } else {
    await timedNotification("Thunderbird LLM Extension", LLM_HTML_NOT_IMPLEMENTED_TEXT);
  }
}

async function withButtonLoading<T>(tabId: number, callback: () => Promise<T>) {
  await browser.composeAction.disable(tabId);
  await browser.composeAction.setIcon({
    path: { 32: "icons/loader-32px.gif" },
  });
  const returnValue = await callback();
  await browser.composeAction.enable(tabId);
  await browser.composeAction.setIcon({ path: DEFAULT_ICONS });
  return returnValue;
}

async function getOldMessagesToFirstRecipient(tabDetails: browser.compose.ComposeDetails) {
  const recipient = getFirstRecipientMailAddress(tabDetails);

  return recipient ? await getSentMessages(recipient.toString()) : [];
}

export async function compose(tabId: number) {
  const tabDetails = await browser.compose.getComposeDetails(tabId);

  const oldMessages = await getOldMessagesToFirstRecipient(tabDetails);
  const context = await getEmailGenerationContext(oldMessages, await getPluginOptions());

  const previousConversation = await getOriginalTabConversation(tabId);
  const prompt = await getEmailGenerationPrompt(tabDetails, previousConversation);

  const response = await sendContentToLlm([context, prompt]);
  if (isLlmTextCompletionResponse(response)) {
    await handleComposeSuccessResponse(tabId, response as LlmTextCompletionResponse);
  } else {
    handleLlmErrorResponse(response as TgiErrorResponse);
  }
}

async function handleComposeSuccessResponse(tabId: number, response: LlmTextCompletionResponse) {
  const tabDetails = await browser.compose.getComposeDetails(tabId);
  const identity = await browser.identities.get(tabDetails.identityId as string);
  const signature: string | undefined = identity.signature;

  const originalContent = await getOriginalTabConversation(tabId);
  const cleanedUpGeneratedEmail = await getCleanedUpGeneratedEmail(response, signature);
  const fullEmail = `${cleanedUpGeneratedEmail}${originalContent ? `\n\n${originalContent}` : ""}${!originalContent ? `\n\n${signature ?? ""} ` : ""}`;

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
  throw Error(`LLM responded with an error: ${response.error.message}`);
}

export async function summarize(tabId: number, originalConversation: string): Promise<void> {
  const messages = await getSummaryPromptAndContext(originalConversation);
  const response = await sendContentToLlm(messages);

  if (isLlmTextCompletionResponse(response)) {
    await browser.compose.setComposeDetails(tabId, {
      plainTextBody: `${response.choices[0].message.content}\n\n\n\n${originalConversation}`,
    });
  } else {
    throw Error(`LLM while attempting to summarize responded with an error: ${response.error.message}`);
  }
}
