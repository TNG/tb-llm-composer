import { DEFAULT_PROMPT, LlmRoles } from "../llmConnection";
import { defaultOptions, LlmParameters, Options } from "../optionUtils";
import ComposeDetails = browser.compose.ComposeDetails;

interface expectRequestContentArgs {
  content?: string;
  previousConversation?: string;
  systemContext?: string;
  options?: Partial<Options>;
  params?: Partial<LlmParameters>;
}

interface mockBrowserAndFetchArgs extends expectRequestContentArgs {
  notOKResponse?: true;
  isPlainText?: boolean;
  signature?: string;
  plainTextBody?: string;
  composeDetailsType?: ComposeDetails["type"];
}

export function mockBrowserAndFetch(args: mockBrowserAndFetchArgs = {}) {
  mockBrowser(args);

  if (args.notOKResponse) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: jest.fn().mockReturnValue("Test Error response"),
    });
    return;
  } else {
    const fetchResponse = {
      messages: [
        {
          content: args.systemContext ?? defaultOptions.llmContext,
          role: LlmRoles.SYSTEM,
        },
        { content: args.content ?? DEFAULT_PROMPT, role: LlmRoles.USER },
        { content: "Generic Test Reply", role: LlmRoles.SYSTEM },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(fetchResponse),
    });

    return fetchResponse;
  }
}

const localStore: {[key: string]: any} = {}

export function mockBrowser(args: mockBrowserAndFetchArgs) {
  global.browser = {
    storage: {
      // @ts-ignore
      sync: {
        get: jest.fn().mockReturnValue(
          args.params || args.options
            ? {
                options: {
                  ...defaultOptions,
                  ...args.options,
                  params: { ...defaultOptions.params, ...args.options?.params, ...args.params },
                },
              }
            : {},
        ),
        set: jest.fn(),
      },
      // @ts-ignore
      local: {
        // @ts-ignore
        get: async (key) => ({[key]: localStore[key]}),
        set: async (items: {[key: string]: any}) => {
          Object.entries(items).forEach(([k, v]) => localStore[k] = v)
        },
        // @ts-ignore
        remove: async (k) => {delete localStore[k]}
      }
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

export function getExpectedRequestContent(args: expectRequestContentArgs = {}) {
  let content = args.content
    ? "This is what the user wants to be in its reply, everything must be included explicitly:\n" + args.content
    : "";
  if (args.previousConversation) {
    content +=
      "\nThis is the conversation the user is replying to, keep the content in mind but do not include them in your suggestion:\n" +
      args.previousConversation;
  }
  if (content === "") {
    content = DEFAULT_PROMPT;
  }

  const expectedRequestBody = {
    messages: [
      {
        content: args.systemContext ?? defaultOptions.llmContext,
        role: LlmRoles.SYSTEM,
      },
      { content, role: LlmRoles.USER },
    ],
    ...defaultOptions.params,
    ...args.params,
  };

  return {
    body: JSON.stringify(expectedRequestBody),
    headers: {
      "Content-Type": "application/json",
      Authorization: args.options?.api_token ? `Bearer ${args.options.api_token}` : undefined,
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

export function mockDocumentGetElementById(notification: MockNotification = { ...MOCK_EMPTY_NOTIFICATION }): MockNotification {
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
