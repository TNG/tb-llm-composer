/**
 * Remembered sizes for the extension's popup windows (report window, organise confirmation).
 *
 * Thunderbird persists the size of extension popup windows itself and re-applies it *after* the
 * window is already on screen — in practice the resize only becomes visible at first paint or at the
 * first click. So whenever the size we ask for in `windows.create` differs from the one Thunderbird
 * has stored, the window visibly jumps. Re-asserting our size afterwards via `windows.update` does
 * not fix that; it just adds a second, even later resize.
 *
 * The fix is to stop disagreeing: remember the size the popup actually ends up with and request
 * exactly that one next time, so our request and Thunderbird's restore describe the same window.
 */

export interface PopupSize {
  width: number;
  height: number;
}

/** Identifies a popup so each window type remembers its own size. */
export type PopupName = "report" | "organiseConfirm";

const storageKey = (name: PopupName): string => `popupSize:${name}`;

// Guards against persisting a degenerate size (minimized/collapsed window) that we could never
// recover from, since it would be restored on every subsequent open.
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

/** The size to open `name` at: the remembered one, or `fallback` on first use. */
export async function getRememberedPopupSize(name: PopupName, fallback: PopupSize): Promise<PopupSize> {
  try {
    const key = storageKey(name);
    const stored = (await browser.storage.local.get(key))?.[key] as PopupSize | undefined;
    if (stored && stored.width >= MIN_WIDTH && stored.height >= MIN_HEIGHT) {
      return { width: Math.round(stored.width), height: Math.round(stored.height) };
    }
  } catch (e) {
    console.warn("POPUP-SIZE: could not read remembered size", e);
  }
  return fallback;
}

/**
 * Called from a popup page: record its size whenever it changes, so the next open starts there.
 * Debounced so a drag-resize writes once, and it also captures Thunderbird's own late restore.
 */
export function rememberPopupSize(name: PopupName): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    const size = { width: window.outerWidth, height: window.outerHeight };
    if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) return;
    void browser.storage.local.set({ [storageKey(name)]: size }).catch(() => {});
  };
  window.addEventListener("resize", () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
}
