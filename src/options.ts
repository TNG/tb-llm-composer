import { getAllFolderPaths } from "./emailOrganising";
import { hasEndpointPermission, requestEndpointPermission } from "./hostPermissions";
import { notifyOnError } from "./notifications";
import { type FolderRule, getPluginOptions, type Options } from "./optionsParams";
import { getInputElement } from "./utils";

type GetFolderPathsMessage = {
  type: "get-folder-paths";
};

/**
 * Serialize read-modify-write updates to the stored options. Each field writer fires on a "change"
 * event, and several can overlap (e.g. tabbing quickly between fields); without serialization two
 * updates could both read the same options, then each write it back and clobber the other's field.
 * Every mutation runs as one link of this chain: it reads the latest options, applies its change,
 * then writes — only after the previous update has finished.
 */
let optionsWriteChain: Promise<void> = Promise.resolve();

function updateStoredOptions(mutate: (options: Options) => void | Promise<void>): Promise<void> {
  const run = optionsWriteChain.then(async () => {
    const options = await getPluginOptions();
    await mutate(options);
    await browser.storage.sync.set({ options });
  });
  // Keep the chain alive even if one mutation rejects, so later updates still run.
  optionsWriteChain = run.catch(() => {});
  return run;
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#url")?.addEventListener("change", updateUrl);
document.querySelector("#grant-access-btn")?.addEventListener("click", grantEndpointAccess);
document.querySelector("#api_token")?.addEventListener("change", updateApiToken);
document.querySelector("#toggle-token-btn")?.addEventListener("click", toggleTokenVisibility);
document.querySelector("#timeout")?.addEventListener("change", updateTimeout);
document.querySelector("#llm_context")?.addEventListener("change", updateLlmContext);
document.querySelector("#subject_context")?.addEventListener("change", updateSubjectContext);
document.querySelector("#use_last_mails")?.addEventListener("change", updateUseLastMails);
document.querySelector("#strip_think_tag")?.addEventListener("change", updateStripThinkTag);
document.querySelector("#context_window")?.addEventListener("change", updateContextWindow);
document.querySelector("#other_options")?.addEventListener("change", updateOtherOptions);
document.querySelector("#report_default_days")?.addEventListener("change", updateReportDefaultDays);
document.querySelector("#report_max_search_results")?.addEventListener("change", updateReportMaxSearchResults);
document.querySelector("#report_max_steps")?.addEventListener("change", updateReportMaxSteps);
document.querySelector("#report_max_message_bodies")?.addEventListener("change", updateReportMaxMessageBodies);
document.querySelector("#report_max_total_body_chars")?.addEventListener("change", updateReportMaxTotalBodyChars);
document.querySelector("#confirm_moves")?.addEventListener("change", updateConfirmMovesBeforeApplying);
document.querySelector("#add-folder-rule-btn")?.addEventListener("click", addFolderRuleRow);
document.querySelector("#refresh-folder-paths-btn")?.addEventListener("click", toggleFolderPaths);
document.querySelector("#query-models-btn")?.addEventListener("click", toggleAvailableModels);

async function updateUrl(event: Event) {
  await notifyOnError(async () => {
    const modelUrlInput = event.target as HTMLInputElement;
    if (!modelUrlInput.value) {
      throw new Error("Invalid value: Model URL cannot be empty");
    }
    await updateStoredOptions((options) => {
      options.model = modelUrlInput.value;
    });
  });
  // Reflect whether this (possibly new) endpoint origin is already permitted.
  await updateUrlPermissionStatus();
}

/**
 * Request the host permission for the current endpoint URL. MV3 host permissions are opt-in and
 * permissions.request requires a real user-activation event — a button click qualifies (the
 * input's "change" event does not), so this is wired to the "Grant access" button.
 */
async function grantEndpointAccess() {
  const modelUrl = getInputElement("#url").value;
  if (!modelUrl) {
    await notifyOnError(async () => {
      throw new Error("Enter the LLM endpoint URL first.");
    });
    return;
  }
  const granted = await requestEndpointPermission(modelUrl);
  await updateUrlPermissionStatus();
  if (!granted) {
    await notifyOnError(async () => {
      throw new Error("Permission to access this endpoint was not granted. The extension cannot reach the LLM.");
    });
  }
}

/**
 * Show whether the extension currently has host permission for the configured endpoint.
 * Renders as an icon-only badge (like the folder-existence badge); the wording shows on hover.
 */
async function updateUrlPermissionStatus() {
  const statusEl = document.querySelector<HTMLElement>("#url-permission-status");
  if (!statusEl) return;
  const modelUrl = getInputElement("#url").value;
  if (!modelUrl) {
    statusEl.textContent = "";
    statusEl.title = "";
    return;
  }
  const granted = await hasEndpointPermission(modelUrl);
  statusEl.textContent = granted ? "✅" : "⚠️";
  statusEl.title = granted ? "Access granted" : 'Access not granted — click "Grant access".';
}

/** Toggle the api-token field between obscured (password) and revealed (text). */
function toggleTokenVisibility() {
  const tokenInput = getInputElement("#api_token");
  const btn = document.querySelector<HTMLButtonElement>("#toggle-token-btn");
  const revealed = tokenInput.type === "password";
  tokenInput.type = revealed ? "text" : "password";
  btn?.classList.toggle("revealed", revealed);
  btn?.setAttribute("aria-pressed", String(revealed));
  const label = revealed ? "Hide token" : "Show token";
  btn?.setAttribute("aria-label", label);
  btn?.setAttribute("title", label);
}

async function updateApiToken(event: Event) {
  const apiTokenInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.api_token = apiTokenInput.value;
  });
}

async function updateTimeout(event: Event) {
  const timeoutInput = event.target as HTMLInputElement;
  const timeoutSeconds = timeoutInput.valueAsNumber;
  await updateStoredOptions((options) => {
    // Convert seconds to milliseconds, or set to undefined if 0 or empty
    options.timeout = timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined;
  });
}

async function updateLlmContext(event: Event) {
  const llmContextInput = event.target as HTMLTextAreaElement;
  await updateStoredOptions((options) => {
    options.llmContext = llmContextInput.value;
  });
}

async function updateSubjectContext(event: Event) {
  const subjectContextInput = event.target as HTMLTextAreaElement;
  await updateStoredOptions((options) => {
    options.subjectContext = subjectContextInput.value;
  });
}

async function updateUseLastMails(event: Event) {
  const useLastMailsInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.include_recent_mails = useLastMailsInput.checked;
  });
}

async function updateStripThinkTag(event: Event) {
  const stripThinkTagInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.strip_think_tag = stripThinkTagInput.checked;
  });
}

async function updateConfirmMovesBeforeApplying(event: Event) {
  const input = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.confirmMovesBeforeApplying = input.checked;
  });
}

async function updateContextWindow(event: Event) {
  const contextWindowInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.context_window = contextWindowInput.valueAsNumber;
  });
}

async function updateOtherOptions(event: Event) {
  await notifyOnError(async () => {
    const otherOptionsElement = event.target as HTMLTextAreaElement;
    const params = JSON.parse(otherOptionsElement.value);
    await updateStoredOptions((options) => {
      options.params = params;
    });
  });
}

// ── Model discovery ────────────────────────────────────────────────────────────

/**
 * Derive the OpenAI-style `/models` endpoint from the configured chat URL. A standard chat URL
 * ends in `/chat/completions`; we swap that for `/models`, preserving any prefix (e.g. `/openai/v1`).
 * Otherwise we treat the URL as the API base and append `/models`.
 */
function deriveModelsEndpoint(chatUrl: string): string {
  const trimmed = chatUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/, "/models");
  }
  return `${trimmed}/models`;
}

/** Extract model ids from an OpenAI-style models response (`{data:[{id}]}`), tolerating variants. */
function extractModelIds(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? ((body as { data: unknown[] }).data as unknown[])
      : [];
  const ids = list
    .map((entry) => (typeof entry === "string" ? entry : ((entry as { id?: unknown })?.id ?? "")))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

/** Query the endpoint's available models and render them, each with a button to apply it. */
async function queryAvailableModels(): Promise<void> {
  const statusEl = document.querySelector("#models-status");
  const listEl = document.querySelector("#models-list");
  if (listEl) listEl.textContent = "";

  const chatUrl = getInputElement("#url").value.trim();
  if (!chatUrl) {
    if (statusEl) statusEl.textContent = "Enter the LLM endpoint URL first.";
    return;
  }

  const modelsUrl = deriveModelsEndpoint(chatUrl);
  if (!(await hasEndpointPermission(modelsUrl))) {
    if (statusEl) statusEl.textContent = 'Access not granted — click "Grant access" above, then retry.';
    return;
  }

  if (statusEl) statusEl.textContent = "Querying models…";
  try {
    const apiToken = getInputElement("#api_token").value.trim();
    const headers: Record<string, string> = {};
    if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

    const response = await fetch(modelsUrl, { headers });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const models = extractModelIds(await response.json());
    if (statusEl) {
      statusEl.textContent = models.length ? `${models.length} model(s) found.` : "No models returned by the endpoint.";
    }
    if (listEl) renderModelList(listEl, models);
  } catch (e) {
    console.error("OPTIONS: Could not query models:", e);
    if (statusEl) statusEl.textContent = `Could not query models: ${(e as Error).message}`;
  }
}

/**
 * Accordion toggle for the models list: closed → fetch and show (button becomes "Hide…");
 * open → clear the list and reset the button label.
 */
async function toggleAvailableModels(): Promise<void> {
  const listEl = document.querySelector("#models-list");
  const btn = document.querySelector<HTMLButtonElement>("#query-models-btn");
  if (listEl && listEl.childElementCount > 0) {
    collapseModelsList();
    return;
  }
  await queryAvailableModels();
  if (btn && listEl && listEl.childElementCount > 0) btn.textContent = "Hide available models";
}

/** Clear the models list and reset the query button to its collapsed state. */
function collapseModelsList(): void {
  document.querySelector("#models-list")?.replaceChildren();
  const statusEl = document.querySelector("#models-status");
  if (statusEl) statusEl.textContent = "";
  const btn = document.querySelector<HTMLButtonElement>("#query-models-btn");
  if (btn) btn.textContent = "Query available models";
}

/**
 * Build a clickable list row (the whole row acts as the button — no inner button) with the given
 * label and an activation handler that also receives the row (used for in-row feedback).
 */
function makeClickableRow(label: string, title: string, onActivate: (row: HTMLElement) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.title = title;

  const id = document.createElement("span");
  id.className = "model-id";
  id.textContent = label;
  row.appendChild(id);

  const activate = () => onActivate(row);
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  return row;
}

/** Render each discovered model as a clickable row that applies it. */
function renderModelList(container: Element, models: string[]): void {
  container.replaceChildren();
  for (const model of models) {
    container.appendChild(
      makeClickableRow(model, `Use "${model}" (sets params.model in Other options)`, () => {
        // Selecting a model applies it and collapses the list (like picking an item from a menu).
        void applyModelToOtherOptions(model);
        collapseModelsList();
      }),
    );
  }
}

/** Upsert the chosen model into the "other options" JSON (params.model) and persist it. */
async function applyModelToOtherOptions(model: string): Promise<void> {
  await notifyOnError(async () => {
    const otherOptionsEl = getInputElement("#other_options");
    let params: Record<string, unknown>;
    try {
      const parsed = JSON.parse(otherOptionsEl.value.trim() || "{}");
      params =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      // The textarea held invalid JSON; start from an empty object rather than failing.
      params = {};
    }
    params.model = model;
    otherOptionsEl.value = JSON.stringify(params, null, 2);

    await updateStoredOptions((options) => {
      options.params = params;
    });
  });
}

/** Persist a positive-integer numeric option, ignoring empty/invalid input. */
async function updatePositiveIntOption(
  event: Event,
  key:
    | "reportDefaultDays"
    | "reportMaxSearchResults"
    | "reportMaxSteps"
    | "reportMaxMessageBodies"
    | "reportMaxTotalBodyChars",
) {
  const input = event.target as HTMLInputElement;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < 1) {
    return;
  }
  await updateStoredOptions((options) => {
    options[key] = Math.floor(value);
  });
}

async function updateReportDefaultDays(event: Event) {
  await updatePositiveIntOption(event, "reportDefaultDays");
}

async function updateReportMaxSearchResults(event: Event) {
  await updatePositiveIntOption(event, "reportMaxSearchResults");
}

async function updateReportMaxSteps(event: Event) {
  await updatePositiveIntOption(event, "reportMaxSteps");
}

async function updateReportMaxMessageBodies(event: Event) {
  await updatePositiveIntOption(event, "reportMaxMessageBodies");
}

async function updateReportMaxTotalBodyChars(event: Event) {
  await updatePositiveIntOption(event, "reportMaxTotalBodyChars");
}

export async function restoreOptions(): Promise<void> {
  const options = await getPluginOptions();

  getInputElement("#url").value = options.model;
  await updateUrlPermissionStatus();
  getInputElement("#api_token").value = options.api_token || "";
  getInputElement("#timeout").value = options.timeout ? `${options.timeout / 1000}` : "";
  getInputElement("#context_window").value = `${options.context_window}`;
  getInputElement("#use_last_mails").checked = options.include_recent_mails;
  getInputElement("#strip_think_tag").checked = options.strip_think_tag ?? true;
  getInputElement("#confirm_moves").checked = options.confirmMovesBeforeApplying ?? true;
  getInputElement("#other_options").value = JSON.stringify(options.params, null, 2);
  getInputElement("#llm_context").value = options.llmContext;
  getInputElement("#subject_context").value = options.subjectContext;
  getInputElement("#report_default_days").value = `${options.reportDefaultDays}`;
  getInputElement("#report_max_search_results").value = `${options.reportMaxSearchResults}`;
  getInputElement("#report_max_steps").value = `${options.reportMaxSteps}`;
  getInputElement("#report_max_message_bodies").value = `${options.reportMaxMessageBodies}`;
  getInputElement("#report_max_total_body_chars").value = `${options.reportMaxTotalBodyChars}`;

  const rules = options.folderSortingRules ?? [];
  const list = document.querySelector("#folder-rules-list");
  if (!list) return;
  list.innerHTML = "";

  await primeFolderPaths();

  const knownPaths = getKnownPaths();
  for (const rule of rules) {
    appendFolderRuleRow(rule.folderPath, rule.description, knownPaths);
  }
}

// ── Folder path loading ───────────────────────────────────────────────────────

function getKnownPaths(): string[] {
  const dl = document.querySelector<HTMLDataListElement>("#folder-paths-datalist");
  return dl ? Array.from(dl.options).map((o) => o.value) : [];
}

/** Button handler: (re)fetch folder paths and render them as a copyable list (like the models list). */
async function refreshFolderPaths() {
  const statusEl = document.querySelector("#folder-paths-status");
  const availableEl = document.querySelector("#available-folder-paths");
  if (statusEl) statusEl.textContent = "Loading folder paths…";
  if (availableEl) availableEl.replaceChildren();

  try {
    const paths = await loadFolderPaths();
    populateFolderDatalist(paths);
    if (statusEl) statusEl.textContent = `${paths.length} folder(s) found.`;
    if (availableEl) renderAvailablePaths(availableEl, paths);
    revalidateAllRows(paths);
  } catch (e) {
    console.error("OPTIONS: Could not fetch folder paths:", e);
    if (statusEl) statusEl.textContent = `Could not load folder paths: ${(e as Error).message}`;
  }
}

/**
 * Accordion toggle for the folder-paths list: closed → fetch and show (button becomes "Hide…");
 * open → clear the list and reset the button label.
 */
async function toggleFolderPaths(): Promise<void> {
  const listEl = document.querySelector("#available-folder-paths");
  const statusEl = document.querySelector("#folder-paths-status");
  const btn = document.querySelector<HTMLButtonElement>("#refresh-folder-paths-btn");
  if (listEl && listEl.childElementCount > 0) {
    listEl.replaceChildren();
    if (statusEl) statusEl.textContent = "";
    if (btn) btn.textContent = "Show available folder paths";
    return;
  }
  await refreshFolderPaths();
  if (btn && listEl && listEl.childElementCount > 0) btn.textContent = "Hide available folder paths";
}

/** On page load: fetch folder paths only to power rule autocomplete + validation (no visible list). */
async function primeFolderPaths() {
  try {
    const paths = await loadFolderPaths();
    populateFolderDatalist(paths);
    revalidateAllRows(paths);
  } catch (e) {
    console.warn("OPTIONS: Could not prime folder paths:", e);
  }
}

/** Populate the hidden datalist backing folder-path autocomplete in the rule inputs. */
function populateFolderDatalist(paths: string[]): void {
  let dl = document.querySelector<HTMLDataListElement>("#folder-paths-datalist");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "folder-paths-datalist";
    document.body.appendChild(dl);
  }
  dl.replaceChildren();
  for (const path of paths) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path;
    dl.appendChild(option);
  }
}

/** Render the available folder paths as clickable rows (styled like the models list); clicking copies the path. */
function renderAvailablePaths(container: Element, paths: string[]): void {
  container.replaceChildren();
  for (const path of paths) {
    container.appendChild(makeClickableRow(path, `Copy "${path}"`, (row) => copyPathToClipboard(path, row)));
  }
}

/** Copy a folder path to the clipboard and briefly show a "Copied!" flag on the row. */
async function copyPathToClipboard(path: string, row: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    console.warn("OPTIONS: Clipboard API unavailable; could not copy folder path.");
    return;
  }
  row.querySelector(".copied-flag")?.remove();
  const flag = document.createElement("span");
  flag.className = "copied-flag";
  flag.textContent = "Copied!";
  row.appendChild(flag);
  setTimeout(() => flag.remove(), 1200);
}

async function loadFolderPaths(): Promise<string[]> {
  try {
    return await getAllFolderPaths();
  } catch (directError) {
    console.warn("OPTIONS: Direct folder-path lookup failed, trying background fallback:", directError);
  }

  const response = await browser.runtime.sendMessage({ type: "get-folder-paths" } as GetFolderPathsMessage);
  if (!Array.isArray(response) || response.some((path) => typeof path !== "string")) {
    throw new Error("Invalid folder path response from background script.");
  }
  return response;
}

function revalidateAllRows(knownPaths: string[]) {
  for (const row of document.querySelectorAll<HTMLDivElement>(".folder-rule-row")) {
    const pathInput = row.querySelector<HTMLInputElement>("input");
    const badge = row.querySelector<HTMLSpanElement>(".folder-path-badge");
    if (pathInput && badge) applyBadge(badge, pathInput.value.trim(), knownPaths);
  }
}

// ── Organise-folder rules ──────────────────────────────────────────────────────

function applyBadge(badge: HTMLSpanElement, val: string, knownPaths: string[]) {
  if (!val) {
    badge.textContent = "";
    badge.title = "";
  } else if (knownPaths.length === 0) {
    badge.textContent = "⏳";
    badge.title = "Folder list not yet loaded";
  } else if (knownPaths.includes(val)) {
    badge.textContent = "✅";
    badge.title = "Folder found";
  } else {
    badge.textContent = "⚠️";
    badge.title = `Path not found in your mailbox.\nCheck the "Available folder paths" list below.`;
  }
}

function appendFolderRuleRow(folderPath = "", description = "", knownPaths: string[] = []) {
  const list = document.querySelector("#folder-rules-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "folder-rule-row";

  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.setAttribute("list", "folder-paths-datalist");
  pathInput.placeholder = "/INBOX/Work";
  pathInput.value = folderPath;

  const badge = document.createElement("span");
  badge.className = "folder-path-badge";
  applyBadge(badge, folderPath, knownPaths);

  pathInput.addEventListener("input", () => {
    applyBadge(badge, pathInput.value.trim(), getKnownPaths());
  });
  pathInput.addEventListener("change", () => {
    applyBadge(badge, pathInput.value.trim(), getKnownPaths());
    saveFolderRules();
  });

  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "description-input";
  descInput.placeholder = "Emails about work projects";
  descInput.value = description;
  descInput.addEventListener("change", saveFolderRules);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-rule-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => {
    row.remove();
    saveFolderRules();
  });

  row.appendChild(pathInput);
  row.appendChild(badge);
  row.appendChild(descInput);
  row.appendChild(removeBtn);
  list.appendChild(row);
}

function addFolderRuleRow() {
  appendFolderRuleRow("", "", getKnownPaths());
}

function collectFolderRules(): FolderRule[] {
  const rows = document.querySelectorAll<HTMLDivElement>(".folder-rule-row");
  const rules: FolderRule[] = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll<HTMLInputElement>("input");
    const folderPath = inputs[0]?.value.trim() ?? "";
    const description = inputs[1]?.value.trim() ?? "";
    if (folderPath) {
      rules.push({ folderPath, description });
    }
  }
  return rules;
}

async function saveFolderRules() {
  await notifyOnError(async () => {
    const rules = collectFolderRules();
    await updateStoredOptions((options) => {
      options.folderSortingRules = rules;
    });
  });
}
