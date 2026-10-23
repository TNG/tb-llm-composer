import MailFolder = browser.folders.MailFolder;
import MessageHeader = browser.messages.MessageHeader;
import MessagePart = browser.messages.MessagePart;

import { getContentFromEmailParts } from "./emailHelpers";
import { getFoldersForAccount } from "./emailOrganising";

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
  const sentFolder = findSentFolder(await getFoldersForAccount(account));
  if (!sentFolder?.id) return [];

  const messageHeaders = await searchSentFolder(sentFolder.id, recipientEmail, identity.email, limit);
  const oldMessages = await Promise.all(messageHeaders.map(getMessageBody));
  const oldMessageContents: string[] = oldMessages.map((mail: MessagePart) => getContentFromEmailParts(mail.parts));
  return oldMessageContents.filter((content) => Boolean(content));
}

/** Depth-first search for the account's Sent folder (MV3 `specialUse`, with the legacy `type` as fallback). */
function findSentFolder(folders: MailFolder[]): MailFolder | undefined {
  for (const folder of folders) {
    if (folder.specialUse?.includes("sent") || folder.type === "sent") return folder;
    const sub = findSentFolder(folder.subFolders ?? []);
    if (sub) return sub;
  }
  return undefined;
}

/** Query the sent folder for messages to recipient, returning up to limit most recent messages. */
async function searchSentFolder(folderId: string, recipientEmail: string, author: string | undefined, limit = 10) {
  // The bundled typings predate TB 121's `folderId`. Several identities can share one Sent folder,
  // so restrict to the sending identity's address when known.
  const query = {
    recipients: recipientEmail,
    folderId,
    ...(author ? { author } : { fromMe: true }),
  } as browser.messages._QueryQueryInfo;
  const messages = await browser.messages.query(query);
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
