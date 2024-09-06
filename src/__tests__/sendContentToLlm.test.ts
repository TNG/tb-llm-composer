import { sendContentToLlm } from "../llmConnection";
import { defaultOptions, Options } from "../optionUtils";
import { getExpectedRequestContent, mockBrowserAndFetch } from "./testUtils";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

const TEST_SIGNATURE = "Test User Signature";

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test("no content, default options", async () => {
    const fetchResponse = mockBrowserAndFetch();
    const expectedRequestContent = getExpectedRequestContent();

    const result = await sendContentToLlm(getTabDetails(), []);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content without old messages, default options", async () => {
    const testContent = "Test content";
    const fetchResponse = mockBrowserAndFetch({ content: testContent, signature: TEST_SIGNATURE });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      systemContext:
        defaultOptions.llmContext +
        "\nThe user signature should appear as is at the end of the email. Their signature is:\n Test User Signature",
    });

    const result = await sendContentToLlm(getTabDetails(testContent), []);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content with old messages, default options", async () => {
    const testContent = "Test content";
    const fetchResponse = mockBrowserAndFetch({ content: testContent, signature: TEST_SIGNATURE });
    const expectedRequestContent = getExpectedRequestContent({
      content: testContent,
      systemContext:
        defaultOptions.llmContext +
        "\nThe user signature should appear as is at the end of the email. Their signature is:\n" +
        " Test User Signature\n" +
        "Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:\n" +
        "Message 0:\nDear someone,\nthis is a test\nRegards,Christoph",
    });

    const result = await sendContentToLlm(getTabDetails(testContent), ["Dear someone,\nthis is a test\nRegards,Christoph"]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("content with old messages, send_with_recent_mails disabled", async () => {
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
      systemContext:
        defaultOptions.llmContext +
        "\nThe user signature should appear as is at the end of the email. Their signature is:\n" +
        " Test User Signature",
    });

    const result = await sendContentToLlm(getTabDetails(testContent), ["Dear someone,\nthis is a test\nRegards,Christoph"]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("default content, custom params", async () => {
    const fetchResponse = mockBrowserAndFetch({
      params: { best_of: 2 },
    });
    const expectedRequestContent = getExpectedRequestContent({ params: { best_of: 2 } });

    const result = await sendContentToLlm(getTabDetails(), []);

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

    const result = await sendContentToLlm(getTabDetails(), []);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(defaultOptions.model, expectedRequestContent);
    expect(result).toEqual(fetchResponse);
  });

  test("not OK response", async () => {
    mockBrowserAndFetch({ notOKResponse: true });
    const expectedError = `Error response from ${defaultOptions.model}: Test Error response`;

    await expect(() => sendContentToLlm(getTabDetails(), [])).rejects.toThrow(expectedError);
  });
});

function getTabDetails(content?: string): browser.compose.ComposeDetails {
  const tabDetails: browser.compose.ComposeDetails = { identityId: "identityId" };
  if (content) {
    tabDetails.plainTextBody = content;
  }
  return tabDetails;
}
