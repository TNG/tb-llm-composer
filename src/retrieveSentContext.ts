import MessageHeader = browser.messages.MessageHeader;
import MessagePart = browser.messages.MessagePart;

import { getContentFromEmailParts, queryMessages } from "./emailHelpers";
import { findFolderInTree, getFoldersForAccount } from "./emailOrganising";

/**
 * Recent mails `identity` sent to `recipientEmail`, as writing-style context. Only the identity's own
 * account is searched, so the examples match the account (and signature) the reply goes out from.
 */
export async function getSentMessages(
  recipientEmail: string,
  identity: browser.identities.MailIdentity,
  limit = 10,
): Promise<string[]> {
  if (!identity.accountId) return [];
  const account = await browser.accounts.get(identity.accountId, true);
  if (!account) return [];
  // MV3 `specialUse`, with the legacy `type` as fallback.
  const sentFolder = findFolderInTree(
    await getFoldersForAccount(account),
    (folder) => folder.specialUse?.includes("sent") || folder.type === "sent",
  );
  if (!sentFolder?.id) return [];

  const messageHeaders = await searchSentFolder(sentFolder.id, recipientEmail, identity.email, limit);
  const oldMessages = await Promise.all(messageHeaders.map(getMessageBody));
  const oldMessageContents: string[] = oldMessages.map((mail: MessagePart) => getContentFromEmailParts(mail.parts));
  return oldMessageContents.filter((content) => Boolean(content));
}

/** Query the sent folder for messages to recipient, returning up to limit most recent messages. */
async function searchSentFolder(folderId: string, recipientEmail: string, author: string | undefined, limit = 10) {
  // Several identities can share one Sent folder, so restrict to the sending identity's address when known.
  const messages = await queryMessages({
    recipients: recipientEmail,
    folderId,
    ...(author ? { author } : { fromMe: true }),
  });
  if (typeof messages === "string") {
    return [];
  }
  return messages.messages.sort(compareDates).slice(0, limit);
}

function compareDates(x: MessageHeader, y: MessageHeader) {
  if (x.date > y.date) {
    return -1;
  }
  if (x.date < y.date) {
    return 1;
  }
  return 0;
}

async function getMessageBody(messageHeader: MessageHeader) {
  return browser.messages.getFull(messageHeader.id);
}
