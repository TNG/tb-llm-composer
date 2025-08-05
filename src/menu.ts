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

export const cancelRequestMenuEntry: browser.menus._CreateCreateProperties = {
  id: "cancel",
  contexts: ["compose_action_menu"],
  title: "Cancel Request",
  enabled: true,
};

export async function addLlmActionsToMenu() {
  await browser.menus.removeAll();
  for (const menuEntry of defaultMenuEntries) {
    await addMenuEntry(menuEntry);
  }
}

export async function addMenuEntry(createData: browser.menus._CreateCreateProperties) {
  console.log(`MENU: add '${createData.title}' option`);
  const shortcut = (await browser.commands.getAll())
    .filter((cmd) => cmd.name === createData.id)
    .map((cmd) => cmd.shortcut)[0];
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
  console.log("MENU: remove all menu entries and add 'Cancel request' option");
  await browser.menus.removeAll();
  await addMenuEntry(cancelRequestMenuEntry);
}
