export function getInputElement<T extends HTMLElement = HTMLInputElement>(selector: string): T {
  const inputElement = document.querySelector(selector) as T | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
}

export function getButtonElement(selector: string): HTMLButtonElement {
  const buttonElement = document.querySelector(selector) as HTMLButtonElement | null;
  if (!buttonElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return buttonElement;
}

/** Remove `<think>...</think>` reasoning blocks (including an unterminated trailing one) from LLM output. */
export function stripThinkTags(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ") // replace tags with a space to avoid word-merging
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n[ \t]+/g, "\n") // trim leading whitespace on each line
    .replace(/[ \t]+\n/g, "\n") // trim trailing whitespace on each line
    .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
    .trim();
}
