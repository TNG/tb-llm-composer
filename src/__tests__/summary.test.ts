import { describe, expect, test } from "vitest";
import { formatAnswerInstructions, type OpenPoint, parseSummaryResponse } from "../summary";

describe("parseSummaryResponse", () => {
  test("parses fenced JSON and normalises open points", () => {
    const content = `\`\`\`json
{"summary": " Meeting next week. ", "openPoints": [
  {"question": "Attend?", "type": "single", "options": ["Yes", "No"]},
  {"question": "Topics?", "type": "multi", "options": ["Budget", "Hiring", ""]},
  {"question": "Agenda ideas?", "type": "text", "options": ["ignored"]},
  {"question": "Only one option", "type": "single", "options": ["Yes"]},
  {"type": "single", "options": ["a", "b"]}
]}
\`\`\``;

    expect(parseSummaryResponse(content)).toEqual({
      summary: "Meeting next week.",
      openPoints: [
        { question: "Attend?", type: "single", options: ["Yes", "No"] },
        { question: "Topics?", type: "multi", options: ["Budget", "Hiring"] },
        { question: "Agenda ideas?", type: "text", options: [] },
        { question: "Only one option", type: "text", options: [] },
      ],
    });
  });

  test("falls back to the raw text when the reply is not JSON", () => {
    expect(parseSummaryResponse("Just a plain summary.")).toEqual({ summary: "Just a plain summary.", openPoints: [] });
  });

  test("falls back to the raw text when the JSON is invalid", () => {
    const content = "Summary {not json}";
    expect(parseSummaryResponse(content)).toEqual({ summary: content, openPoints: [] });
  });
});

describe("formatAnswerInstructions", () => {
  const points: OpenPoint[] = [
    { question: "Attend?", type: "single", options: ["Yes", "No"] },
    { question: "Topics?", type: "multi", options: ["Budget", "Hiring"] },
    { question: "Agenda ideas?", type: "text", options: [] },
  ];

  test("lists answered points and appends extra instructions", () => {
    const result = formatAnswerInstructions(
      points,
      [
        { selected: ["Yes"], text: "but only after 2pm" },
        { selected: [], text: "" },
        { selected: [], text: "Roadmap" },
      ],
      " Keep it short. ",
    );

    expect(result).toBe(
      "Answer the open points as follows:\n- Attend? → Yes, but only after 2pm\n- Agenda ideas? → Roadmap\n\nKeep it short.",
    );
  });

  test("returns an empty string when nothing was answered", () => {
    expect(formatAnswerInstructions(points, [], "")).toBe("");
  });
});
