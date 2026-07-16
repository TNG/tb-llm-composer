import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { resolveFolderPathMock, extractTextFromPartMock, getFoldersForAccountMock } = vi.hoisted(() => ({
  resolveFolderPathMock: vi.fn(),
  extractTextFromPartMock: vi.fn(),
  getFoldersForAccountMock: vi.fn(),
}));

vi.mock("../emailOrganising", () => ({
  resolveFolderPath: resolveFolderPathMock,
  extractTextFromPart: extractTextFromPartMock,
  getFoldersForAccount: getFoldersForAccountMock,
}));

import {
  assertSearchCapabilities,
  createReportToolHandlers,
  type ReportScope,
  reportToolDefinitions,
} from "../reportTools";

const originalBrowser = global.browser;

const BASE_SCOPE: ReportScope = {
  folderOnly: false,
  folder: null,
  includeSent: false,
  defaultDays: 30,
  maxSearchResults: 50,
};

function setBrowser(overrides: Record<string, unknown>): void {
  global.browser = {
    messages: {
      query: vi.fn().mockResolvedValue({ messages: [] }),
      continueList: vi.fn(),
      get: vi.fn(),
      getFull: vi.fn(),
      ...overrides,
    },
  } as unknown as typeof browser;
}

describe("reportTools", () => {
  beforeEach(() => {
    resolveFolderPathMock.mockReset();
    extractTextFromPartMock.mockReset();
    getFoldersForAccountMock.mockReset();
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  test("exposes search_messages and get_message tool definitions", () => {
    const names = reportToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(["search_messages", "get_message"]);
  });

  describe("assertSearchCapabilities", () => {
    test("passes a fromDate/author/fullText probe to messages.query", async () => {
      const query = vi.fn().mockResolvedValue({ messages: [] });
      setBrowser({ query });

      await assertSearchCapabilities(BASE_SCOPE);

      expect(query).toHaveBeenCalledTimes(1);
      const probe = query.mock.calls[0][0];
      expect(probe.fromDate).toBeInstanceOf(Date);
      expect(probe.author).toBeTruthy();
      expect(probe.fullText).toBeTruthy();
    });

    test("throws a clear error when querying is not supported", async () => {
      const query = vi.fn().mockRejectedValue(new Error("not implemented"));
      setBrowser({ query });

      await expect(assertSearchCapabilities(BASE_SCOPE)).rejects.toThrow(/Email search is not available/);
    });
  });

  describe("search_messages", () => {
    test("maps query args to messages.query and returns compact metadata only", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          {
            id: 1,
            date: new Date("2026-01-01T00:00:00Z"),
            author: "alice@example.com",
            recipients: ["me@example.com"],
            subject: "Hello",
          },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers(BASE_SCOPE);
      const result = (await handlers.search_messages({ query: "invoice", author: "alice" })) as Array<
        Record<string, unknown>
      >;

      expect(query).toHaveBeenCalledTimes(1);
      const queryInfo = query.mock.calls[0][0];
      expect(queryInfo.fullText).toBe("invoice");
      expect(queryInfo.author).toBe("alice");
      expect(queryInfo.fromDate).toBeInstanceOf(Date);
      expect(result).toEqual([
        {
          id: 1,
          date: "2026-01-01T00:00:00.000Z",
          author: "alice@example.com",
          recipients: ["me@example.com"],
          subject: "Hello",
        },
      ]);
      // No body field is leaked in search results.
      expect(result[0]).not.toHaveProperty("body");
    });

    test("respects maxSearchResults cap across paged results", async () => {
      const page1 = {
        id: "page-1",
        messages: [
          { id: 1, subject: "a", author: "x", recipients: [] },
          { id: 2, subject: "b", author: "x", recipients: [] },
        ],
      };
      const page2 = {
        id: undefined,
        messages: [{ id: 3, subject: "c", author: "x", recipients: [] }],
      };
      const query = vi.fn().mockResolvedValue(page1);
      const continueList = vi.fn().mockResolvedValue(page2);
      setBrowser({ query, continueList });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxSearchResults: 2 });
      const result = (await handlers.search_messages({})) as unknown[];

      expect(result).toHaveLength(2);
      // Cap reached on first page, so continueList is never called.
      expect(continueList).not.toHaveBeenCalled();
    });

    test("filters subjects as a case-insensitive substring instead of an exact query match", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          { id: 1, subject: "Einladung zur Schulung am Montag", author: "x", recipients: [] },
          { id: 2, subject: "Rechnung Februar", author: "x", recipients: [] },
          { id: 3, subject: "SCHULUNG abgesagt", author: "x", recipients: [] },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers(BASE_SCOPE);
      const result = (await handlers.search_messages({ subject: "schulung" })) as Array<Record<string, unknown>>;

      // `subject` must not be forwarded as an exact-match query field.
      expect(query.mock.calls[0][0]).not.toHaveProperty("subject");
      expect(result.map((r) => r.id)).toEqual([1, 3]);
    });

    test("restricts to the active folder id when folderOnly is set", async () => {
      const query = vi.fn().mockResolvedValue({ messages: [] });
      setBrowser({ query });
      resolveFolderPathMock.mockResolvedValue({ id: "folder-7", accountId: "a", path: "/INBOX", name: "Inbox" });

      const handlers = createReportToolHandlers({
        ...BASE_SCOPE,
        folderOnly: true,
        folder: { accountId: "a", path: "/INBOX" },
      });
      await handlers.search_messages({});

      expect(resolveFolderPathMock).toHaveBeenCalledWith("/INBOX");
      expect(query.mock.calls[0][0].folderId).toBe("folder-7");
    });

    test("also searches the account's Sent folder when includeSent is set", async () => {
      const query = vi.fn().mockResolvedValue({ id: undefined, messages: [] });
      setBrowser({ query, accounts: undefined });
      // Provide an accounts.get + folder tree containing a Sent folder.
      global.browser.accounts = {
        get: vi.fn().mockResolvedValue({ id: "a" }),
      } as unknown as typeof browser.accounts;
      resolveFolderPathMock.mockResolvedValue({ id: "folder-7", accountId: "a", path: "/INBOX", name: "Inbox" });
      getFoldersForAccountMock.mockResolvedValue([
        { id: "inbox-id", path: "/INBOX", name: "Inbox", type: "inbox" },
        { id: "sent-id", path: "/Sent", name: "Sent", specialUse: ["sent"] },
      ]);

      const handlers = createReportToolHandlers({
        ...BASE_SCOPE,
        folderOnly: true,
        includeSent: true,
        folder: { accountId: "a", path: "/INBOX" },
      });
      await handlers.search_messages({});

      // One query per in-scope folder: the target folder and the Sent folder.
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][0].folderId).toBe("folder-7");
      expect(query.mock.calls[1][0].folderId).toBe("sent-id");
    });

    test("de-duplicates messages that appear in more than one searched folder", async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce({ id: undefined, messages: [{ id: 1, subject: "a", author: "x", recipients: [] }] })
        .mockResolvedValueOnce({
          id: undefined,
          messages: [
            { id: 1, subject: "a", author: "x", recipients: [] },
            { id: 2, subject: "b", author: "x", recipients: [] },
          ],
        });
      setBrowser({ query });
      global.browser.accounts = {
        get: vi.fn().mockResolvedValue({ id: "a" }),
      } as unknown as typeof browser.accounts;
      resolveFolderPathMock.mockResolvedValue({ id: "folder-7", accountId: "a", path: "/INBOX", name: "Inbox" });
      getFoldersForAccountMock.mockResolvedValue([{ id: "sent-id", path: "/Sent", name: "Sent", type: "sent" }]);

      const handlers = createReportToolHandlers({
        ...BASE_SCOPE,
        folderOnly: true,
        includeSent: true,
        folder: { accountId: "a", path: "/INBOX" },
      });
      const result = (await handlers.search_messages({})) as Array<{ id: number }>;

      expect(result.map((r) => r.id)).toEqual([1, 2]);
    });
  });

  describe("get_message", () => {
    test("returns a truncated plain-text body", async () => {
      const longBody = "x".repeat(5000);
      extractTextFromPartMock.mockReturnValue(longBody);
      const get = vi.fn().mockResolvedValue({
        date: new Date("2026-02-02T00:00:00Z"),
        author: "bob@example.com",
        subject: "Re: Hi",
      });
      const getFull = vi.fn().mockResolvedValue({ contentType: "text/plain", body: longBody });
      setBrowser({ get, getFull });

      const handlers = createReportToolHandlers(BASE_SCOPE);
      const result = (await handlers.get_message({ id: 42 })) as { id: number; body: string; author: string };

      expect(get).toHaveBeenCalledWith(42);
      expect(getFull).toHaveBeenCalledWith(42);
      expect(result.id).toBe(42);
      expect(result.author).toBe("bob@example.com");
      expect(result.body.length).toBe(1200);
    });

    test("throws when id is not numeric", async () => {
      setBrowser({});
      const handlers = createReportToolHandlers(BASE_SCOPE);
      await expect(handlers.get_message({ id: "not-a-number" })).rejects.toThrow(/numeric 'id'/);
    });

    test("returns a recoverable hint when the message id does not exist", async () => {
      const get = vi.fn().mockRejectedValue(new Error("Message not found: 51291."));
      const getFull = vi.fn();
      setBrowser({ get, getFull });

      const handlers = createReportToolHandlers(BASE_SCOPE);
      await expect(handlers.get_message({ id: 51291 })).rejects.toThrow(/No message exists with id 51291/);
      expect(getFull).not.toHaveBeenCalled();
    });
  });
});
