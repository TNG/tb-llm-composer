import { sendContentToLlm } from "../llmConnection";
import { getExpectedRequestContent, mockBrowserAndFetch } from "./testUtils";
import { defaultOptions, Options } from "../options";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

const TEST_SIGNATURE = "Test User Signature";

// TODO LLL: remove pointless tests, fix others
describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test("no content, no previous conversation, default options", async () => {
    const fetchResponse = mockBrowserAndFetch();
    const expectedRequestContent = getExpectedRequestContent();

    const result = await sendContentToLlm(getTabDetails(), [], undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content without old messages, no previous conversation, default options", async () => {
    const testContent = "Test content";
    const fetchResponse = mockBrowserAndFetch({ content: testContent, signature: TEST_SIGNATURE });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      systemContext: defaultOptions.llmContext,
    });

    const result = await sendContentToLlm(getTabDetails(testContent), [], undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content without old messages, with previous conversation, default options", async () => {
    const testContent = "Test content";
    const testPreviousConversation = "Previous conversation";
    const fetchResponse = mockBrowserAndFetch({ content: testContent, signature: TEST_SIGNATURE });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      previousConversation: testPreviousConversation,
      systemContext: defaultOptions.llmContext,
    });

    const result = await sendContentToLlm(getTabDetails(testContent), [], testPreviousConversation);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content with old messages, no previous conversation, default options", async () => {
    const testContent = "Test content";
    const fetchResponse = mockBrowserAndFetch({ content: testContent, signature: TEST_SIGNATURE });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      systemContext:
        defaultOptions.llmContext +
        "Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:\n" +
        "Message 0:\nDear someone,\nthis is a test\nRegards,Christoph",
    });

    const result = await sendContentToLlm(getTabDetails(testContent), ["Dear someone,\nthis is a test\nRegards,Christoph"], undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content with old messages, no previous conversation, send_with_recent_mails disabled", async () => {
    const testContent = "Test content";
    const testOptions = {
      ...defaultOptions,
      include_recent_mails: false,
    } as Options;
    const fetchResponse = mockBrowserAndFetch({
      content: testContent,
      signature: TEST_SIGNATURE,
      options: testOptions,
    });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      systemContext: defaultOptions.llmContext,
    });

    const result = await sendContentToLlm(getTabDetails(testContent), ["Dear someone,\nthis is a test\nRegards,Christoph"], undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content with old messages, with previous conversation, send_with_recent_mails disabled", async () => {
    const testContent = "Test content";
    const testPreviousConversation = "Previous conversation";
    const testOptions = {
      ...defaultOptions,
      include_recent_mails: false,
    } as Options;
    const fetchResponse = mockBrowserAndFetch({
      content: testContent,
      signature: TEST_SIGNATURE,
      options: testOptions,
    });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      previousConversation: testPreviousConversation,
      systemContext: defaultOptions.llmContext,
    });

    const result = await sendContentToLlm(
      getTabDetails(testContent),
      ["Dear someone,\nthis is a test\nRegards,Christoph"],
      testPreviousConversation,
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("default content, custom params", async () => {
    const fetchResponse = mockBrowserAndFetch({
      params: { best_of: 2 },
    });
    const expectedRequestContent = getExpectedRequestContent({ params: { best_of: 2 } });

    const result = await sendContentToLlm(getTabDetails(), [], undefined);

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

    const result = await sendContentToLlm(getTabDetails(), [], undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("not OK response", async () => {
    mockBrowserAndFetch({ notOKResponse: true });
    const expectedError = `Error response from ${defaultOptions.model}: Test Error response`;

    await expect(() => sendContentToLlm(getTabDetails(), [], undefined)).rejects.toThrow(expectedError);
  });
});

function getTabDetails(content?: string): browser.compose.ComposeDetails {
  const tabDetails: browser.compose.ComposeDetails = { identityId: "identityId" };
  if (content) {
    tabDetails.plainTextBody = content;
  }
  return tabDetails;
}
