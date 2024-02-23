function getInputElement(selector: string): HTMLInputElement {
  const inputElement = document.querySelector(selector) as HTMLInputElement | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
}

interface Options {
  model: string;
  api_token?: string;
  context_window: number;
}

const defaultOptions: Options = {
  model: "",
  context_window: 4096,
};

function showNotification(message: string, isSuccess: boolean) {
  const notification = document.getElementById('notification');
  if (!notification) {
    throw Error(`Element "notification" could not be found. Contact devs`);
  }
  notification.textContent = message;
  notification.style.backgroundColor = isSuccess ? '#4CAF50' : '#f44336'; // Green for success, red for failure
  notification.className = 'notification show';
  setTimeout(function() {
    notification.className = 'notification';
  }, 3000); // The notification will disappear after 3 seconds
}

async function saveOptions(e: Event): Promise<void> {
  console.log(e);
  const model = getInputElement("#url").value
  if (!model) {
    showNotification("model can't be empty", false);
    e.preventDefault();
    return;
  }
  const contextWindow = getInputElement("#context_window").value
  if (!contextWindow) {
    showNotification("context window has to be set (greater than zero)", false);
    e.preventDefault();
    return;
  }
  const options = {
    model: model,
    api_token: getInputElement("#api_token").value,
    context_window: parseInt(contextWindow),
  } as Options;

  // no await on purpose, otherwise the code does not work
  browser.storage.sync.set({
    options: options,
  });
  showNotification("Settings saved", true)
  e.preventDefault();
}

async function restoreOptions(): Promise<void> {
  const options = (await browser.storage.sync.get("options"))?.options as Options | undefined;

  getInputElement("#url").value = options?.model || defaultOptions.model;
  getInputElement("#api_token").value = options?.api_token || defaultOptions.api_token || "";
  getInputElement("#context_window").value = `${options?.context_window || defaultOptions.context_window}`;
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form")?.addEventListener("submit", saveOptions);
