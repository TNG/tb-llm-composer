import { defaultOptions } from "../options";
import { getEmailGenerationContext, getEmailGenerationPrompt } from "../promptAndContext";
import { getExpectedEmailGenerationContext, getExpectedEmailGenerationPrompt, mockBrowser } from "./testUtils";

describe("Testing getEmailGenerationContext", () => {
  test("no old messages, default options", async () => {
    const expectedContext = getExpectedEmailGenerationContext(defaultOptions.llmContext);

    const result = await getEmailGenerationContext([], defaultOptions);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    const expectedContext = getExpectedEmailGenerationContext(
      defaultOptions.llmContext +
        "\n" +
        "Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:\n" +
        "Message 0:\n" +
        "old message 1\n\n" +
        "Message 1:\n" +
        "old message 2",
    );

    const result = await getEmailGenerationContext(["old message 1", "old message 2"], {
      ...defaultOptions,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    const expectedContext = getExpectedEmailGenerationContext(defaultOptions.llmContext);

    const result = await getEmailGenerationContext(["old message 1", "old message 2"], {
      ...defaultOptions,
      include_recent_mails: false,
    });

    expect(result).toEqual(expectedContext);
  });
});

const originalBrowser = global.browser;

describe("Testing getEmailGenerationPrompt", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  test("plain text email body, no signature, no previous conversation", async () => {
    mockBrowser({});
    const expectedPrompt = getExpectedEmailGenerationPrompt(
      "This is what the user wants to be the content of their email to be:\n" + "Test email",
    );

    const result = await getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: "Test email",
        type: "new",
      },
      "",
    );

    expect(result).toEqual(expectedPrompt);
  });

  test("plain text email body, signature, no previous conversation", async () => {
    const testSignature = "My signature";
    const testEmailWithoutSignature = "Test email";
    const testEmail = testEmailWithoutSignature + "\n\n" + testSignature;
    mockBrowser({ signature: testSignature });
    const expectedPrompt = getExpectedEmailGenerationPrompt(
      "This is what the user wants to be the content of their email to be:\n" + testEmailWithoutSignature,
    );

    const result = await getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: testEmail,
        type: "new",
      },
      "",
    );

    expect(result).toEqual(expectedPrompt);
  });

  // TODO LLL: add previous conversation
  test("plain text email body, signature, previous conversation", async () => {
    const testSignature = "My signature";
    const testEmailWithoutSignature = "Test email";
    const testEmail = testEmailWithoutSignature + "\n\n" + testSignature;
    mockBrowser({ signature: testSignature });
    const expectedPrompt = getExpectedEmailGenerationPrompt(
      "This is what the user wants to be the content of their email to be:\n" + testEmailWithoutSignature,
    );

    const result = await getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: testEmail,
        type: "new",
      },
      "",
    );

    expect(result).toEqual(expectedPrompt);
  });
});
