import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { runAgenticLlmMock, assertSearchCapabilitiesMock, createReportToolHandlersMock } = vi.hoisted(() => ({
  runAgenticLlmMock: vi.fn(),
  assertSearchCapabilitiesMock: vi.fn(),
  createReportToolHandlersMock: vi.fn(),
}));

vi.mock("../llmConnection", () => ({
  LlmRoles: { SYSTEM: "system", USER: "user", ASSISTANT: "assistant", TOOL: "tool" },
  runAgenticLlm: runAgenticLlmMock,
}));

vi.mock("../reportTools", () => ({
  assertSearchCapabilities: assertSearchCapabilitiesMock,
  createReportToolHandlers: createReportToolHandlersMock,
  reportToolDefinitions: [{ type: "function", function: { name: "search_messages" } }],
}));

vi.mock("../optionsParams", async () => {
  const actual = await vi.importActual<typeof import("../optionsParams")>("../optionsParams");
  return {
    ...actual,
    getPluginOptions: vi.fn(async () => ({ ...actual.DEFAULT_OPTIONS })),
  };
});

import { getPluginOptions } from "../optionsParams";
import { generateReport, type ReportRequest } from "../reportGeneration";

const abortSignal = new AbortController().signal;

const BASE_REQUEST: ReportRequest = {
  prompt: "Make me a todo list",
  days: 14,
  folderOnly: true,
  folder: { accountId: "a", path: "/INBOX" },
};

describe("reportGeneration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    runAgenticLlmMock.mockReset().mockResolvedValue("Final report");
    assertSearchCapabilitiesMock.mockReset().mockResolvedValue(undefined);
    createReportToolHandlersMock.mockReset().mockReturnValue({ search_messages: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getPluginOptions).mockReset?.();
  });

  test("validates search capabilities before running the loop", async () => {
    await generateReport(BASE_REQUEST, abortSignal);
    expect(assertSearchCapabilitiesMock).toHaveBeenCalledTimes(1);
  });

  test("throws (and does not run the loop) if search capabilities are missing", async () => {
    assertSearchCapabilitiesMock.mockRejectedValue(new Error("Email search is not available"));
    await expect(generateReport(BASE_REQUEST, abortSignal)).rejects.toThrow(/Email search is not available/);
    expect(runAgenticLlmMock).not.toHaveBeenCalled();
  });

  test("passes tools, handlers, abort signal and maxSteps to the agentic loop", async () => {
    await generateReport(BASE_REQUEST, abortSignal);

    expect(runAgenticLlmMock).toHaveBeenCalledTimes(1);
    const [messages, tools, handlers, signal, maxSteps] = runAgenticLlmMock.mock.calls[0];
    expect(tools).toEqual([{ type: "function", function: { name: "search_messages" } }]);
    expect(handlers).toEqual({ search_messages: expect.any(Function) });
    expect(signal).toBe(abortSignal);
    expect(maxSteps).toBe(8); // DEFAULT_OPTIONS.reportMaxSteps
    expect(messages[0].role).toBe("system");
    expect(messages.some((m: { content: string }) => m.content.includes("Make me a todo list"))).toBe(true);
    expect(
      messages.some((m: { content: string }) =>
        m.content.includes("Default date range (computed now): 2026-05-22 to 2026-06-05."),
      ),
    ).toBe(true);
    expect(messages.some((m: { content: string }) => m.content.includes("Report run date: 2026-06-05."))).toBe(true);
  });

  test("includes the prior report when refining", async () => {
    await generateReport({ ...BASE_REQUEST, priorReport: "PREVIOUS REPORT" }, abortSignal);
    const [messages] = runAgenticLlmMock.mock.calls[0];
    expect(messages.some((m: { content: string }) => m.content.includes("PREVIOUS REPORT"))).toBe(true);
  });

  test("strips <think> tags from the report by default", async () => {
    runAgenticLlmMock.mockResolvedValue("<think>reasoning</think>Clean report");
    const result = await generateReport(BASE_REQUEST, abortSignal);
    expect(result).toBe("Clean report");
  });

  test("keeps <think> tags when strip_think_tag is disabled", async () => {
    vi.mocked(getPluginOptions).mockResolvedValue({
      // biome-ignore lint/suspicious/noExplicitAny: minimal options stub for the test
    } as any);
    vi.mocked(getPluginOptions).mockResolvedValue({
      reportMaxSteps: 8,
      reportMaxSearchResults: 50,
      strip_think_tag: false,
      // biome-ignore lint/suspicious/noExplicitAny: minimal options stub for the test
    } as any);
    runAgenticLlmMock.mockResolvedValue("<think>keep</think>Report");

    const result = await generateReport(BASE_REQUEST, abortSignal);
    expect(result).toContain("<think>keep</think>");
  });
});
