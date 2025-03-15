import { notifyOnError } from "./notifications";
import { getPluginOptions } from "./optionsParams";
import { getInputElement } from "./utils";

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#url")?.addEventListener("change", updateUrl);
document.querySelector("#api_token")?.addEventListener("change", updateApiToken);
document.querySelector("#llm_context")?.addEventListener("change", updateLlmContext);
document.querySelector("#use_last_mails")?.addEventListener("change", updateUseLastMails);
document.querySelector("#context_window")?.addEventListener("change", updateContextWindow);
document.querySelector("#other_options")?.addEventListener("change", updateOtherOptions);

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
