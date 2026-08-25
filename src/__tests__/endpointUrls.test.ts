import { describe, expect, test } from "vitest";
import { chatCompletionsEndpoint, modelsEndpoint } from "../endpointUrls";

describe("chatCompletionsEndpoint", () => {
  test("leaves a full chat URL untouched", () => {
    expect(chatCompletionsEndpoint("https://my-llm.com/v1/chat/completions")).toEqual(
      "https://my-llm.com/v1/chat/completions",
    );
  });

  test("appends the chat route to a plain API base", () => {
    expect(chatCompletionsEndpoint("https://my-llm.com/v1")).toEqual("https://my-llm.com/v1/chat/completions");
  });

  test("appends the chat route to an origin without a path", () => {
    expect(chatCompletionsEndpoint("https://my-llm.com")).toEqual("https://my-llm.com/chat/completions");
  });

  test("completes a URL that stops at /chat", () => {
    expect(chatCompletionsEndpoint("https://my-llm.com/openai/v1/chat")).toEqual(
      "https://my-llm.com/openai/v1/chat/completions",
    );
  });

  test("ignores trailing slashes and surrounding whitespace", () => {
    expect(chatCompletionsEndpoint("  https://my-llm.com/v1//  ")).toEqual("https://my-llm.com/v1/chat/completions");
    expect(chatCompletionsEndpoint("https://my-llm.com/v1/chat/completions/")).toEqual(
      "https://my-llm.com/v1/chat/completions",
    );
  });

  test("keeps a deliberately configured legacy /completions route", () => {
    expect(chatCompletionsEndpoint("https://my-llm.com/v1/completions")).toEqual("https://my-llm.com/v1/completions");
  });

  test("preserves a query string (e.g. Azure's api-version)", () => {
    expect(chatCompletionsEndpoint("https://x.openai.azure.com/openai/deployments/gpt?api-version=2024-02-01")).toEqual(
      "https://x.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-02-01",
    );
  });

  test("returns an empty string unchanged", () => {
    expect(chatCompletionsEndpoint("   ")).toEqual("");
  });
});

describe("modelsEndpoint", () => {
  test("swaps the chat route for /models, preserving the prefix", () => {
    expect(modelsEndpoint("https://my-llm.com/openai/v1/chat/completions")).toEqual(
      "https://my-llm.com/openai/v1/models",
    );
  });

  test("appends /models to a plain API base", () => {
    expect(modelsEndpoint("https://my-llm.com/v1/")).toEqual("https://my-llm.com/v1/models");
  });

  test("strips a trailing /chat", () => {
    expect(modelsEndpoint("https://my-llm.com/v1/chat")).toEqual("https://my-llm.com/v1/models");
  });

  test("strips the legacy /completions route", () => {
    expect(modelsEndpoint("https://my-llm.com/v1/completions")).toEqual("https://my-llm.com/v1/models");
  });

  test("preserves a query string", () => {
    expect(modelsEndpoint("https://my-llm.com/v1/chat/completions?api-version=2024-02-01")).toEqual(
      "https://my-llm.com/v1/models?api-version=2024-02-01",
    );
  });
});
