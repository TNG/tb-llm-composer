import { compose, llmActionClickHandler, summarize } from "../llmButtonClickHandling";
import { LlmRoles, type LlmTextCompletionResponse, type TgiErrorResponse, sendContentToLlm } from "../llmConnection";
import { mockBrowser } from "./testUtils";
import Tab = browser.tabs.Tab;
import { type MockInstance, afterAll, afterEach, describe, expect, test, vi } from "vitest";

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

  test("calls compose", async () => {
    mockBrowser({});
    (sendContentToLlm as unknown as MockInstance).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(MOCK_TAB, compose);

    expectSendToLllmAndIntermittentChanges();

    expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(MOCK_TAB_ID, {
      plainTextBody: `${MOCK_RESPONSE_LLM_TEXT}\n\n `,
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

function expectSendToLllmAndIntermittentChanges(): void {
  expect(sendContentToLlm).toHaveBeenCalledTimes(1);

  expect(global.browser.composeAction.disable).toHaveBeenCalledTimes(1);
  expect(global.browser.composeAction.disable).toHaveBeenCalledWith(MOCK_TAB_ID);
  expect(global.browser.composeAction.enable).toHaveBeenCalledTimes(1);
  expect(global.browser.composeAction.enable).toHaveBeenCalledWith(MOCK_TAB_ID);
  expect(global.browser.composeAction.setIcon).toHaveBeenCalledTimes(2);
  expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(1, {
    path: { 32: "icons/loader-32px.gif" },
  });
  expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(2, {
    path: { 64: "icons/icon-64px.png" },
  });
}
