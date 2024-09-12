import { mockBrowser } from "./testUtils";
import { ORIGINAL_TAB_CONVERSATION, storeOriginalReplyText } from "../storeOriginalReplyText";
import Tab = browser.tabs.Tab;
import clearAllMocks = jest.clearAllMocks;

const originalBrowser = global.browser;

describe("The storeOriginalReplyText", () => {
  afterAll(() => {
    global.browser = originalBrowser;
  });

  afterEach(() => {
    clearAllMocks();
    Object.keys(ORIGINAL_TAB_CONVERSATION).forEach((key) => delete ORIGINAL_TAB_CONVERSATION[key]);
  });

  test("does not stores original tab conversation when tab type is not messageCompose", async () => {
    mockBrowser({ plainTextBody: "Previous Conversation" });
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    const wrongTypeTab: Tab = { ...testTab, type: "mail" };
    await storeOriginalReplyText(wrongTypeTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});
  });

  test("does not stores original tab conversation when there is no plainTextBody", async () => {
    mockBrowser({});
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});
  });

  test("stores original tab conversation when tab type is messageCompose", async () => {
    mockBrowser({ plainTextBody: "Previous Conversation" });
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });

  test("stores original tab conversation without leading and tailing white spaces", async () => {
    mockBrowser({ plainTextBody: " \t\n" + "Previous Conversation" + " \t\n" });
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });

  test("stores original tab conversation removing the tailing signature", async () => {
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });

  test("stores original tab conversation removing the leading signature", async () => {
    const signature = "My\nAwesome\nSignature";
    mockBrowser({ plainTextBody: "\n\n-- \n" + signature + "\n" + "Previous Conversation", signature });
    expect(ORIGINAL_TAB_CONVERSATION).toEqual({});

    await storeOriginalReplyText(testTab);

    expect(ORIGINAL_TAB_CONVERSATION).toEqual({ [testTab.id as number]: "Previous Conversation" });
  });
});

const testTab: Tab = {
  id: 12312093,
  index: 0,
  highlighted: true,
  active: true,
  type: "messageCompose",
};
