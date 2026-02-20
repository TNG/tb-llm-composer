import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, type MockInstance, test, vi } from "vitest";
import { compose, type LlmPluginAction, llmActionClickHandler, summarize } from "../llmButtonClickHandling";
import {
  type LlmApiRequestMessage,
  LlmRoles,
  type LlmTextCompletionResponse,
  sendContentToLlm,
  type TgiErrorResponse,
} from "../llmConnection";
import { handleMenuClickListener } from "../menu";
import { mockBrowser, mockBrowserMenus, waitFor } from "./testUtils";

import Tab = browser.tabs.Tab;
import WebExtensionManifest = browser._manifest.WebExtensionManifest;

const MOCK_TAB_ID = 99999999;
const MOCK_TAB: Tab = {
  id: MOCK_TAB_ID,
  index: 0,
  highlighted: true,
  active: true,
};
const MOCK_RESPONSE_LLM_TEXT = "MOCK_RESPONSE_LLM_TEXT";

vi.mock("../llmConnection", async () => ({
  ...(await vi.importActual("../llmConnection")),
  sendContentToLlm: vi.fn(),
}));

const originalBrowser = global.browser;

describe("The llmActionClickHandler", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("calls compose without signature", async () => {
    mockBrowser({});
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(sendContentToLlm).toHaveBeenCalledTimes(2);
    expectComposerButtonSetAndReset();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}`,
    });
  });

  test("calls compose with signature", async () => {
    const mockSignature = "MOCK_SIGNATURE";
    mockBrowser({ signature: mockSignature });
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(sendContentToLlm).toHaveBeenCalledTimes(2);
    expectComposerButtonSetAndReset();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n--\n${mockSignature}`,
    });
  });

  test("does not generate a subject when one is already present", async () => {
    mockBrowser({ subject: "MUCK_SUBJECT" });
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(sendContentToLlm).toHaveBeenCalledTimes(1);
    expectComposerButtonSetAndReset();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}`,
    });
  });

  test("notifies errors", async () => {
    mockBrowser({});
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getErrorResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith({
      message: "LLM responded with an error: Test Error",
      title: "Thunderbird LLM Extension Error",
      type: "basic",
    });
    expectMenuEntriesToBe("compose", "summarize");
  });

  test("calls summarize ", async () => {
    mockBrowser({});
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    const mockPreviousConversation = "Test previous conversation";

    await llmActionClickHandler(MOCK_TAB, async (tabId: number) => summarize(tabId, mockPreviousConversation));

    expect(sendContentToLlm).toHaveBeenCalledTimes(1);
    expectComposerButtonSetAndReset();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n\n\n${mockPreviousConversation}`,
    });
  });

  test("Cancel request aborts request", async () => {
    mockBrowser({});
    fetchMock.mockOnce(() => {
      console.log("fetch was mocked, stalling for 500 ms");
      return new Promise((resolve) => {
        setTimeout(resolve, 500);
        const response: TgiErrorResponse = {
          error: {
            type: "TestError",
            message: "test error, should never be returned, this request should be aborted",
          },
        };
        return response;
      });
    });
    // noinspection ES6MissingAwait
    (sendContentToLlm as unknown as MockInstance).mockImplementation(
      async (messages: Array<LlmApiRequestMessage>, abortSignal: AbortSignal) => {
        console.log("run with message", messages);
        await fetch("https://fake-url.com/llm", { signal: abortSignal });
      },
    );
    llmActionClickHandler(MOCK_TAB, compose);
    await waitFor(() => {
      expectMenuEntriesToBe("cancel");
    });
    // @ts-expect-error
    await handleMenuClickListener({ menuItemId: "cancel" }, MOCK_TAB);
    await waitFor(() => {
      expectMenuEntriesToBe("compose", "summarize");
    });
    expectComposerButtonSetAndReset();
    // user should not be notified if they canceled the request themselves
    expect(global.browser.notifications.create).not.toHaveBeenCalled();
  });
});

describe("The LlmPluginAction type", () => {
  test("matches the commands defined in the manifest.json config", () => {
    const manifestFile = path.resolve(__dirname, "../../manifest.json");
    const manifestJson = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as WebExtensionManifest;
    const shortcuts = manifestJson.commands;

    const existingActions: LlmPluginAction[] = ["compose", "summarize", "cancel"];

    for (const shortcut in shortcuts) {
      expect(existingActions).toContain(shortcut);
    }
  });
});

function getTestResponse(): LlmTextCompletionResponse {
  return {
    status: 200,
    id: "testId",
    created: 123,
    model: "testModel",
    choices: [
      {
        message: { content: MOCK_RESPONSE_LLM_TEXT, role: LlmRoles.USER },
        index: 0,
        prefill: ["Test prefill"],
        logprobs: [0.1],
        finish_reason: "length",
      },
    ],
    finish_reason: "length",
  };
}

function getErrorResponse(): TgiErrorResponse {
  return {
    error: {
      message: "Test Error",
      type: "Test Type",
      code: "Test Code",
    },
  };
}

function expectComposerButtonSetAndReset() {
  expect(global.browser.composeAction.disable).not.toHaveBeenCalled();
  expect(global.browser.composeAction.setIcon).toHaveBeenCalledTimes(2);
  expect(global.browser.composeAction.setTitle).toHaveBeenCalledTimes(2);
  expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(1, {
    path: { 32: "icons/loader-32px.gif" },
    tabId: MOCK_TAB_ID,
  });
  expect(global.browser.composeAction.setTitle).toHaveBeenNthCalledWith(1, {
    title: "Cancel Request",
    tabId: MOCK_TAB_ID,
  });
  expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(2, {
    path: { 64: "icons/icon-64px.png" },
    tabId: MOCK_TAB_ID,
  });
  expect(global.browser.composeAction.setTitle).toHaveBeenNthCalledWith(2, {
    tabId: MOCK_TAB_ID,
    title: "To LLM (dev)",
  });
}

function expectMenuEntriesToBe(...entries: LlmPluginAction[]): void {
  expect(mockBrowserMenus.sort()).toEqual(entries.sort());
}
