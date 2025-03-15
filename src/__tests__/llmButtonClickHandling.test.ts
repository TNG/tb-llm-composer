import fs from "node:fs";
import path from "node:path";
import { type MockInstance, afterAll, afterEach, describe, expect, test, vi } from "vitest";
import {
  type LlmPluginAction,
  allRequestsStatus,
  compose,
  llmActionClickHandler,
  summarize,
} from "../llmButtonClickHandling";
import { LlmRoles, type LlmTextCompletionResponse, type TgiErrorResponse, sendContentToLlm } from "../llmConnection";
import { mockBrowser, mockBrowserMenus, waitFor } from "./testUtils";
import Tab = browser.tabs.Tab;
import WebExtensionManifest = browser._manifest.WebExtensionManifest;
import { handleMenuClickListener } from "../menu";

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

// @ts-ignore
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

    expectSendToLllmAndIntermittentChanges();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}`,
    });
  });

  test("calls compose with signature", async () => {
    const mockSignature = "MOCK_SIGNATURE";
    mockBrowser({ signature: mockSignature });
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expectSendToLllmAndIntermittentChanges();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n--\n${mockSignature}`,
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

  test("throws when used with html", async () => {
    mockBrowser({ isPlainText: false });
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith({
      message: "LLM Support for HTML Mails is not yet implemented",
      title: "Thunderbird LLM Extension",
      type: "basic",
    });
  });

  test("calls summarize ", async () => {
    mockBrowser({});
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    const mockPreviousConversation = "Test previous conversation";

    await llmActionClickHandler(MOCK_TAB, async (tabId: number) => summarize(tabId, mockPreviousConversation));

    expectSendToLllmAndIntermittentChanges();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n\n\n${mockPreviousConversation}`,
    });
  });

  test("Cancel request aborts request", async () => {
    mockBrowser({});
    let fakeCommunicationTimedOut = false;
    let fakeCommunicationAborted = false;
    const fakeCommunicateWithLlm = async (tabId: number) => {
      let retries = 20;
      while (retries > 0) {
        if (allRequestsStatus.getAbortSignal(MOCK_TAB_ID).aborted) {
          fakeCommunicationAborted = true;
          throw new Error(`Request in tab ${tabId} aborted!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        retries -= 1;
      }
      fakeCommunicationTimedOut = true;
    };

    // noinspection ES6MissingAwait
    llmActionClickHandler(MOCK_TAB, fakeCommunicateWithLlm);
    await waitFor(() => {
      expectMenuEntriesToBe("cancel");
    });
    // @ts-ignore
    await handleMenuClickListener({ menuItemId: "cancelRequest" }, MOCK_TAB);

    await waitFor(() => {
      expect(fakeCommunicationAborted).toBeTruthy();
      expect(fakeCommunicationTimedOut).toBeFalsy();
      expectComposerButtonSetAndReset();
      expectMenuEntriesToBe("compose", "summarize");
    });
  });
});

describe("The LlmPluginAction type", () => {
  test("matches the commands defined in the manifest.json config", () => {
    const manifestFile = path.resolve(__dirname, "../../manifest.json");
    const manifestJson = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as WebExtensionManifest;
    const shortcuts = manifestJson.commands;

    const existingActions: LlmPluginAction[] = ["compose", "summarize"];

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

function expectSendToLllmAndIntermittentChanges(): void {
  expect(sendContentToLlm).toHaveBeenCalledTimes(1);
  expectComposerButtonSetAndReset();
}

function expectMenuEntriesToBe(...entries: LlmPluginAction[]): void {
  expect(mockBrowserMenus.sort()).toEqual(entries.sort());
}
