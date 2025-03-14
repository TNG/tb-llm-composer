import { notifyOnError } from "./notifications";
import { getInputElement } from "./utils";

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#url")?.addEventListener("change", updateUrl);
document.querySelector("#api_token")?.addEventListener("change", updateApiToken);
document.querySelector("#llm_context")?.addEventListener("change", updateLlmContext);
document.querySelector("#use_last_mails")?.addEventListener("change", updateUseLastMails);
document.querySelector("#context_window")?.addEventListener("change", updateContextWindow);
document.querySelector("#other_options")?.addEventListener("change", updateOtherOptions);

export interface LlmParameters {
  max_new_tokens?: number;
  temperature?: number;
  stop?: [string];
  best_of?: number;
  repetition_penalty?: number;
  return_full_text?: boolean;
  seed?: number;
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

async function updateUrl(event: Event) {
  await notifyOnError(async () => {
    const modelUrlInput = event.target as HTMLInputElement;
    if (!modelUrlInput.value) {
      throw new Error("Invalid value: Model URL cannot be empty");
    }
    const options = await getPluginOptions();
    options.model = modelUrlInput.value;
    await browser.storage.sync.set({ options });
  });
}

async function updateApiToken(event: Event) {
  const apiTokenInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.api_token = apiTokenInput.value;
  await browser.storage.sync.set({ options });
}

async function updateLlmContext(event: Event) {
  const llmContextInput = event.target as HTMLTextAreaElement;
  const options = await getPluginOptions();
  options.llmContext = llmContextInput.value;
  await browser.storage.sync.set({ options });
}

async function updateUseLastMails(event: Event) {
  const useLastMailsInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.include_recent_mails = useLastMailsInput.checked;
  await browser.storage.sync.set({ options });
}

async function updateContextWindow(event: Event) {
  const contextWindowInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.context_window = contextWindowInput.valueAsNumber;
  await browser.storage.sync.set({ options });
}

async function updateOtherOptions(event: Event) {
  await notifyOnError(async () => {
    const otherOptionsElement = event.target as HTMLTextAreaElement;
    const options = await getPluginOptions();
    options.params = JSON.parse(otherOptionsElement.value);
    await browser.storage.sync.set({ options });
  });
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
