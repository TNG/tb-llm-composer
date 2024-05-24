import { DEFAULT_PROMPT, getSignatureInstructions, LlmRoles } from "../llmConnection";
import { defaultOptions, LlmParameters, Options } from "../optionUtils";

const DEFAULT_TEST_SIGNATURE = "Test User Signature";

interface expectRequestContentArgs {
  content?: string;
  systemContext?: string;
  options?: Partial<Options>;
  params?: Partial<LlmParameters>;
}

interface mockBrowserAndFetchArgs extends expectRequestContentArgs {
  notOKResponse?: true;
  isPlainText?: boolean;
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
          content: (args.systemContext ?? defaultOptions.llmContext) + getSignatureInstructions(DEFAULT_TEST_SIGNATURE),
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

export function mockBrowser(args: mockBrowserAndFetchArgs) {
  global.browser = {
    storage: {
      // @ts-ignore
      sync: {
        get: jest
          .fn()
          .mockReturnValue(
            args.params || args.options
              ? { options: { ...defaultOptions, ...args.options, params: { ...defaultOptions.params, ...args.params } } }
              : {},
          ),
      },
    },
    // @ts-ignore
    identities: { get: jest.fn().mockReturnValue({ signature: DEFAULT_TEST_SIGNATURE }) },
    // @ts-ignore
    compose: {
      getComposeDetails: jest.fn().mockResolvedValue({ isPlainText: args.isPlainText !== false }),
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
  const expectedRequestBody = {
    messages: [
      {
        content: (args.systemContext ?? defaultOptions.llmContext) + getSignatureInstructions(DEFAULT_TEST_SIGNATURE),
        role: LlmRoles.SYSTEM,
      },
      { content: args.content ?? DEFAULT_PROMPT, role: LlmRoles.USER },
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
