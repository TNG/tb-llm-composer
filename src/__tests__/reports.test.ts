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

/** Captures the anchors that would have triggered a file download. */
let triggeredDownloads: Array<{ download: string; href: string }>;

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
      get: async () => ({}),
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
  test("prefills the scope note from the folder context in the URL", async () => {
    await loadPopup(FOLDER_SEARCH);

    const scopeNote = reportsDom.window.document.getElementById("scope-note");
    expect(scopeNote?.textContent).toContain("Inbox");
  });

  test("searches all folders when no folder context is provided", async () => {
    await loadPopup("");

    const folderOnly = reportsDom.window.document.getElementById("folder-only") as HTMLInputElement;
    expect(folderOnly.checked).toBe(false);
    expect(folderOnly.disabled).toBe(true);
    expect(reportsDom.window.document.getElementById("scope-note")?.textContent).toContain("all folders");
  });

  test("requests a report and renders it in the output area", async () => {
    sendMessageMock.mockResolvedValue({ report: "GENERATED REPORT BODY" });
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "Give me a to-do list";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect((doc.getElementById("report-output") as HTMLTextAreaElement).value).toEqual("GENERATED REPORT BODY");
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
    sendMessageMock.mockResolvedValue({ error: "endpoint exploded" });
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "anything";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(doc.getElementById("status")?.textContent).toContain("endpoint exploded");
    });
  });

  test("saves the report as .txt with the default filename", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("report-output") as HTMLTextAreaElement).value = "report contents";
    (doc.getElementById("save-txt-btn") as HTMLButtonElement).click();

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(triggeredDownloads).toHaveLength(1);
    expect(triggeredDownloads[0].href).toBe("blob:mock-url");
    expect(triggeredDownloads[0].download).toMatch(/^llm-composer-report-\d{4}-\d{2}-\d{2}\.txt$/);
  });

  test("saves the report as .md with the default filename", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("report-output") as HTMLTextAreaElement).value = "# report";
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

  test("copies the report to the clipboard", async () => {
    await loadPopup(FOLDER_SEARCH);

    const doc = reportsDom.window.document;
    (doc.getElementById("report-output") as HTMLTextAreaElement).value = "copy me";
    (doc.getElementById("copy-btn") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalledWith("copy me");
      expect(doc.getElementById("status")?.textContent).toContain("copied");
    });
  });

  test("shows live progress and lets the user abort while generating", async () => {
    // Keep the generate-report request pending so the popup stays in the busy state.
    let finishGenerate: (value: { report?: string; error?: string }) => void = () => {};
    sendMessageMock.mockImplementation((message: { type?: string }) => {
      if (message.type === "generate-report") {
        return new Promise((resolve) => {
          finishGenerate = resolve;
        });
      }
      return Promise.resolve({});
    });

    await loadPopup(FOLDER_SEARCH);
    const doc = reportsDom.window.document;
    (doc.getElementById("prompt") as HTMLTextAreaElement).value = "Give me a to-do list";
    (doc.getElementById("create-btn") as HTMLButtonElement).click();

    // The progress row becomes visible while generating.
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

    // Clicking the Stop button aborts the in-flight report.
    (doc.getElementById("abort-btn") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "cancel-report", windowId: 123 }));
      expect(doc.getElementById("status")?.textContent).toContain("Cancelling");
    });

    // Let the (now cancelled) request settle so the popup leaves the busy state.
    finishGenerate({ error: "Report generation was cancelled." });
    await waitFor(() => {
      expect(progress.hasAttribute("hidden")).toBe(true);
    });
  });
});
