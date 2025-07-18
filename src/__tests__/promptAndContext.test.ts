import { describe, expect, test } from "vitest";
import { LlmRoles } from "../llmConnection";
import { DEFAULT_OPTIONS } from "../optionsParams";
import {
  getEmailGenerationContext,
  getEmailGenerationPrompt,
  getSubjectGenerationContext,
  getSubjectGenerationPrompt,
  getSummaryPromptAndContext,
} from "../promptAndContext";
import { MOCK_TAB_DETAILS, MOCK_USER_NAME, mockBrowser } from "./testUtils";

const EMAIL_BASIC_PROMPT = `${DEFAULT_OPTIONS.llmContext}\nI am ${MOCK_USER_NAME}.`;
const SUBJECT_BASIC_PROMPT = `I need a concise subject for an email I am writing, in the same language as the email. 
      Reply in the format: [subject] 
      I am MOCK_USER_NAME.`;

const originalBrowser = global.browser;

describe("Testing getEmailGenerationContext", () => {
  test("no old messages, default options", async () => {
    mockBrowser({});
    const expectedContext = {
      content: EMAIL_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = await getEmailGenerationContext(MOCK_TAB_DETAILS, [], DEFAULT_OPTIONS);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    mockBrowser({});
    const expectedContext = {
      content: `${EMAIL_BASIC_PROMPT}
Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:
Message 0:
old message 1

Message 1:
old message 2`,
      role: LlmRoles.SYSTEM,
    };

    const result = await getEmailGenerationContext(MOCK_TAB_DETAILS, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    mockBrowser({});
    const expectedContext = {
      content: EMAIL_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = await getEmailGenerationContext(MOCK_TAB_DETAILS, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: false,
    });

    expect(result).toEqual(expectedContext);
  });
});

describe("Testing getEmailGenerationPrompt", () => {
  test("plain text email body, no signature, no previous conversation", async () => {
    mockBrowser({});
    const expectedPrompt = {
      content: "This is what I want the content of my email to be:\n" + "Test email",
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
    const testEmail = `${testEmailWithoutSignature}\n\n${testSignature}`;

    const expectedPrompt = {
      content: `This is what I want the content of my email to be:\n${testEmailWithoutSignature}`,
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
    const testEmail = `${testEmailWithoutSignature}\n\n${testSignature}\n\n${testPreviousConversation}`;

    const expectedPrompt = {
      content: `This is what I want the content of my email to be:
${testEmailWithoutSignature}

This is the conversation I am replying to. Keep its content in mind but do not include it in your suggestion:
${testPreviousConversation}`,
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

describe("Testing getSubjectGenerationContext", () => {
  test("no old messages, default options", async () => {
    mockBrowser({});
    const expectedContext = {
      content: SUBJECT_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = await getSubjectGenerationContext(MOCK_TAB_DETAILS, [], DEFAULT_OPTIONS);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    mockBrowser({});
    const expectedContext = {
      content: `${SUBJECT_BASIC_PROMPT}
Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:
Message 0:
old message 1

Message 1:
old message 2`,
      role: LlmRoles.SYSTEM,
    };

    const result = await getSubjectGenerationContext(MOCK_TAB_DETAILS, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    mockBrowser({});
    const expectedContext = {
      content: SUBJECT_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = await getSubjectGenerationContext(MOCK_TAB_DETAILS, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: false,
    });

    expect(result).toEqual(expectedContext);
  });
});

describe("Testing getSubjectGenerationPrompt", () => {
  test("plain text email body, no signature, no previous conversation", async () => {
    mockBrowser({});
    const expectedPrompt = {
      content: "This is what I want the content of my email to be:\nTest email",
      role: LlmRoles.USER,
    };

    const result = await getSubjectGenerationPrompt({
      isPlainText: true,
      plainTextBody: "Test email",
      type: "new",
    });

    expect(result).toEqual(expectedPrompt);
  });
});

describe("Testing getSummaryPromptAndContext", () => {
  test("sends previous conversation", async () => {
    const testPreviousConversation = "Previous conversation";
    const expectedContext = [
      {
        content:
          "I want to reply to an email. Give me a short summary of the previous conversation, " +
          "highlighting the open points I needs to cover in my answer.",
        role: LlmRoles.SYSTEM,
      },
      {
        content: `Previous conversation:\n${testPreviousConversation}`,
        role: LlmRoles.USER,
      },
    ];

    const result = await getSummaryPromptAndContext(testPreviousConversation);

    expect(result).toEqual(expectedContext);
  });
});

global.browser = originalBrowser;
