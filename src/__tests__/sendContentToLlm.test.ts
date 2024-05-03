import { sendContentToLlm } from "../llmConnection";
import { defaultOptions } from "../optionUtils";
import { getExpectedRequestContent, mockBrowserAndFetch } from "./testUtils";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test("no content, default options", async () => {
    const fetchResponse = mockBrowserAndFetch();
    const expectedRequestContent = getExpectedRequestContent();

    const result = await sendContentToLlm(getTabDetails());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content, default options", async () => {
    const testContent = "Test content";
    const fetchResponse = mockBrowserAndFetch({ content: testContent });
    const expectedRequestContent = getExpectedRequestContent({ content: testContent });

    const result = await sendContentToLlm(getTabDetails(testContent));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("default content, custom params", async () => {
    const fetchResponse = mockBrowserAndFetch({
      params: { best_of: 2 },
    });
    const expectedRequestContent = getExpectedRequestContent({ params: { best_of: 2 } });

    const result = await sendContentToLlm(getTabDetails());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("default content, token", async () => {
    const testOptionsWithToken = {
      options: { api_token: "testToken" },
    };
    const fetchResponse = mockBrowserAndFetch(testOptionsWithToken);
    const expectedRequestContent = getExpectedRequestContent(testOptionsWithToken);

    const result = await sendContentToLlm(getTabDetails());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("not OK response", async () => {
    mockBrowserAndFetch({ notOKResponse: true });
    const expectedError = `Error response from ${defaultOptions.model}: Test Error response`;

    expect(() => sendContentToLlm(getTabDetails())).rejects.toThrow(expectedError);
  });
});

function getTabDetails(content?: string): browser.compose.ComposeDetails {
  const tabDetails: browser.compose.ComposeDetails = { identityId: "identityId" };
  if (content) {
    tabDetails.plainTextBody = content;
  }
  return tabDetails;
}
