import { afterAll, describe, expect, test, vi } from "vitest";
import {
  type LlmApiRequestMessage,
  LlmRoles,
  type LlmToolDefinition,
  runAgenticLlm,
  sendContentToLlm,
} from "../llmConnection";
import { getMockResponseBody, mockBrowser, mockBrowserAndFetch } from "./testUtils";

const originalBrowser = global.browser;
const originalFetch = global.fetch;

const MOCK_CONTEXT: LlmApiRequestMessage = {
  content: "Test content",
  role: LlmRoles.SYSTEM,
};
const MOCK_PROMPT: LlmApiRequestMessage = {
  content: "Test prompt",
  role: LlmRoles.USER,
};
const MOCK_MODEL_URL = "https://mock.llm.test/v1/chat/completions";
const abortSignal = new AbortController().signal;

describe("Testing sentContentToLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test.each([[undefined], [""]])("throws if the model is %s", async (model) => {
    mockBrowserAndFetch({ responseBody: getMockResponseBody(), options: { model } });

    await expect(sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT], abortSignal)).rejects.toThrow(
      "Missing LLM model, set it in the options panel.",
    );
  });

  test("without token, ok response", async () => {
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({ responseBody: mockResponseBody, options: { model: MOCK_MODEL_URL } });

    const result = await sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT], abortSignal);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      MOCK_MODEL_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [MOCK_CONTEXT, MOCK_PROMPT] }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(mockResponseBody);
  });

  test("with token, ok response", async () => {
    const mockToken = "testToken";
    const mockResponseBody = getMockResponseBody();
    mockBrowserAndFetch({
      responseBody: mockResponseBody,
      options: { api_token: mockToken, model: MOCK_MODEL_URL },
    });

    const result = await sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT], abortSignal);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      MOCK_MODEL_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mockToken}` },
        body: JSON.stringify({ messages: [MOCK_CONTEXT, MOCK_PROMPT] }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(mockResponseBody);
  });

  test("error response", async () => {
    mockBrowserAndFetch({ responseBody: "NOT_OK_RESPONSE", options: { model: MOCK_MODEL_URL } });

    await expect(sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT], abortSignal)).rejects.toThrow(
      `LLM-CONNECTION: Error response from ${MOCK_MODEL_URL}: Error response from LLM API`,
    );
  });

  test("throws an actionable error and does not fetch when host permission is missing", async () => {
    mockBrowserAndFetch({ responseBody: getMockResponseBody(), options: { model: MOCK_MODEL_URL } });
    vi.mocked(global.browser.permissions.contains).mockResolvedValue(false);

    await expect(sendContentToLlm([MOCK_CONTEXT, MOCK_PROMPT], abortSignal)).rejects.toThrow(
      `Missing permission to access ${MOCK_MODEL_URL}`,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

const TOOLS: LlmToolDefinition[] = [
  {
    type: "function",
    function: { name: "search_messages", description: "search", parameters: { type: "object", properties: {} } },
  },
];

function okJson(body: unknown): Partial<Response> {
  return { ok: true, json: vi.fn().mockResolvedValue(body) };
}

function toolCallResponse(name: string, args: string) {
  return {
    id: "resp-tool",
    created: 1,
    model: "m",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name, arguments: args } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    finish_reason: "tool_calls",
  };
}

function finalResponse(content: string) {
  return {
    id: "resp-final",
    created: 1,
    model: "m",
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    finish_reason: "stop",
  };
}

describe("runAgenticLlm", () => {
  afterAll(() => {
    global.browser = originalBrowser;
    global.fetch = originalFetch;
  });

  test("executes tool calls and returns the final answer", async () => {
    mockBrowser({ options: { model: MOCK_MODEL_URL } });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okJson(toolCallResponse("search_messages", '{"query":"hi"}')))
      .mockResolvedValueOnce(okJson(finalResponse("All done")));

    const handler = vi.fn().mockResolvedValue([{ id: 1 }]);
    const result = await runAgenticLlm(
      [{ content: "do it", role: LlmRoles.USER }],
      TOOLS,
      { search_messages: handler },
      abortSignal,
      8,
    );

    expect(handler).toHaveBeenCalledWith({ query: "hi" });
    expect(result.report).toBe("All done");
    // The returned conversation ends with the final assistant answer (so it can be continued).
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: "All done" });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Second request must include the assistant tool-call message and the tool result.
    const secondBody = JSON.parse(vi.mocked(global.fetch).mock.calls[1][1]?.body as string);
    const roles = secondBody.messages.map((m: { role: string }) => m.role);
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
  });

  test("returns immediately when the model answers without tool calls", async () => {
    mockBrowser({ options: { model: MOCK_MODEL_URL } });
    global.fetch = vi.fn().mockResolvedValueOnce(okJson(finalResponse("Quick answer")));

    const result = await runAgenticLlm([{ content: "hi", role: LlmRoles.USER }], TOOLS, {}, abortSignal, 8);
    expect(result.report).toBe("Quick answer");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("throws when the endpoint rejects the tool-calling request", async () => {
    mockBrowser({ options: { model: MOCK_MODEL_URL } });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, text: async () => "tools unsupported" });

    await expect(runAgenticLlm([{ content: "hi", role: LlmRoles.USER }], TOOLS, {}, abortSignal, 8)).rejects.toThrow(
      /may not support tool calling/,
    );
  });

  test("throws after exceeding maxSteps without a final answer", async () => {
    mockBrowser({ options: { model: MOCK_MODEL_URL } });
    global.fetch = vi.fn().mockResolvedValue(okJson(toolCallResponse("search_messages", "{}")));

    const handler = vi.fn().mockResolvedValue([]);
    await expect(
      runAgenticLlm([{ content: "hi", role: LlmRoles.USER }], TOOLS, { search_messages: handler }, abortSignal, 2),
    ).rejects.toThrow(/maximum of 2 steps/);
  });
});
