import { vi } from "vitest";
import type { LlmPluginAction } from "../llmButtonClickHandling";
import { DEFAULT_OPTIONS, type LlmParameters, type Options } from "../optionsParams";

import { MOCK_MODEL_URL, MOCK_TOKEN, useFetchMock } from "./useFetchMock";

import ComposeDetails = browser.compose.ComposeDetails;
import _CreateCreateProperties = browser.menus._CreateCreateProperties;

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

/**
 * Mock the browser global variable and the fetch function using {@link useFetchMock}.
 *
 * @param args Customize/overwrite specific browser attributes. By default, the plugins model and token options are set
 * to {@link MOCK_MODEL_URL} and {@link MOCK_TOKEN} in order to automatically match the requests specified in the
 * mockResponses folder
 * @param mockNames The names of the mock request/response pairs maintained in the mcokResponses folder.
 */
export function mockBrowserAndFetch(args: mockBrowserArgs, ...mockNames: string[]) {
  useFetchMock(...mockNames);
  mockBrowser({
    ...args,
    options: {
      model: MOCK_MODEL_URL,
      api_token: MOCK_TOKEN,
      ...args.options,
    },
  });
}

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
