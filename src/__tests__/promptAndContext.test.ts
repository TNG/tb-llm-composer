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
import { SUMMARY_JSON_SCHEMA } from "../summary";
import { MOCK_USER_NAME } from "./testUtils";

const IDENTITY = { name: MOCK_USER_NAME } as browser.identities.MailIdentity;
const identityWithSignature = (signature: string) => ({ ...IDENTITY, signature }) as browser.identities.MailIdentity;

const EMAIL_BASIC_PROMPT = `${DEFAULT_OPTIONS.llmContext}\nI am ${MOCK_USER_NAME}.`;
const SUBJECT_BASIC_PROMPT = `${DEFAULT_OPTIONS.subjectContext}\nI am ${MOCK_USER_NAME}.`;

describe("Testing getEmailGenerationContext", () => {
  test("no old messages, default options", async () => {
    const expectedContext = {
      content: EMAIL_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = getEmailGenerationContext(IDENTITY, [], DEFAULT_OPTIONS);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    const expectedContext = {
      content: `${EMAIL_BASIC_PROMPT}
Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:
Message 0:
old message 1

Message 1:
old message 2`,
      role: LlmRoles.SYSTEM,
    };

    const result = getEmailGenerationContext(IDENTITY, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    const expectedContext = {
      content: EMAIL_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = getEmailGenerationContext(IDENTITY, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: false,
    });

    expect(result).toEqual(expectedContext);
  });
});

describe("Testing getEmailGenerationPrompt", () => {
  test("plain text email body, no signature, no previous conversation", async () => {
    const expectedPrompt = {
      content: "This is what I want the content of my email to be:\n" + "Test email",
      role: LlmRoles.USER,
    };

    const result = getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: "Test email",
        type: "new",
      },
      IDENTITY,
    );

    expect(result).toEqual(expectedPrompt);
  });

  test("plain text email body, signature, no previous conversation", async () => {
    const testSignature = "My signature";
    const testEmailWithoutSignature = "Test email";
    const testEmail = `${testEmailWithoutSignature}\n\n${testSignature}`;

    const expectedPrompt = {
      content: `This is what I want the content of my email to be:\n${testEmailWithoutSignature}`,
      role: LlmRoles.USER,
    };

    const result = getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: testEmail,
        type: "new",
      },
      identityWithSignature(testSignature),
    );

    expect(result).toEqual(expectedPrompt);
  });

  test("plain text email body, signature, previous conversation", async () => {
    const testSignature = "My signature";
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

    const result = getEmailGenerationPrompt(
      {
        isPlainText: true,
        plainTextBody: testEmail,
        type: "new",
      },
      identityWithSignature(testSignature),
      testPreviousConversation,
    );

    expect(result).toEqual(expectedPrompt);
  });
});

describe("Testing getSubjectGenerationContext", () => {
  test("no old messages, default options", async () => {
    const expectedContext = {
      content: SUBJECT_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = getSubjectGenerationContext(IDENTITY, [], DEFAULT_OPTIONS);

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is true", async () => {
    const expectedContext = {
      content: `${SUBJECT_BASIC_PROMPT}
Furthermore, here are some older messages to give you an idea of the style I'm writing in when talking to this person:
Message 0:
old message 1

Message 1:
old message 2`,
      role: LlmRoles.SYSTEM,
    };

    const result = getSubjectGenerationContext(IDENTITY, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: true,
    });

    expect(result).toEqual(expectedContext);
  });

  test("old messages, include_recent_mails is false", async () => {
    const expectedContext = {
      content: SUBJECT_BASIC_PROMPT,
      role: LlmRoles.SYSTEM,
    };

    const result = getSubjectGenerationContext(IDENTITY, ["old message 1", "old message 2"], {
      ...DEFAULT_OPTIONS,
      include_recent_mails: false,
    });

    expect(result).toEqual(expectedContext);
  });
});

describe("Testing getSubjectGenerationPrompt", () => {
  test("plain text email body, no signature, no previous conversation", async () => {
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
  test("sends previous conversation and asks for the JSON summary schema", async () => {
    const testPreviousConversation = "Previous conversation";

    const [system, user] = await getSummaryPromptAndContext(testPreviousConversation);

    expect(system.role).toBe(LlmRoles.SYSTEM);
    expect(system.content).toContain(SUMMARY_JSON_SCHEMA);
    expect(user).toEqual({
      content: `Previous conversation:
${testPreviousConversation}`,
      role: LlmRoles.USER,
    });
  });
});
