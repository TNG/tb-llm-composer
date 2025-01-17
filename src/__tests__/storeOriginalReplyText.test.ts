import { mockBrowser } from "./testUtils";
import {
  clearOriginalTabCache,
  getOriginalTabConversationCacheContent,
  storeOriginalReplyText
} from "../originalTabConversation";
import Tab = browser.tabs.Tab;
import clearAllMocks = jest.clearAllMocks;

const originalBrowser = global.browser;

describe("The storeOriginalReplyText", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(async () => {
    clearAllMocks();
    await clearOriginalTabCache();
  });

  test("does not stores original tab conversation when composeDetails.type is not reply", async () => {
    mockBrowser({ plainTextBody: "Previous Conversation", composeDetailsType: "draft" });
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
    mockBrowser({ plainTextBody: "Previous Conversation", composeDetailsType: "reply" });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });

  test("removes leftover original tab conversation for the given id when composeDetails.type is not reply", async () => {
    mockBrowser({ plainTextBody: "Previous Conversation", composeDetailsType: "draft" });
    (await getOriginalTabConversationCacheContent())[testTab.id as number] = "Previous Conversation";

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({});
  });

  test("stores original tab conversation without leading and tailing white spaces", async () => {
    mockBrowser({ plainTextBody: " \t\n" + "Previous Conversation" + " \t\n", composeDetailsType: "reply" });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });

  test("stores original tab conversation including the tailing signature", async () => {
    const signature = "My\nAwesome\nSignature";
    const plainTextBodyNoLeadingNewLine = "Previous Conversation" + "\n\n-- \n" + signature;
    const plainTextBody = "\n" + plainTextBodyNoLeadingNewLine;
    mockBrowser({ plainTextBody,
      signature,
      composeDetailsType: "reply",
    });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({ [testTab.id as number]: plainTextBodyNoLeadingNewLine });
  });

  test("stores original tab conversation including the leading signature", async () => {
    const signature = "My\nAwesome\nSignature";
    const plainTextBodyNoLeadingNewLines = signature + "\n" + "Previous Conversation";
    const plainTextBody = "\n\n" + plainTextBodyNoLeadingNewLines;
    mockBrowser({ plainTextBody,
      signature,
      composeDetailsType: "reply",
    });
    expect(await getOriginalTabConversationCacheContent()).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(await getOriginalTabConversationCacheContent()).toEqual({ [testTab.id as number]: plainTextBodyNoLeadingNewLines });
  });
});

const testTab: Tab = {
  id: 12312093,
  index: 0,
  highlighted: true,
  active: true,
  type: "messageCompose",
};
