// Persistence for reusable report prompts, stored in browser.storage.sync (so they roam
// across a user's devices) — save a prompt you like and re-load it in a later report run.
//
// Storage layout: STORAGE_KEY holds a small index (the list of prompt names), and each
// prompt body lives under its own `${BODY_KEY_PREFIX}${name}` entry. This keeps every sync
// item small, so a long prompt (or many of them) never overflows the per-item byte quota
// that a single array-under-one-key would hit.

export interface SavedPrompt {
  name: string;
  text: string;
}

const STORAGE_KEY = "reportPrompts";
const BODY_KEY_PREFIX = "reportPrompt:";

function bodyKey(name: string): string {
  return `${BODY_KEY_PREFIX}${name}`;
}

/** Return all saved prompts, sorted by name. Never throws; returns [] when none are stored. */
export async function getSavedPrompts(): Promise<SavedPrompt[]> {
  const index = (await browser.storage.sync.get(STORAGE_KEY))?.[STORAGE_KEY];
  const names = Array.isArray(index) ? index.filter((n): n is string => typeof n === "string") : [];
  if (names.length === 0) {
    return [];
  }
  const bodies = await browser.storage.sync.get(names.map(bodyKey));
  return names
    .map((name) => ({ name, text: bodies?.[bodyKey(name)] }))
    .filter((p): p is SavedPrompt => typeof p.text === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Insert or overwrite the prompt with the given name; returns the updated, sorted list. */
export async function savePrompt(name: string, text: string): Promise<SavedPrompt[]> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("A prompt name is required.");
  }
  const prompts = (await getSavedPrompts()).filter((p) => p.name !== trimmedName);
  prompts.push({ name: trimmedName, text });
  prompts.sort((a, b) => a.name.localeCompare(b.name));
  await browser.storage.sync.set({
    [STORAGE_KEY]: prompts.map((p) => p.name),
    [bodyKey(trimmedName)]: text,
  });
  return prompts;
}

/** Remove the prompt with the given name; returns the updated list. */
export async function deletePrompt(name: string): Promise<SavedPrompt[]> {
  const prompts = (await getSavedPrompts()).filter((p) => p.name !== name);
  await browser.storage.sync.set({ [STORAGE_KEY]: prompts.map((p) => p.name) });
  await browser.storage.sync.remove(bodyKey(name));
  return prompts;
}
