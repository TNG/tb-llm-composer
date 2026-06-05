import { startKeepAlive, stopKeepAlive } from "./keepAlive";
import { getPluginOptions, type LlmParameters } from "./optionsParams";

export enum LlmRoles {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
}

/** An OpenAI-style tool call requested by the assistant. */
export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded arguments
  };
}

export interface LlmApiRequestMessage {
  content: string | null;
  role: LlmRoles;
  // Present on assistant messages that request tool calls
  tool_calls?: LlmToolCall[];
  // Present on tool-result messages
  tool_call_id?: string;
  name?: string;
}

/** OpenAI-style function tool definition advertised to the model. */
export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON schema
  };
}

/** Executes a tool call and returns a JSON-serialisable result. */
export type LlmToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface LlmApiRequestBody extends LlmParameters {
  messages: LlmApiRequestMessage[];
  tools?: LlmToolDefinition[];
  tool_choice?: "auto" | "none";
}

export interface InputToken {
  id: number;
  text: string;
  logprob?: number;
}

export interface TokensAndLogprobs {
  tokens: [string];
  token_logprobe: [number];
  text_offset: [number];
  top_logprobs?: [object];
}

export interface LlmChoice {
  message: {
    content: string | null;
    role: LlmRoles;
    tool_calls?: LlmToolCall[];
  };
  index: number;
  prefill: [string];
  logprobs: [number];
  finish_reason: FinishReason;
}

export interface LlmTextCompletionResponse {
  status: number;
  id: string;
  cached?: boolean;
  server_version?: string;
  object?: string;
  created: number;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: LlmChoice[];
  finish_reason: FinishReason;
  prefill?: [InputToken];
  logprobs?: TokensAndLogprobs;
}

type FinishReason = "length" | "eos_token" | "stop_sequence" | "error" | "tool_calls" | "stop";

export interface TgiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export async function sendContentToLlm(
  messages: Array<LlmApiRequestMessage>,
  abortSignal: AbortSignal,
): Promise<LlmTextCompletionResponse | TgiErrorResponse> {
  const options = await getPluginOptions();
  if (!options.model) {
    throw Error("Missing LLM model, set it in the options panel.");
  }

  const requestBody = {
    messages,
    ...options.params,
  };

  return callLlmApi(options.model, requestBody, abortSignal, options.api_token, options.timeout);
}

async function callLlmApi(
  url: string,
  requestBody: LlmApiRequestBody,
  signal: AbortSignal,
  token?: string,
  timeout?: number,
): Promise<LlmTextCompletionResponse | TgiErrorResponse> {
  const headers: { [key: string]: string } = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Create a combined abort controller for both user cancellation and timeout
  const combinedAbortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Listen to the user's abort signal
  const abortHandler = () => combinedAbortController.abort(signal.reason);
  signal.addEventListener("abort", abortHandler);
  // Handle signals that were already aborted before the listener was registered
  if (signal.aborted) {
    combinedAbortController.abort(signal.reason);
  }

  // Set up timeout if specified
  if (timeout !== undefined && timeout > 0) {
    timeoutId = setTimeout(() => {
      combinedAbortController.abort(
        new DOMException(
          `LLM request timed out after ${timeout / 1000} seconds. You can increase or disable the timeout in the extension settings.`,
          "TimeoutError",
        ),
      );
    }, timeout);
  }

  try {
    await startKeepAlive();
    console.log(`LLM-CONNECTION: Sending request to LLM: POST ${url} (body redacted)`);
    const response = await fetch(url, {
      signal: combinedAbortController.signal,
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorResponseBody = await response.text();
      throw Error(`LLM-CONNECTION: Error response from ${url}: ${errorResponseBody}`);
    }
    const responseBody = (await response.json()) as LlmTextCompletionResponse | TgiErrorResponse;
    console.log("LLM-CONNECTION: LLM responded with:", response.status, responseBody);

    return responseBody;
  } finally {
    // Synchronous cleanup first to guarantee it always runs
    signal.removeEventListener("abort", abortHandler);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    try {
      await stopKeepAlive();
    } catch (err) {
      console.error("LLM-CONNECTION: Error stopping keep-alive:", err);
    }
  }
}

export function isLlmTextCompletionResponse(response: LlmTextCompletionResponse | TgiErrorResponse) {
  return "id" in response;
}

/** Log per-call token usage and return the running total. */
function logTokenUsage(response: LlmTextCompletionResponse, runningTotal: number, step: number): number {
  const usage = response.usage;
  if (!usage) {
    console.log(`REPORT: step ${step} token usage unavailable (endpoint returned no 'usage')`);
    return runningTotal;
  }
  const total = runningTotal + (usage.total_tokens ?? 0);
  console.log(
    `REPORT: step ${step} tokens — prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} ` +
      `total=${usage.total_tokens} (run total=${total})`,
  );
  return total;
}

/**
 * Run an agentic chat-completion loop with tool calling. Posts the conversation plus tool
 * definitions, executes any requested tool calls via `toolHandlers`, and repeats until the
 * model returns a plain message or `maxSteps` is reached. Throws if the endpoint/model does
 * not support tool calling.
 */
export async function runAgenticLlm(
  messages: LlmApiRequestMessage[],
  tools: LlmToolDefinition[],
  toolHandlers: Record<string, LlmToolHandler>,
  abortSignal: AbortSignal,
  maxSteps: number,
): Promise<string> {
  const options = await getPluginOptions();
  if (!options.model) {
    throw Error("Missing LLM model, set it in the options panel.");
  }

  const conversation: LlmApiRequestMessage[] = [...messages];
  let totalTokens = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (abortSignal.aborted) {
      throw new DOMException("Report generation cancelled", "AbortError");
    }

    const requestBody: LlmApiRequestBody = {
      messages: conversation,
      tools,
      tool_choice: "auto",
      ...options.params,
    };

    console.log(
      `REPORT: step ${step}/${maxSteps} request with ${conversation.length} conversation message(s) and ${tools.length} tool(s)`,
    );

    let response: LlmTextCompletionResponse | TgiErrorResponse;
    try {
      response = await callLlmApi(options.model, requestBody, abortSignal, options.api_token, options.timeout);
    } catch (e) {
      if ((e as Error).name === "AbortError" || (e as Error).name === "TimeoutError") {
        throw e;
      }
      throw new Error(
        `LLM tool-calling request failed. Your endpoint/model may not support tool calling, which the report ` +
          `feature requires. Original error: ${(e as Error).message}`,
      );
    }

    if (!isLlmTextCompletionResponse(response)) {
      const errorResponse = response as TgiErrorResponse;
      throw new Error(
        `The LLM endpoint rejected the tool-calling request: ${errorResponse.error?.message ?? "unknown error"}. ` +
          `The report feature requires an endpoint/model that supports tool calling.`,
      );
    }

    const completion = response as LlmTextCompletionResponse;
    totalTokens = logTokenUsage(completion, totalTokens, step);

    const choice = Array.isArray(completion.choices) ? completion.choices[0] : undefined;
    if (!choice) {
      throw new Error("LLM response did not contain any choices.");
    }

    const toolCalls = choice.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Final answer.
      console.log(
        `REPORT: completed after ${step} step(s), ~${totalTokens} total tokens, finalChars=${choice.message?.content?.length ?? 0}`,
      );
      return choice.message?.content ?? "";
    }

    console.log(
      `REPORT: step ${step} requested ${toolCalls.length} tool call(s): ${toolCalls.map((t) => t.function.name).join(", ")}`,
    );

    // Append the assistant's tool-call request, then each tool result.
    conversation.push({
      role: LlmRoles.ASSISTANT,
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const handler = toolHandlers[toolCall.function.name];
      let resultContent: string;
      if (!handler) {
        console.warn(`REPORT: tool '${toolCall.function.name}' is not registered`);
        resultContent = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
      } else {
        try {
          const parsedArgs = parseToolArguments(toolCall.function.arguments);
          console.log(
            `REPORT: running tool '${toolCall.function.name}' with arg keys: ${Object.keys(parsedArgs).join(",") || "(none)"}`,
          );
          const result = await handler(parsedArgs);
          resultContent = JSON.stringify(result ?? null);
          console.log(`REPORT: tool '${toolCall.function.name}' completed (resultChars=${resultContent.length})`);
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          console.warn(`REPORT: tool '${toolCall.function.name}' failed:`, e);
          resultContent = JSON.stringify({ error: (e as Error).message });
        }
      }
      conversation.push({
        role: LlmRoles.TOOL,
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: resultContent,
      });
    }
  }

  console.warn(`REPORT: reached max steps (${maxSteps}) without a final answer`);

  throw new Error(
    `Report generation stopped after the maximum of ${maxSteps} steps without a final answer. ` +
      `Increase 'reportMaxSteps' in the options or simplify the request.`,
  );
}

/** Parse tool-call arguments JSON; tolerate an empty/whitespace string as no-args. */
function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Tool arguments were not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
