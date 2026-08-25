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
import { continueReport, generateReport, type ReportRequest, rebuildSessionFromReport } from "../reportGeneration";

const abortSignal = new AbortController().signal;

const BASE_REQUEST: ReportRequest = {
  prompt: "Make me a todo list",
  days: 14,
  folderOnly: true,
  folder: { accountId: "a", path: "/INBOX" },
};

/** runAgenticLlm now returns the final text plus the full conversation. */
function agenticResult(report: string, messages: unknown[] = []) {
  return { report, messages };
}

describe("reportGeneration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00Z"));
    runAgenticLlmMock.mockReset().mockResolvedValue(agenticResult("Final report"));
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
    expect(maxSteps).toBe(20); // DEFAULT_OPTIONS.reportMaxSteps
    expect(messages[0].role).toBe("system");
    expect(messages.some((m: { content: string }) => m.content.includes("Make me a todo list"))).toBe(true);
    expect(
      messages.some((m: { content: string }) =>
        m.content.includes("Default date range (computed now): 2026-05-22 to 2026-06-05."),
      ),
    ).toBe(true);
    expect(messages.some((m: { content: string }) => m.content.includes("Report run date: 2026-06-05."))).toBe(true);
  });

  test("returns the report plus the conversation and scope for continuation", async () => {
    runAgenticLlmMock.mockResolvedValue(
      agenticResult("Final report", [{ role: "assistant", content: "Final report" }]),
    );
    const session = await generateReport(BASE_REQUEST, abortSignal);
    expect(session.report).toBe("Final report");
    expect(session.messages).toHaveLength(1);
    expect(session.scope).toMatchObject({ folderOnly: true, folder: { accountId: "a", path: "/INBOX" } });
  });

  test("continueReport appends the follow-up to the existing conversation", async () => {
    const priorMessages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "First report" },
    ] as unknown as Parameters<typeof continueReport>[0]["messages"];
    const scope = {
      folderOnly: true,
      folder: { accountId: "a", path: "/INBOX" },
      defaultDays: 14,
      maxSearchResults: 50,
      maxMessageBodies: 25,
      maxTotalBodyChars: 60000,
    };

    await continueReport({ messages: priorMessages, scope }, "Add deadlines", abortSignal);

    const [messages] = runAgenticLlmMock.mock.calls[0];
    // Prior turns are preserved and the new follow-up is appended.
    expect(messages.slice(0, 2)).toEqual(priorMessages);
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toContain("Add deadlines");
  });

  test("rebuilds a lost session with the displayed report as the last assistant turn", async () => {
    const session = await rebuildSessionFromReport(BASE_REQUEST, "Previous report body");

    const last = session.messages[session.messages.length - 1];
    expect(last).toEqual({ role: "assistant", content: "Previous report body" });
    expect(session.messages[0].role).toBe("system");
    // The scope the refinement inherits still matches the request.
    expect(session.scope).toMatchObject({
      folderOnly: true,
      folder: { accountId: "a", path: "/INBOX" },
      defaultDays: 14,
    });
    // Rebuilding is pure prompt assembly — it must not kick off an agentic run.
    expect(runAgenticLlmMock).not.toHaveBeenCalled();
  });

  test("strips <think> tags from the report by default", async () => {
    runAgenticLlmMock.mockResolvedValue(agenticResult("<think>reasoning</think>Clean report"));
    const session = await generateReport(BASE_REQUEST, abortSignal);
    expect(session.report).toBe("Clean report");
  });

  test("keeps <think> tags when strip_think_tag is disabled", async () => {
    vi.mocked(getPluginOptions).mockResolvedValue({
      reportMaxSteps: 8,
      reportMaxSearchResults: 50,
      strip_think_tag: false,
      // biome-ignore lint/suspicious/noExplicitAny: minimal options stub for the test
    } as any);
    runAgenticLlmMock.mockResolvedValue(agenticResult("<think>keep</think>Report"));

    const session = await generateReport(BASE_REQUEST, abortSignal);
    expect(session.report).toContain("<think>keep</think>");
  });
});
