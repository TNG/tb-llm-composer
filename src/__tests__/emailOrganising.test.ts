import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const { timedNotificationMock } = vi.hoisted(() => ({
  timedNotificationMock: vi.fn(),
}));

const { sendContentToLlmMock } = vi.hoisted(() => ({
  sendContentToLlmMock: vi.fn(),
}));

vi.mock("../llmConnection", () => ({
  LlmRoles: {
    SYSTEM: "system",
    USER: "user",
    ASSISTANT: "assistant",
  },
  sendContentToLlm: sendContentToLlmMock,
  isLlmTextCompletionResponse: (response: unknown) => {
    return Boolean(response && typeof response === "object" && "id" in response);
  },
}));

vi.mock("../notifications", () => ({
  timedNotification: timedNotificationMock,
}));

// Extra options merged over the defaults by the mocked getPluginOptions; reset before each test so a
// test can opt into e.g. pre-filter rules without affecting the others.
const { optionOverrides } = vi.hoisted(() => ({
  optionOverrides: { value: {} as Record<string, unknown> },
}));

vi.mock("../optionsParams", async () => {
  const actual = await vi.importActual<typeof import("../optionsParams")>("../optionsParams");
  return {
    ...actual,
    getPluginOptions: vi.fn(async () => ({
      ...actual.DEFAULT_OPTIONS,
      folderSortingRules: [{ folderPath: "/target", description: "Target folder" }],
      ...optionOverrides.value,
    })),
  };
});

import { organiseCurrentFolder, planOrganiseCurrentFolder } from "../emailOrganising";

const originalBrowser = global.browser;

describe("emailOrganising", () => {
  beforeEach(() => {
    timedNotificationMock.mockReset();
    sendContentToLlmMock.mockReset();
    optionOverrides.value = {};
  });

  afterAll(() => {
    global.browser = originalBrowser;
  });

  test("uses displayed folder id when listing messages", async () => {
    const messagesList = vi.fn().mockResolvedValue({ id: undefined, messages: [] });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { accountId: "acc-1", path: "/target", name: "target" },
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: messagesList,
        continueList: vi.fn(),
        getFull: vi.fn(),
        move: vi.fn(),
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    expect(messagesList).toHaveBeenCalledTimes(1);
    expect(messagesList).toHaveBeenCalledWith("folder-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder",
      "The folder is empty — nothing to organise.",
      5000,
    );
  });

  test("falls back to MailFolder object when messages.list rejects folder id", async () => {
    const messagesList = vi
      .fn()
      .mockRejectedValueOnce(new Error("Incorrect argument types for messages.list."))
      .mockResolvedValue({ id: undefined, messages: [] });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { accountId: "acc-1", path: "/target", name: "target" },
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: messagesList,
        continueList: vi.fn(),
        getFull: vi.fn(),
        move: vi.fn(),
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    expect(messagesList).toHaveBeenCalledTimes(2);
    expect(messagesList).toHaveBeenNthCalledWith(1, "folder-id");
    expect(messagesList).toHaveBeenNthCalledWith(2, { accountId: "acc-1", path: "/inbox", name: "Inbox" });
  });

  test("moves classified messages and falls back when messages.move rejects folder id", async () => {
    const messagesMove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Incorrect argument types for messages.move."))
      .mockResolvedValue(undefined);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [
        {
          message: {
            role: "system",
            content: '{"classifications":[{"id":15,"folder":1}]}',
          },
        },
      ],
    });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [{ id: 15, author: "alice@example.com", subject: "Quarterly report" }],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Please process this message" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    expect(messagesMove).toHaveBeenCalledTimes(2);
    expect(messagesMove).toHaveBeenNthCalledWith(1, [15], "target-id");
    expect(messagesMove).toHaveBeenNthCalledWith(2, [15], {
      accountId: "acc-1",
      path: "/target",
      name: "Target",
    });
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 1 email(s). 0 email(s) kept in place.",
      10000,
    );
  });

  test("parses and applies classifications when LLM reply includes think-tag prose before JSON", async () => {
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [
        {
          message: {
            role: "system",
            content:
              '<think>So, summarizing the emails that are introductions (folder 1):\n- ID 8: Leander Blume\n- ID 7: Matthias Weber\n\nAll others: null.</think>\n{"classifications":[{"id":8,"folder":1},{"id":7,"folder":1}]}',
          },
        },
      ],
    });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [
            { id: 8, author: "alice@example.com", subject: "Intro 1" },
            { id: 7, author: "bob@example.com", subject: "Intro 2" },
          ],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Message body" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    // Both emails target the same folder, so they are moved together in a single API call.
    expect(messagesMove).toHaveBeenCalledTimes(1);
    expect(messagesMove).toHaveBeenNthCalledWith(1, [8, 7], "target-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 2 email(s). 0 email(s) kept in place.",
      10000,
    );
  });

  test("still moves emails when the endpoint rejects JSON output mode by throwing", async () => {
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    // First call (JSON output mode requested) throws as if the endpoint rejected `response_format`;
    // the plain-text retry succeeds. The email must still be classified and moved.
    sendContentToLlmMock
      .mockRejectedValueOnce(new Error("LLM-CONNECTION: Error response: unknown field response_format"))
      .mockResolvedValueOnce({
        status: 1,
        id: "mock-response-id",
        created: 1,
        model: "mock-model",
        choices: [{ message: { role: "system", content: '{"classifications":[{"id":15,"folder":1}]}' } }],
      });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [{ id: 15, author: "alice@example.com", subject: "Quarterly report" }],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Please process this message" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    expect(sendContentToLlmMock).toHaveBeenCalledTimes(2);
    expect(messagesMove).toHaveBeenCalledTimes(1);
    expect(messagesMove).toHaveBeenNthCalledWith(1, [15], "target-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 1 email(s). 0 email(s) kept in place.",
      10000,
    );
  });

  test("reports emails as errors (not kept in place) when the LLM reply cannot be classified", async () => {
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [],
    });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [{ id: 15, author: "alice@example.com", subject: "Quarterly report" }],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Please process this message" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    expect(messagesMove).not.toHaveBeenCalled();
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 0 email(s). 0 email(s) kept in place. 1 email(s) could not be processed.",
      10000,
    );
  });

  test("rejects a fractional folder index instead of turning it into an unusable move", async () => {
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      // 1.5 is inside the valid range but is not a folder: it must not become index 0.5.
      choices: [{ message: { role: "system", content: '{"classifications":[{"id":15,"folder":1.5}]}' } }],
    });

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [{ id: 15, author: "alice@example.com", subject: "Quarterly report" }],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Please process this message" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;

    await organiseCurrentFolder(new AbortController().signal);

    // The email stays put; the absent error clause shows it was not counted as a failed move either.
    expect(messagesMove).not.toHaveBeenCalled();
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 0 email(s). 1 email(s) kept in place.",
      10000,
    );
  });

  /** Build a browser mock backed by `messageCount` messages (ids 1..N) in the source folder. */
  function buildMultiMessageBrowser(messageCount: number, messagesMove: ReturnType<typeof vi.fn>) {
    const messages = Array.from({ length: messageCount }, (_, i) => ({
      id: i + 1,
      author: `sender${i + 1}@example.com`,
      subject: `Subject ${i + 1}`,
    }));

    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [{ id: "target-id", accountId: "acc-1", path: "/target", name: "Target" }],
          },
        ]),
      },
      mailTabs: {
        query: vi.fn().mockResolvedValue([
          {
            displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" },
          },
        ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({ id: undefined, messages }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "Message body" }),
        move: messagesMove,
      },
      folders: {
        getSubFolders: vi.fn(),
      },
    } as unknown as typeof browser;
  }

  test("moves each chunk before classifying the next, not all at the end", async () => {
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    // 16 messages => two chunks (BATCH_SIZE is 15): ids 1..15, then id 16.
    sendContentToLlmMock
      .mockImplementationOnce(async () => ({
        id: "r1",
        choices: [{ message: { role: "system", content: '{"classifications":[{"id":1,"folder":1}]}' } }],
      }))
      .mockImplementationOnce(async () => {
        // By the time the second chunk is being classified, the first chunk's
        // classified message must already have been moved.
        expect(messagesMove).toHaveBeenCalledWith([1], "target-id");
        return {
          id: "r2",
          choices: [{ message: { role: "system", content: '{"classifications":[{"id":16,"folder":1}]}' } }],
        };
      });

    buildMultiMessageBrowser(16, messagesMove);

    await organiseCurrentFolder(new AbortController().signal);

    expect(sendContentToLlmMock).toHaveBeenCalledTimes(2);
    expect(messagesMove).toHaveBeenCalledWith([1], "target-id");
    expect(messagesMove).toHaveBeenCalledWith([16], "target-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 2 email(s). 14 email(s) kept in place.",
      10000,
    );
  });

  test("shows an abort summary of what was moved so far when cancelled mid-run", async () => {
    const controller = new AbortController();
    const messagesMove = vi.fn().mockResolvedValue(undefined);

    sendContentToLlmMock.mockImplementation(async () => ({
      id: "r1",
      choices: [{ message: { role: "system", content: '{"classifications":[{"id":1,"folder":1}]}' } }],
    }));

    buildMultiMessageBrowser(16, messagesMove);

    // Abort once the first chunk has been processed (progress passes 0%), so the
    // second chunk is never classified or moved.
    const progress = vi.fn((percent: number) => {
      if (percent > 0) {
        controller.abort(new DOMException("cancel", "AbortError"));
      }
    });

    await organiseCurrentFolder(controller.signal, progress);

    // Only the first chunk's classification ran; the first chunk's message moved.
    expect(sendContentToLlmMock).toHaveBeenCalledTimes(1);
    expect(messagesMove).toHaveBeenCalledTimes(1);
    expect(messagesMove).toHaveBeenCalledWith([1], "target-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Aborted",
      "Aborted. Moved 1 email(s) so far. 14 email(s) kept in place.",
      10000,
    );
  });

  /** Build a browser stub with two messages in /inbox and a resolvable /newsletters target folder. */
  function stubBrowserWithTwoMessages(messagesMove: ReturnType<typeof vi.fn>) {
    global.browser = {
      accounts: {
        list: vi.fn().mockResolvedValue([
          {
            id: "acc-1",
            rootFolder: { id: "root-id", accountId: "acc-1", path: "/", name: "root" },
            folders: [
              { id: "target-id", accountId: "acc-1", path: "/target", name: "Target" },
              { id: "news-id", accountId: "acc-1", path: "/newsletters", name: "Newsletters" },
            ],
          },
        ]),
      },
      mailTabs: {
        query: vi
          .fn()
          .mockResolvedValue([
            { displayedFolder: { id: "folder-id", accountId: "acc-1", path: "/inbox", name: "Inbox" } },
          ]),
      },
      messages: {
        list: vi.fn().mockResolvedValue({
          id: undefined,
          messages: [
            { id: 1, author: "news@example.com", subject: "Weekly digest" },
            { id: 2, author: "alice@corp.test", subject: "Quarterly report" },
          ],
        }),
        continueList: vi.fn(),
        getFull: vi.fn().mockResolvedValue({ contentType: "text/plain", body: "body text" }),
        move: messagesMove,
      },
      folders: { getSubFolders: vi.fn() },
    } as unknown as typeof browser;
  }

  test("pre-filters move matching mail and keep it away from the LLM", async () => {
    optionOverrides.value = {
      preFilterRules: [
        { field: "from", operator: "contains", value: "news@example.com", targetFolderPath: "/newsletters" },
      ],
    };
    const messagesMove = vi.fn().mockResolvedValue(undefined);
    stubBrowserWithTwoMessages(messagesMove);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [{ message: { role: "system", content: '{"classifications":[{"id":2,"folder":1}]}' } }],
    });

    const result = await organiseCurrentFolder(new AbortController().signal);

    // The newsletter was moved by the pre-filter, before any LLM call.
    expect(messagesMove).toHaveBeenNthCalledWith(1, [1], "news-id");
    // Only the remaining message was classified.
    const promptSent = sendContentToLlmMock.mock.calls[0][0][1].content as string;
    expect(promptSent).toContain("Quarterly report");
    expect(promptSent).not.toContain("Weekly digest");
    // Both moves are reflected in the run's tallies.
    expect(result).toEqual({ moved: 2, keptInPlace: 0, errors: 0, aborted: false });
  });

  test("a pre-filter without a target folder keeps the mail in place and skips the LLM", async () => {
    optionOverrides.value = {
      preFilterRules: [{ field: "subject", operator: "contains", value: "digest", targetFolderPath: "" }],
    };
    const messagesMove = vi.fn().mockResolvedValue(undefined);
    stubBrowserWithTwoMessages(messagesMove);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [{ message: { role: "system", content: '{"classifications":[{"id":2,"folder":null}]}' } }],
    });

    const result = await organiseCurrentFolder(new AbortController().signal);

    expect(messagesMove).not.toHaveBeenCalled();
    expect(sendContentToLlmMock.mock.calls[0][0][1].content).not.toContain("Weekly digest");
    expect(result).toEqual({ moved: 0, keptInPlace: 2, errors: 0, aborted: false });
  });

  test("planning does not move pre-filtered mail; it lands in the plan pre-assigned to its target", async () => {
    optionOverrides.value = {
      preFilterRules: [
        { field: "from", operator: "contains", value: "news@example.com", targetFolderPath: "/newsletters" },
      ],
    };
    const messagesMove = vi.fn().mockResolvedValue(undefined);
    stubBrowserWithTwoMessages(messagesMove);

    sendContentToLlmMock.mockResolvedValue({
      status: 1,
      id: "mock-response-id",
      created: 1,
      model: "mock-model",
      choices: [{ message: { role: "system", content: '{"classifications":[{"id":2,"folder":1}]}' } }],
    });

    const plan = await planOrganiseCurrentFolder(new AbortController().signal);

    // Nothing may move before the user confirms — not even a deterministic pre-filter match.
    expect(messagesMove).not.toHaveBeenCalled();
    // The pre-filter target is not an organise rule, so it gets its own slot appended to the folders.
    expect(plan?.folders).toEqual([
      { path: "/target", name: "Target" },
      { path: "/newsletters", name: "Newsletters" },
    ]);
    const newsletter = plan?.entries.find((entry) => entry.messageId === 1);
    expect(newsletter?.proposedFolderIndex).toBe(1);
    expect(plan?.resolvedFolders[1]).toMatchObject({ id: "news-id" });
    // The pre-filtered message still never reaches the classifier.
    expect(sendContentToLlmMock.mock.calls[0][0][1].content).not.toContain("Weekly digest");
  });

  test("an unresolvable pre-filter target folder fails the run with an actionable message", async () => {
    optionOverrides.value = {
      preFilterRules: [{ field: "from", operator: "contains", value: "news@", targetFolderPath: "/nope" }],
    };
    stubBrowserWithTwoMessages(vi.fn());

    await expect(organiseCurrentFolder(new AbortController().signal)).rejects.toThrow(
      /Could not find these folder paths: \/nope/,
    );
    expect(sendContentToLlmMock).not.toHaveBeenCalled();
  });
});
