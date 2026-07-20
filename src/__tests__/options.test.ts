/**
 * @vi-environment jsdom
 */
import fs from "node:fs";
import * as path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { beforeEach, describe, expect, test, vi } from "vitest";

Object.assign(global, { TextDecoder, TextEncoder });

import { JSDOM } from "jsdom";
import { waitFor } from "./testUtils";

Object.assign(global, { TextDecoder, TextEncoder });

import CreateNotificationOptions = browser.notifications.CreateNotificationOptions;

import type { Options } from "../optionsParams";

let optionsDom: JSDOM;

let browserStorage: { [key: string]: object } = {};
let jsDomNotifications: CreateNotificationOptions[] = [];

const permissionsContainsMock = vi.fn();
const permissionsRequestMock = vi.fn();
const fetchMock = vi.fn();

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
  permissions: {
    contains: (...args: unknown[]) => permissionsContainsMock(...args),
    request: (...args: unknown[]) => permissionsRequestMock(...args),
  },
  accounts: {
    list: async () => [
      {
        id: "a",
        rootFolder: { accountId: "a", path: "/", name: "root" },
        folders: [{ accountId: "a", path: "/INBOX", name: "Inbox", subFolders: [] }],
      },
    ],
  },
};

/**
 * This test runs on the <i>compiled</i> version of the options.html page located in the build folder.
 */
describe("The options page", () => {
  beforeEach(async () => {
    browserStorage = {};
    jsDomNotifications = [];
    permissionsContainsMock.mockReset().mockResolvedValue(true);
    permissionsRequestMock.mockReset().mockResolvedValue(true);
    fetchMock.mockReset();
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
    vmContext.fetch = (...args: unknown[]) => fetchMock(...args);

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

  test("requests host permission for the endpoint when clicking Grant access", async () => {
    const urlInput = optionsDom.window.document.getElementById("url") as HTMLInputElement;
    urlInput.value = "https://my-llm.com/v1/chat/completions";

    (optionsDom.window.document.getElementById("grant-access-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(permissionsRequestMock).toHaveBeenCalledWith({ origins: ["https://my-llm.com/*"] });
      const statusBadge = optionsDom.window.document.getElementById("url-permission-status") as HTMLElement;
      expect(statusBadge.textContent).toBe("✅");
      expect(statusBadge.title).toContain("Access granted");
    });
  });

  test("reports when host permission is denied", async () => {
    permissionsContainsMock.mockResolvedValue(false);
    permissionsRequestMock.mockResolvedValue(false);
    const urlInput = optionsDom.window.document.getElementById("url") as HTMLInputElement;
    urlInput.value = "https://my-llm.com/v1/chat/completions";

    (optionsDom.window.document.getElementById("grant-access-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(jsDomNotifications).toHaveLength(1);
      expect(jsDomNotifications[0].message).toContain("not granted");
      expect((optionsDom.window.document.getElementById("url-permission-status") as HTMLElement).title).toContain(
        "not granted",
      );
    });
  });

  test("does not request permission when the URL is empty", async () => {
    (optionsDom.window.document.getElementById("url") as HTMLInputElement).value = "";

    (optionsDom.window.document.getElementById("grant-access-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(jsDomNotifications).toHaveLength(1);
      expect(jsDomNotifications[0].message).toContain("Enter the LLM endpoint URL first");
    });
    expect(permissionsRequestMock).not.toHaveBeenCalled();
  });

  test("lists available folder paths and copies a path when its row is clicked", async () => {
    const win = optionsDom.window;
    const doc = win.document;
    const clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(win.navigator, "clipboard", {
      value: { writeText: clipboardWriteMock },
      configurable: true,
    });

    (doc.getElementById("refresh-folder-paths-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      const rows = doc.querySelectorAll("#available-folder-paths .model-row");
      expect(rows.length).toBeGreaterThan(0);
    });

    const firstRow = doc.querySelector("#available-folder-paths .model-row") as HTMLElement;
    const firstPath = (firstRow.querySelector(".model-id") as HTMLElement).textContent;
    firstRow.click();

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith(firstPath);
      // Confirmation shows a transient "Copied!" flag on the row.
      expect(firstRow.querySelector(".copied-flag")?.textContent).toBe("Copied!");
    });
  });

  test("queries available models and applies one to the other-options JSON", async () => {
    const doc = optionsDom.window.document;
    (doc.getElementById("url") as HTMLInputElement).value = "https://my-llm.com/v1/chat/completions";
    const otherOptions = doc.getElementById("other_options") as HTMLTextAreaElement;
    otherOptions.value = JSON.stringify({ temperature: 0.5 });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ object: "list", data: [{ id: "model-a" }, { id: "model-b" }] }),
    });

    (doc.getElementById("query-models-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(doc.querySelectorAll("#models-list .model-row")).toHaveLength(2);
    });
    // The /models endpoint is derived from the chat URL.
    expect(fetchMock).toHaveBeenCalledWith("https://my-llm.com/v1/models", expect.anything());

    // Applying a model upserts params.model while preserving existing keys.
    const modelRows = doc.querySelectorAll("#models-list .model-row");
    (modelRows[1] as HTMLElement).click();

    await waitFor(() => {
      const params = JSON.parse((doc.getElementById("other_options") as HTMLTextAreaElement).value);
      expect(params).toEqual({ temperature: 0.5, model: "model-b" });
      expect((browserStorage.options as Options).params).toMatchObject({ temperature: 0.5, model: "model-b" });
    });
  });
});
