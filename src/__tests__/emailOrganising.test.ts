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
  },
  sendContentToLlm: sendContentToLlmMock,
  isLlmTextCompletionResponse: (response: unknown) => {
    return Boolean(response && typeof response === "object" && "id" in response);
  },
}));

vi.mock("../notifications", () => ({
  timedNotification: timedNotificationMock,
}));

vi.mock("../optionsParams", async () => {
  const actual = await vi.importActual<typeof import("../optionsParams")>("../optionsParams");
  return {
    ...actual,
    getPluginOptions: vi.fn(async () => ({
      ...actual.DEFAULT_OPTIONS,
      folderSortingRules: [{ folderPath: "/target", description: "Target folder" }],
    })),
  };
});

import { organiseCurrentFolder } from "../emailOrganising";

const originalBrowser = global.browser;

describe("emailOrganising", () => {
  beforeEach(() => {
    timedNotificationMock.mockReset();
    sendContentToLlmMock.mockReset();
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

    expect(messagesMove).toHaveBeenCalledTimes(2);
    expect(messagesMove).toHaveBeenNthCalledWith(1, [8], "target-id");
    expect(messagesMove).toHaveBeenNthCalledWith(2, [7], "target-id");
    expect(timedNotificationMock).toHaveBeenCalledWith(
      "Organise Folder Complete",
      "Moved 2 email(s). 0 email(s) kept in place.",
      10000,
    );
  });

  test("keeps messages in place when LLM response has no choice message content", async () => {
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
      "Moved 0 email(s). 1 email(s) kept in place.",
      10000,
    );
  });
});

