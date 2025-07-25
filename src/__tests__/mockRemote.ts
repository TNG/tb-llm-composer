import { vi } from "vitest";
import {
  type LlmApiRequestMessage,
  type LlmChoice,
  LlmRoles,
  type LlmTextCompletionResponse,
  type TgiErrorResponse,
} from "../llmConnection";
import { DEFAULT_OPTIONS, type LlmParameters } from "../optionsParams";
import type { MockResponse } from "vitest-fetch-mock";

interface mockBrowserAndFetchArgs extends mockBrowserArgs {
  responseBody: LlmTextCompletionResponse | TgiErrorResponse | "NOT_OK_RESPONSE";
}

export function mockBrowserAndFetch(args: mockBrowserAndFetchArgs): void {
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
    json: vi.fn().mockResolvedValue(args.responseBody),
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

export function setupSuccessLlmFetchMock(
  responseBody: LlmTextCompletionResponse | TgiErrorResponse,
  options: {
    expectedEndpoint?: string;
    expectedApiToken?: string;
    delayResponseMs?: number;
  },
): void {
  fetchMock.mockResponse(async (req: Request): Promise<MockResponse> => {
    if (req.method !== "POST") {
      return {
        status: 405,
        body: `Mock fetch method ${req.method} not allowed`,
      };
    }
    // todo: always check url but use a default one
    if (options.expectedEndpoint && req.url !== options.expectedEndpoint) {
      return {
        status: 404,
        body: `Mock fetch url ${req.url} not known`,
      };
    }
    // todo: always check api token but use a default one
    if (options.expectedApiToken && req.headers.get("Authorization") !== `Bearer ${options.expectedApiToken}`) {
      return {
        status: 401,
        body: `Mock fetch auth failed (all headers: ${req.headers})`,
      };
    }
    if (req.headers.get("Content-Type") !== "application/json") {
      return {
        status: 400,
        body: `Mock fetch failed, missing or wrong content-type (all headers: ${req.headers})`,
      };
    }
    if (options.delayResponseMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayResponseMs));
    }
    return {
      status: 200,
      body: JSON.stringify(responseBody),
    };
  });
}
