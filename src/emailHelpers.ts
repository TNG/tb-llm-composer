import MessagePart = browser.messages.MessagePart;

const emailRegex = /<([^<>]+)>/;

export function getContentFromEmailParts(messageParts?: MessagePart[]) {
  const parts = messageParts || [];

  // First try to get plain text content
  const plainTextContent = parts
    .map((part): string => {
      if (part.contentType === "text/plain") {
        return part.body || "";
      }
      return getContentFromEmailParts(part.parts);
    })
    .join("");

  // If we found plain text content, return it
  if (plainTextContent.trim()) {
    return plainTextContent;
  }

  // Otherwise, return HTML content directly for LLM processing
  return parts
    .map((part): string => {
      if (part.contentType === "text/html") {
        return part.body || "";
      }
      return getContentFromEmailParts(part.parts);
    })
    .join("");
}

export function getFirstRecipientMailAddress(tabDetails: browser.compose.ComposeDetails) {
  const recipients = tabDetails.to;
  const recipient = recipients ? (Array.isArray(recipients) ? recipients[0] : recipients) : undefined;
  const match = recipient?.toString().match(emailRegex);
  return match ? match[1] : recipient;
}
