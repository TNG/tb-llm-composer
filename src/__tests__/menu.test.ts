import { describe, expect, test } from "vitest";
import type { LlmPluginAction } from "../llmButtonClickHandling";
import { cancelRequestMenuEntry, defaultMenuEntries } from "../menu";

describe("The menu configuration", () => {
  test.each([
    ...defaultMenuEntries,
    cancelRequestMenuEntry,
  ])("only has ids which match the LlmPluginAction type", (menuEntry) => {
    const allLlmActions: LlmPluginAction[] = ["compose", "summarize", "cancel"];
    expect(allLlmActions).toContain(menuEntry.id);
  });
});
