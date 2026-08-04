/**
 * @vi-environment jsdom
 *
 * Runs against the compiled report popup (build/public/reports.html + build/reports.js).
 */
import fs from "node:fs";
import * as path from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { waitFor } from "./testUtils";

Object.assign(global, { TextDecoder, TextEncoder });

let reportsDom: JSDOM;

const getCurrentMock = vi.fn();
const sendMessageMock = vi.fn();
const clipboardWriteMock = vi.fn();
const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();

/** Runtime message listeners registered by the popup, plus a helper to dispatch to them. */
let messageListeners: Array<(message: unknown) => void>;
function dispatchRuntimeMessage(message: unknown): void {
  for (const listener of messageListeners) listener(message);
}

/** Deliver a finished report to the popup the way the background does — a `report-result` message. */
function deliverReport(report: string): void {
  dispatchRuntimeMessage({ type: "report-result", windowId: 123, report });
}

/** Drive the create flow and deliver `report` back over the result channel, then wait for the render. */
async function generateReportInPopup(doc: Document, prompt: string, report = "REPORT BODY"): Promise<void> {
  (doc.getElementById("prompt") as HTMLTextAreaElement).value = prompt;
  (doc.getElementById("create-btn") as HTMLButtonElement).click();
  deliverReport(report);
  await waitFor(() => {
    expect(doc.querySelector("#report-output .report-placeholder")).toBeNull();
  });
}

/** Captures the anchors that would have triggered a file download. */
let triggeredDownloads: Array<{ download: string; href: string }>;

/** In-memory backing store for the mocked browser.storage.sync. */
let syncStore: Record<string, unknown>;

const mockBrowser = {
  windows: {
    getCurrent: (...args: unknown[]) => getCurrentMock(...args),
  },
  runtime: {
    sendMessage: (...args: unknown[]) => sendMessageMock(...args),
    onMessage: {
      addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
    },
  },
  storage: {
    sync: {
      get: async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = syncStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(syncStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete syncStore[key];
      },
    },
  },
};

async function loadPopup(search: string): Promise<void> {
  const projectDir = path.resolve(__dirname, "../..");
  const reportsHtmlFile = `${projectDir}/build/public/reports.html`;
  const reportsHtmlContent = fs.readFileSync(reportsHtmlFile, "utf-8");
  reportsDom = new JSDOM(reportsHtmlContent, {
    url: `file://${reportsHtmlFile}${search}`,
    runScripts: "dangerously",
    resources: "usable",
  });

  const win = reportsDom.window;
  win.URL.createObjectURL = createObjectUrlMock as unknown as typeof URL.createObjectURL;
  win.URL.revokeObjectURL = revokeObjectUrlMock as unknown as typeof URL.revokeObjectURL;
  win.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    triggeredDownloads.push({ download: this.download, href: this.href });
  };
  Object.defineProperty(win.navigator, "clipboard", {
    value: { writeText: clipboardWriteMock },
    configurable: true,
  });

  reportsDom.getInternalVMContext().browser = mockBrowser;

  // Let the async external script load and init() run.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const FOLDER_SEARCH = "?accountId=acc1&path=/INBOX&name=Inbox";

beforeEach(() => {
  triggeredDownloads = [];
  messageListeners = [];
  syncStore = {};
  getCurrentMock.mockReset().mockResolvedValue({ id: 123 });
  sendMessageMock.mockReset().mockResolvedValue({});
  clipboardWriteMock.mockReset().mockResolvedValue(undefined);
  createObjectUrlMock.mockReset().mockReturnValue("blob:mock-url");
  revokeObjectUrlMock.mockReset();
});

afterEach(() => {
  reportsDom.window.close();
});

describe("The report popup", () => {
  test("prefills the selected folder name from the folder context in the URL", async () => {
    await loadPopup(FOLDER_SEARCH);

    const selectedFolder = reportsDom.window.document.getElementById("selected-folder-name");
    expect(selectedFolder?.textContent).toContain("Inbox");
  });

  test("searches all folders when no folder context is provided", async () => {
    await loadPopup("");

    const folderOnly = reportsDom.window.document.getElementById("folder-only") as HTMLInputElement;
    expect(folderOnly.checked).toBe(false);
    expect(folderOnly.disabled).toBe(true);
  });

  test("requests a report and renders it in the output area", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "Give me a to-do list";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    deliverReport("GENERATED REPORT BODY");

    await waitFor(() => {
      expect(doc.getElementById("report-output")?.textContent).toContain("GENERATED REPORT BODY");
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "generate-report",
        windowId: 123,
        request: expect.objectContaining({
          prompt: "Give me a to-do list",
          folderOnly: true,
          folder: { accountId: "acc1", path: "/INBOX" },
        }),
      }),
    );
  });

  test("renders an email citation as a chip and opens/replies to it on click", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "status";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    deliverReport('Resolved [Alice — "Re: Invoice"](email:4242).');

    await waitFor(() => {
      expect(doc.querySelector("#report-output .email-citation")).not.toBeNull();
    });

    sendMessageMock.mockClear();
    // Clicking the chip label (anywhere but the Reply button) opens the cited email.
    (doc.querySelector("#report-output .email-citation-label") as HTMLElement).click();
    expect(sendMessageMock).toHaveBeenCalledWith({ type: "open-email", id: 4242 });

    sendMessageMock.mockClear();
    (doc.querySelector("#report-output .email-reply") as HTMLButtonElement).click();
    expect(sendMessageMock).toHaveBeenCalledWith({ type: "reply-email", id: 4242 });
  });

  test("keeps report versions and steps back and forth between them", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;

    await generateReportInPopup(doc, "make a report", "FIRST VERSION");

    const nav = doc.getElementById("version-nav") as HTMLElement;
    // A single version: navigation stays hidden.
    expect(nav.hidden).toBe(true);

    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    deliverReport("SECOND VERSION");
    await waitFor(() => {
      expect(doc.getElementById("report-output")?.textContent).toContain("SECOND VERSION");
    });

    // Two versions now: navigation appears, showing the latest.
    expect(nav.hidden).toBe(false);
    expect(doc.getElementById("version-label")?.textContent).toBe("2 / 2");
    expect((doc.getElementById("next-version") as HTMLButtonElement).disabled).toBe(true);

    // Step back to the first version.
    (doc.getElementById("prev-version") as HTMLButtonElement).click();
    expect(doc.getElementById("report-output")?.textContent).toContain("FIRST VERSION");
    expect(doc.getElementById("version-label")?.textContent).toBe("1 / 2");
    expect((doc.getElementById("prev-version") as HTMLButtonElement).disabled).toBe(true);

    // Step forward again.
    (doc.getElementById("next-version") as HTMLButtonElement).click();
    expect(doc.getElementById("report-output")?.textContent).toContain("SECOND VERSION");

    // "New report" clears the history and hides the navigation.
    (doc.getElementById("new-report-btn") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(nav.hidden).toBe(true);
      expect(doc.querySelector("#report-output .report-placeholder")).not.toBeNull();
    });
  });

  test("shows 'refine without search' only after a report exists and sends the flag", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    const noSearch = doc.getElementById("no-search") as HTMLInputElement;
    const refineControl = doc.getElementById("refine-control") as HTMLElement;

    // Hidden until there is a report to refine.
    expect(refineControl.hidden).toBe(true);

    await generateReportInPopup(doc, "make a report", "V1");
    expect(refineControl.hidden).toBe(false);

    // Refine with the option checked → the generate-report message carries noSearch:true.
    noSearch.checked = true;
    sendMessageMock.mockClear();
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "reorder the sections";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    deliverReport("V2");

    // Wait for the refine to fully complete (V2 rendered) so the popup is no longer busy.
    await waitFor(() => {
      expect(doc.getElementById("report-output")?.textContent).toContain("V2");
    });
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "generate-report", continueConversation: true, noSearch: true }),
    );

    // Starting a new report hides and unchecks the option again.
    (doc.getElementById("new-report-btn") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(refineControl.hidden).toBe(true);
      expect(noSearch.checked).toBe(false);
    });
  });

  test("does not send a request when the prompt is empty", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("create-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(doc.getElementById("status")?.textContent).toContain("Please enter a report request");
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  test("shows an error status when generation fails", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "anything";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    // The background reports failure over the result channel.
    dispatchRuntimeMessage({ type: "report-result", windowId: 123, error: "endpoint exploded" });

    await waitFor(() => {
      expect(doc.getElementById("status")?.textContent).toContain("endpoint exploded");
    });
  });

  test("saves the report as .txt with the default filename", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    await generateReportInPopup(doc, "anything", "report contents");

    (doc.getElementById("save-txt-btn") as HTMLButtonElement).click();

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(triggeredDownloads).toHaveLength(1);
    expect(triggeredDownloads[0].href).toBe("blob:mock-url");
    expect(triggeredDownloads[0].download).toMatch(/^llm-composer-report-\d{4}-\d{2}-\d{2}\.txt$/);
  });

  test("saves the report as .md with the default filename", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    await generateReportInPopup(doc, "anything", "# report");

    (doc.getElementById("save-md-btn") as HTMLButtonElement).click();

    expect(triggeredDownloads).toHaveLength(1);
    expect(triggeredDownloads[0].href).toBe("blob:mock-url");
    expect(triggeredDownloads[0].download).toMatch(/^llm-composer-report-\d{4}-\d{2}-\d{2}\.md$/);
  });

  test("does not trigger a download when there is nothing to save", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("save-txt-btn") as HTMLButtonElement).click();

    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(triggeredDownloads).toHaveLength(0);
    expect(doc.getElementById("status")?.textContent).toContain("Nothing to save");
  });

  test("copies the report to the clipboard, flattening citation links to plain text", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    await generateReportInPopup(doc, "anything", "copy [Alice](email:7) me");

    (doc.getElementById("copy-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith("copy Alice me");
      expect(doc.getElementById("status")?.textContent).toContain("copied");
    });
  });

  test("saves a prompt and re-loads it from the dropdown", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;

    const prompt = doc.getElementById("prompt") as HTMLTextAreaElement;
    const nameInput = doc.getElementById("prompt-name") as HTMLInputElement;
    const select = doc.getElementById("saved-prompts") as HTMLSelectElement;
    const deleteBtn = doc.getElementById("delete-prompt-btn") as HTMLButtonElement;

    // Save the current prompt under a name.
    prompt.value = "Summarise open action items addressed to me";
    nameInput.value = "Action items";
    (doc.getElementById("save-prompt-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).toContain("Action items");
      expect(doc.getElementById("status")?.textContent).toContain('Saved prompt "Action items"');
    });

    // Clear the field, then re-load the saved prompt via the dropdown.
    prompt.value = "";
    select.value = "Action items";
    select.dispatchEvent(new reportsDom.window.Event("change"));

    await waitFor(() => {
      expect(prompt.value).toBe("Summarise open action items addressed to me");
      expect(deleteBtn.disabled).toBe(false);
    });

    // Delete it; the option disappears and the store is emptied.
    deleteBtn.click();
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).not.toContain("Action items");
      expect(doc.getElementById("status")?.textContent).toContain('Deleted prompt "Action items"');
    });
    expect(syncStore.reportPrompts).toEqual([]);
    expect(syncStore["reportPrompt:Action items"]).toBeUndefined();
  });

  test("persists saved prompts across popup reloads", async () => {
    await loadPopup(FOLDER_SEARCH);
    let doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "Weekly digest";
    (doc.getElementById("prompt-name") as HTMLInputElement).value = "Digest";
    (doc.getElementById("save-prompt-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(syncStore.reportPrompts).toEqual(["Digest"]);
      expect(syncStore["reportPrompt:Digest"]).toBe("Weekly digest");
    });

    // Reopen the popup: the saved prompt is listed again from storage.
    reportsDom.window.close();
    await loadPopup(FOLDER_SEARCH);
    doc = reportsDom.window.document;
    const select = doc.getElementById("saved-prompts") as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(select.options).map((o) => o.value)).toContain("Digest");
    });
  });

  test("shows live progress and lets the user abort while generating", async () => {
    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "Give me a to-do list";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();

    // The generate-report request is fire-and-forget; the popup enters the busy state immediately.
    const progress = doc.getElementById("progress") as HTMLDivElement;
    await waitFor(() => {
      expect(progress.hasAttribute("hidden")).toBe(false);
    });

    // A progress message from the background updates the counters and phase.
    dispatchRuntimeMessage({
      type: "report-progress",
      windowId: 123,
      progress: { llmCalls: 2, toolCalls: 5, phase: "Searching messages…" },
    });
    await waitFor(() => {
      const text = doc.getElementById("progress-text")?.textContent ?? "";
      expect(text).toContain("Searching messages…");
      expect(text).toContain("2 LLM calls");
      expect(text).toContain("5 tool calls");
    });

    // While generating, the send button acts as a stop control; clicking it aborts the report.
    (doc.getElementById("create-btn") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "cancel-report", windowId: 123 }));
      expect(doc.getElementById("status")?.textContent).toContain("Cancelling");
    });

    // The background delivers a cancellation result, which leaves the busy state.
    dispatchRuntimeMessage({ type: "report-result", windowId: 123, error: "Report generation was cancelled." });
    await waitFor(() => {
      expect(progress.hasAttribute("hidden")).toBe(true);
    });
  });
});
