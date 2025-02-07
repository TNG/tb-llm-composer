export function getInputElement(selector: string): HTMLInputElement {
  const inputElement = document.querySelector(selector) as HTMLInputElement | null;
  if (!inputElement) {
    throw Error(`Selector "${selector}" could not be found. Contact devs`);
  }
  return inputElement;
}
