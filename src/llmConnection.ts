import { type LlmParameters, getPluginOptions } from "./optionsParams";

export enum LlmRoles {
  SYSTEM = "system",
  USER = "user",
}

export interface LlmApiRequestMessage {
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

export async function sendContentToLlm(
  messages: Array<LlmApiRequestMessage>,
): Promise<LlmTextCompletionResponse | TgiErrorResponse> {
  const options = await getPluginOptions();
  if (!options.model) {
    throw Error("Missing LLM model, set it in the options panel.");
  }

  const requestBody = {
    messages,
    ...options.params,
  };

  return callLlmApi(options.model, requestBody, options.api_token);
}

async function callLlmApi(
  url: string,
  requestBody: LlmApiRequestBody,
  token?: string,
): Promise<LlmTextCompletionResponse | TgiErrorResponse> {
  const headers: { [key: string]: string } = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  console.log(`LLM-CONNECTION: Sending request to LLM: POST ${url} with body:\n`, JSON.stringify(requestBody));
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
