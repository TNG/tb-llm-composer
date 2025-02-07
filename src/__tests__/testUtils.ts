import { LlmApiRequestMessage, LlmTextCompletionResponse, TgiErrorResponse } from "../llmConnection";
import { DEFAULT_OPTIONS, LlmParameters, Options } from "../options";
import ComposeDetails = browser.compose.ComposeDetails;

interface mockBrowserArgs {
  options?: Partial<Options>;
  params?: Partial<LlmParameters>;
  plainTextBody?: string;
  isPlainText?: boolean;
  composeDetailsType?: ComposeDetails["type"];
  signature?: string;
}

const localStore: { [key: string]: any } = {};

export function mockBrowser(args: mockBrowserArgs) {
  global.browser = {
    storage: {
      // @ts-ignore
      sync: {
        get: jest.fn().mockReturnValue(
          args.params || args.options
            ? {
                options: {
                  ...DEFAULT_OPTIONS,
                  ...args.options,
                  params: { ...DEFAULT_OPTIONS.params, ...args.options?.params, ...args.params },
                },
              }
            : {},
        ),
        set: jest.fn(),
      },
      // @ts-ignore
      local: {
        // @ts-ignore
        get: async (key) => ({ [key]: localStore[key] }),
        set: async (items: { [key: string]: any }) => {
          Object.entries(items).forEach(([k, v]) => (localStore[k] = v));
        },
        // @ts-ignore
        remove: async (k: string) => {
          delete localStore[k];
        },
      },
    },
    // @ts-ignore
    identities: { get: jest.fn().mockReturnValue({ signature: args.signature }) },
    // @ts-ignore
    compose: {
      getComposeDetails: jest.fn().mockResolvedValue({
        isPlainText: args.isPlainText !== false,
        plainTextBody: args.plainTextBody || undefined,
        type: args.composeDetailsType,
      }),
      setComposeDetails: jest.fn(),
    },
    // @ts-ignore
    composeAction: {
      disable: jest.fn(),
      setIcon: jest.fn(),
      enable: jest.fn(),
    },
    // @ts-ignore
    notifications: {
      create: jest.fn(),
    },
  };
}

interface mockBrowserAndFetchArgs extends mockBrowserArgs {
  responseBody: LlmTextCompletionResponse | TgiErrorResponse | "NOT_OK_RESPONSE";
}

export function mockBrowserAndFetch(args: mockBrowserAndFetchArgs): void {
  mockBrowser(args);

  if (args.responseBody === "NOT_OK_RESPONSE") {
    const errorResponse: Partial<Response> = {
      ok: false,
      text: async () => "Error response from LLM API",
    };
    global.fetch = jest.fn().mockResolvedValue(errorResponse);

    return;
  }

  const fetchResponse: Partial<Response> = {
    ok: true,
    json: jest.fn().mockResolvedValue(args.responseBody),
  };
  global.fetch = jest.fn().mockResolvedValue(fetchResponse);
}

export function getMockResponseBody(): LlmTextCompletionResponse {
  return {
    status: 1,
    id: "1",
    created: 1,
    model: "test_model",
    choices: [],
    finish_reason: "stop_sequence",
  };
}

export function getExpectedRequestContent(
  messages: Array<LlmApiRequestMessage>,
  api_token?: string,
  params: Partial<LlmParameters> = {},
): any {
  const expectedRequestBody = {
    messages,
    ...DEFAULT_OPTIONS.params,
    ...params,
  };

  return {
    body: JSON.stringify(expectedRequestBody),
    headers: {
      "Content-Type": "application/json",
      Authorization: api_token ? `Bearer ${api_token}` : undefined,
    },
    method: "POST",
  };
}

export interface MockQuerySelectorValues {
  url?: string;
  contextWindow?: string;
  includeRecentMails?: boolean;
  apiToken?: string;
  otherOptions?: string;
  llmContext?: string;
}

interface MockNotification {
  textContent: string | null;
  style: { backgroundColor: string };
  className: string;
}

const MOCK_EMPTY_NOTIFICATION: MockNotification = {
  textContent: null,
  style: { backgroundColor: "" },
  className: "",
};

interface MockOptionsHTMLValues {
  url: HTMLInputElement;
  contextWindow: HTMLInputElement;
  includeRecentMails: HTMLInputElement;
  apiToken: HTMLInputElement;
  otherOptions: HTMLInputElement;
  llmContext: HTMLInputElement;
}

export function mockDocumentQuerySelector(values: MockQuerySelectorValues): MockOptionsHTMLValues {
  const mockInputElements: MockOptionsHTMLValues = {
    url: { value: values.url } as HTMLInputElement,
    contextWindow: { value: values.contextWindow } as HTMLInputElement,
    includeRecentMails: { checked: values.includeRecentMails } as HTMLInputElement,
    apiToken: { value: values.apiToken } as HTMLInputElement,
    otherOptions: { value: values.otherOptions } as HTMLInputElement,
    llmContext: { value: values.llmContext } as HTMLInputElement,
  };

  document.querySelector = function (selector: string): HTMLInputElement | null {
    switch (selector) {
      case "#url":
        return mockInputElements.url;
      case "#context_window":
        return mockInputElements.contextWindow;
      case "#use_last_mails":
        return mockInputElements.includeRecentMails;
      case "#api_token":
        return mockInputElements.apiToken;
      case "#other_options":
        return mockInputElements.otherOptions;
      case "#llm_context":
        return mockInputElements.llmContext;
      default:
        throw Error(`Mock of querySelector for selector "${selector}" could not be found.`);
    }
  };

  return mockInputElements;
}

export function mockDocumentGetElementById(
  notification: MockNotification = { ...MOCK_EMPTY_NOTIFICATION },
): MockNotification {
  document.getElementById = function (id: string): HTMLElement | null {
    switch (id) {
      case "notification":
        return notification as HTMLElement;
      default:
        throw Error(`Mock of getElementById for id "${id}" could not be found.`);
    }
  };

  return notification;
}
