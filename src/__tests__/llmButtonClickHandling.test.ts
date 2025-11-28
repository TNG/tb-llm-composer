import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { compose, type LlmPluginAction, llmActionClickHandler, summarize } from "../llmButtonClickHandling";
import { handleMenuClickListener } from "../menu";
import { mockBrowser, mockBrowserAndFetch, mockBrowserMenus, waitFor } from "./testUtils";

import { MOCK_MODEL_URL, MOCK_TOKEN, useFetchWithAbort } from "./useFetchMock";

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

const originalBrowser = global.browser;

describe("The llmActionClickHandler", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("calls compose without signature", async () => {
    mockBrowserAndFetch({}, "subject-request-200.json", "compose-request-200.json");

    await llmActionClickHandler(MOCK_TAB, compose);

    expectComposerButtonSetAndReset();
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      subject: MOCK_RESPONSE_LLM_TEXT,
    });
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: MOCK_RESPONSE_LLM_TEXT,
    });
  });

  test("calls compose with signature", async () => {
    const mockSignature = "MOCK_SIGNATURE";
    mockBrowserAndFetch({ signature: mockSignature }, "subject-request-200.json", "compose-request-200.json");

    await llmActionClickHandler(MOCK_TAB, compose);

    expectComposerButtonSetAndReset();
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      subject: MOCK_RESPONSE_LLM_TEXT,
    });
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n--\n${mockSignature}`,
    });
  });

  test("does not generate a subject when one is already present", async () => {
    mockBrowserAndFetch({ subject: "MUCK_SUBJECT" }, "compose-request-200.json");

    await llmActionClickHandler(MOCK_TAB, compose);

    expectComposerButtonSetAndReset();

    // check that it hasn't been called with "{ subject: ...}"
    expect(browser.compose.setComposeDetails).toHaveBeenCalledOnce();
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}`,
    });
  });

  test("notifies errors", async () => {
    mockBrowserAndFetch({ subject: "MUCK_SUBJECT" }, "compose-request-200-error.json");

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

    await llmActionClickHandler(MOCK_TAB, compose);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith({
      message: "LLM Support for HTML Mails is not yet implemented",
      title: "Thunderbird LLM Extension",
      type: "basic",
    });
  });

  test("calls summarize ", async () => {
    mockBrowserAndFetch({}, "summarize-request-200.json");

    const mockPreviousConversation = "Test previous conversation";

    await llmActionClickHandler(MOCK_TAB, async (tabId: number) => summarize(tabId, mockPreviousConversation));

    expectComposerButtonSetAndReset();
    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n\n\n${mockPreviousConversation}`,
    });
  });

  test("Cancel request aborts request", async () => {
    mockBrowser({ options: { api_token: MOCK_TOKEN, model: MOCK_MODEL_URL } });
    useFetchWithAbort(500);
    // noinspection ES6MissingAwait
    llmActionClickHandler(MOCK_TAB, compose);
    await waitFor(() => expectMenuEntriesToBe("cancel"));
    // @ts-ignore
    await handleMenuClickListener({ menuItemId: "cancel" }, MOCK_TAB);
    await waitFor(() => expectMenuEntriesToBe("compose", "summarize"));
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
