import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getSentMessages } from "../retrieveSentContext";

const originalBrowser = global.browser;

const sentFolder = (accountId: string) => ({ id: `${accountId}-sent`, accountId, path: "/Sent", specialUse: ["sent"] });

const ACCOUNTS: Record<string, unknown> = {
  work: { id: "work", folders: [{ id: "work-inbox", path: "/INBOX", subFolders: [sentFolder("work")] }] },
  home: { id: "home", folders: [sentFolder("home")] },
  bare: { id: "bare", folders: [{ id: "bare-inbox", path: "/INBOX" }] },
};

const IDENTITY = { id: "id-home", accountId: "home", email: "me@home.example" } as browser.identities.MailIdentity;

describe("getSentMessages", () => {
  let query: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    query = vi.fn().mockResolvedValue({
      messages: [
        { id: 1, date: new Date("2026-01-01") },
        { id: 2, date: new Date("2026-03-01") },
      ],
    });
    global.browser = {
      accounts: { get: vi.fn(async (id: string) => ACCOUNTS[id] ?? null) },
      messages: {
        query,
        getFull: vi.fn(async (id: number) => ({ parts: [{ contentType: "text/plain", body: `mail ${id}` }] })),
      },
    } as unknown as typeof browser;
  });

  afterAll(() => {
    global.browser = originalBrowser;
  });

  test("searches the sending identity's own Sent folder, newest first", async () => {
    const mails = await getSentMessages("bob@example.com", IDENTITY, 10);

    expect(browser.accounts.get).toHaveBeenCalledWith("home", true);
    expect(query).toHaveBeenCalledWith({
      recipients: "bob@example.com",
      folderId: "home-sent",
      author: "me@home.example",
    });
    expect(mails).toEqual(["mail 2", "mail 1"]);
  });

  test("finds a nested Sent folder", async () => {
    await getSentMessages("bob@example.com", { ...IDENTITY, accountId: "work" }, 10);

    expect(query.mock.calls[0][0]).toMatchObject({ folderId: "work-sent" });
  });

  test("does not borrow another account's Sent folder", async () => {
    expect(await getSentMessages("bob@example.com", { ...IDENTITY, accountId: "bare" }, 10)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  test("falls back to fromMe when the identity has no address", async () => {
    await getSentMessages("bob@example.com", { ...IDENTITY, email: "" }, 10);

    expect(query.mock.calls[0][0]).toMatchObject({ fromMe: true });
    expect(query.mock.calls[0][0]).not.toHaveProperty("author");
  });
});
