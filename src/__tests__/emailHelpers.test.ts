import ComposeDetails = browser.compose.ComposeDetails;
import ComposeRecipientList = browser.compose.ComposeRecipientList;
import MessagePart = browser.messages.MessagePart;

import { describe, expect, test } from "vitest";
import {
  getContentFromEmailParts,
  getFirstRecipientMailAddress,
  getPlainTextSignature,
  replaceForeignSignatures,
} from "../emailHelpers";

describe("getPlainTextSignature", () => {
  test.each([
    [{}, undefined],
    [{ signature: "  " }, undefined],
    [{ signature: "Jane\nACME" }, "Jane\nACME"],
    [{ signature: "Jane\nACME", signatureIsPlainText: true }, "Jane\nACME"],
    [
      { signature: "<p>Jane</p><div>ACME &amp; Co<br>Berlin</div>", signatureIsPlainText: false },
      "Jane\nACME & Co\nBerlin",
    ],
  ])("turns %j into %j", (identity, expected) => {
    expect(getPlainTextSignature(identity as browser.identities.MailIdentity)).toBe(expected);
  });
});

describe("replaceForeignSignatures", () => {
  const quote = (sig: string) => `\n\n-- \n${sig}\n\nOn Monday Bob wrote:\n> Hi`;

  test("swaps another identity's signature for the current one", () => {
    expect(replaceForeignSignatures(quote("Old Sig"), "New Sig", ["Old Sig"])).toBe(quote("New Sig"));
  });

  test("drops the old signature with its delimiter when the current identity has none", () => {
    expect(replaceForeignSignatures(quote("Old Sig"), undefined, ["Old Sig"])).toBe("\n\n\nOn Monday Bob wrote:\n> Hi");
  });

  test("keeps the content when it already carries the current signature", () => {
    expect(replaceForeignSignatures(quote("New Sig"), "New Sig", ["Old Sig", "New Sig"])).toBe(quote("New Sig"));
  });

  test("inserts a signature containing $ literally", () => {
    expect(replaceForeignSignatures(quote("Old"), "Cost $& co", ["Old"])).toBe(quote("Cost $& co"));
  });
});

describe("The getFirstRecipientMailAddress", () => {
  test.each([
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
  test.each([
    ["some text", emailWithCalendar],
    ["some text without html", htmlEmail],
    ["some text in an email with attachments", emailWithAttachments],
  ])("Extracting text content %p from mail", (expected: string, email: MessagePart) => {
    const actual = getContentFromEmailParts([email]);
    expect(actual).toEqual(expected);
  });
});
