import { getPluginOptions, LlmParameters, Options } from "./optionUtils";

export enum LlmRoles {
  SYSTEM = "system",
  USER = "user",
}

interface LlmApiRequestMessage {
  content: string;
  role: LlmRoles;
}

export interface LlmApiRequestBody extends LlmParameters {
  messages: LlmApiRequestMessage[];
}

export interface InputToken {
  id: number;
  text: string;
  logprob?: number;
}

export interface TokensAndLogprobs {
  tokens: [string];
  token_logprobe: [number];
  text_offset: [number];
  top_logprobs?: [object];
}

export interface LlmChoice {
  message: {
    content: string;
    role: LlmRoles;
  };
  index: number;
  prefill: [string];
  logprobs: [number];
  finish_reason: FinishReason;
}

export interface LlmTextCompletionResponse {
  status: number;
  id: string;
  cached?: boolean;
  server_version?: string;
  object?: string;
  created: number;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: LlmChoice[];
  finish_reason: FinishReason;
  prefill?: [InputToken];
  logprobs?: TokensAndLogprobs;
}

type FinishReason = "length" | "eos_token" | "stop_sequence" | "error";

export interface TgiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export const DEFAULT_PROMPT = "Schreib den Partnern, dass ich kündige, auf Deutsch.";

export async function sendContentToLlm(
  tabDetails: browser.compose.ComposeDetails,
  oldMessages: string[],
  previousConversation: string | undefined,
) {
  const options = await getPluginOptions();

  const requestBody = await buildRequestBody(tabDetails, oldMessages, previousConversation, options);

  return callLlmApi(options.model, requestBody, options.api_token);
}

/**
 * Build the request body for interacting with the LLM
 *
 * ,
 *
 */
async function buildRequestBody(
  tabDetails: browser.compose.ComposeDetails,
  oldMessages: string[],
  previousConversation: string | undefined,
  options: Options,
): Promise<LlmApiRequestBody> {
  const identity = await browser.identities.get(tabDetails.identityId as string);
  const oldMessagesContext = options.include_recent_mails && oldMessages.length > 0 ? buildOldMessagesContext(oldMessages) : "";
  const context: LlmApiRequestMessage = {
    content: options.llmContext + oldMessagesContext,
    role: LlmRoles.SYSTEM,
  };

  const currentMessageContent: LlmApiRequestMessage = {
    content: tabDetails.plainTextBody
      ? buildEmailPrompt(tabDetails.plainTextBody, identity.signature, previousConversation)
      : DEFAULT_PROMPT,
    role: LlmRoles.USER,
  };

  return {
    messages: [context, currentMessageContent],
    ...options.params,
  };
}

function buildEmailPrompt(plainText: string, signature: string | undefined, previousConversation: string | undefined): string {
  const textWithoutSignature = signature ? plainText.replace(signature, "") : plainText;
  const textWithoutPreviousConversation = previousConversation
    ? textWithoutSignature.replace(previousConversation, "")
    : textWithoutSignature;

  return (
    "This is what the user wants to be in its reply, everything must be included explicitly:\n" +
    textWithoutPreviousConversation.trim() +
    (previousConversation
      ? "\nThis is the conversation the user is replying to, keep the content in mind but do not include them in your suggestion:\n" +
        previousConversation
      : "")
  );
}

function buildOldMessagesContext(oldMessages: string[]) {
  return (
    "Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:\n" +
    oldMessages.map((value, index) => `Message ${index}:\n` + value).join("\n\n")
  );
}

async function callLlmApi(
  url: string,
  requestBody: LlmApiRequestBody,
  token?: string,
): Promise<LlmTextCompletionResponse | TgiErrorResponse> {
  const headers: { [key: string]: string } = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  console.log(`LLM-CONNECTION: Sending request to LLM: POST ${url} with body`, requestBody);
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorResponseBody = await response.text();
    throw Error(`LLM-CONNECTION: Error response from ${url}: ${errorResponseBody}`);
  }
  const responseBody = (await response.json()) as LlmTextCompletionResponse | TgiErrorResponse;
  console.log("LLM-CONNECTION: LLM responded with:", response.status, responseBody);
  return responseBody;
}

export function isLlmTextCompletionResponse(response: LlmTextCompletionResponse | TgiErrorResponse) {
  return "id" in response;
}
