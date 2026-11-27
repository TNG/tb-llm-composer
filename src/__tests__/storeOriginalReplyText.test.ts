import {
  clearOriginalTabCache,
  getOriginalTabConversationCacheContent,
  getOriginalTabConversationForIdentity,
  storeOriginalReplyText,
  updateOriginalTabCache,
} from "../originalTabConversation";
import { mockBrowser } from "./testUtils";

import Tab = browser.tabs.Tab;

import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

const originalBrowser = global.browser;

describe("The storeOriginalReplyTextAndSummarize", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await clearOriginalTabCache();
  });

  test("does not stores original tab conversation when composeDetails.type is not reply", async () => {
    mockBrowser({
      plainTextBody: "Previous Conversation",
      composeDetailsType: "draft",
    });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({});
  });

  test("does not stores original tab conversation when there is no plainTextBody", async () => {
    mockBrowser({ composeDetailsType: "reply" });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({});
  });

  test("stores original tab conversation when composeDetails.type is reply", async () => {
    mockBrowser({
      plainTextBody: "Previous Conversation",
      composeDetailsType: "reply",
    });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({
      [testTab.id as number]: { content: "Previous Conversation", identityId: "MOCK_IDENTITY_ID" },
    });
  });

  test("removes leftover original tab conversation for the given id when composeDetails.type is not reply", async () => {
    mockBrowser({
      plainTextBody: "Previous Conversation",
      composeDetailsType: "draft",
    });
    (await getOriginalTabConversationCacheContent())[testTab.id as number] = { content: "Previous Conversation" };

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({});
  });

  test("stores original tab conversation without leading and tailing white spaces", async () => {
    mockBrowser({
      plainTextBody: " \t\n" + "Previous Conversation" + " \t\n",
      composeDetailsType: "reply",
    });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({
      [testTab.id as number]: { content: "Previous Conversation", identityId: "MOCK_IDENTITY_ID" },
    });
  });

  test("stores original tab conversation including the tailing signature", async () => {
    const signature = "My\nAwesome\nSignature";
    const plainTextBodyNoLeadingNewLine = `Previous Conversation\n\n-- \n${signature}`;
    const plainTextBody = `\n${plainTextBodyNoLeadingNewLine}`;
    mockBrowser({ plainTextBody, signature, composeDetailsType: "reply" });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({
      [testTab.id as number]: { content: plainTextBodyNoLeadingNewLine, identityId: "MOCK_IDENTITY_ID" },
    });
  });

  test("stores original tab conversation including the leading signature", async () => {
    const signature = "My\nAwesome\nSignature";
    const plainTextBodyNoLeadingNewLines = `${signature}\nPrevious Conversation`;
    const plainTextBody = `\n\n${plainTextBodyNoLeadingNewLines}`;
    mockBrowser({ plainTextBody, signature, composeDetailsType: "reply" });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({
      [testTab.id as number]: { content: plainTextBodyNoLeadingNewLines, identityId: "MOCK_IDENTITY_ID" },
    });
  });

  describe("getOriginalTabConversationForIdentity", () => {
    const quote = (sig: string) => `-- 
${sig}

On Monday Bob wrote:
> Hi
> -- 
> Colleague Sig`;
    const current = { id: "MOCK_IDENTITY_ID", signature: "New Sig" } as browser.identities.MailIdentity;

    test("swaps only the signature of the identity the reply was opened as", async () => {
      mockBrowser({
        otherIdentities: [
          // Listed first: guessing from all identities would wrongly swap this signature in the quote.
          { id: "colleague", signature: "Colleague Sig" },
          { id: "opened", signature: "Old Sig" },
        ],
      });
      await updateOriginalTabCache(testTab.id as number, quote("Old Sig"), "opened");

      expect(await getOriginalTabConversationForIdentity(testTab.id as number, current)).toBe(quote("New Sig"));
    });

    test("returns a quote cached without its identity unchanged", async () => {
      mockBrowser({ otherIdentities: [{ id: "opened", signature: "Old Sig" }] });
      await browser.storage.local.set({ ORIGINAL_TAB_CONVERSATION: { [testTab.id as number]: quote("Old Sig") } });

      expect(await getOriginalTabConversationForIdentity(testTab.id as number, current)).toBe(quote("Old Sig"));
    });
  });
});

const testTab: Tab = {
  id: 12312093,
  index: 0,
  highlighted: true,
  active: true,
  type: "messageCompose",
};
