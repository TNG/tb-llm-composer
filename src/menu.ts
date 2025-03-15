import _LastError = browser.runtime._LastError;
import Tab = browser.tabs.Tab;
import OnClickData = browser.menus.OnClickData;
import { type LlmPluginAction, executeLlmAction } from "./llmButtonClickHandling";

export const menuEntries: browser.menus._CreateCreateProperties[] = [
  {
    type: undefined,
    id: "summarize",
    // @ts-ignore
    contexts: ["compose_action_menu"],
    title: "Summarize",
    enabled: true,
  },
  {
    type: undefined,
    id: "compose",
    // @ts-ignore
    contexts: ["compose_action_menu"],
    title: "Compose",
    enabled: true,
  },
];

export async function addMenuEntry(createData: browser.menus._CreateCreateProperties) {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const { promise, resolve, reject } = (Promise as any).withResolvers();
  let error: _LastError | undefined;
  const id = browser.menus.create(createData, () => {
    error = browser.runtime.lastError; // Either null or an Error object.
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  });

  try {
    await promise;
    console.info(`Successfully created menu entry <${id}>`);
  } catch (error) {
    if ((error as Error).message.includes("already exists")) {
      console.info(`The menu entry <${id}> exists already and was not added again.`);
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

  console.log({ tab, info });
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
