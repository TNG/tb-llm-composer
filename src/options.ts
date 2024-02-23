function getInputElement(selector: string): HTMLInputElement {
  const inputElement = document.querySelector(selector) as HTMLInputElement | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
}

function throwError(message: string): never {
  throw new Error(message);
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

async function saveOptions(e: Event): Promise<void> {
  console.log(e);
  const model = getInputElement("#url").value ?? throwError("model can't be empty");
  const contextWindow = getInputElement("#context_window").value ?? throwError("context window has to be set");
  const options = {
    model: model,
    api_token: getInputElement("#api_token").value,
    context_window: parseInt(contextWindow),
  } as Options;

  // no await on purpose, otherwise the code does not work
  browser.storage.sync.set({
    options: options,
  });
  e.preventDefault();
}

async function restoreOptions(): Promise<void> {
  const options = await (browser.storage.sync.get("options") as Promise<Options | undefined>);

  getInputElement("#url").value = options?.model || defaultOptions.model;
  getInputElement("#api_token").value = options?.api_token || defaultOptions.api_token || "";
  getInputElement("#context_window").value = `${options?.context_window || defaultOptions.context_window}`;
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form")?.addEventListener("submit", saveOptions);
