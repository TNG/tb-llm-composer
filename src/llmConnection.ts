import { getPluginOptions, LlmParameters, Options } from "./optionUtils";

enum LlmRoles {
  SYSTEM = "system",
  USER = "user",
}

interface LlmApiRequestMessage {
  content: string;
  role: LlmRoles;
}

interface LlmApiRequestBody extends LlmParameters {
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
  finish_reason: "lenght" | "eos_token " | "stop_sequence" | "error";
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
  finish_reason: "length" | "eos_token" | "stop_sequence" | "error";
  prefill?: [InputToken];
  logprobs?: TokensAndLogprobs;
}

export interface TgiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

const DEFAULT_PROMPT = "Schreib die Partner, dass ich kündige, auf Deutsch.";

export function isLlmTextcompletionResponse(response: LlmTextCompletionResponse | TgiErrorResponse) {
  return "id" in response;
}

export async function sentContentToLlm(tabDetails: browser.compose.ComposeDetails) {
  const options = await getPluginOptions();

  const requestBody = await buildRequestBody(tabDetails, options);
  console.log("requestBody: ", requestBody);

  return callLlmApi(options.model, requestBody, options.api_token);
}

async function buildRequestBody(tabDetails: browser.compose.ComposeDetails, options: Options): Promise<LlmApiRequestBody> {
  const identity = await browser.identities.get(tabDetails.identityId as string);
  const signatureInstructions =
    "\nThe user signature should appear as is at the end of the email. Their signature is:\n " + identity.signature;
  const context: LlmApiRequestMessage = {
    content: options.llmContext + signatureInstructions,
    role: LlmRoles.SYSTEM,
  };

  const currentMessageContent: LlmApiRequestMessage = { content: tabDetails.plainTextBody || DEFAULT_PROMPT, role: LlmRoles.USER };

  return {
    messages: [context, currentMessageContent],
    ...options.params,
  };
}

async function callLlmApi(url: string, requestBody: LlmApiRequestBody, token?: string) {
  const headers: { [key: string]: string } = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    throw Error(`Error response from ${url}: ${await response.text()}`);
  }
  return (await response.json()) as LlmTextCompletionResponse | TgiErrorResponse;
}
