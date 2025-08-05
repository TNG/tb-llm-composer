import { getFirstRecipientMailAddress } from "./emailHelpers";
import {
  isLlmTextCompletionResponse,
  type LlmTextCompletionResponse,
  sendContentToLlm,
  type TgiErrorResponse,
} from "./llmConnection";
import { addCancelRequestMenuEntry, addLlmActionsToMenu } from "./menu";
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

const LLM_HTML_NOT_IMPLEMENTED_TEXT: string = "LLM Support for HTML Mails is not yet implemented";
function getActionDefaultIcon() {
  return {
    "64": "icons/icon-64px.png",
  };
}
function getActionDefaultTitle() {
  return browser.runtime.getManifest().compose_action?.default_title || "";
}

interface RequestStatus {
  tabId: number;
  isRunning: boolean;
  abortController: AbortController;
}

export class AllRequestsStatus {
  requests: {
    [tabId: number]: RequestStatus;
  } = {};

  getRequestStatus(tabId: number) {
    if (!(tabId in this.requests)) {
      this.requests[tabId] = {
        tabId,
        isRunning: false,
        abortController: new AbortController(),
      };
    }
    return this.requests[tabId];
  }

  deleteRequestStatus(tabId: number) {
    delete this.requests[tabId];
  }

  getAbortSignal(tabId: number) {
    return this.getRequestStatus(tabId).abortController.signal;
  }

  abort(tabId: number) {
    const message = `User cancelled request in tab ${tabId}`;
    this.getRequestStatus(tabId).abortController.abort(message);
  }
}

export const allRequestsStatus = new AllRequestsStatus();

export type LlmPluginAction = "compose" | "summarize" | "cancel";

export async function llmActionClickHandler(tab: Tab, communicateWithLlm: (tabID: number) => Promise<void>) {
  const openTabId = tab.id;
  if (openTabId === undefined) {
    //This should NOT happen and should be a thunderbird bug.
    console.error("No tabId found for detail request");
    throw Error("no tabId");
  }

  const tabDetails = await browser.compose.getComposeDetails(openTabId);
  if (tabDetails.isPlainText) {
    await withButtonRequestInProgress(openTabId, () => communicateWithLlm(openTabId));
  } else {
    await timedNotification("Thunderbird LLM Extension", LLM_HTML_NOT_IMPLEMENTED_TEXT);
  }
}

async function withButtonRequestInProgress<T>(tabId: number, callback: () => Promise<T>) {
  const requestStatus = allRequestsStatus.getRequestStatus(tabId);
  requestStatus.isRunning = true;
  await browser.composeAction.disable(tabId);
  await browser.composeAction.setIcon({
    tabId: tabId,
    path: { 32: "icons/loader-32px.gif" },
  });
  await browser.composeAction.setTitle({ title: "Cancel Request", tabId: tabId });
  await addCancelRequestMenuEntry();

  const response = await notifyOnError(callback);
  await resetComposerAction(tabId);
  return response;
}

async function resetComposerAction(tabId: number) {
  await browser.composeAction.enable(tabId);
  const actionDefaultIcon = getActionDefaultIcon();
  await browser.composeAction.setIcon({ path: actionDefaultIcon, tabId: tabId });
  await browser.composeAction.setTitle({ title: getActionDefaultTitle(), tabId: tabId });
  await addLlmActionsToMenu();
  allRequestsStatus.deleteRequestStatus(tabId);
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
    const subjectResponse = await sendContentToLlm(
      [subjectContext, subjectPrompt],
      allRequestsStatus.getAbortSignal(tabId),
    );
    console.log("subject", subjectResponse);
    if (isLlmTextCompletionResponse(subjectResponse)) {
      await handleSubjectSuccessResponse(tabId, subjectResponse as LlmTextCompletionResponse);
    }
  }

  const emailResponse = await sendContentToLlm([emailContext, emailPrompt], allRequestsStatus.getAbortSignal(tabId));
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
  const requestStatus = allRequestsStatus.getRequestStatus(tabId);
  const response = await sendContentToLlm(messages, requestStatus.abortController.signal);
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
    case "cancel":
      if (tab?.id) {
        allRequestsStatus.abort(tab.id);
      }
      break;
  }
}
