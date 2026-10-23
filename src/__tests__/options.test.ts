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

import { DEFAULT_OPTIONS, type Options } from "../optionsParams";

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

  test("hints the resolved chat URL when only the API base is entered", async () => {
    const doc = optionsDom.window.document;
    const urlInput = doc.getElementById("url") as HTMLInputElement;
    const hint = doc.getElementById("url-resolved-hint") as HTMLElement;

    urlInput.value = "https://my-llm.com/v1";
    urlInput.dispatchEvent(new optionsDom.window.Event("change"));
    await waitFor(() => {
      expect(hint.textContent).toContain("https://my-llm.com/v1/chat/completions");
    });

    // A complete chat URL needs no hint.
    urlInput.value = "https://my-llm.com/v1/chat/completions";
    urlInput.dispatchEvent(new optionsDom.window.Event("change"));
    await waitFor(() => {
      expect(hint.textContent).toBe("");
    });
  });

  test("offers mailbox folders in a dropdown for new folder rules and saves the chosen one", async () => {
    const doc = optionsDom.window.document;

    (doc.getElementById("add-folder-rule-btn") as HTMLButtonElement).click();
    const select = doc.querySelector("#folder-rules-list .fr-path") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values[0]).toBe("");
    expect(values).toContain("/INBOX");

    select.value = "/INBOX";
    select.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect((browserStorage.options as Options).folderSortingRules).toEqual([
        { folderPath: "/INBOX", description: "" },
      ]);
    });
  });

  test("keeps a stored folder that no longer exists selectable and flags it", async () => {
    browserStorage = {
      options: { preFilterRules: [{ field: "from", operator: "contains", value: "x", targetFolderPath: "/Gone" }] },
    };
    // Re-run the page's load handler against the new storage.
    optionsDom.window.document.dispatchEvent(new optionsDom.window.Event("DOMContentLoaded"));

    await waitFor(() => {
      const select = optionsDom.window.document.querySelector(".prefilter-rule-row .pf-target") as HTMLSelectElement;
      expect(select.value).toBe("/Gone");
      expect(select.selectedOptions[0].textContent).toBe("/Gone (not found)");
      expect(select.options[0].textContent).toBe("Keep in place");
      const badge = optionsDom.window.document.querySelector(".prefilter-rule-row .folder-path-badge");
      expect(badge?.textContent).toBe("⚠️");
    });
  });

  test("shows advanced options only when the checkbox is checked, and persists the choice", async () => {
    const doc = optionsDom.window.document;
    const toggle = doc.getElementById("show_advanced_options") as HTMLInputElement;
    expect(doc.body.classList.contains("show-advanced")).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect(doc.body.classList.contains("show-advanced")).toBe(true);
      expect((browserStorage.options as Options).showAdvancedOptions).toBe(true);
    });
  });

  test("renders one endpoint block per feature", () => {
    const doc = optionsDom.window.document;
    for (const feature of ["compose", "summarize", "report", "organise"]) {
      expect(doc.getElementById(`${feature}-fe-url`)).not.toBeNull();
      expect(doc.querySelector(`label[for="${feature}-fe-url"]`)).not.toBeNull();
    }
  });

  test("enabling a feature endpoint starts from a copy of the main endpoint and saves edits", async () => {
    browserStorage = { options: { model: "https://main.llm/v1", api_token: "tok", params: { model: "big" } } };
    const doc = optionsDom.window.document;
    const enabled = doc.getElementById("summarize-fe-enabled") as HTMLInputElement;

    enabled.checked = true;
    enabled.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect((browserStorage.options as Options).featureEndpoints.summarize).toEqual({
        enabled: true,
        model: "https://main.llm/v1",
        api_token: "tok",
        timeout: undefined,
        params: { model: "big" },
      });
      expect((doc.getElementById("summarize-fe-url") as HTMLInputElement).value).toBe("https://main.llm/v1");
    });

    const otherOptions = doc.getElementById("summarize-fe-other-options") as HTMLTextAreaElement;
    otherOptions.value = JSON.stringify({ model: "small" });
    otherOptions.dispatchEvent(new optionsDom.window.Event("change"));

    await waitFor(() => {
      expect((browserStorage.options as Options).featureEndpoints.summarize?.params).toEqual({ model: "small" });
      // The main endpoint is untouched.
      expect((browserStorage.options as Options).params).toEqual({ model: "big" });
    });
  });

  test("saves and resets an advanced system prompt", async () => {
    const doc = optionsDom.window.document;
    const textarea = doc.getElementById("report_system_prompt") as HTMLTextAreaElement;

    textarea.value = "Custom report prompt";
    textarea.dispatchEvent(new optionsDom.window.Event("change"));
    await waitFor(() => {
      expect((browserStorage.options as Options).reportSystemPrompt).toBe("Custom report prompt");
    });

    (doc.querySelector('[data-reset-prompt="report_system_prompt"]') as HTMLButtonElement).click();
    await waitFor(() => {
      expect((browserStorage.options as Options).reportSystemPrompt).toBe(DEFAULT_OPTIONS.reportSystemPrompt);
      expect(textarea.value).toBe(DEFAULT_OPTIONS.reportSystemPrompt);
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
