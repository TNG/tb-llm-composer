import MessagePart = browser.messages.MessagePart;

const emailRegex = /<([^<>]+)>/;

export function getContentFromEmailParts(messageParts?: MessagePart[]) {
  return (messageParts || [])
    .map((part): string => {
      if (part.contentType === "text/plain") {
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
