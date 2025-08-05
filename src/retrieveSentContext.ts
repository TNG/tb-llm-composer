import MailFolder = browser.folders.MailFolder;
import MailAccount = browser.accounts.MailAccount;
import _QueryQueryInfo = browser.messages._QueryQueryInfo;
import MessageHeader = browser.messages.MessageHeader;

import { getContentFromEmailParts } from "./emailHelpers";

export async function getSentMessages(recipientEmail: string) {
  const accounts = await browser.accounts.list();
  for (const account of accounts) {
    const sentFolder = findSentFolder(account);
    if (sentFolder) {
      const messageHeaders = await searchSentFolder(sentFolder, recipientEmail);
      const oldMessages = await Promise.all(messageHeaders.map(getMessageBody));
      return oldMessages.map((mail) => getContentFromEmailParts(mail.parts)).filter((x) => x);
    }
  }
  return [];
}

function findSentFolder(account: MailAccount) {
  const folders = account.folders || [];
  return folders.find((folder) => folder.type === "sent");
}

async function searchSentFolder(sentFolder: MailFolder, recipientEmail: string, limit = 10) {
  const query: _QueryQueryInfo = {
    recipients: recipientEmail,
    folder: sentFolder,
    fromMe: true,
  };
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
