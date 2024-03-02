import { getPluginOptions, Options } from "./optionUtils";

export interface LlmParameters {
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: [string];
  best_of?: number;
  repetition_penalty?: number;
  return_full_text?: boolean;
  seed?: number;
  top_k?: number;
  truncate?: number;
  typical_p?: number;
  watermark?: boolean;
  decoder_input_details?: boolean;
  stream?: boolean;
  model?: string;
  use_cache?: boolean;
  logprobs?: number;
}

export let defaultParams: LlmParameters = {
  best_of: 1,
  decoder_input_details: true,
  logprobs: 3,
  max_new_tokens: 2000,
  repetition_penalty: 1.03,
  return_full_text: false,
  temperature: 0.5,
  top_k: 10,
  top_p: 0.95,
  typical_p: 0.95,
  use_cache: true,
  watermark: true,
};

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

export function isLlmTextcompletionResponse(response: LlmTextCompletionResponse | TgiErrorResponse) {
  return "id" in response;
}

function buildRequestBody(content: string, options: Options): LlmApiRequestBody {
  const llmContext =
    "You are an AI language model asked to write an email.\n" +
    "The email should be written in a professional manner and should be polite and respectful.\n" +
    "In the reply, just include the email itself, no need to include the original text from the user.\n" +
    "Do not include the email subject in you reply.\n" +
    "The user prompt is the following:\n";
  const context: LlmApiRequestMessage = { content: llmContext, role: LlmRoles.SYSTEM };
  return {
    messages: [context, { content, role: LlmRoles.USER }],
    ...(options.params || defaultParams),
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

export async function sentContentToLlm(content: string) {
  const options = await getPluginOptions();
  const requestBody = buildRequestBody(content, options);
  console.log("requestBody: ", requestBody);
  return callLlmApi(options.model, requestBody, options.api_token);
}
