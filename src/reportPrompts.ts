// Persistence for reusable report prompts, stored in browser.storage.sync (so they roam
// across a user's devices) — save a prompt you like and re-load it in a later report run.

export interface SavedPrompt {
  name: string;
  text: string;
}

const STORAGE_KEY = "reportPrompts";

/** Return all saved prompts, sorted by name. Never throws; returns [] when none are stored. */
export async function getSavedPrompts(): Promise<SavedPrompt[]> {
  const stored = (await browser.storage.sync.get(STORAGE_KEY))?.[STORAGE_KEY];
  if (!Array.isArray(stored)) {
    return [];
  }
  return (stored as SavedPrompt[])
    .filter((p) => p && typeof p.name === "string" && typeof p.text === "string")
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
  await browser.storage.sync.set({ [STORAGE_KEY]: prompts });
  return prompts;
}

/** Remove the prompt with the given name; returns the updated list. */
export async function deletePrompt(name: string): Promise<SavedPrompt[]> {
  const prompts = (await getSavedPrompts()).filter((p) => p.name !== name);
  await browser.storage.sync.set({ [STORAGE_KEY]: prompts });
  return prompts;
}
