/** Kind of answer an open point expects: pick one option, pick several, or free text. */
export type OpenPointType = "single" | "multi" | "text";

export interface OpenPoint {
  question: string;
  type: OpenPointType;
  options: string[];
}

export interface ConversationSummary {
  summary: string;
  openPoints: OpenPoint[];
}

/** The user's answer to one open point: chosen options and/or free text. */
export interface OpenPointAnswer {
  selected: string[];
  text: string;
}

/** JSON shape the summary prompt asks the model for. */
export const SUMMARY_JSON_SCHEMA =
  '{"summary": string, "openPoints": [{"question": string, "type": "single" | "multi" | "text", "options": string[]}]}';

function normaliseOpenPoint(value: unknown): OpenPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { question?: unknown; type?: unknown; options?: unknown };
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (!question) return undefined;
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim())
    : [];
  let type: OpenPointType = raw.type === "single" || raw.type === "multi" ? raw.type : "text";
  // A choice without at least two options is not a choice.
  if (type !== "text" && options.length < 2) type = "text";
  return { question, type, options: type === "text" ? [] : options };
}

/**
 * Parse the model's summary reply. Tolerates code fences and prose around the JSON object;
 * anything unparsable is shown as a plain summary without open points.
 */
export function parseSummaryResponse(content: string): ConversationSummary {
  const text = content.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; openPoints?: unknown };
      if (typeof parsed.summary === "string") {
        const openPoints = Array.isArray(parsed.openPoints)
          ? parsed.openPoints.map(normaliseOpenPoint).filter((p): p is OpenPoint => p !== undefined)
          : [];
        return { summary: parsed.summary.trim(), openPoints };
      }
    } catch {
      // fall through to the plain-text fallback
    }
  }
  return { summary: text.replace(/^```\w*\s*|\s*```$/g, "").trim(), openPoints: [] };
}

/**
 * Turn the user's answers into the instruction text written into the composer, which the regular
 * compose flow then expands into the reply. Unanswered points are left out.
 */
export function formatAnswerInstructions(
  openPoints: OpenPoint[],
  answers: OpenPointAnswer[],
  additionalInstructions: string,
): string {
  const lines: string[] = [];
  openPoints.forEach((point, index) => {
    const answer = answers[index];
    if (!answer) return;
    const parts = [...answer.selected];
    if (answer.text.trim()) parts.push(answer.text.trim());
    if (parts.length > 0) lines.push(`- ${point.question} → ${parts.join(", ")}`);
  });

  const extra = additionalInstructions.trim();
  const sections: string[] = [];
  if (lines.length > 0) sections.push(`Answer the open points as follows:\n${lines.join("\n")}`);
  if (extra) sections.push(extra);
  return sections.join("\n\n");
}
