/**
 * Token-frugal clean-up of email bodies served to the report agent.
 *
 * Real-world traces showed ~80% of body characters were quoted reply history ("From: … Sent: …",
 * "On … wrote:", "> …"), so every message of a thread repeated all of its predecessors. Bodies are
 * therefore cut at the start of the quoted history by default; the model can still request it.
 */

/** A cleaned body plus how many characters of quoted earlier messages were removed from it. */
export interface CleanedBody {
  body: string;
  quotedChars: number;
}

/**
 * Line-anchored markers that start a quoted earlier message. Forward markers ("Forwarded message")
 * are deliberately absent: in a forward, the "quoted" part is the actual content.
 */
const QUOTE_START_PATTERNS: RegExp[] = [
  // Outlook-style header block: "From: …" directly followed by "Sent:/Date: …" (EN/DE/FR/IT/ES).
  /^[ \t]*\*?(From|Von|De|Da)\*?:[^\n]*\n[ \t]*\*?(Sent|Gesendet|Date|Datum|Envoyé|Inviato|Enviado)\*?:/im,
  // Gmail/Apple/Thunderbird attribution, possibly wrapped onto a second line.
  /^[ \t]*On\b[^\n]*(\n[^\n]*)?\bwrote:[ \t]*$/im,
  /^[ \t]*Am\b[^\n]*(\n[^\n]*)?\bschrieb[^\n]*:[ \t]*$/im,
  /^[ \t]*-{2,}[ \t]*(Original Message|Ursprüngliche Nachricht|Message d'origine)[ \t]*-{2,}/im,
];

/** Below this many non-whitespace characters the "new" part is too thin to stand alone; keep quotes. */
const MIN_OWN_TEXT_CHARS = 40;

/** Subjects of forwarded mail; their quoted block is the content, so it is never stripped. */
const FORWARD_SUBJECT = /^\s*(fwd?|wg|tr|fw)\s*:/i;

/** Normalise whitespace and drop noise that carries no information for the model. */
function normaliseText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Outlook renders links as "addr<mailto:addr>"; the bracketed copy is pure duplication.
      .replace(/<mailto:[^>\s]*>/gi, "")
      // Trailing blanks go, except on the "-- " signature delimiter, whose space makes it unambiguous.
      .replace(/(?<!^--)[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Index where the quoted history starts, or -1. Includes a preceding "_____" separator line. */
function findQuoteStart(text: string): number {
  let start = -1;
  for (const pattern of QUOTE_START_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (start < 0 || match.index < start)) start = match.index;
  }
  const trailing = trailingQuoteStart(text);
  if (trailing >= 0 && (start < 0 || trailing < start)) start = trailing;
  if (start < 0) return -1;

  const before = text.slice(0, start);
  const separator = /\n[ \t]*_{8,}[ \t]*\n?\s*$/.exec(before);
  return separator ? separator.index : start;
}

/**
 * Offset of a trailing block made only of "> " lines (and blanks), or -1. Inline replies interleaved
 * with quotes are left alone, because a non-quoted line follows them.
 */
function trailingQuoteStart(text: string): number {
  const lines = text.split("\n");
  let first = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(">")) first = i;
    else if (lines[i].trim() !== "") break;
  }
  if (first === lines.length) return -1;
  return lines.slice(0, first).reduce((offset, line) => offset + line.length + 1, 0);
}

/** Remove an RFC 3676 signature ("-- " line and everything after it). */
function stripSignature(text: string): string {
  const match = /^-- $/m.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}

/**
 * Clean a plain-text body for the report agent: normalise whitespace, drop `<mailto:>` duplicates and
 * the signature, and — unless `includeQuoted` — cut the quoted reply history, reporting its size.
 */
export function cleanReportBody(rawBody: string, subject: string, includeQuoted: boolean): CleanedBody {
  const text = normaliseText(rawBody);
  const quoteStart = includeQuoted || FORWARD_SUBJECT.test(subject) ? -1 : findQuoteStart(text);
  if (quoteStart < 0) {
    return { body: includeQuoted ? text : stripSignature(text), quotedChars: 0 };
  }
  const own = stripSignature(text.slice(0, quoteStart).trimEnd());
  if (own.replace(/\s/g, "").length < MIN_OWN_TEXT_CHARS) {
    return { body: text, quotedChars: 0 };
  }
  return { body: own, quotedChars: text.length - quoteStart };
}
