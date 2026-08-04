/**
 * A tiny, security-conscious renderer for the constrained markdown subset the report model emits.
 *
 * The report text is untrusted LLM output, so nothing here ever goes through innerHTML: every run of
 * text is written via textContent and only a fixed whitelist of elements/attributes is produced. This
 * avoids pulling in a full markdown parser + sanitizer just to render headings, emphasis, lists, code,
 * and — the point of the feature — inline email citations.
 *
 * Citations use a custom link scheme: `[short label](email:<messageId>)`. Those become clickable
 * "chips" with Open/Reply buttons carrying the numeric message id; all other links are flattened to
 * their plain label (reports should not surface arbitrary clickable web links).
 */

/** Custom link scheme the model uses to cite a mailbox message by its numeric id. */
export const EMAIL_CITATION_SCHEME = "email:";

/** Matches any markdown link `[label](target)`; used both for rendering and for export flattening. */
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Flatten a report's markdown links to plain text (keep the label, drop the target) for the
 * `.txt` / `.md` / clipboard exports — the ids only resolve inside this Thunderbird session, so a
 * saved file with `email:` links would be useless. Everything else is left as-is.
 */
export function stripCitations(text: string): string {
  return (text ?? "").replace(MARKDOWN_LINK, "$1");
}

/** An inline matcher: given the remaining text, report the earliest construct it can find. */
interface InlineMatch {
  start: number;
  end: number;
  build: (doc: Document) => Node;
}

/**
 * Build the email-citation chip: a clickable label that opens the cited email, plus a Reply button.
 * The chip itself carries the message id and acts as the "open" control (role=button), so there is no
 * separate open icon — only the Reply button is a distinct action.
 */
function buildEmailChip(doc: Document, id: string, label: string): Node {
  const chip = doc.createElement("span");
  chip.className = "email-citation";
  chip.dataset.emailId = id;
  chip.setAttribute("role", "button");
  chip.setAttribute("tabindex", "0");
  chip.title = "Open this email";
  chip.setAttribute("aria-label", `Open email: ${label}`);

  const name = doc.createElement("span");
  name.className = "email-citation-label";
  name.textContent = label;
  chip.appendChild(name);

  const replyBtn = doc.createElement("button");
  replyBtn.type = "button";
  replyBtn.className = "email-reply";
  replyBtn.dataset.emailId = id;
  replyBtn.title = "Reply to this email";
  replyBtn.setAttribute("aria-label", `Reply to email: ${label}`);
  replyBtn.textContent = "↩";
  chip.appendChild(replyBtn);

  return chip;
}

/** Ordered inline constructs. Earlier entries win ties on start position (so ** beats *). */
const INLINE_MATCHERS: Array<(text: string) => InlineMatch | null> = [
  // Link — an `email:<id>` target becomes a chip; any other target is flattened to its label.
  matcher(/\[([^\]]*)\]\(([^)]*)\)/, (m) => {
    const label = m[1];
    const target = m[2].trim();
    if (target.startsWith(EMAIL_CITATION_SCHEME)) {
      const id = target.slice(EMAIL_CITATION_SCHEME.length).trim();
      if (/^\d+$/.test(id)) return (doc) => buildEmailChip(doc, id, label);
    }
    // Non-email link: render the label as plain inline content (no clickable target).
    return (doc) => inlineFragment(label, doc);
  }),
  // Inline code.
  matcher(/`([^`]+?)`/, (m) => (doc) => el(doc, "code", m[1])),
  // Bold (** or __).
  matcher(/\*\*([^*]+?)\*\*|__([^_]+?)__/, (m) => (doc) => wrap(doc, "strong", m[1] ?? m[2])),
  // Italic (* or _).
  matcher(/\*([^*]+?)\*|_([^_]+?)_/, (m) => (doc) => wrap(doc, "em", m[1] ?? m[2])),
];

/** Adapt a regex + node factory into an InlineMatch producer. */
function matcher(
  re: RegExp,
  make: (match: RegExpMatchArray) => (doc: Document) => Node,
): (text: string) => InlineMatch | null {
  return (text: string) => {
    const m = re.exec(text);
    if (!m || m.index === undefined) return null;
    return { start: m.index, end: m.index + m[0].length, build: make(m) };
  };
}

/** A plain element whose text content is set safely. */
function el(doc: Document, tag: string, text: string): Node {
  const node = doc.createElement(tag);
  node.textContent = text;
  return node;
}

/** An element whose children are themselves inline-rendered (so emphasis can contain a chip, etc.). */
function wrap(doc: Document, tag: string, inner: string): Node {
  const node = doc.createElement(tag);
  node.appendChild(inlineFragment(inner, doc));
  return node;
}

/** Render inline markdown within a run of text into a fragment of safe nodes. */
function inlineFragment(text: string, doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  let rest = text;
  while (rest.length > 0) {
    let best: InlineMatch | null = null;
    for (const find of INLINE_MATCHERS) {
      const match = find(rest);
      if (match && (best === null || match.start < best.start)) best = match;
    }
    if (!best) {
      frag.appendChild(doc.createTextNode(rest));
      break;
    }
    if (best.start > 0) frag.appendChild(doc.createTextNode(rest.slice(0, best.start)));
    frag.appendChild(best.build(doc));
    rest = rest.slice(best.end);
  }
  return frag;
}

/** True for a line that opens a new block, so paragraph accumulation stops before it. */
function isBlockStart(line: string): boolean {
  return (
    /^\s*$/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*([-*])\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*```/.test(line)
  );
}

const BULLET = /^\s*([-*])\s+(.*)$/;
const ORDERED = /^\s*\d+\.\s+(.*)$/;

type CellAlign = "left" | "right" | "center" | "";

/** Split a `| a | b |` table row into trimmed cells, honouring escaped `\|` pipes. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/** True for a table delimiter row like `| --- | :--: |` (every cell is dashes with optional colons). */
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * A table starts where a header row is immediately followed by a delimiter row. Needs the next line,
 * so it is detected with lookahead rather than via {@link isBlockStart}.
 */
function isTableStart(lines: string[], idx: number): boolean {
  const header = lines[idx];
  const delimiter = lines[idx + 1];
  return Boolean(header?.includes("|")) && delimiter !== undefined && isTableDelimiterRow(delimiter);
}

/** Derive per-column alignment from the delimiter row's leading/trailing colons. */
function parseAlignments(delimiterLine: string): CellAlign[] {
  return splitTableRow(delimiterLine).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/** Build a `<td>`/`<th>` with inline-rendered content and optional text alignment. */
function buildCell(doc: Document, tag: "th" | "td", text: string, align: CellAlign): HTMLTableCellElement {
  const cell = doc.createElement(tag);
  if (align) cell.style.textAlign = align;
  cell.appendChild(inlineFragment(text, doc));
  return cell;
}

/** Assemble a `<table>` from parsed header/body cells, padding ragged rows to the header width. */
function buildTable(doc: Document, header: string[], rows: string[][], aligns: CellAlign[]): Node {
  const table = doc.createElement("table");
  table.className = "report-table";

  const thead = doc.createElement("thead");
  const headerRow = doc.createElement("tr");
  header.forEach((text, col) => {
    headerRow.appendChild(buildCell(doc, "th", text, aligns[col] ?? ""));
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    for (let col = 0; col < header.length; col++) {
      tr.appendChild(buildCell(doc, "td", row[col] ?? "", aligns[col] ?? ""));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

/**
 * Render the report's markdown subset into a DocumentFragment of safe DOM nodes. Supports headings,
 * paragraphs, unordered/ordered lists, tables, fenced code blocks, inline emphasis/code, and email
 * citations.
 *
 * @param doc the Document to create nodes in — injectable so it can be unit-tested under jsdom.
 */
export function renderReportHtml(text: string, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Fenced code block: copy verbatim until the closing fence (or end of input).
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence
      const pre = doc.createElement("pre");
      pre.appendChild(el(doc, "code", code.join("\n")));
      frag.appendChild(pre);
      continue;
    }

    // Heading: `#`..`######` maps to h2..h6 (h1 is reserved for the popup's own title).
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      const h = doc.createElement(`h${level}`);
      h.appendChild(inlineFragment(heading[2].trim(), doc));
      frag.appendChild(h);
      i++;
      continue;
    }

    // Table: a header row followed by a delimiter row, then body rows until a non-table line.
    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      const aligns = parseAlignments(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      frag.appendChild(buildTable(doc, header, rows, aligns));
      continue;
    }

    // List: a run of consecutive bullet or ordered items (nesting is flattened).
    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const list = doc.createElement(ordered ? "ol" : "ul");
      while (i < lines.length && (BULLET.test(lines[i]) || ORDERED.test(lines[i]))) {
        const m = lines[i].match(BULLET) ?? lines[i].match(ORDERED);
        const itemText = (m?.[2] ?? m?.[1] ?? "").trim();
        const li = doc.createElement("li");
        li.appendChild(inlineFragment(itemText, doc));
        list.appendChild(li);
        i++;
      }
      frag.appendChild(list);
      continue;
    }

    // Paragraph: gather soft-wrapped lines until the next block starts.
    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i]) && !isTableStart(lines, i)) {
      paragraph.push(lines[i].trim());
      i++;
    }
    const p = doc.createElement("p");
    p.appendChild(inlineFragment(paragraph.join(" "), doc));
    frag.appendChild(p);
  }

  return frag;
}
