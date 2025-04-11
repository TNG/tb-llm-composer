import { getFirstRecipientMailAddress } from "./emailHelpers";
import {
  type LlmTextCompletionResponse,
  type TgiErrorResponse,
  isLlmTextCompletionResponse,
  sendContentToLlm,
} from "./llmConnection";
import { notifyOnError, timedNotification } from "./notifications";
import { getPluginOptions } from "./optionsParams";
import { getOriginalTabConversation } from "./originalTabConversation";
import {
  getEmailGenerationContext,
  getEmailGenerationPrompt,
  getSubjectGenerationContext,
  getSubjectGenerationPrompt,
  getSummaryPromptAndContext,
} from "./promptAndContext";
import { getSentMessages } from "./retrieveSentContext";
import Tab = browser.tabs.Tab;
import IconPath = browser._manifest.IconPath;

const LLM_HTML_NOT_IMPLEMENTED_TEXT: string = "LLM Support for HTML Mails is not yet implemented";
const DEFAULT_ICONS: IconPath = { 64: "icons/icon-64px.png" };

export type LlmPluginAction = "compose" | "summarize";

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
  const options = await getPluginOptions();
  const emailContext = await getEmailGenerationContext(tabDetails, oldMessages, options);

  const previousConversation = await getOriginalTabConversation(tabId);
  const emailPrompt = await getEmailGenerationPrompt(tabDetails, previousConversation);

  const subject = tabDetails.subject;
  if (!subject) {
    const subjectContext = await getSubjectGenerationContext(tabDetails, oldMessages, options);
    const subjectPrompt = await getSubjectGenerationPrompt(tabDetails);
    const subjectResponse = await sendContentToLlm([subjectContext, subjectPrompt]);
    if (isLlmTextCompletionResponse(subjectResponse)) {
      await handleSubjectSuccessResponse(tabId, subjectResponse);
    }
  }

  const emailResponse = await sendContentToLlm([emailContext, emailPrompt]);
  if (isLlmTextCompletionResponse(emailResponse)) {
    await handleComposeSuccessResponse(tabId, emailResponse as LlmTextCompletionResponse);
  } else {
    handleLlmErrorResponse(emailResponse as TgiErrorResponse);
  }
}

async function handleSubjectSuccessResponse(tabId: number, subjectResponse: LlmTextCompletionResponse) {
  await browser.compose.setComposeDetails(tabId, {
    subject: subjectResponse.choices[0].message.content.trim(),
  });
}

async function handleComposeSuccessResponse(tabId: number, response: LlmTextCompletionResponse) {
  const tabDetails = await browser.compose.getComposeDetails(tabId);
  const identity = await browser.identities.get(tabDetails.identityId as string);
  if (!identity) {
    // It should never happen, if it does this is a bug
    throw Error(`Could not find an identity for ID '${tabDetails.identityId}'`);
  }
  const signature: string | undefined = identity.signature;

  const originalContent = await getOriginalTabConversation(tabId);
  const cleanedUpGeneratedEmail = await getCleanedUpGeneratedEmail(response, signature);
  const fullEmail =
    // biome-ignore lint/style/useTemplate: the new lines are necessary to improve readability
    cleanedUpGeneratedEmail +
    `${originalContent ? `\n\n${originalContent}` : ""}` +
    `${!originalContent && signature ? `\n\n--\n${signature}` : ""}`;

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

export async function summarize(tabId: number, originalConversation?: string): Promise<void> {
  if (!originalConversation) {
    // This should never happen, as we do not want to allow summarize to be called when there is nothing to summarize
    throw Error("No conversation found to summarize. Aborting.");
  }
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

export async function executeLlmAction(actionId: LlmPluginAction, tab: Tab) {
  switch (actionId) {
    case "summarize":
      await llmActionClickHandler(tab, async (tabId: number) =>
        summarize(tabId, await getOriginalTabConversation(tabId)),
      );
      break;
    case "compose":
      await llmActionClickHandler(tab, compose);
      break;
  }
}
