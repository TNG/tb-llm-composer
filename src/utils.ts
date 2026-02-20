export function getInputElement(selector: string): HTMLInputElement {
  const inputElement = document.querySelector(selector) as HTMLInputElement | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
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
