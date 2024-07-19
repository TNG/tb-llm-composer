import { mockBrowser, mockDocumentGetElementById, mockDocumentQuerySelector, MockQuerySelectorValues } from "./testUtils";
import { restoreOptions, saveOptions } from "../options";
import { defaultOptions, Options } from "../optionUtils";
import clearAllMocks = jest.clearAllMocks;

const originalBrowser = global.browser;
const originalDocumentQuerySelector = document.querySelector;
const originalDocumentGetElementById = document.getElementById;

describe("The options functions", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    document.querySelector = originalDocumentQuerySelector;
    document.getElementById = originalDocumentGetElementById;
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("saveOptions", () => {
    test("notifies if the model is empty", async () => {
      mockBrowser({});
      mockDocumentQuerySelector({ url: "", contextWindow: "2000" });
      const mockNotification = mockDocumentGetElementById();
      const mockPreventDefault = jest.fn();

      await saveOptions({ preventDefault: mockPreventDefault } as unknown as Event);

      expect(mockPreventDefault).toHaveBeenCalledTimes(1);
      expect(mockNotification).toEqual({
        textContent: "model can't be empty",
        style: { backgroundColor: "red" },
        className: "notification show",
      });
    });

    test("notifies if the context window is empty", async () => {
      mockBrowser({});
      mockDocumentQuerySelector({ url: "https://url.com", contextWindow: "" });
      const mockNotification = mockDocumentGetElementById();
      const mockPreventDefault = jest.fn();

      await saveOptions({ preventDefault: mockPreventDefault } as unknown as Event);

      expect(mockPreventDefault).toHaveBeenCalledTimes(1);
      expect(mockNotification).toEqual({
        textContent: "context window has to be set (greater than zero)",
        style: { backgroundColor: "red" },
        className: "notification show",
      });
    });

    test("sets options correctly", async () => {
      mockBrowser({});
      const selectorValues: MockQuerySelectorValues = {
        url: "https://url.com",
        contextWindow: "2000",
        apiToken: "abc",
        otherOptions: '{"temperature": 0.2}',
        llmContext: "My context",
      };
      mockDocumentQuerySelector(selectorValues);
      const mockNotification = mockDocumentGetElementById();
      const mockPreventDefault = jest.fn();

      await saveOptions({ preventDefault: mockPreventDefault } as unknown as Event);

      expect(mockPreventDefault).toHaveBeenCalledTimes(1);
      expect(global.browser.storage.sync.set).toHaveBeenCalledTimes(1);
      expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
        options: {
          model: selectorValues.url,
          api_token: selectorValues.apiToken,
          context_window: 2000,
          params: { temperature: 0.2 },
          llmContext: selectorValues.llmContext,
        },
      });
      expect(mockNotification).toEqual({
        textContent: "Settings saved",
        style: { backgroundColor: "green" },
        className: "notification show",
      });
    });
  });

  describe("restoreOptions", () => {
    test("restores default options", async () => {
      mockBrowser({});
      const mockInputElements = mockDocumentQuerySelector({});

      await restoreOptions();

      expect(mockInputElements.url.value).toEqual(defaultOptions.model);
      expect(mockInputElements.apiToken.value).toEqual("");
      expect(mockInputElements.contextWindow.value).toEqual(`${defaultOptions.context_window}`);
      expect(mockInputElements.otherOptions.value).toEqual(JSON.stringify(defaultOptions.params, null, 2));
      expect(mockInputElements.llmContext.value).toEqual(defaultOptions.llmContext);
    });

    test("restores previously saved options", async () => {
      const testOptions: Options = {
        model: "https://url.com",
        api_token: "abc",
        context_window: 2000,
        params: { ...defaultOptions.params, temperature: 0.2 },
        llmContext: "My context",
      };
      mockBrowser({
        options: testOptions,
      });
      const mockInputElements = mockDocumentQuerySelector({});

      await restoreOptions();

      expect(mockInputElements.url.value).toEqual(testOptions.model);
      expect(mockInputElements.apiToken.value).toEqual(testOptions.api_token);
      expect(mockInputElements.contextWindow.value).toEqual(`${testOptions.context_window}`);
      expect(JSON.parse(mockInputElements.otherOptions.value)).toEqual(testOptions.params);
      expect(mockInputElements.llmContext.value).toEqual(testOptions.llmContext);
    });
  });
});
