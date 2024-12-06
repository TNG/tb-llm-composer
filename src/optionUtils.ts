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

export interface Options {
  model: string;
  api_token?: string;
  context_window: number;
  include_recent_mails: boolean;
  params: LlmParameters;
  llmContext: string;
}

export const defaultParams: LlmParameters = {
  best_of: 1,
  decoder_input_details: true,
  max_new_tokens: 2000,
  repetition_penalty: 1.03,
  return_full_text: false,
  temperature: 0.2,
  top_k: 10,
  top_p: 0.95,
  typical_p: 0.95,
  use_cache: true,
  watermark: true,
};

export const defaultOptions: Options = {
  model: "",
  context_window: 4096,
  params: defaultParams,
  llmContext:
    "You are an AI language model asked to write an email.\n" +
    "The email should be concise.\n" +
    "In the reply, just include the email itself, no need to include the original text from the user.\n" +
    "Do not include the email subject in your reply.\n",
  include_recent_mails: true,
};

export async function getPluginOptions(): Promise<Options> {
  return (await browser.storage.sync.get("options"))?.options || defaultOptions;
}
