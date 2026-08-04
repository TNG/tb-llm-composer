// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { renderReportHtml, stripCitations } from "../reportMarkdown";

/** Render to a detached container so we can assert on the produced DOM. */
function render(text: string): HTMLElement {
  const container = document.createElement("div");
  container.appendChild(renderReportHtml(text, document));
  return container;
}

describe("renderReportHtml", () => {
  test("renders headings, paragraphs, and lists", () => {
    const html = render("# Title\n\nSome text.\n\n- one\n- two\n\n1. first\n2. second");
    expect(html.querySelector("h2")?.textContent).toBe("Title");
    expect(html.querySelector("p")?.textContent).toBe("Some text.");
    expect([...html.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["one", "two"]);
    expect([...html.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(["first", "second"]);
  });

  test("renders a markdown table with a header row and body cells", () => {
    const html = render(
      "Summary:\n\n| Sender | Count |\n| --- | --- |\n| alice@x.com | 3 |\n| bob@y.com | 1 |\n\nDone.",
    );
    expect(html.querySelector("table.report-table")).not.toBeNull();
    expect([...html.querySelectorAll("thead th")].map((c) => c.textContent)).toEqual(["Sender", "Count"]);
    const bodyRows = [...html.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(bodyRows).toEqual([
      ["alice@x.com", "3"],
      ["bob@y.com", "1"],
    ]);
    // Surrounding paragraphs are still rendered around the table.
    expect([...html.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Summary:", "Done."]);
  });

  test("applies column alignment from the delimiter row and renders inline markup in cells", () => {
    const html = render("| Left | Right |\n| :--- | ---: |\n| **a** | [Z](email:7) |");
    const [th1, th2] = [...html.querySelectorAll<HTMLTableCellElement>("th")];
    expect(th1.style.textAlign).toBe("left");
    expect(th2.style.textAlign).toBe("right");
    const [td1, td2] = [...html.querySelectorAll<HTMLTableCellElement>("td")];
    expect(td1.querySelector("strong")?.textContent).toBe("a");
    expect(td2.style.textAlign).toBe("right");
    expect(td2.querySelector(".email-citation .email-open")?.getAttribute("data-email-id")).toBe("7");
  });

  test("pads ragged table rows to the header width", () => {
    const html = render("| A | B | C |\n| - | - | - |\n| 1 | 2 |");
    const cells = [...html.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cells).toEqual(["1", "2", ""]);
  });

  test("renders bold, italic, and inline code", () => {
    const html = render("A **bold** and _italic_ and `code` word.");
    expect(html.querySelector("strong")?.textContent).toBe("bold");
    expect(html.querySelector("em")?.textContent).toBe("italic");
    expect(html.querySelector("code")?.textContent).toBe("code");
  });

  test("turns an email citation into a chip with Open/Reply buttons carrying the id", () => {
    const html = render('Resolved on Tuesday [Alice — "Re: Invoice"](email:12345).');
    const chip = html.querySelector(".email-citation");
    expect(chip).not.toBeNull();
    expect(chip?.querySelector(".email-citation-label")?.textContent).toBe('Alice — "Re: Invoice"');

    const open = chip?.querySelector<HTMLButtonElement>(".email-open");
    const reply = chip?.querySelector<HTMLButtonElement>(".email-reply");
    expect(open?.dataset.emailId).toBe("12345");
    expect(reply?.dataset.emailId).toBe("12345");
    // The surrounding prose is preserved around the chip.
    expect(html.textContent).toContain("Resolved on Tuesday");
  });

  test("flattens non-email links and email links with a non-numeric id to plain text", () => {
    const html = render("See [the site](https://example.com) and [bad](email:not-a-number).");
    expect(html.querySelector(".email-citation")).toBeNull();
    expect(html.querySelector("a")).toBeNull();
    expect(html.textContent).toContain("the site");
    expect(html.textContent).toContain("bad");
  });

  test("never injects raw HTML from the model output (XSS safety)", () => {
    const html = render("<img src=x onerror=alert(1)> and <script>alert(2)</script> **safe**");
    // The angle-bracket text is rendered as literal text, not as elements.
    expect(html.querySelector("img")).toBeNull();
    expect(html.querySelector("script")).toBeNull();
    expect(html.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(html.querySelector("strong")?.textContent).toBe("safe");
  });

  test("renders a fenced code block verbatim", () => {
    const html = render("Intro\n\n```\nline **not bold**\n```\n");
    const code = html.querySelector("pre > code");
    expect(code?.textContent).toBe("line **not bold**");
    // Emphasis inside a code fence must not be parsed.
    expect(code?.querySelector("strong")).toBeNull();
  });
});

describe("stripCitations", () => {
  test("replaces markdown links with their label for export", () => {
    expect(stripCitations('Done [Alice — "Re: Invoice"](email:12345) today.')).toBe(
      'Done Alice — "Re: Invoice" today.',
    );
  });

  test("flattens ordinary links too, and leaves plain text untouched", () => {
    expect(stripCitations("See [site](https://example.com).")).toBe("See site.");
    expect(stripCitations("No links here.")).toBe("No links here.");
  });
});
