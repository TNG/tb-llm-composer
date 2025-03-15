import { type LlmApiRequestMessage, LlmRoles } from "./llmConnection";

import type { Options } from "./optionsParams";

export const DEFAULT_PROMPT = "Schreib den Partnern, dass ich kündige, auf Deutsch.";

export async function getEmailGenerationContext(
  oldMessages: string[],
  options: Options,
): Promise<LlmApiRequestMessage> {
  const oldMessagesContext =
    options.include_recent_mails && oldMessages.length > 0 ? buildOldMessagesContext(oldMessages) : "";
  return {
    content: options.llmContext + oldMessagesContext,
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

  return {
    content: tabDetails.plainTextBody
      ? buildEmailPrompt(tabDetails.plainTextBody, identity.signature, previousConversation)
      : DEFAULT_PROMPT,
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
    return `This is what the user wants to be the content of their email to be:
${textWithoutSignature.replace(previousConversation, "").trim()}

This is the conversation the user is replying to. Keep its content in mind but do not include it in your suggestion:
${previousConversation}`;
  }
  return `This is what the user wants to be the content of their email to be:
${textWithoutSignature.trim()}`;
}

export async function getSummaryPromptAndContext(previousConversation: string): Promise<Array<LlmApiRequestMessage>> {
  return [
    {
      content:
        "The user wants to reply to an email. You need to give him a short summary of the previous conversation, " +
        "highlighting the open points he needs to cover in his answer.",
      role: LlmRoles.SYSTEM,
    },
    {
      content: `Previous conversation:\n${previousConversation}`,
      role: LlmRoles.USER,
    },
  ];
}
