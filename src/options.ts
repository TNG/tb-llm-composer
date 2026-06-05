import { getAllFolderPaths } from "./emailOrganising";
import { notifyOnError } from "./notifications";
import { type FolderRule, getPluginOptions } from "./optionsParams";
import { getInputElement } from "./utils";

type GetFolderPathsMessage = {
  type: "get-folder-paths";
};

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("#url")?.addEventListener("change", updateUrl);
document.querySelector("#api_token")?.addEventListener("change", updateApiToken);
document.querySelector("#timeout")?.addEventListener("change", updateTimeout);
document.querySelector("#llm_context")?.addEventListener("change", updateLlmContext);
document.querySelector("#use_last_mails")?.addEventListener("change", updateUseLastMails);
document.querySelector("#strip_think_tag")?.addEventListener("change", updateStripThinkTag);
document.querySelector("#context_window")?.addEventListener("change", updateContextWindow);
document.querySelector("#other_options")?.addEventListener("change", updateOtherOptions);
document.querySelector("#add-folder-rule-btn")?.addEventListener("click", addFolderRuleRow);
document.querySelector("#refresh-folder-paths-btn")?.addEventListener("click", refreshFolderPaths);

async function updateUrl(event: Event) {
  await notifyOnError(async () => {
    const modelUrlInput = event.target as HTMLInputElement;
    if (!modelUrlInput.value) {
      throw new Error("Invalid value: Model URL cannot be empty");
    }
    const options = await getPluginOptions();
    options.model = modelUrlInput.value;
    await browser.storage.sync.set({ options });
  });
}

async function updateApiToken(event: Event) {
  const apiTokenInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.api_token = apiTokenInput.value;
  await browser.storage.sync.set({ options });
}

async function updateTimeout(event: Event) {
  const timeoutInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  const timeoutSeconds = timeoutInput.valueAsNumber;
  // Convert seconds to milliseconds, or set to undefined if 0 or empty
  options.timeout = timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined;
  await browser.storage.sync.set({ options });
}

async function updateLlmContext(event: Event) {
  const llmContextInput = event.target as HTMLTextAreaElement;
  const options = await getPluginOptions();
  options.llmContext = llmContextInput.value;
  await browser.storage.sync.set({ options });
}

async function updateUseLastMails(event: Event) {
  const useLastMailsInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.include_recent_mails = useLastMailsInput.checked;
  await browser.storage.sync.set({ options });
}

async function updateStripThinkTag(event: Event) {
  const stripThinkTagInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.strip_think_tag = stripThinkTagInput.checked;
  await browser.storage.sync.set({ options });
}

async function updateContextWindow(event: Event) {
  const contextWindowInput = event.target as HTMLInputElement;
  const options = await getPluginOptions();
  options.context_window = contextWindowInput.valueAsNumber;
  await browser.storage.sync.set({ options });
}

async function updateOtherOptions(event: Event) {
  await notifyOnError(async () => {
    const otherOptionsElement = event.target as HTMLTextAreaElement;
    const options = await getPluginOptions();
    options.params = JSON.parse(otherOptionsElement.value);
    await browser.storage.sync.set({ options });
  });
}

export async function restoreOptions(): Promise<void> {
  const options = await getPluginOptions();

  getInputElement("#url").value = options.model;
  getInputElement("#api_token").value = options.api_token || "";
  getInputElement("#timeout").value = options.timeout ? `${options.timeout / 1000}` : "";
  getInputElement("#context_window").value = `${options.context_window}`;
  getInputElement("#use_last_mails").checked = options.include_recent_mails;
  getInputElement("#strip_think_tag").checked = options.strip_think_tag ?? true;
  getInputElement("#other_options").value = JSON.stringify(options.params, null, 2);
  getInputElement("#llm_context").value = options.llmContext;

  const rules = options.folderSortingRules ?? [];
  const list = document.querySelector("#folder-rules-list");
  if (!list) return;
  list.innerHTML = "";

  await refreshFolderPaths();

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

async function refreshFolderPaths() {
  const statusEl = document.querySelector("#folder-paths-status");
  const availableEl = document.querySelector("#available-folder-paths");
  if (statusEl) statusEl.textContent = "Loading folder paths...";
  if (availableEl) availableEl.textContent = "";

  try {
    const paths = await loadFolderPaths();

    // Populate datalist for autocomplete
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

    if (statusEl) statusEl.textContent = `${paths.length} folder(s) found.`;
    if (availableEl) availableEl.textContent = paths.join("\n");

    // Re-validate any existing rows
    revalidateAllRows(paths);
  } catch (e) {
    console.error("OPTIONS: Could not fetch folder paths:", e);
    if (statusEl) statusEl.textContent = `Could not load folder paths: ${(e as Error).message}`;
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
    const options = await getPluginOptions();
    options.folderSortingRules = collectFolderRules();
    await browser.storage.sync.set({ options });
  });
}
