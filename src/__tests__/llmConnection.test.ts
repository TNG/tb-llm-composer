import { type LlmApiRequestMessage, LlmRoles, sendContentToLlm } from "../llmConnection";
import { getExpectedRequestContent, getMockResponseBody, mockBrowserAndFetch } from "./testUtils";

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
const MOCK_MODEL_URL = "MOCK_MODEL_URL";

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test.each([[undefined], [""]])("throws if the model is %s", async (model) => {
    mockBrowserAndFetch({ responseBody: getMockResponseBody(), options: { model } });

    await expect(sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT])).rejects.toThrow(
      "Missing LLM model, set it in the options panel.",
    );
  });

  test("without token, ok response", async () => {
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({ responseBody: mockResponseBody, options: { model: MOCK_MODEL_URL } });

    const result = await sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(MOCK_MODEL_URL, getExpectedRequestContent([MOCK_CONTEXT, MOCK_PROMPT]));
    expect(result).toEqual(mockResponseBody);
  });

  test("with token, ok response", async () => {
    const mockToken = "testToken";
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({
      responseBody: mockResponseBody,
      options: { api_token: mockToken, model: MOCK_MODEL_URL },
    });

    const result = await sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      MOCK_MODEL_URL,
      getExpectedRequestContent([MOCK_CONTEXT, MOCK_PROMPT], mockToken),
    );
    expect(result).toEqual(mockResponseBody);
  });

  test("error response", async () => {
    mockBrowserAndFetch({ responseBody: "NOT_OK_RESPONSE", options: { model: MOCK_MODEL_URL } });

    await expect(sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT])).rejects.toThrow(
      `LLM-CONNECTION: Error response from ${MOCK_MODEL_URL}: Error response from LLM API`,
    );
  });
});
