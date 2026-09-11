import { describe, expect, it } from "vitest";
import type { LlmApiRequestBody, LlmTextCompletionResponse } from "../llmConnection";
import { LlmRoles } from "../llmConnection";
import { DEFAULT_OPTIONS, type Options } from "../optionsParams";
import { isTraceBuild, ReportTrace, withReportTrace } from "../reportTrace";

const OPTIONS: Options = { ...DEFAULT_OPTIONS, model: "https://llm.example/v1/chat/completions", api_token: "secret" };

const REQUEST = { prompt: "Weekly status for project Foo!", days: 7, folderOnly: false, folderPath: null };

function newTrace(): ReportTrace {
  return new ReportTrace("report", REQUEST, OPTIONS, Date.now());
}

function completion(content: string | null, totalTokens = 30): LlmTextCompletionResponse {
  return {
    id: "1",
    created: 0,
    model: "test-model",
    status: 200,
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: totalTokens },
    choices: [{ message: { content, role: LlmRoles.ASSISTANT }, index: 0, finish_reason: "stop" }],
  } as unknown as LlmTextCompletionResponse;
}

function requestBody(contents: string[]): LlmApiRequestBody {
  return {
    messages: contents.map((content) => ({ role: LlmRoles.USER, content })),
    tools: [{ type: "function", function: { name: "search_messages", description: "", parameters: {} } }],
    temperature: 0.2,
  };
}

describe("ReportTrace", () => {
  it("is compiled out unless webpack defines the trace flag", () => {
    expect(isTraceBuild()).toBe(false);
  });

  it("passes the run through untouched when tracing is off", async () => {
    const result = await withReportTrace("report", REQUEST, OPTIONS, async () => ({ report: "done" }));
    expect(result).toEqual({ report: "done" });
  });

  it("never records the API token", () => {
    const json = JSON.stringify(newTrace().toJson());
    expect(json).not.toContain("secret");
    expect((newTrace().toJson().options as Record<string, unknown>).hasApiToken).toBe(true);
  });

  it("records only the messages appended since the previous request", () => {
    const trace = newTrace();
    trace.llmRequest("https://llm.example", requestBody(["system", "first"]));
    trace.llmRequest("https://llm.example", requestBody(["system", "first", "second"]));

    const events = trace.toJson().events as Array<Record<string, unknown>>;
    expect((events[0].appendedMessages as unknown[]).length).toBe(2);
    expect(events[1].appendedMessages).toEqual([
      expect.objectContaining({ role: LlmRoles.USER, content: "second", chars: 6 }),
    ]);
    expect(events[1].conversationMessages).toBe(3);
    expect(events[0].tools).toEqual(["search_messages"]);
    expect((events[0].params as Record<string, unknown>).temperature).toBe(0.2);
  });

  it("totals calls, tokens and payload sizes across the run", () => {
    const trace = newTrace();
    trace.llmRequest("https://llm.example", requestBody(["ask"]));
    trace.llmResponse(completion(null), 120);
    trace.toolCall("search_messages", { query: "foo" });
    trace.toolResult("search_messages", '{"hits":3}');
    trace.llmRequest("https://llm.example", requestBody(["ask", "tool result"]));
    trace.llmResponse(completion("the report"), 200);
    trace.finish("success", { report: "the report" });

    const json = trace.toJson();
    expect(json.outcome).toBe("success");
    expect(json.report).toBe("the report");
    expect(json.totals).toEqual(
      expect.objectContaining({
        llmCalls: 2,
        toolCalls: 1,
        promptTokens: 40,
        completionTokens: 20,
        totalTokens: 60,
        responseChars: 320,
        toolResultChars: 10,
      }),
    );
  });

  it("marks an aborted run as cancelled and keeps the error message", () => {
    const trace = newTrace();
    trace.finish("cancelled", { error: new DOMException("Report generation cancelled", "AbortError") });
    expect(trace.toJson().outcome).toBe("cancelled");
    expect(trace.toJson().error).toBe("Report generation cancelled");
  });

  it("builds a file-system-safe slug from the prompt", () => {
    expect(newTrace().slug()).toBe("weekly-status-for-project-foo");
    expect(new ReportTrace("refine", { ...REQUEST, prompt: "!!!" }, OPTIONS, 0).slug()).toBe("report");
  });
});
