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

  test("renders bold, italic, and inline code", () => {
    const html = render("A **bold** and _italic_ and `code` word.");
    expect(html.querySelector("strong")?.textContent).toBe("bold");
    expect(html.querySelector("em")?.textContent).toBe("italic");
    expect(html.querySelector("code")?.textContent).toBe("code");
  });

  test("turns an email citation into a chip whose label opens and whose button replies", () => {
    const html = render('Resolved on Tuesday [Alice — "Re: Invoice"](email:12345).');
    const chip = html.querySelector(".email-citation");
    expect(chip).not.toBeNull();

    const open = chip?.querySelector<HTMLButtonElement>(".email-open");
    const reply = chip?.querySelector<HTMLButtonElement>(".email-reply");
    // The label itself is the open control, so there is no separate arrow glyph on the chip.
    expect(open?.textContent).toBe('Alice — "Re: Invoice"');
    expect(open?.classList.contains("email-citation-label")).toBe(true);
    expect(chip?.querySelectorAll("button")).toHaveLength(2);
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
  test("renders a pipe table with a header and body rows", () => {
    const html = render(
      "| # | Item | Status |\n|---|------|--------|\n| 1 | **Rename** | Pending |\n| 2 | Ship | Done |",
    );
    const table = html.querySelector("table.report-table");
    expect(table).not.toBeNull();
    expect([...html.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["#", "Item", "Status"]);
    const rows = [...html.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["1", "Rename", "Pending"],
      ["2", "Ship", "Done"],
    ]);
    // Inline markup still applies inside cells.
    expect(table?.querySelector("tbody strong")?.textContent).toBe("Rename");
  });

  test("applies delimiter-row alignment and normalises ragged rows", () => {
    const html = render("| A | B | C |\n| :--- | :---: | ---: |\n| only |\n| 1 | 2 | 3 | 4 |");
    const headers = [...html.querySelectorAll("th")];
    expect(headers.map((th) => (th as HTMLElement).style.textAlign)).toEqual(["left", "center", "right"]);
    const rows = [...html.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td").length);
    // A short row is padded and an over-long one truncated, so every row matches the header.
    expect(rows).toEqual([3, 3]);
    expect(html.querySelectorAll("tbody tr")[1].textContent).toBe("123");
  });

  test("does not treat a paragraph containing pipes as a table", () => {
    const html = render("Use the a | b syntax.\nIt is not a table.");
    expect(html.querySelector("table")).toBeNull();
    expect(html.querySelector("p")?.textContent).toBe("Use the a | b syntax. It is not a table.");
  });

  test("does not treat a header and delimiter row with different column counts as a table", () => {
    const html = render("Costs | risks | owners\n---|---\nstill text");
    expect(html.querySelector("table")).toBeNull();
    expect(html.querySelector("p")?.textContent).toBe("Costs | risks | owners ---|--- still text");
  });

  test("separates a table from the paragraph directly above it", () => {
    const html = render("Summary of items:\n| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html.querySelector("p")?.textContent).toBe("Summary of items:");
    expect(html.querySelectorAll("tbody td").length).toBe(2);
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
