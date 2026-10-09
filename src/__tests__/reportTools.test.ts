import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { resolveFolderPathMock, extractTextFromPartMock } = vi.hoisted(() => ({
  resolveFolderPathMock: vi.fn(),
  extractTextFromPartMock: vi.fn(),
}));

vi.mock("../emailOrganising", () => ({
  resolveFolderPath: resolveFolderPathMock,
  extractTextFromPart: extractTextFromPartMock,
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
  defaultDays: 30,
  maxSearchResults: 50,
  maxMessageBodies: 25,
  maxTotalBodyChars: 60000,
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
  });

  afterEach(() => {
    global.browser = originalBrowser;
  });

  test("exposes the report tool definitions", () => {
    const names = reportToolDefinitions.map((t) => t.function.name);
    expect(names).toEqual(["search_messages", "get_messages", "get_thread", "aggregate_messages"]);
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
    test("maps filter args to messages.query and returns compact metadata with flags", async () => {
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

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.search_messages({
        query: "invoice",
        author: "alice",
        recipient: "bob",
        unread: true,
        flagged: true,
        hasAttachment: true,
      })) as { hits: Array<Record<string, unknown>>; returned: number; truncated: boolean };

      const queryInfo = query.mock.calls[0][0];
      expect(queryInfo.fullText).toBe("invoice");
      expect(queryInfo.author).toBe("alice");
      expect(queryInfo.recipients).toBe("bob");
      expect(queryInfo.read).toBe(false); // unread -> read:false
      expect(queryInfo.flagged).toBe(true);
      expect(queryInfo.attachment).toBe(true);
      expect(queryInfo.fromDate).toBeInstanceOf(Date);

      expect(result.returned).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.hits[0]).toEqual({
        id: 1,
        date: "2026-01-01T00:00Z",
        from: "alice@example.com",
        to: ["me@example.com"],
        subject: "Hello",
      });
      expect(result.hits[0]).not.toHaveProperty("body");
    });

    test("renders names compactly and only lists the first three recipients", async () => {
      const query = vi.fn().mockResolvedValue({
        messages: [
          {
            id: 1,
            author: '"Doe, Jane" <jane@example.com>',
            recipients: ["a@x.com", "Bob <b@x.com>", "c@x.com", "d@x.com", "e@x.com"],
            subject: "Hi",
          },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.search_messages({})) as { hits: Array<Record<string, unknown>> };

      expect(result.hits[0]).toMatchObject({
        from: "Doe, Jane <jane@example.com>",
        to: ["a@x.com", "b@x.com", "c@x.com"],
        toCount: 5,
      });
    });

    test("answers a repeated identical search from the cache", async () => {
      const query = vi.fn().mockResolvedValue({ messages: [] });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      await handlers.search_messages({ author: "alice", fromDays: 7 });
      await handlers.search_messages({ fromDays: 7, author: "alice" });

      expect(query).toHaveBeenCalledTimes(1);
    });

    test("falls back to header matching when full-text search stalls, and stays there", async () => {
      vi.useFakeTimers();
      try {
        const query = vi.fn(async (info: Record<string, unknown>) => {
          if (info.fullText) return new Promise(() => {}); // the IMAP full-text search hangs
          return {
            messages: [
              { id: 1, subject: "Lunch", author: "x@y.com", recipients: [], date: new Date("2026-01-01") },
              { id: 2, subject: "Würth Zugang", author: "x@y.com", recipients: [], date: new Date("2026-01-02") },
              { id: 3, subject: "Passwort", author: "it@wuerth-it.com", recipients: [], date: new Date("2026-01-03") },
            ],
          };
        });
        setBrowser({ query });
        const handlers = createReportToolHandlers({ ...BASE_SCOPE });

        const pending = handlers.search_messages({ query: "wuerth passwort" }) as Promise<{
          hits: Array<{ id: number }>;
          note: string;
        }>;
        await vi.advanceTimersByTimeAsync(10_000);
        const first = await pending;

        // Both terms match id 3 (subject + sender), one matches id 2; "Lunch" matches neither.
        expect(first.hits.map((h) => h.id)).toEqual([3, 2]);
        expect(first.note).toMatch(/bodies were NOT searched/i);

        // Full-text is now known to stall, so the next search skips it entirely.
        const second = (await handlers.search_messages({ query: "lunch" })) as { hits: Array<{ id: number }> };
        expect(second.hits.map((h) => h.id)).toEqual([1]);
        expect(query.mock.calls.filter((c) => (c[0] as Record<string, unknown>).fullText)).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    test("remembers a full-text stall for later reports and requires two terms for 3+ term queries", async () => {
      vi.useFakeTimers();
      try {
        const query = vi.fn(async (info: Record<string, unknown>) => {
          if (info.fullText) return new Promise(() => {});
          return {
            messages: [
              { id: 1, subject: "Service desk", author: "x@y.com", recipients: [], date: new Date("2026-01-01") },
              { id: 2, subject: "Würth Zugang", author: "x@y.com", recipients: [], date: new Date("2026-01-02") },
              { id: 3, subject: "Passwort", author: "it@wuerth-it.com", recipients: [], date: new Date("2026-01-03") },
            ],
          };
        });
        const stored: Record<string, unknown> = {};
        setBrowser({ query });
        (global.browser as unknown as Record<string, unknown>).storage = {
          local: {
            get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
            set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, items)),
          },
        };

        // First report: the full-text query stalls once, and only the message matching 2 of 3 terms is kept.
        const first = createReportToolHandlers({ ...BASE_SCOPE });
        const pending = first.search_messages({ query: "wuerth service passwort" }) as Promise<{
          hits: Array<{ id: number }>;
        }>;
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await pending).hits.map((h) => h.id)).toEqual([3]);

        // A later report (new scope object) skips full-text immediately.
        const later = createReportToolHandlers({ ...BASE_SCOPE });
        const result = (await later.search_messages({ query: "zugang" })) as { hits: Array<{ id: number }> };
        expect(result.hits.map((h) => h.id)).toEqual([2]);
        expect(query.mock.calls.filter((c) => (c[0] as Record<string, unknown>).fullText)).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    test("reports truncated when more matches exist beyond maxSearchResults", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          { id: 1, subject: "a", author: "x", recipients: [] },
          { id: 2, subject: "b", author: "x", recipients: [] },
          { id: 3, subject: "c", author: "x", recipients: [] },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxSearchResults: 2 });
      const result = (await handlers.search_messages({})) as { hits: unknown[]; truncated: boolean };

      expect(result.hits).toHaveLength(2);
      expect(result.truncated).toBe(true);
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

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.search_messages({ subject: "schulung" })) as { hits: Array<{ id: number }> };

      expect(query.mock.calls[0][0]).not.toHaveProperty("subject");
      expect(result.hits.map((r) => r.id)).toEqual([1, 3]);
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
  });

  describe("get_messages", () => {
    test("returns full (untruncated) bodies for a batch of ids", async () => {
      const longBody = "x".repeat(5000);
      extractTextFromPartMock.mockReturnValue(longBody);
      const get = vi.fn().mockResolvedValue({
        date: new Date("2026-02-02T00:00:00Z"),
        author: "bob@example.com",
        recipients: ["me@example.com"],
        subject: "Re: Hi",
      });
      const getFull = vi.fn().mockResolvedValue({ contentType: "text/plain", body: longBody });
      setBrowser({ get, getFull });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.get_messages({ ids: [42, 43] })) as {
        messages: Array<{ id: number; body: string }>;
        skipped: unknown[];
      };

      expect(get).toHaveBeenCalledTimes(2);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].body.length).toBe(5000); // no windowing/truncation
      expect(result.skipped).toHaveLength(0);
    });

    test("skips ids once the body-count budget is exhausted", async () => {
      extractTextFromPartMock.mockReturnValue("body");
      const get = vi.fn().mockResolvedValue({ subject: "s", author: "a", recipients: [] });
      const getFull = vi.fn().mockResolvedValue({ body: "body" });
      setBrowser({ get, getFull });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxMessageBodies: 1 });
      const result = (await handlers.get_messages({ ids: [1, 2] })) as {
        messages: unknown[];
        skipped: Array<{ id: number; reason: string }>;
      };

      expect(result.messages).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ id: 2 });
      expect(result.skipped[0].reason).toMatch(/budget/i);
    });

    test("stops serving bodies once the total-char budget is spent", async () => {
      extractTextFromPartMock.mockReturnValue("y".repeat(100));
      const get = vi.fn().mockResolvedValue({ subject: "s", author: "a", recipients: [] });
      const getFull = vi.fn().mockResolvedValue({ body: "y".repeat(100) });
      setBrowser({ get, getFull });

      // Budget of 50 chars: the first 100-char body is served whole (overshoot), the next is skipped.
      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxTotalBodyChars: 50 });
      const result = (await handlers.get_messages({ ids: [1, 2] })) as {
        messages: unknown[];
        skipped: unknown[];
      };

      expect(result.messages).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
    });

    test("cuts quoted reply history unless includeQuoted is set", async () => {
      const raw =
        "Thanks, the deployment is done and verified on staging.\r\n\r\nFrom: Bob <b@x.com>\r\nSent: Monday\r\nSubject: Task\r\n\r\nPlease do it.";
      extractTextFromPartMock.mockReturnValue(raw);
      const get = vi.fn().mockResolvedValue({ subject: "Re: Task", author: "a", recipients: [] });
      setBrowser({ get, getFull: vi.fn().mockResolvedValue({}) });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const short = (await handlers.get_messages({ ids: [1] })) as {
        messages: Array<{ body: string; quotedChars?: number }>;
      };
      const full = (await handlers.get_messages({ ids: [1], includeQuoted: true })) as {
        messages: Array<{ body: string; quotedChars?: number }>;
      };

      expect(short.messages[0].body).toBe("Thanks, the deployment is done and verified on staging.");
      expect(short.messages[0].quotedChars).toBeGreaterThan(0);
      expect(full.messages[0].body).toContain("Please do it.");
      expect(full.messages[0]).not.toHaveProperty("quotedChars");
    });

    test("serves a repeated get_messages from the cache without spending budget", async () => {
      extractTextFromPartMock.mockReturnValue("body");
      const get = vi.fn().mockResolvedValue({ subject: "s", author: "a", recipients: [] });
      setBrowser({ get, getFull: vi.fn().mockResolvedValue({}) });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxMessageBodies: 1 });
      await handlers.get_messages({ ids: [1] });
      const again = (await handlers.get_messages({ ids: [1] })) as { messages: unknown[]; skipped: unknown[] };

      expect(get).toHaveBeenCalledTimes(1);
      expect(again.messages).toHaveLength(1);
      expect(again.skipped).toHaveLength(0);
    });

    test("does not overspend the body budget across concurrent calls", async () => {
      extractTextFromPartMock.mockReturnValue("body");
      const get = vi.fn().mockResolvedValue({ subject: "s", author: "a", recipients: [] });
      setBrowser({ get, getFull: vi.fn().mockResolvedValue({}) });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE, maxMessageBodies: 1 });
      const results = (await Promise.all([
        handlers.get_messages({ ids: [1] }),
        handlers.get_messages({ ids: [2] }),
      ])) as Array<{ messages: unknown[] }>;

      expect(results.flatMap((r) => r.messages)).toHaveLength(1);
    });

    test("reports a recoverable hint for ids that do not exist", async () => {
      const get = vi.fn().mockRejectedValue(new Error("Message not found: 51291."));
      const getFull = vi.fn();
      setBrowser({ get, getFull });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.get_messages({ ids: [51291] })) as {
        messages: unknown[];
        skipped: Array<{ id: number; reason: string }>;
      };

      expect(result.messages).toHaveLength(0);
      expect(result.skipped[0].reason).toMatch(/Could not read message 51291/);
    });

    test("throws when ids is empty", async () => {
      setBrowser({});
      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      await expect(handlers.get_messages({ ids: [] })).rejects.toThrow(/non-empty 'ids'/);
    });
  });

  describe("get_thread", () => {
    test("collects referenced messages and same-subject siblings across folders", async () => {
      const get = vi.fn().mockResolvedValue({ subject: "Re: Project", headerMessageId: "b@x" });
      const getFull = vi.fn().mockResolvedValue({
        headers: { "message-id": ["<b@x>"], references: ["<a@x>"] },
      });
      const query = vi.fn(async (info: Record<string, unknown>) => {
        if (info.headerMessageId === "a@x") {
          return {
            messages: [{ id: 10, subject: "Project", author: "alice", recipients: [], date: new Date("2026-01-01") }],
          };
        }
        if (info.headerMessageId === "b@x") {
          return {
            messages: [{ id: 11, subject: "Re: Project", author: "me", recipients: [], date: new Date("2026-01-02") }],
          };
        }
        // fullText subject scan finds a sent reply not linked by references.
        return {
          messages: [
            { id: 11, subject: "Re: Project", author: "me", recipients: [], date: new Date("2026-01-02") },
            { id: 12, subject: "RE: Project", author: "bob", recipients: [], date: new Date("2026-01-03") },
            { id: 99, subject: "Unrelated", author: "x", recipients: [], date: new Date("2026-01-04") },
          ],
        };
      });
      setBrowser({ get, getFull, query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.get_thread({ id: 11 })) as { messages: Array<{ id: number }> };

      const ids = result.messages.map((m) => m.id);
      expect(ids).toContain(10);
      expect(ids).toContain(11);
      expect(ids).toContain(12);
      expect(ids).not.toContain(99); // different normalized subject

      // The sibling scan is a date-bounded header scan, never a (stall-prone) full-text query.
      const scan = query.mock.calls.find((c) => !(c[0] as Record<string, unknown>).headerMessageId)?.[0] as Record<
        string,
        unknown
      >;
      expect(scan).not.toHaveProperty("fullText");
      expect(scan.fromDate).toBeInstanceOf(Date);
      // Starts before the earliest thread message (2026-01-01), with the lookback margin.
      expect((scan.fromDate as Date).getTime()).toBeLessThan(new Date("2026-01-01").getTime());
    });

    test("throws a clear error for a numeric id that cannot be loaded", async () => {
      const get = vi.fn().mockRejectedValue(new Error("nope"));
      setBrowser({ get, getFull: vi.fn() });
      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      await expect(handlers.get_thread({ id: 5 })).rejects.toThrow(/No message exists with id 5/);
    });

    test("falls back to a subject-only lookup when the body cannot be streamed", async () => {
      // Header loads, but streaming the full message fails (e.g. IMAP "Error while streaming …").
      const get = vi.fn().mockResolvedValue({ subject: "Re: Project", headerMessageId: "b@x" });
      const getFull = vi.fn().mockRejectedValue(new Error("Error while streaming message: Status 2153054243"));
      const query = vi.fn().mockResolvedValue({
        messages: [
          { id: 11, subject: "Re: Project", author: "me", recipients: [], date: new Date("2026-01-02") },
          { id: 12, subject: "Project", author: "bob", recipients: [], date: new Date("2026-01-03") },
        ],
      });
      setBrowser({ get, getFull, query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.get_thread({ id: 11 })) as { messages: Array<{ id: number }> };

      // Despite the streaming failure, same-subject siblings are still found via the subject scan.
      const ids = result.messages.map((m) => m.id);
      expect(ids).toContain(11);
      expect(ids).toContain(12);
    });

    test("does not hang when a reference lookup stalls, and still returns the message itself", async () => {
      vi.useFakeTimers();
      try {
        const get = vi.fn().mockResolvedValue({
          id: 11,
          subject: "Re: Project",
          headerMessageId: "b@x",
          author: "me",
          recipients: [],
          date: new Date("2026-01-02"),
        });
        const getFull = vi.fn().mockResolvedValue({ headers: { "message-id": ["<b@x>"], references: ["<a@x>"] } });
        // Both headerMessageId lookups never settle (the IMAP search hangs); the subject scan works.
        const query = vi.fn(async (info: Record<string, unknown>) => {
          if (info.headerMessageId) return new Promise(() => {});
          return { messages: [] };
        });
        setBrowser({ get, getFull, query });

        const handlers = createReportToolHandlers({ ...BASE_SCOPE });
        const pending = handlers.get_thread({ id: 11 }) as Promise<{
          messages: Array<{ id: number }>;
          truncated: boolean;
        }>;
        // One 25s query timeout per stalled lookup (own message-id + one reference).
        await vi.advanceTimersByTimeAsync(60_000);

        const result = await pending;
        expect(result.messages.map((m) => m.id)).toEqual([11]);
        // The ancestor could not be resolved, so the thread is incomplete and must say so.
        expect(result.truncated).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    test("caps how many referenced ids are resolved for a long thread", async () => {
      const references = Array.from({ length: 40 }, (_, i) => `<r${i}@x>`).join(" ");
      const get = vi.fn().mockResolvedValue({ id: 11, subject: "Project", headerMessageId: "b@x" });
      const getFull = vi.fn().mockResolvedValue({ headers: { "message-id": ["<b@x>"], references: [references] } });
      const query = vi.fn().mockResolvedValue({ messages: [] });
      setBrowser({ get, getFull, query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.get_thread({ id: 11 })) as { truncated: boolean };

      const lookups = query.mock.calls.filter((c) => (c[0] as Record<string, unknown>).headerMessageId);
      expect(lookups.length).toBe(13); // 12 nearest ancestors + own message-id
      // The nearest ancestors are kept, the oldest ones dropped.
      expect(lookups.at(-1)?.[0]).toEqual({ headerMessageId: "r39@x" });
      expect(result.truncated).toBe(true); // dropped references are reported, not hidden
    });

    test("aborts promptly when the run is cancelled", async () => {
      const controller = new AbortController();
      controller.abort();
      const get = vi.fn().mockResolvedValue({ subject: "x", headerMessageId: "a@x" });
      setBrowser({ get, getFull: vi.fn(), query: vi.fn() });
      const handlers = createReportToolHandlers({ ...BASE_SCOPE }, controller.signal);
      await expect(handlers.get_thread({ id: 5 })).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("aggregate_messages", () => {
    test("counts messages grouped by author", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          { id: 1, author: "alice", recipients: [], subject: "a", date: new Date("2026-01-01") },
          { id: 2, author: "alice", recipients: [], subject: "b", date: new Date("2026-01-02") },
          { id: 3, author: "bob", recipients: [], subject: "c", date: new Date("2026-01-03") },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.aggregate_messages({ groupBy: "author" })) as {
        totalMatched: number;
        groups: Array<{ key: string; count: number }>;
      };

      expect(result.totalMatched).toBe(3);
      expect(result.groups[0]).toEqual({ key: "alice", count: 2 });
      expect(result.groups).toContainEqual({ key: "bob", count: 1 });
    });

    test("groups by sender domain, ignoring display names and address casing", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          { id: 1, author: "Alice <alice@Example.com>", recipients: [], subject: "a", date: new Date("2026-01-01") },
          { id: 2, author: "bob@example.com", recipients: [], subject: "b", date: new Date("2026-01-02") },
          { id: 3, author: "carol@other.org", recipients: [], subject: "c", date: new Date("2026-01-03") },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.aggregate_messages({ groupBy: "domain" })) as {
        groups: Array<{ key: string; count: number }>;
      };

      expect(result.groups[0]).toEqual({ key: "example.com", count: 2 });
      expect(result.groups).toContainEqual({ key: "other.org", count: 1 });
    });

    test("groups by recipient domain, counting each distinct domain once per message", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          {
            id: 1,
            author: "a",
            recipients: ["x@acme.com", "Y <y@acme.com>", "z@beta.io"],
            subject: "a",
            date: new Date("2026-01-01"),
          },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.aggregate_messages({ groupBy: "recipientDomain" })) as {
        groups: Array<{ key: string; count: number }>;
      };

      // acme.com appears on two recipients of the same message but is counted once.
      expect(result.groups).toContainEqual({ key: "acme.com", count: 1 });
      expect(result.groups).toContainEqual({ key: "beta.io", count: 1 });
    });

    test("groups by day", async () => {
      const query = vi.fn().mockResolvedValue({
        id: undefined,
        messages: [
          { id: 1, author: "a", recipients: [], subject: "x", date: new Date("2026-01-01T09:00:00Z") },
          { id: 2, author: "b", recipients: [], subject: "y", date: new Date("2026-01-01T18:00:00Z") },
        ],
      });
      setBrowser({ query });

      const handlers = createReportToolHandlers({ ...BASE_SCOPE });
      const result = (await handlers.aggregate_messages({ groupBy: "day" })) as {
        groups: Array<{ key: string; count: number }>;
      };

      expect(result.groups).toEqual([{ key: "2026-01-01", count: 2 }]);
    });
  });
});
