import { DEFAULT_OPTIONS } from "../options";
import { getEmailGenerationContext, getEmailGenerationPrompt } from "../promptAndContext";
import { mockBrowser } from "./testUtils";
import { LlmRoles } from "../llmConnection";

describe("Testing getEmailGenerationContext", () => {
  test("no old messages, default options", async () => {
    const expectedContext = { content: DEFAULT_OPTIONS.llmContext, role: LlmRoles.SYSTEM };

    const result = await getEmailGenerationContext([], DEFAULT_OPTIONS);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    const expectedContext = {
      content:
        DEFAULT_OPTIONS.llmContext +
        "\n" +
        "Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:\n" +
        "Message 0:\n" +
        "old message 1\n\n" +
        "Message 1:\n" +
        "old message 2",
      role: LlmRoles.SYSTEM,
    };

    const result = await getEmailGenerationContext(["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    const expectedContext = { content: DEFAULT_OPTIONS.llmContext, role: LlmRoles.SYSTEM };

    const result = await getEmailGenerationContext(["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
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
    const expectedPrompt = {
      content: "This is what the user wants to be the content of their email to be:\n" + "Test email",
      role: LlmRoles.USER,
    };

    const result = await getEmailGenerationPrompt({
      isPlainText: true,
      plainTextBody: "Test email",
      type: "new",
    });

    expect(result).toEqual(expectedPrompt);
  });

  test("plain text email body, signature, no previous conversation", async () => {
    const testSignature = "My signature";
    mockBrowser({ signature: testSignature });
    const testEmailWithoutSignature = "Test email";
    const testEmail = testEmailWithoutSignature + "\n\n" + testSignature;

    const expectedPrompt = {
      content: "This is what the user wants to be the content of their email to be:\n" + testEmailWithoutSignature,
      role: LlmRoles.USER,
    };

    const result = await getEmailGenerationPrompt({
      isPlainText: true,
      plainTextBody: testEmail,
      type: "new",
    });

    expect(result).toEqual(expectedPrompt);
  });

  test("plain text email body, signature, previous conversation", async () => {
    const testSignature = "My signature";
    mockBrowser({ signature: testSignature });
    const testEmailWithoutSignature = "Test email";
    const testPreviousConversation = "Previous conversation";
    const testEmail = testEmailWithoutSignature + "\n\n" + testSignature + "\n\n" + testPreviousConversation;

    const expectedPrompt = {
      content:
        "This is what the user wants to be the content of their email to be:\n" +
        testEmailWithoutSignature +
        "\nThis is the conversation the user is replying to. Keep its content in mind but do not include it in your suggestion:\n" +
        testPreviousConversation,
      role: LlmRoles.USER,
    };

    const result = await getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: testEmail,
        type: "new",
      },
      testPreviousConversation,
    );

    expect(result).toEqual(expectedPrompt);
  });
});
