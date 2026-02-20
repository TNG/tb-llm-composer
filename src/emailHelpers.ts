import MessagePart = browser.messages.MessagePart;

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
