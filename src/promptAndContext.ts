import { type LlmApiRequestMessage, LlmRoles } from "./llmConnection";
import type { Options } from "./options";

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
