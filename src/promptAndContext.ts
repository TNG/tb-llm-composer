import { type LlmApiRequestMessage, LlmRoles } from "./llmConnection";

import type { Options } from "./optionsParams";
import { stripHtml } from "./utils";

export const DEFAULT_PROMPT = "Schreib den Partnern, dass ich kündige, auf Deutsch.";
const THIS_IS_THE_CONTENT = "This is what I want the content of my email to be:";

export async function getEmailGenerationContext(
  tabDetails: browser.compose.ComposeDetails,
  oldMessages: string[],
  options: Options,
): Promise<LlmApiRequestMessage> {
  const writerIdentityId = tabDetails.identityId;
  if (!writerIdentityId) {
    // It should never happen, if it does this is a bug
    throw Error("No Identity ID found for this tab, aborting operation.");
  }

  const identity = await browser.identities.get(writerIdentityId);
  if (!identity) {
    // It should never happen, if it does this is a bug
    throw Error(`Could not find an identity for ID '${tabDetails.identityId}'`);
  }

  const accountContext = `\nI am ${identity.name}.`;
  const oldMessagesContext =
    options.include_recent_mails && oldMessages.length > 0 ? buildOldMessagesContext(oldMessages) : "";
  return {
    content: options.llmContext + accountContext + oldMessagesContext,
    role: LlmRoles.SYSTEM,
  };
}

function buildOldMessagesContext(oldMessages: string[]) {
  return `
Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:
${oldMessages.map((value, index) => `Message ${index}:\n${value}`).join("\n\n")}`;
}

function getBodyContent(tabDetails: browser.compose.ComposeDetails): string {
  if (tabDetails.isPlainText && tabDetails.plainTextBody) {
    return tabDetails.plainTextBody;
  }
  if (!tabDetails.isPlainText && tabDetails.body) {
    // Normalise to plain text so buildEmailPrompt can reliably strip
    // previousConversation (which is always stored as plain text).
    return stripHtml(tabDetails.body);
  }
  return "";
}

export async function getEmailGenerationPrompt(
  tabDetails: browser.compose.ComposeDetails,
  previousConversation?: string,
): Promise<LlmApiRequestMessage> {
  const identity = await browser.identities.get(tabDetails.identityId as string);
  if (!identity) {
    // It should never happen, if it does this is a bug
    throw Error(`Could not find an identity for ID '${tabDetails.identityId}'`);
  }

  const bodyContent = getBodyContent(tabDetails);

  return {
    content: bodyContent ? buildEmailPrompt(bodyContent, identity.signature, previousConversation) : DEFAULT_PROMPT,
    role: LlmRoles.USER,
  };
}

function buildEmailPrompt(
  emailContent: string,
  signature: string | undefined,
  previousConversation: string | undefined,
): string {
  const contentWithoutSignature = signature ? emailContent.replace(signature, "") : emailContent;
  if (previousConversation) {
    return (
      `${THIS_IS_THE_CONTENT}\n${contentWithoutSignature.replace(previousConversation, "").trim()}\n\n` +
      `This is the conversation I am replying to. Keep its content in mind but do not include it in your suggestion:\n${previousConversation}`
    );
  }

  return `${THIS_IS_THE_CONTENT}\n${contentWithoutSignature.trim()}`;
}

export async function getSummaryPromptAndContext(previousConversation: string): Promise<Array<LlmApiRequestMessage>> {
  return [
    {
      content:
        "I want to reply to an email. Give me a short summary of the previous conversation, " +
        "highlighting the open points I needs to cover in my answer.",
      role: LlmRoles.SYSTEM,
    },
    {
      content: `Previous conversation:\n${previousConversation}`,
      role: LlmRoles.USER,
    },
  ];
}

export async function getSubjectGenerationContext(
  tabDetails: browser.compose.ComposeDetails,
  oldMessages: string[],
  options: Options,
): Promise<LlmApiRequestMessage> {
  const writerIdentityId = tabDetails.identityId;
  if (!writerIdentityId) {
    // It should never happen, if it does this is a bug
    throw Error("No Identity ID found for this tab, aborting operation.");
  }

  const identity = await browser.identities.get(writerIdentityId);
  if (!identity) {
    // It should never happen, if it does this is a bug
    throw Error(`Could not find an identity for ID '${tabDetails.identityId}'`);
  }

  const oldMessagesContext =
    options.include_recent_mails && oldMessages.length > 0 ? buildOldMessagesContext(oldMessages) : "";
  return {
    content: `I need a concise subject for an email I am writing, in the same language as the email. 
      Reply in the format: [subject] 
      I am ${identity.name}.${oldMessagesContext}`,
    role: LlmRoles.SYSTEM,
  };
}

export async function getSubjectGenerationPrompt(
  tabDetails: browser.compose.ComposeDetails,
): Promise<LlmApiRequestMessage> {
  const bodyContent = getBodyContent(tabDetails);

  return {
    content: bodyContent ? `${THIS_IS_THE_CONTENT}\n${bodyContent}` : DEFAULT_PROMPT,
    role: LlmRoles.USER,
  };
}
