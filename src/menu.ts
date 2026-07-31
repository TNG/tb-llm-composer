import _LastError = browser.runtime._LastError;
import Tab = browser.tabs.Tab;
import OnClickData = browser.menus.OnClickData;

import { executeLlmAction, type LlmPluginAction } from "./llmButtonClickHandling";

export const defaultMenuEntries: browser.menus._CreateCreateProperties[] = [
  {
    id: "summarize",
    contexts: ["compose_action_menu"],
    title: "Summarize",
    enabled: true,
  },
  {
    id: "compose",
    contexts: ["compose_action_menu"],
    title: "Compose",
    enabled: true,
  },
];

// Toolbar action menu, shown in the main mail window. Native menu entries so it
// looks identical to the compose_action menu (Summarize/Compose) above, rather
// than a custom HTML popup.
export const actionMenuEntries: browser.menus._CreateCreateProperties[] = [
  {
    id: "organise-folder",
    contexts: ["action_menu"],
    title: "Organise Folder",
    enabled: true,
  },
  {
    id: "create-report",
    contexts: ["action_menu"],
    title: "Create Report",
    enabled: true,
  },
];

export const cancelRequestMenuEntry: browser.menus._CreateCreateProperties = {
  id: "cancel",
  contexts: ["compose_action_menu"],
  title: "Cancel Request",
  enabled: true,
};

// Shown in place of the toolbar action entries while a folder is being organised:
// a single top-level entry that displays progress and doubles as an abort button,
// mirroring the compose_action "Cancel Request" behaviour. The title leads with
// "Cancel" so it is obvious the entry aborts the run, with the live progress appended.
export const cancelOrganiseMenuEntry: browser.menus._CreateCreateProperties = {
  id: "cancel-organise",
  contexts: ["action_menu"],
  title: "Cancel Organise",
  enabled: true,
};

function organiseProgressTitle(percent: number): string {
  return `Cancel Organise (${percent}%)`;
}

/** Swap the toolbar action entries for a single organise-progress/cancel entry. */
export async function showOrganiseProgressMenu(percent: number): Promise<void> {
  for (const menuEntry of actionMenuEntries) {
    await removeMenuEntry(menuEntry.id);
  }
  await addMenuEntry({ ...cancelOrganiseMenuEntry, title: organiseProgressTitle(percent) });
}

/** Update the organise-progress entry title with the latest percentage. */
export async function updateOrganiseProgressMenu(percent: number): Promise<void> {
  try {
    await browser.menus.update(cancelOrganiseMenuEntry.id as string, { title: organiseProgressTitle(percent) });
    await browser.menus.refresh();
  } catch (error) {
    console.info("MENU: could not update organise progress entry:", error);
  }
}

/** Restore the normal toolbar action entries once organising ends. */
export async function restoreActionMenu(): Promise<void> {
  await removeMenuEntry(cancelOrganiseMenuEntry.id);
  for (const menuEntry of actionMenuEntries) {
    await addMenuEntry(menuEntry);
  }
}

export async function addLlmActionsToMenu() {
  await browser.menus.removeAll();
  for (const menuEntry of [...defaultMenuEntries, ...actionMenuEntries]) {
    await addMenuEntry(menuEntry);
  }
}

export async function addMenuEntry(createData: browser.menus._CreateCreateProperties) {
  console.log(`MENU: add '${createData.title}' option`);
  type CommandInfo = { name: string; shortcut?: string };
  // Append keyboard shortcut to menu title if available
  const shortcut = (await browser.commands.getAll())
    .filter((cmd: CommandInfo) => cmd.name === createData.id)
    .map((cmd: CommandInfo) => cmd.shortcut)[0];
  // biome-ignore lint/suspicious/noExplicitAny: workaround for missing type definitions
  const { promise, resolve, reject } = (Promise as any).withResolvers();
  let error: _LastError | undefined;
  const id = browser.menus.create(
    {
      ...createData,
      title: shortcut ? `${createData.title} (${shortcut})` : createData.title,
    },
    () => {
      error = browser.runtime.lastError; // Either null or an Error object.
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    },
  );

  try {
    await promise;
    console.info(`MENU: Successfully created menu entry <${id}>`);
  } catch (error) {
    if ((error as Error).message.includes("already exists")) {
      console.info(`MENU: The menu entry <${id}> exists already and was not added again.`);
    } else {
      console.error("Failed to create menu entry:", createData, error);
    }
  }

  return id;
}

export async function handleMenuClickListener(info: OnClickData, tab?: Tab): Promise<void> {
  if (tab === undefined || tab.id === undefined) {
    console.error(`No tab id found, ignoring "${info.menuItemId}" menu click`);
    return;
  }
  await executeLlmAction(info.menuItemId as LlmPluginAction, tab);
}

export async function enableSummarizeMenuEntryIfReply(tab: Tab): Promise<void> {
  if (tab.id) {
    const tabDetails = await browser.compose.getComposeDetails(tab.id);
    if (tabDetails.type === "reply") {
      await browser.menus.update("summarize", {
        enabled: true,
      });
    } else {
      await browser.menus.update("summarize", {
        enabled: false,
      });
    }
  }
}

export async function addCancelRequestMenuEntry() {
  console.log("MENU: replace compose_action entries with 'Cancel request' option");
  // Only swap out the compose_action entries; leave the toolbar action menu
  // (organise/report) intact so it stays usable while a compose request runs.
  for (const menuEntry of defaultMenuEntries) {
    await removeMenuEntry(menuEntry.id);
  }
  await addMenuEntry(cancelRequestMenuEntry);
}

async function removeMenuEntry(id: browser.menus._CreateCreateProperties["id"]): Promise<void> {
  if (id === undefined) return;
  try {
    await browser.menus.remove(id);
  } catch (error) {
    // The entry may not exist yet (e.g. first run); that is not an error here.
    console.info(`MENU: could not remove menu entry <${id}>:`, error);
  }
}
