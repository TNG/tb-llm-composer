import ComposeDetails = browser.compose.ComposeDetails;
import ComposeRecipientList = browser.compose.ComposeRecipientList;
import MessagePart = browser.messages.MessagePart;
import { getContentFromEmailParts, getFirstRecipientMailAddress } from "../emailHelpers";

describe("The getFirstRecipientMailAddress", () => {
  it.each([
    [undefined, undefined],
    [undefined, []],
    ["michael.mueller@konzern.de", ["michael.mueller@konzern.de"]],
    [
      "recruiting@acompany.com",
      ["Julia Mayer <recruiting@acompany.com>", "interviews <interviews@company.com>", "michael.mueller@konzern.de"],
    ],
  ])("extracts %p from recipient list %p", (expected: string | undefined, to: ComposeRecipientList | undefined) => {
    const composerDetails: ComposeDetails = {
      to,
    };
    const recipient = getFirstRecipientMailAddress(composerDetails);
    expect(recipient).toEqual(expected);
  });
});

const emailWithCalendar: MessagePart = {
  contentType: "message/rfc822",
  partName: "",
  size: 616,
  headers: {},
  parts: [
    {
      contentType: "multipart/alternative",
      partName: "1",
      size: 616,
      parts: [
        {
          body: "some text",
          contentType: "text/plain",
          partName: "1.1",
          size: 616,
          headers: {
            "content-type": ['text/plain; charset="UTF-8"'],
          },
        },
        {
          contentType: "text/calendar",
          partName: "1.2",
          size: 0,
          headers: {
            "content-type": ['text/calendar; charset="utf-8"; method="REPLY"'],
          },
        },
      ],
    },
  ],
};

const htmlEmail: MessagePart = {
  contentType: "message/rfc822",
  partName: "",
  size: 2793,
  headers: {},
  parts: [
    {
      contentType: "multipart/alternative",
      partName: "1",
      size: 2793,
      headers: {
        "content-type": ['multipart/alternative;  boundary="----=_Part_50629042_323380359.1715686681194"'],
      },
      parts: [
        {
          body: "some text without html",
          contentType: "text/plain",
          partName: "1.1",
          size: 642,
          headers: {
            "content-type": ["text/plain; charset=utf-8"],
          },
        },
        {
          body: '<html lang="en-US"><body>html version of that text</body></html>',
          contentType: "text/html",
          partName: "1.2",
          size: 988,
          headers: {
            "content-type": ["text/html; charset=utf-8"],
          },
        },
      ],
    },
  ],
};

const emailWithAttachments: MessagePart = {
  contentType: "message/rfc822",
  partName: "",
  size: 96301,
  parts: [
    {
      contentType: "multipart/mixed",
      partName: "1",
      size: 96301,
      headers: {},
      parts: [
        {
          body: "some text in an email with attachments",
          contentType: "text/plain",
          partName: "1.1",
          size: 388,
          headers: {},
        },
        {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          name: "An-Excel-File.xlsx",
          partName: "1.2",
          size: 24492,
          headers: {},
        },
      ],
    },
  ],
};

describe("The getContentFromEmailParts", () => {
  it.each([
    ["some text", emailWithCalendar],
    ["some text without html", htmlEmail],
    ["some text in an email with attachments", emailWithAttachments],
  ])("Extracting text content %p from mail", (expected: string, email: MessagePart) => {
    const actual = getContentFromEmailParts([email]);
    expect(actual).toEqual(expected);
  });
});
