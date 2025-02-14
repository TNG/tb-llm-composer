import { showNotification } from "./notifications";
import { getInputElement } from "./utils";

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form")?.addEventListener("submit", saveOptions);

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

export const DEFAULT_OPTIONS: Options = {
  model: "",
  context_window: 4096,
  params: defaultParams,
  llmContext:
    "You are an AI language model asked to write an email.\n" +
    "The email should be concise.\n" +
    "Please write the email in the following format:\n" +
    "[Initial salutation with Recipient's Name],\n\n" +
    "[Body of the email]\n\n" +
    "[Salutation]\n[Your Name]",
  include_recent_mails: true,
};

export async function getPluginOptions(): Promise<Options> {
  return (await browser.storage.sync.get("options"))?.options || DEFAULT_OPTIONS;
}

export async function saveOptions(event: Event): Promise<void> {
  event.preventDefault();
  const model = getInputElement("#url").value;
  if (!model) {
    showNotification("model can't be empty", false);
    return;
  }
  const contextWindow = getInputElement("#context_window").value;
  if (!contextWindow) {
    showNotification("context window has to be set (greater than zero)", false);
    return;
  }
  const options = {
    model: model,
    api_token: getInputElement("#api_token").value,
    context_window: Number.parseInt(contextWindow),
    include_recent_mails: getInputElement("#use_last_mails").checked,
    params: JSON.parse(getInputElement("#other_options").value),
    llmContext: getInputElement("#llm_context").value,
  } as Options;

  // noinspection ES6MissingAwait deliberately trigger async call without await
  browser.storage.sync.set({
    options: options,
  });
  showNotification("Settings saved", true);
}

export async function restoreOptions(): Promise<void> {
  const options = await getPluginOptions();

  getInputElement("#url").value = options.model;
  getInputElement("#api_token").value = options.api_token || "";
  getInputElement("#context_window").value = `${options.context_window}`;
  getInputElement("#use_last_mails").checked = options.include_recent_mails;
  getInputElement("#other_options").value = JSON.stringify(options.params, null, 2);
  getInputElement("#llm_context").value = options.llmContext;
}
