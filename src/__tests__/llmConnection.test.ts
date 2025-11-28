import { afterAll, describe, expect, test } from "vitest";
import {
  type LlmApiRequestMessage,
  LlmRoles,
  type LlmTextCompletionResponse,
  sendContentToLlm,
} from "../llmConnection";
import { mockBrowserAndFetch } from "./testUtils";
import { MOCK_MODEL_URL } from "./useFetchMock";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

const abortSignal = new AbortController().signal;

const MOCK_REQUEST_BODY_MESSAGES: LlmApiRequestMessage[] = [
  { content: "Test content", role: LlmRoles.SYSTEM },
  { content: "Test prompt", role: LlmRoles.USER },
];

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test.each([[undefined], [""]])("throws if the model is %s", async (model) => {
    mockBrowserAndFetch({ options: { model } }, "generic-request-200.json");

    await expect(sendContentToLlm(MOCK_REQUEST_BODY_MESSAGES, abortSignal)).rejects.toThrow(
      "Missing LLM model, set it in the options panel.",
    );
  });

  test("without token, ok response", async () => {
    mockBrowserAndFetch({ options: { api_token: "" } }, "generic-request-wo-token-200.json");

    const result = await sendContentToLlm(MOCK_REQUEST_BODY_MESSAGES, abortSignal);

    const llmChoices = (result as LlmTextCompletionResponse).choices;
    expect(llmChoices).length(1);
    expect(llmChoices[0].message.content).toEqual("Test response");
  });

  test("with token, ok response", async () => {
    mockBrowserAndFetch({}, "generic-request-200.json");

    const result = await sendContentToLlm(MOCK_REQUEST_BODY_MESSAGES, abortSignal);
    const llmChoices = (result as LlmTextCompletionResponse).choices;
    expect(llmChoices).length(1);
    expect(llmChoices[0].message.content).toEqual("Test response");
  });

  test("error response", async () => {
    mockBrowserAndFetch({}, "generic-request-500.json");

    await expect(sendContentToLlm(MOCK_REQUEST_BODY_MESSAGES, abortSignal)).rejects.toThrow(
      `LLM-CONNECTION: Error response from ${MOCK_MODEL_URL}: "Error response from LLM API"`,
    );
  });
});
