/**
 * @vi-environment jsdom
 */
import fs from "node:fs";
import * as path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { beforeEach, describe, expect, test } from "vitest";

Object.assign(global, { TextDecoder, TextEncoder });

import { JSDOM } from "jsdom";
import { waitFor } from "./testUtils";

Object.assign(global, { TextDecoder, TextEncoder });

import CreateNotificationOptions = browser.notifications.CreateNotificationOptions;
import type { Options } from "../optionsParams";

let optionsDom: JSDOM;

let browserStorage: { [key: string]: object } = {};
let jsDomNotifications: CreateNotificationOptions[] = [];

const mockBrowser = {
  storage: {
    sync: {
      get: async (key: string) => {
        console.log(`Getting element '${key}' from mock storage`);
        return { [key]: browserStorage[key] };
      },
      set: async (items: { [key: string]: object }) => {
        for (const key in items) {
          console.log(`Setting element '${key}' from mock storage`);
          browserStorage[key] = items[key];
        }
      },
    },
  },
  notifications: {
    create: async (options: CreateNotificationOptions) => {
      jsDomNotifications.push(options);
    },
  },
};

/**
 * This test runs on the <i>compiled</i> version of the options.html page located in the build folder.
 */
describe("The options page", () => {
  beforeEach(async () => {
    browserStorage = {};
    jsDomNotifications = [];
    const projectDir = path.resolve(__dirname, "../..");
    const optionsHtmlFile = `${projectDir}/build/public/options.html`;
    const optionsHtmlContent = fs.readFileSync(optionsHtmlFile, "utf-8");
    optionsDom = new JSDOM(optionsHtmlContent, {
      url: `file://${optionsHtmlFile}`,
      runScripts: "dangerously",
      resources: "usable",
    });
    const vmContext = optionsDom.getInternalVMContext();
    vmContext.browser = mockBrowser;

    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test("sets the model url option in the local storage on change", async () => {
    const urlInput = optionsDom.window.document.getElementById("url") as HTMLInputElement;
    expect(urlInput).not.toBeNull();

    const expectedUrl = "https://my-llm.com/chat";
    urlInput.value = expectedUrl;
    urlInput.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).model).toEqual(expectedUrl);
    });
  });

  test("raises an error if model url option is empty after change", async () => {
    const urlInput = optionsDom.window.document.getElementById("url") as HTMLInputElement;
    expect(urlInput).not.toBeNull();

    urlInput.value = "";
    urlInput.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(jsDomNotifications).toHaveLength(1);
      expect(jsDomNotifications[0].message).toContain("Model URL cannot be empty");
    });
  });

  test("sets the api_token option in the local storage on change", async () => {
    const apiTokenInput = optionsDom.window.document.getElementById("api_token") as HTMLInputElement;
    expect(apiTokenInput).not.toBeNull();

    const expectedApiToken = "wasfoenaoenf";
    apiTokenInput.value = expectedApiToken;
    apiTokenInput.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).api_token).toEqual(expectedApiToken);
    });
  });

  test("sets the context_window number option in the local storage on change", async () => {
    const contextWindow = optionsDom.window.document.getElementById("context_window") as HTMLInputElement;
    expect(contextWindow).not.toBeNull();

    const expectedContextWindow = 9021;
    contextWindow.valueAsNumber = expectedContextWindow;
    contextWindow.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).context_window).toEqual(expectedContextWindow);
    });
  });

  test("sets the include_recent_mails option in the local storage on change", async () => {
    const useLastMails = optionsDom.window.document.getElementById("use_last_mails") as HTMLInputElement;
    expect(useLastMails).not.toBeNull();

    const expectedUseLastMails = false;
    useLastMails.checked = expectedUseLastMails;
    useLastMails.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).include_recent_mails).toEqual(expectedUseLastMails);
    });
  });

  test("throws error if params is not json", async () => {
    const otherOptionsEl = optionsDom.window.document.getElementById("other_options") as HTMLInputElement;
    expect(otherOptionsEl).not.toBeNull();

    otherOptionsEl.value = "{ not a valid JSON";
    otherOptionsEl.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(jsDomNotifications).toHaveLength(1);
      expect(jsDomNotifications[0].message).toContain("JSON");
    });
  });

  test("sets the params option in the local storage on change", async () => {
    const otherOptionsEl = optionsDom.window.document.getElementById("other_options") as HTMLInputElement;
    expect(otherOptionsEl).not.toBeNull();

    const expectedOtherOptions = { "a key": "value" };
    otherOptionsEl.value = JSON.stringify(expectedOtherOptions);
    otherOptionsEl.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).params).toEqual(expectedOtherOptions);
    });
  });

  test("sets the llmContext option in the local storage on change", async () => {
    const llmContext = optionsDom.window.document.getElementById("llm_context") as HTMLInputElement;
    expect(llmContext).not.toBeNull();

    const expectedLlmContext = "Hi you are a world-destroying AI";
    llmContext.value = expectedLlmContext;
    llmContext.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(browserStorage).toHaveProperty("options");
      expect((browserStorage.options as Options).llmContext).toEqual(expectedLlmContext);
    });
  });
});
