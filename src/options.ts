import { getPluginOptions, Options } from "./optionUtils";

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form")?.addEventListener("submit", saveOptions);

function getInputElement(selector: string): HTMLInputElement {
  const inputElement = document.querySelector(selector) as HTMLInputElement | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
}

function showNotification(message: string, isSuccess: boolean) {
  const notification = document.getElementById("notification");
  if (!notification) {
    throw Error(`Element "notification" could not be found. Contact devs`);
  }
  notification.textContent = message;
  notification.style.backgroundColor = isSuccess ? "green" : "red";
  notification.className = "notification show";
  setTimeout(function () {
    notification.className = "notification";
  }, 3000); // The notification will disappear after 3 seconds
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
    context_window: parseInt(contextWindow),
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
