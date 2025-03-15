import { describe, expect, test } from "vitest";
import type { LlmPluginAction } from "../llmButtonClickHandling";
import { menuEntries } from "../menu";

describe("The menu configuration", () => {
  test.each(menuEntries)("only has ids which match the LlmPluginAction type", (menuEntry) => {
    const allLlmActions: LlmPluginAction[] = ["compose", "summarize"];
    expect(allLlmActions).toContain(menuEntry.id);
  });
});
