import { LlmParameters } from "./llmConnection";

export interface Options {
  model: string;
  api_token?: string;
  context_window: number;
  params?: LlmParameters;
}

const defaultOptions: Options = {
  model: "",
  context_window: 4096,
};

export async function getPluginOptions(): Promise<Options> {
  return (await browser.storage.sync.get("options"))?.options || defaultOptions;
}
