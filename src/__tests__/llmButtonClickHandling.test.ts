import { llmActionClickHandler } from "../llmButtonClickHandling";
import { LlmRoles, LlmTextCompletionResponse, sendContentToLlm, TgiErrorResponse } from "../llmConnection";
import { mockBrowser } from "./testUtils";
import Tab = browser.tabs.Tab;
import clearAllMocks = jest.clearAllMocks;

jest.mock("../llmConnection", () => ({
  ...(jest.requireActual("../llmConnection") as object),
  sendContentToLlm: jest.fn(),
}));

const originalBrowser = global.browser;

describe("The llmActionClickHandler", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(() => {
    clearAllMocks();
  });

  test("calls communicateWithLlm", async () => {
    mockBrowser({});
    (sendContentToLlm as jest.Mock<any, any>).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(testTab);

    expect(sendContentToLlm).toHaveBeenCalledTimes(1);

    expect(global.browser.composeAction.disable).toHaveBeenCalledTimes(1);
    expect(global.browser.composeAction.disable).toHaveBeenCalledWith(12312093);
    expect(global.browser.composeAction.enable).toHaveBeenCalledTimes(1);
    expect(global.browser.composeAction.enable).toHaveBeenCalledWith(12312093);
    expect(global.browser.composeAction.setIcon).toHaveBeenCalledTimes(2);
    expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(1, { path: { 32: "icons/loader-32px.gif" } });
    expect(global.browser.composeAction.setIcon).toHaveBeenNthCalledWith(2, { path: { 64: "icons/icon-64px.png" } });
  });

  test("notifies errors", async () => {
    mockBrowser({});
    (sendContentToLlm as jest.Mock<any, any>).mockResolvedValue(getErrorResponse());

    await llmActionClickHandler(testTab);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith({
      message: "LLM responded with an error: Test Error",
      title: "Thunderbird LLM Extension Error",
      type: "basic",
    });
  });

  test("throws when used with html", async () => {
    mockBrowser({ isPlainText: false });
    (sendContentToLlm as jest.Mock<any, any>).mockResolvedValue(getTestResponse());

    await llmActionClickHandler(testTab);

    expect(global.browser.notifications.create).toHaveBeenCalledTimes(1);
    expect(global.browser.notifications.create).toHaveBeenCalledWith({
      message: "LLM Support for HTML Mails is not yet implemented",
      title: "Thunderbird LLM Extension",
      type: "basic",
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
        message: { content: "Test content", role: LlmRoles.USER },
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

const testTab: Tab = {
  id: 12312093,
  index: 0,
  highlighted: true,
  active: true,
};
