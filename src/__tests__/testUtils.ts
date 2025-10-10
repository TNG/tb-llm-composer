import { vi } from "vitest";
import {
  type LlmApiRequestMessage,
  type LlmChoice,
  LlmRoles,
  type LlmTextCompletionResponse,
  type TgiErrorResponse,
} from "../llmConnection";
import { DEFAULT_OPTIONS, type LlmParameters, type Options } from "../optionsParams";

import ComposeDetails = browser.compose.ComposeDetails;
import _CreateCreateProperties = browser.menus._CreateCreateProperties;

import type { LlmPluginAction } from "../llmButtonClickHandling";

const MOCK_IDENTITY_ID = "MOCK_IDENTITY_ID";
export const MOCK_TAB_DETAILS: browser.compose.ComposeDetails = { identityId: MOCK_IDENTITY_ID };
export const MOCK_USER_NAME = "MOCK_USER_NAME";

interface mockBrowserArgs {
  options?: Partial<Options>;
  params?: Partial<LlmParameters>;
  plainTextBody?: string;
  isPlainText?: boolean;
  composeDetailsType?: ComposeDetails["type"];
  signature?: string;
  subject?: string;
}

const localStore: { [key: string]: unknown } = {};
export let mockBrowserMenus: string[] = [];

const allShortcuts: { name: LlmPluginAction; shortcut: string }[] = [
  {
    name: "compose",
    shortcut: "Ctrl+Alt+L",
  },
  {
    name: "summarize",
    shortcut: "Ctrl+Alt+K",
  },
  {
    name: "cancel",
    shortcut: "Ctrl+Alt+C",
  },
];

export function mockBrowser(args: mockBrowserArgs) {
  mockBrowserMenus = [];
  // noinspection JSUnusedGlobalSymbols
  global.browser = {
    // @ts-ignore
    runtime: {
      // @ts-ignore
      getManifest: () => ({
        compose_action: {
          default_title: "To LLM (dev)",
          type: "menu",
          default_icon: {
            "64": "icons/icon-64px.png",
          },
        },
      }),
      lastError: undefined,
    },
    storage: {
      // @ts-ignore
      sync: {
        get: vi.fn().mockReturnValue(
          args.params || args.options
            ? {
                options: {
                  ...DEFAULT_OPTIONS,
                  ...args.options,
                  params: {
                    ...DEFAULT_OPTIONS.params,
                    ...args.options?.params,
                    ...args.params,
                  },
                },
              }
            : {},
        ),
        set: vi.fn(),
      },
      // @ts-ignore
      local: {
        // @ts-ignore
        get: async (key) => ({ [key]: localStore[key] }),
        set: async (items: { [key: string]: unknown }) => {
          for (const [k, v] of Object.entries(items)) {
            localStore[k] = v;
          }
        },
        // @ts-ignore
        remove: async (k: string) => {
          delete localStore[k];
        },
      },
    },
    // @ts-ignore
    identities: {
      get: vi.fn().mockReturnValue({ name: MOCK_USER_NAME, signature: args.signature }),
    },
    // @ts-ignore
    compose: {
      getComposeDetails: vi.fn().mockResolvedValue({
        identityId: MOCK_IDENTITY_ID,
        isPlainText: args.isPlainText !== false,
        plainTextBody: args.plainTextBody || undefined,
        type: args.composeDetailsType,
        subject: args.subject,
      }),
      setComposeDetails: vi.fn(),
    },
    // @ts-ignore
    composeAction: {
      disable: vi.fn(),
      setIcon: vi.fn(),
      enable: vi.fn(),
      setTitle: vi.fn(),
    },
    // @ts-ignore
    notifications: {
      create: vi.fn(),
    },
    // @ts-ignore
    menus: {
      removeAll: async () => {
        mockBrowserMenus = [];
      },
      create: mockMenuCreate,
    },
    // @ts-ignore
    commands: {
      getAll: async () => allShortcuts,
    },
  };
}

function mockMenuCreate(createProperties: _CreateCreateProperties, callback?: () => void) {
  console.log(`MENU: Called mocked menus.create function for '${createProperties.title}'. Executing callback...`);
  createProperties.id && mockBrowserMenus.push(createProperties.id);
  callback?.();
  return `mocked-menu-id-${createProperties.title}`;
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
    global.fetch = vi.fn().mockResolvedValue(errorResponse);

    return;
  }

  const fetchResponse: Partial<Response> = {
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(args.responseBody)),
  };
  global.fetch = vi.fn().mockResolvedValue(fetchResponse);
}

export function getMockResponseBody(firstChoiceContent?: string): LlmTextCompletionResponse {
  const firstChoice: LlmChoice = getMockLLMChoice(firstChoiceContent || "Test response", LlmRoles.SYSTEM);
  return {
    status: 1,
    id: "1",
    created: 1,
    model: "test_model",
    choices: [firstChoice],
    finish_reason: "stop_sequence",
  };
}

function getMockLLMChoice(content: string, role: LlmRoles): LlmChoice {
  return {
    message: { content, role },
    finish_reason: "stop_sequence",
    index: 0,
    logprobs: [0],
    prefill: [""],
  };
}

export function getExpectedRequestContent(
  messages: Array<LlmApiRequestMessage>,
  signal: AbortSignal,
  api_token?: string,
  params: Partial<LlmParameters> = {},
): unknown {
  const expectedRequestBody = {
    messages,
    ...DEFAULT_OPTIONS.params,
    ...params,
  };

  return {
    body: JSON.stringify(expectedRequestBody),
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: api_token ? `Bearer ${api_token}` : undefined,
    },
    method: "POST",
  };
}

export async function waitFor(
  expectation: () => void | Promise<void>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();
  let expectationSuccessful = false;
  while (!expectationSuccessful) {
    if (Date.now() - startTime >= timeout) {
      throw new Error("Timed out waiting for composer to update");
    }
    try {
      await expectation();
      expectationSuccessful = true;
    } catch (e) {
      console.warn("Expectation not met (yet)", e);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}
