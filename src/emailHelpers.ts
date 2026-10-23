import MessagePart = browser.messages.MessagePart;

import { stripHtml } from "./utils";

const emailRegex = /<([^<>]+)>/;

function getPlainTextFromEmailParts(messageParts?: MessagePart[]): string {
  const parts = messageParts || [];
  return parts
    .map((part): string => {
      if (part.contentType === "text/plain") {
        return part.body || "";
      }
      if (part.contentType === "text/html") {
        return "";
      }
      return getPlainTextFromEmailParts(part.parts);
    })
    .join("");
}

function getHtmlFromEmailParts(messageParts?: MessagePart[]): string {
  const parts = messageParts || [];
  return parts
    .map((part): string => {
      if (part.contentType === "text/html") {
        return part.body || "";
      }
      return getHtmlFromEmailParts(part.parts);
    })
    .join("");
}

export function getContentFromEmailParts(messageParts?: MessagePart[]) {
  // First try to get plain text content (never includes HTML branches)
  const plainTextContent = getPlainTextFromEmailParts(messageParts);

  // If we found plain text content, return it
  if (plainTextContent.trim()) {
    return plainTextContent;
  }

  // Otherwise, return HTML content directly for LLM processing
  return getHtmlFromEmailParts(messageParts);
}

export function getFirstRecipientMailAddress(tabDetails: browser.compose.ComposeDetails) {
  const recipients = tabDetails.to;
  const recipient = recipients ? (Array.isArray(recipients) ? recipients[0] : recipients) : undefined;
  const match = recipient?.toString().match(emailRegex);
  return match ? match[1] : recipient;
}

/** An identity's signature as plain text (HTML signatures are flattened), or undefined when it has none. */
export function getPlainTextSignature(identity: browser.identities.MailIdentity): string | undefined {
  const raw = identity.signature;
  if (!raw?.trim()) return undefined;
  if (identity.signatureIsPlainText !== false) return raw;
  // Keep the signature's line structure: block ends and <br> become newlines before tags are dropped.
  const text = stripHtml(raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n"));
  return text || undefined;
}

/**
 * Swap another identity's signature in `content` for `current` (or drop it, with its "-- " delimiter,
 * when the current identity has none). A reply's quote is cached when the composer opens, so it still
 * carries the old signature if the user switches the From identity afterwards.
 */
export function replaceForeignSignatures(content: string, current: string | undefined, others: string[]): string {
  for (const other of others) {
    if (!other || other === current || !content.includes(other)) continue;
    // Function replacements, so "$" in a signature is not read as a replacement pattern.
    if (current) return content.replace(other, () => current);
    const withDelimiter = new RegExp(`(^|\\n)--[ \\t]?\\r?\\n${escapeRegExp(other)}(\\r?\\n)?`);
    return withDelimiter.test(content)
      ? content.replace(withDelimiter, (_match, lineStart: string) => lineStart)
      : content.replace(other, "");
  }
  return content;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
