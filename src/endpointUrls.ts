/**
 * Normalisation of the configured LLM endpoint URL.
 *
 * Users configure a single URL in the options page, and they enter it in whichever form their
 * provider documents: the full chat URL (`https://host/v1/chat/completions`), the API base
 * (`https://host/v1`), or something in between (`https://host/v1/chat`). All requests go to
 * OpenAI-style routes, so we derive the concrete route from whatever was entered instead of
 * forcing one spelling on the user.
 */

/** Split a URL into its path part and everything after it (`?query#hash`), which we keep verbatim. */
function splitSuffix(url: string): { base: string; suffix: string } {
  const match = /[?#]/.exec(url);
  return match ? { base: url.slice(0, match.index), suffix: url.slice(match.index) } : { base: url, suffix: "" };
}

/** Trim whitespace and drop trailing slashes, preserving any query string / fragment. */
function trimUrl(url: string): { base: string; suffix: string } {
  const { base, suffix } = splitSuffix(url.trim());
  return { base: base.replace(/\/+$/, ""), suffix };
}

/**
 * The chat-completions URL for the configured endpoint: appends the missing part when the user
 * entered only the API base (`…/v1`) or stopped at `…/v1/chat`, and leaves a complete URL alone.
 * A URL ending in the legacy `/completions` route is left untouched — that spelling is deliberate.
 */
export function chatCompletionsEndpoint(endpointUrl: string): string {
  const { base, suffix } = trimUrl(endpointUrl);
  if (!base) return endpointUrl.trim();
  if (/\/completions$/.test(base)) return base + suffix;
  if (/\/chat$/.test(base)) return `${base}/completions${suffix}`;
  return `${base}/chat/completions${suffix}`;
}

/**
 * The OpenAI-style `/models` URL for the configured endpoint: strips the chat route (preserving any
 * prefix, e.g. `/openai/v1`) and appends `/models`.
 */
export function modelsEndpoint(endpointUrl: string): string {
  const { base, suffix } = trimUrl(endpointUrl);
  if (!base) return endpointUrl.trim();
  const apiBase = base.replace(/\/chat\/completions$/, "").replace(/\/chat$/, "");
  return `${apiBase}/models${suffix}`;
}
