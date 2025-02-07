import { LlmApiRequestMessage, LlmRoles, sendContentToLlm } from "../llmConnection";
import { getExpectedRequestContent, getMockResponseBody, mockBrowserAndFetch } from "./testUtils";
import { DEFAULT_OPTIONS } from "../options";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

const MOCK_CONTEXT: LlmApiRequestMessage = {
  content: "Test content",
  role: LlmRoles.SYSTEM,
};
const MOCK_PROMPT: LlmApiRequestMessage = {
  content: "Test prompt",
  role: LlmRoles.USER,
};

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test("without token, ok response", async () => {
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({ responseBody: mockResponseBody });

    const result = await sendContentToLlm(MOCK_CONTEXT, MOCK_PROMPT);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(DEFAULT_OPTIONS.model, getExpectedRequestContent([MOCK_CONTEXT, MOCK_PROMPT]));
    expect(result).toEqual(mockResponseBody);
  });

  test("with token, ok response", async () => {
    const mockToken = "testToken";
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({ responseBody: mockResponseBody, options: { api_token: mockToken } });

    const result = await sendContentToLlm(MOCK_CONTEXT, MOCK_PROMPT);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(DEFAULT_OPTIONS.model, getExpectedRequestContent([MOCK_CONTEXT, MOCK_PROMPT], mockToken));
    expect(result).toEqual(mockResponseBody);
  });

  test("error response", async () => {
    mockBrowserAndFetch({ responseBody: "NOT_OK_RESPONSE" });

    await expect(sendContentToLlm(MOCK_CONTEXT, MOCK_PROMPT)).rejects.toThrow(
      `LLM-CONNECTION: Error response from ${DEFAULT_OPTIONS.model}: Error response from LLM API`,
    );
  });
});
