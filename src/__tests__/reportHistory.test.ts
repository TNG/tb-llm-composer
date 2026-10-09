import { describe, expect, test } from "vitest";
import { type LlmApiRequestMessage, LlmRoles } from "../llmConnection";
import { compactReportHistory } from "../reportHistory";

function toolResult(name: string, payload: unknown): LlmApiRequestMessage {
  return { role: LlmRoles.TOOL, name, tool_call_id: name, content: JSON.stringify(payload) };
}

const assistant: LlmApiRequestMessage = { role: LlmRoles.ASSISTANT, content: "" };

function bigSearch(): LlmApiRequestMessage {
  const hits = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    date: "2026-01-01T00:00Z",
    from: "a@b.c",
    to: [],
    subject: "s".repeat(300),
  }));
  return toolResult("search_messages", { hits, returned: hits.length, truncated: false });
}

function bigBodies(): LlmApiRequestMessage {
  const messages = [
    { id: 7, date: "2026-01-02T00:00Z", from: "Bob <b@x.com>", to: [], subject: "Plan", body: "x".repeat(40_000) },
  ];
  return toolResult("get_messages", { messages, skipped: [] });
}

describe("compactReportHistory", () => {
  test("leaves a small conversation untouched", () => {
    const conversation = [toolResult("search_messages", { hits: [{ id: 1 }] }), assistant, assistant, assistant];
    const before = structuredClone(conversation);
    compactReportHistory(conversation);
    expect(conversation).toEqual(before);
  });

  test("stubs old search results first and old bodies later, keeping ids and citation metadata", () => {
    const conversation: LlmApiRequestMessage[] = [bigSearch(), bigBodies()];
    for (let i = 0; i < 3; i++) conversation.push(assistant);
    compactReportHistory(conversation);

    expect(JSON.parse(conversation[0].content as string)).toMatchObject({ ids: expect.arrayContaining([0, 99]) });
    expect(conversation[0].content).toMatch(/compacted/);
    expect(conversation[1].content).not.toMatch(/compacted/); // bodies are younger than their age limit

    for (let i = 0; i < 3; i++) conversation.push(assistant);
    conversation.push(bigBodies(), bigSearch()); // keep the conversation above the size threshold
    compactReportHistory(conversation);
    expect(JSON.parse(conversation[1].content as string)).toMatchObject({
      messages: [{ id: 7, date: "2026-01-02T00:00Z", from: "Bob <b@x.com>", subject: "Plan" }],
    });
    expect(conversation[1].content).not.toContain("xxxx");
  });
});
