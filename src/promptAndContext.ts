import { type LlmApiRequestMessage, LlmRoles } from "./llmConnection";

import type { Options } from "./optionsParams";

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

export async function getEmailGenerationPrompt(
  tabDetails: browser.compose.ComposeDetails,
  previousConversation?: string,
): Promise<LlmApiRequestMessage> {
  const identity = await browser.identities.get(tabDetails.identityId as string);
  if (!identity) {
    // It should never happen, if it does this is a bug
    throw Error(`Could not find an identity for ID '${tabDetails.identityId}'`);
  }

  // Get body content - handle both plain text and HTML
  let bodyContent = "";
  if (tabDetails.isPlainText && tabDetails.plainTextBody) {
    bodyContent = tabDetails.plainTextBody;
  } else if (!tabDetails.isPlainText && tabDetails.body) {
    // For HTML content, pass it directly to the LLM
    bodyContent = tabDetails.body;
  }

  return {
    content: bodyContent ? buildEmailPrompt(bodyContent, identity.signature, previousConversation) : DEFAULT_PROMPT,
    role: LlmRoles.USER,
  };
}

function buildEmailPrompt(
  plainText: string,
  signature: string | undefined,
  previousConversation: string | undefined,
): string {
  const textWithoutSignature = signature ? plainText.replace(signature, "") : plainText;
  if (previousConversation) {
    return (
      `${THIS_IS_THE_CONTENT}\n${textWithoutSignature.replace(previousConversation, "").trim()}\n\n` +
      `This is the conversation I am replying to. Keep its content in mind but do not include it in your suggestion:\n${previousConversation}`
    );
  }

  return `${THIS_IS_THE_CONTENT}\n${textWithoutSignature.trim()}`;
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
  // Get body content - handle both plain text and HTML
  let bodyContent = "";
  if (tabDetails.isPlainText && tabDetails.plainTextBody) {
    bodyContent = tabDetails.plainTextBody;
  } else if (!tabDetails.isPlainText && tabDetails.body) {
    // For HTML content, pass it directly to the LLM
    bodyContent = tabDetails.body;
  }

  return {
    content: bodyContent ? `${THIS_IS_THE_CONTENT}\n${bodyContent}` : DEFAULT_PROMPT,
    role: LlmRoles.USER,
  };
}
