import { getAllFolderPaths } from "./emailOrganising";
import { chatCompletionsEndpoint, modelsEndpoint } from "./endpointUrls";
import { hasEndpointPermission, requestEndpointPermission } from "./hostPermissions";
import { notifyOnError } from "./notifications";
import {
  type AdvancedPromptKey,
  DEFAULT_OPTIONS,
  type FeatureEndpointOverride,
  type FolderRule,
  getPluginOptions,
  LLM_FEATURES,
  type LlmFeature,
  type LlmParameters,
  type Options,
  type PreFilterRule,
  type ThinkTagFeature,
} from "./optionsParams";
import { PRE_FILTER_FIELDS, PRE_FILTER_OPERATORS, toPreFilterField, toPreFilterOperator } from "./preFilters";
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

/** System-prompt textareas: element id → stored option. Each has a reset button tagged `data-reset-prompt`. */
const PROMPT_FIELDS: ReadonlyArray<{ id: string; key: "llmContext" | "subjectContext" | AdvancedPromptKey }> = [
  { id: "llm_context", key: "llmContext" },
  { id: "subject_context", key: "subjectContext" },
  { id: "summary_context", key: "summaryContext" },
  { id: "organise_system_prompt", key: "organiseSystemPrompt" },
  { id: "report_system_prompt", key: "reportSystemPrompt" },
];

/** DOM controls of one endpoint configuration: the main API section or a per-feature override. */
interface EndpointControls {
  url: HTMLInputElement;
  token: HTMLInputElement;
  otherOptions: HTMLTextAreaElement;
  permissionStatus: HTMLElement | null;
  resolvedHint: HTMLElement | null;
  modelsStatus: HTMLElement | null;
  modelsList: HTMLElement | null;
  queryModelsBtn: HTMLButtonElement | null;
  /** Persist params chosen via the model picker. */
  saveParams: (params: LlmParameters) => Promise<void>;
}

/** A per-feature endpoint block: the shared endpoint controls plus its enable toggle and timeout. */
interface FeatureEndpointUi extends EndpointControls {
  block: HTMLElement;
  enabled: HTMLInputElement;
  timeout: HTMLInputElement;
}

const featureEndpointUis = new Map<LlmFeature, FeatureEndpointUi>();

function mainEndpointControls(): EndpointControls {
  return {
    url: getInputElement("#url"),
    token: getInputElement("#api_token"),
    otherOptions: getInputElement<HTMLTextAreaElement>("#other_options"),
    permissionStatus: document.querySelector<HTMLElement>("#url-permission-status"),
    resolvedHint: document.querySelector<HTMLElement>("#url-resolved-hint"),
    modelsStatus: document.querySelector<HTMLElement>("#models-status"),
    modelsList: document.querySelector<HTMLElement>("#models-list"),
    queryModelsBtn: document.querySelector<HTMLButtonElement>("#query-models-btn"),
    saveParams: (params) =>
      updateStoredOptions((options) => {
        options.params = params;
      }),
  };
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#show_advanced_options")?.addEventListener("change", updateShowAdvancedOptions);
document.querySelector("#url")?.addEventListener("change", updateUrl);
document
  .querySelector("#grant-access-btn")
  ?.addEventListener("click", () => grantEndpointAccess(mainEndpointControls()));
document.querySelector("#api_token")?.addEventListener("change", updateApiToken);
document.querySelector("#toggle-token-btn")?.addEventListener("click", (event) => {
  toggleTokenVisibility(getInputElement("#api_token"), event.currentTarget as HTMLButtonElement);
});
document.querySelector("#timeout")?.addEventListener("change", updateTimeout);
for (const { id, key } of PROMPT_FIELDS) {
  document.getElementById(id)?.addEventListener("change", (event) => updatePrompt(key, event));
  document.querySelector(`[data-reset-prompt="${id}"]`)?.addEventListener("click", () => resetPrompt(id, key));
}
document.querySelector("#use_last_mails")?.addEventListener("change", updateUseLastMails);
document.querySelector("#recent_mails_count")?.addEventListener("change", updateRecentMailsCount);
document.querySelector("#strip_think_tag")?.addEventListener("change", updateStripThinkTag);
for (const { feature, input } of stripThinkCheckboxes()) {
  input.addEventListener("change", () => updateFeatureStripThinkTag(feature, input));
}
document.querySelector("#context_window")?.addEventListener("change", updateContextWindow);
document.querySelector("#other_options")?.addEventListener("change", updateOtherOptions);
document.querySelector("#report_default_days")?.addEventListener("change", updateReportDefaultDays);
document.querySelector("#report_max_search_results")?.addEventListener("change", updateReportMaxSearchResults);
document.querySelector("#report_max_steps")?.addEventListener("change", updateReportMaxSteps);
document.querySelector("#report_max_message_bodies")?.addEventListener("change", updateReportMaxMessageBodies);
document.querySelector("#report_max_total_body_chars")?.addEventListener("change", updateReportMaxTotalBodyChars);
document.querySelector("#confirm_moves")?.addEventListener("change", updateConfirmMovesBeforeApplying);
document.querySelector("#report_disable_thinking")?.addEventListener("change", updateReportDisableThinking);
document.querySelector("#add-folder-rule-btn")?.addEventListener("click", addFolderRuleRow);
document.querySelector("#add-prefilter-rule-btn")?.addEventListener("click", addPreFilterRuleRow);
document.querySelector("#refresh-folder-paths-btn")?.addEventListener("click", refreshFolderPaths);
document
  .querySelector("#query-models-btn")
  ?.addEventListener("click", () => toggleAvailableModels(mainEndpointControls()));
setupFeatureEndpoints();

// ── Advanced options ──────────────────────────────────────────────────────────

/** Show/hide every `.advanced-only` element. */
function applyAdvancedVisibility(show: boolean): void {
  document.body.classList.toggle("show-advanced", show);
}

async function updateShowAdvancedOptions(event: Event) {
  const input = event.target as HTMLInputElement;
  applyAdvancedVisibility(input.checked);
  await updateStoredOptions((options) => {
    options.showAdvancedOptions = input.checked;
  });
}

async function updatePrompt(key: (typeof PROMPT_FIELDS)[number]["key"], event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  await updateStoredOptions((options) => {
    options[key] = textarea.value;
  });
}

/** Reset a prompt textarea to the shipped default and persist it. */
async function resetPrompt(id: string, key: (typeof PROMPT_FIELDS)[number]["key"]) {
  getInputElement<HTMLTextAreaElement>(`#${id}`).value = DEFAULT_OPTIONS[key];
  await updateStoredOptions((options) => {
    options[key] = DEFAULT_OPTIONS[key];
  });
}

// ── Main endpoint ─────────────────────────────────────────────────────────────

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
  const controls = mainEndpointControls();
  await updateUrlPermissionStatus(controls);
  updateResolvedUrlHint(controls);
}

async function updateApiToken(event: Event) {
  const apiTokenInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.api_token = apiTokenInput.value;
  });
}

async function updateTimeout(event: Event) {
  const timeoutMs = timeoutInputToMs(event.target as HTMLInputElement);
  await updateStoredOptions((options) => {
    options.timeout = timeoutMs;
  });
}

/** Seconds in the input → milliseconds, or undefined (no timeout) if 0 or empty. */
function timeoutInputToMs(input: HTMLInputElement): number | undefined {
  const seconds = input.valueAsNumber;
  return seconds > 0 ? seconds * 1000 : undefined;
}

function timeoutMsToInput(timeout: number | undefined): string {
  return timeout ? `${timeout / 1000}` : "";
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

// ── Shared endpoint controls ──────────────────────────────────────────────────

/**
 * The URL field accepts either the full chat route or just the API base, so show which URL the
 * plugin will actually POST to — otherwise a base URL looks like it was silently ignored.
 */
function updateResolvedUrlHint(controls: EndpointControls) {
  if (!controls.resolvedHint) return;
  const modelUrl = controls.url.value.trim();
  const resolved = chatCompletionsEndpoint(modelUrl);
  controls.resolvedHint.textContent = !modelUrl || resolved === modelUrl ? "" : `Requests go to ${resolved}`;
}

/**
 * Request the host permission for the endpoint URL. MV3 host permissions are opt-in and
 * permissions.request requires a real user-activation event — a button click qualifies (the
 * input's "change" event does not), so this is wired to the "Grant access" buttons.
 */
async function grantEndpointAccess(controls: EndpointControls) {
  const modelUrl = controls.url.value;
  if (!modelUrl) {
    await notifyOnError(async () => {
      throw new Error("Enter the LLM endpoint URL first.");
    });
    return;
  }
  const granted = await requestEndpointPermission(modelUrl);
  await updateUrlPermissionStatus(controls);
  if (!granted) {
    await notifyOnError(async () => {
      throw new Error("Permission to access this endpoint was not granted. The extension cannot reach the LLM.");
    });
  }
}

/**
 * Show whether the extension currently has host permission for the endpoint.
 * Renders as an icon-only badge (like the folder-existence badge); the wording shows on hover.
 */
async function updateUrlPermissionStatus(controls: EndpointControls) {
  const statusEl = controls.permissionStatus;
  if (!statusEl) return;
  const modelUrl = controls.url.value;
  if (!modelUrl) {
    statusEl.textContent = "";
    statusEl.title = "";
    return;
  }
  const granted = await hasEndpointPermission(modelUrl);
  statusEl.textContent = granted ? "✅" : "⚠️";
  statusEl.title = granted ? "Access granted" : 'Access not granted — click "Grant access".';
}

/** Toggle an api-token field between obscured (password) and revealed (text). */
function toggleTokenVisibility(tokenInput: HTMLInputElement, btn: HTMLButtonElement | null) {
  const revealed = tokenInput.type === "password";
  tokenInput.type = revealed ? "text" : "password";
  btn?.classList.toggle("revealed", revealed);
  btn?.setAttribute("aria-pressed", String(revealed));
  const label = revealed ? "Hide token" : "Show token";
  btn?.setAttribute("aria-label", label);
  btn?.setAttribute("title", label);
}

// ── Per-feature endpoints ─────────────────────────────────────────────────────

function emptyOverride(): FeatureEndpointOverride {
  return { enabled: false, model: "", params: {} };
}

/** Clone the endpoint template into every `.feature-endpoint-slot` and wire its controls. */
function setupFeatureEndpoints(): void {
  const template = document.querySelector<HTMLTemplateElement>("#feature-endpoint-template");
  if (!template) return;
  for (const slot of document.querySelectorAll<HTMLElement>(".feature-endpoint-slot")) {
    const feature = LLM_FEATURES.find((f) => f.value === slot.dataset.feature)?.value;
    const block = template.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    if (!feature || !block) continue;
    // Template ids are shared by every clone: prefix them (and their labels) with the feature.
    for (const el of block.querySelectorAll<HTMLElement>("[id]")) {
      el.id = `${feature}-${el.id}`;
    }
    for (const label of block.querySelectorAll<HTMLLabelElement>("label[for]")) {
      label.htmlFor = `${feature}-${label.htmlFor}`;
    }
    slot.replaceChildren(block);
    featureEndpointUis.set(feature, wireFeatureEndpoint(feature, block));
  }
}

function wireFeatureEndpoint(feature: LlmFeature, block: HTMLElement): FeatureEndpointUi {
  const q = <T extends Element>(selector: string) => block.querySelector<T>(selector) as T;
  const ui: FeatureEndpointUi = {
    block,
    enabled: q<HTMLInputElement>(".fe-enabled"),
    url: q<HTMLInputElement>(".fe-url"),
    token: q<HTMLInputElement>(".fe-token"),
    timeout: q<HTMLInputElement>(".fe-timeout"),
    otherOptions: q<HTMLTextAreaElement>(".fe-other-options"),
    permissionStatus: q<HTMLElement>(".fe-permission-status"),
    resolvedHint: q<HTMLElement>(".fe-url-hint"),
    modelsStatus: q<HTMLElement>(".fe-models-status"),
    modelsList: q<HTMLElement>(".fe-models-list"),
    queryModelsBtn: q<HTMLButtonElement>(".fe-query-models-btn"),
    saveParams: (params) =>
      updateFeatureEndpoint(feature, (override) => {
        override.params = params;
      }),
  };

  ui.enabled.addEventListener("change", () => toggleFeatureEndpoint(feature, ui));
  ui.url.addEventListener("change", async () => {
    await updateFeatureEndpoint(feature, (override) => {
      override.model = ui.url.value.trim();
    });
    await updateUrlPermissionStatus(ui);
    updateResolvedUrlHint(ui);
  });
  ui.token.addEventListener("change", () =>
    updateFeatureEndpoint(feature, (override) => {
      override.api_token = ui.token.value;
    }),
  );
  ui.timeout.addEventListener("change", () =>
    updateFeatureEndpoint(feature, (override) => {
      override.timeout = timeoutInputToMs(ui.timeout);
    }),
  );
  ui.otherOptions.addEventListener("change", () =>
    notifyOnError(async () => {
      const params = JSON.parse(ui.otherOptions.value);
      await updateFeatureEndpoint(feature, (override) => {
        override.params = params;
      });
    }),
  );
  q<HTMLButtonElement>(".fe-grant-btn").addEventListener("click", () => grantEndpointAccess(ui));
  const tokenToggle = q<HTMLButtonElement>(".fe-toggle-token-btn");
  tokenToggle.addEventListener("click", () => toggleTokenVisibility(ui.token, tokenToggle));
  ui.queryModelsBtn?.addEventListener("click", () => toggleAvailableModels(ui));
  return ui;
}

function updateFeatureEndpoint(feature: LlmFeature, mutate: (override: FeatureEndpointOverride) => void) {
  return updateStoredOptions((options) => {
    const override = { ...emptyOverride(), ...options.featureEndpoints?.[feature] };
    mutate(override);
    options.featureEndpoints = { ...options.featureEndpoints, [feature]: override };
  });
}

/** Enable/disable a feature's own endpoint; the first time, start from a copy of the main endpoint. */
async function toggleFeatureEndpoint(feature: LlmFeature, ui: FeatureEndpointUi) {
  const enabled = ui.enabled.checked;
  let updated: FeatureEndpointOverride | undefined;
  await updateStoredOptions((options) => {
    const override = { ...emptyOverride(), ...options.featureEndpoints?.[feature], enabled };
    if (enabled && !override.model.trim()) {
      override.model = options.model;
      override.api_token = options.api_token;
      override.timeout = options.timeout;
      override.params = { ...options.params };
    }
    options.featureEndpoints = { ...options.featureEndpoints, [feature]: override };
    updated = override;
  });
  if (updated) await renderFeatureEndpoint(ui, updated);
}

async function renderFeatureEndpoint(ui: FeatureEndpointUi, override: FeatureEndpointOverride) {
  ui.enabled.checked = override.enabled;
  ui.block.classList.toggle("enabled", override.enabled);
  ui.url.value = override.model;
  ui.token.value = override.api_token ?? "";
  ui.timeout.value = timeoutMsToInput(override.timeout);
  ui.otherOptions.value = JSON.stringify(override.params ?? {}, null, 2);
  updateResolvedUrlHint(ui);
  await updateUrlPermissionStatus(ui);
}

// ── Other settings ────────────────────────────────────────────────────────────

async function updateUseLastMails(event: Event) {
  const useLastMailsInput = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.include_recent_mails = useLastMailsInput.checked;
  });
}

async function updateRecentMailsCount(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < 1) {
    return;
  }
  await updateStoredOptions((options) => {
    options.recentMailsCount = Math.floor(value);
  });
}

async function updateStripThinkTag(event: Event) {
  const stripThinkTagInput = event.target as HTMLInputElement;
  let updated: Options | undefined;
  await updateStoredOptions((options) => {
    options.strip_think_tag = stripThinkTagInput.checked;
    updated = options;
  });
  // Per-feature checkboxes that were never set follow the global value.
  if (updated) renderStripThinkCheckboxes(updated);
}

/** Per-feature strip-<think> checkboxes (advanced mode), keyed by feature. */
function stripThinkCheckboxes(): Array<{ feature: ThinkTagFeature; input: HTMLInputElement }> {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input[data-strip-think-feature]")).map((input) => ({
    feature: input.dataset.stripThinkFeature as ThinkTagFeature,
    input,
  }));
}

/** Show each feature's own setting, or the global one where it was never set. */
function renderStripThinkCheckboxes(options: Options): void {
  for (const { feature, input } of stripThinkCheckboxes()) {
    input.checked = options.stripThinkTagByFeature?.[feature] ?? options.strip_think_tag ?? true;
  }
}

async function updateFeatureStripThinkTag(feature: ThinkTagFeature, input: HTMLInputElement) {
  await updateStoredOptions((options) => {
    options.stripThinkTagByFeature = { ...options.stripThinkTagByFeature, [feature]: input.checked };
  });
}

async function updateReportDisableThinking(event: Event) {
  const input = event.target as HTMLInputElement;
  await updateStoredOptions((options) => {
    options.reportDisableThinking = input.checked;
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

// ── Model discovery ────────────────────────────────────────────────────────────

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
async function queryAvailableModels(controls: EndpointControls): Promise<void> {
  const { modelsStatus: statusEl, modelsList: listEl } = controls;
  if (listEl) listEl.textContent = "";

  const chatUrl = controls.url.value.trim();
  if (!chatUrl) {
    if (statusEl) statusEl.textContent = "Enter the LLM endpoint URL first.";
    return;
  }

  const modelsUrl = modelsEndpoint(chatUrl);
  if (!(await hasEndpointPermission(modelsUrl))) {
    if (statusEl) statusEl.textContent = 'Access not granted — click "Grant access" above, then retry.';
    return;
  }

  if (statusEl) statusEl.textContent = "Querying models…";
  try {
    const apiToken = controls.token.value.trim();
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
    if (listEl) renderModelList(controls, models);
  } catch (e) {
    console.error("OPTIONS: Could not query models:", e);
    if (statusEl) statusEl.textContent = `Could not query models: ${(e as Error).message}`;
  }
}

/**
 * Accordion toggle for the models list: closed → fetch and show (button becomes "Hide…");
 * open → clear the list and reset the button label.
 */
async function toggleAvailableModels(controls: EndpointControls): Promise<void> {
  const { modelsList: listEl, queryModelsBtn: btn } = controls;
  if (listEl && listEl.childElementCount > 0) {
    collapseModelsList(controls);
    return;
  }
  await queryAvailableModels(controls);
  if (btn && listEl && listEl.childElementCount > 0) btn.textContent = "Hide available models";
}

/** Clear the models list and reset the query button to its collapsed state. */
function collapseModelsList(controls: EndpointControls): void {
  controls.modelsList?.replaceChildren();
  if (controls.modelsStatus) controls.modelsStatus.textContent = "";
  if (controls.queryModelsBtn) controls.queryModelsBtn.textContent = "Query available models";
}

/** Build a clickable list row (the whole row acts as the button — no inner button). */
function makeClickableRow(label: string, title: string, onActivate: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "model-row";
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.title = title;

  const id = document.createElement("span");
  id.className = "model-id";
  id.textContent = label;
  row.appendChild(id);

  row.addEventListener("click", onActivate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate();
    }
  });
  return row;
}

/** Render each discovered model as a clickable row that applies it. */
function renderModelList(controls: EndpointControls, models: string[]): void {
  controls.modelsList?.replaceChildren();
  for (const model of models) {
    controls.modelsList?.appendChild(
      makeClickableRow(model, `Use "${model}" (sets params.model in Other options)`, () => {
        // Selecting a model applies it and collapses the list (like picking an item from a menu).
        void applyModelToOtherOptions(controls, model);
        collapseModelsList(controls);
      }),
    );
  }
}

/** Upsert the chosen model into the "other options" JSON (params.model) and persist it. */
async function applyModelToOtherOptions(controls: EndpointControls, model: string): Promise<void> {
  await notifyOnError(async () => {
    let params: Record<string, unknown>;
    try {
      const parsed = JSON.parse(controls.otherOptions.value.trim() || "{}");
      params =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      // The textarea held invalid JSON; start from an empty object rather than failing.
      params = {};
    }
    params.model = model;
    controls.otherOptions.value = JSON.stringify(params, null, 2);
    await controls.saveParams(params);
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

  getInputElement("#show_advanced_options").checked = options.showAdvancedOptions;
  applyAdvancedVisibility(options.showAdvancedOptions);

  const main = mainEndpointControls();
  main.url.value = options.model;
  await updateUrlPermissionStatus(main);
  updateResolvedUrlHint(main);
  main.token.value = options.api_token || "";
  getInputElement("#timeout").value = timeoutMsToInput(options.timeout);
  getInputElement("#context_window").value = `${options.context_window}`;
  getInputElement("#use_last_mails").checked = options.include_recent_mails;
  getInputElement("#recent_mails_count").value = `${options.recentMailsCount}`;
  getInputElement("#strip_think_tag").checked = options.strip_think_tag ?? true;
  renderStripThinkCheckboxes(options);
  getInputElement("#confirm_moves").checked = options.confirmMovesBeforeApplying ?? true;
  main.otherOptions.value = JSON.stringify(options.params, null, 2);
  for (const { id, key } of PROMPT_FIELDS) {
    getInputElement<HTMLTextAreaElement>(`#${id}`).value = options[key];
  }
  getInputElement("#report_default_days").value = `${options.reportDefaultDays}`;
  getInputElement("#report_max_search_results").value = `${options.reportMaxSearchResults}`;
  getInputElement("#report_max_steps").value = `${options.reportMaxSteps}`;
  getInputElement("#report_max_message_bodies").value = `${options.reportMaxMessageBodies}`;
  getInputElement("#report_max_total_body_chars").value = `${options.reportMaxTotalBodyChars}`;
  getInputElement("#report_disable_thinking").checked = options.reportDisableThinking;
  for (const [feature, ui] of featureEndpointUis) {
    await renderFeatureEndpoint(ui, { ...emptyOverride(), ...options.featureEndpoints?.[feature] });
  }

  const list = document.querySelector("#folder-rules-list");
  const preFilterList = document.querySelector("#prefilter-rules-list");
  if (!list) return;
  list.innerHTML = "";
  if (preFilterList) preFilterList.innerHTML = "";

  await primeFolderPaths();

  for (const rule of options.folderSortingRules ?? []) {
    appendFolderRuleRow(rule.folderPath, rule.description);
  }
  for (const rule of options.preFilterRules ?? []) {
    appendPreFilterRuleRow(rule);
  }
}

// ── Folder path loading ───────────────────────────────────────────────────────

/** Folder paths offered in the folder dropdowns; `null` until the first successful load. */
let knownFolderPaths: string[] | null = null;

/** Button handler: reload folder paths (e.g. after creating a folder) and refresh every dropdown. */
async function refreshFolderPaths() {
  const statusEl = document.querySelector("#folder-paths-status");
  if (statusEl) statusEl.textContent = "Loading folders…";
  try {
    knownFolderPaths = await loadFolderPaths();
    if (statusEl) statusEl.textContent = `${knownFolderPaths.length} folder(s) found.`;
    refreshAllFolderSelects();
  } catch (e) {
    console.error("OPTIONS: Could not fetch folder paths:", e);
    if (statusEl) statusEl.textContent = `Could not load folders: ${(e as Error).message}`;
  }
}

/** On page load: fetch folder paths to fill the dropdowns. */
async function primeFolderPaths() {
  try {
    knownFolderPaths = await loadFolderPaths();
  } catch (e) {
    console.warn("OPTIONS: Could not prime folder paths:", e);
  }
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

/**
 * Fill a folder dropdown: an empty choice (`emptyLabel`), then every known folder. A stored path
 * that no longer exists stays selectable (flagged "not found") so it is not silently dropped.
 */
function fillFolderSelect(select: HTMLSelectElement, selected: string, emptyLabel: string): void {
  const paths = knownFolderPaths ?? [];
  const choices = [{ value: "", label: emptyLabel }, ...paths.map((path) => ({ value: path, label: path }))];
  if (selected && !paths.includes(selected)) {
    choices.push({ value: selected, label: knownFolderPaths ? `${selected} (not found)` : selected });
  }
  select.replaceChildren(
    ...choices.map((choice) => {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }),
  );
  select.value = selected;
}

function makeFolderSelect(className: string, selected: string, emptyLabel: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = className;
  select.dataset.emptyLabel = emptyLabel;
  fillFolderSelect(select, selected, emptyLabel);
  return select;
}

/** Re-fill every folder dropdown from `knownFolderPaths`, keeping each selection, and refresh badges. */
function refreshAllFolderSelects(): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>("select.folder-select")) {
    fillFolderSelect(select, select.value, select.dataset.emptyLabel ?? "");
    const badge = select.parentElement?.querySelector<HTMLSpanElement>(".folder-path-badge");
    if (badge) applyBadge(badge, select.value);
  }
}

/** Flag a selected folder that is missing from the mailbox (or that could not be checked yet). */
function applyBadge(badge: HTMLSpanElement, val: string) {
  if (!val || knownFolderPaths?.includes(val)) {
    badge.textContent = "";
    badge.title = "";
  } else if (!knownFolderPaths) {
    badge.textContent = "⏳";
    badge.title = 'Folder list not loaded — click "Reload folders".';
  } else {
    badge.textContent = "⚠️";
    badge.title = "Folder not found in your mailbox. Pick another one.";
  }
}

// ── Organise-folder rules ──────────────────────────────────────────────────────

function appendFolderRuleRow(folderPath = "", description = "") {
  const list = document.querySelector("#folder-rules-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "folder-rule-row";

  const pathSelect = makeFolderSelect("folder-select fr-path", folderPath, "Select a folder…");

  const badge = document.createElement("span");
  badge.className = "folder-path-badge";
  applyBadge(badge, folderPath);

  pathSelect.addEventListener("change", () => {
    applyBadge(badge, pathSelect.value);
    void saveFolderRules();
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
    void saveFolderRules();
  });

  row.appendChild(pathSelect);
  row.appendChild(badge);
  row.appendChild(descInput);
  row.appendChild(removeBtn);
  list.appendChild(row);
}

function addFolderRuleRow() {
  appendFolderRuleRow();
}

function collectFolderRules(): FolderRule[] {
  const rules: FolderRule[] = [];
  for (const row of document.querySelectorAll<HTMLDivElement>(".folder-rule-row")) {
    const folderPath = row.querySelector<HTMLSelectElement>(".fr-path")?.value ?? "";
    const description = row.querySelector<HTMLInputElement>(".description-input")?.value.trim() ?? "";
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

// ── Pre-filter rules ──────────────────────────────────────────────────────────
// Deterministic rules applied before classification; matched mail never reaches the LLM.

function makeSelect(className: string, choices: ReadonlyArray<{ value: string; label: string }>, selected: string) {
  const select = document.createElement("select");
  select.className = className;
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    select.appendChild(option);
  }
  select.value = selected;
  select.addEventListener("change", savePreFilterRules);
  return select;
}

function appendPreFilterRuleRow(rule: PreFilterRule) {
  const list = document.querySelector("#prefilter-rules-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "prefilter-rule-row";

  row.appendChild(makeSelect("pf-field", PRE_FILTER_FIELDS, toPreFilterField(rule.field)));
  row.appendChild(makeSelect("pf-operator", PRE_FILTER_OPERATORS, toPreFilterOperator(rule.operator)));

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "pf-value";
  valueInput.placeholder = "newsletter@example.com";
  valueInput.value = rule.value;
  valueInput.addEventListener("change", savePreFilterRules);
  row.appendChild(valueInput);

  const targetPath = rule.targetFolderPath.trim();
  const targetSelect = makeFolderSelect("folder-select pf-target", targetPath, "Keep in place");
  row.appendChild(targetSelect);

  const badge = document.createElement("span");
  badge.className = "folder-path-badge";
  applyBadge(badge, targetPath);
  row.appendChild(badge);

  targetSelect.addEventListener("change", () => {
    applyBadge(badge, targetSelect.value);
    void savePreFilterRules();
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-rule-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => {
    row.remove();
    void savePreFilterRules();
  });
  row.appendChild(removeBtn);

  list.appendChild(row);
}

function addPreFilterRuleRow() {
  appendPreFilterRuleRow({ field: "from", operator: "contains", value: "", targetFolderPath: "" });
}

function collectPreFilterRules(): PreFilterRule[] {
  const rules: PreFilterRule[] = [];
  for (const row of document.querySelectorAll<HTMLDivElement>(".prefilter-rule-row")) {
    const value = row.querySelector<HTMLInputElement>(".pf-value")?.value.trim() ?? "";
    // A rule with no value would match nothing (or everything, for "does not contain") — drop it.
    if (!value) continue;
    rules.push({
      field: toPreFilterField(row.querySelector<HTMLSelectElement>(".pf-field")?.value ?? ""),
      operator: toPreFilterOperator(row.querySelector<HTMLSelectElement>(".pf-operator")?.value ?? ""),
      value,
      targetFolderPath: row.querySelector<HTMLSelectElement>(".pf-target")?.value ?? "",
    });
  }
  return rules;
}

async function savePreFilterRules() {
  await notifyOnError(async () => {
    const rules = collectPreFilterRules();
    await updateStoredOptions((options) => {
      options.preFilterRules = rules;
    });
  });
}
