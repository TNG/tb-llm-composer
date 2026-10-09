import { describe, expect, test } from "vitest";
import { cleanReportBody } from "../reportBodyCleanup";

const OWN = "Hi Bob,\nthe new build is deployed and the TTS issue is fixed.\nCheers";

describe("cleanReportBody", () => {
  test("cuts an Outlook-style quoted header block, including its separator line", () => {
    const raw = `${OWN}\r\n\r\n________________________________\r\nFrom: Bob <b@x.com>\r\nSent: Monday\r\nTo: Me\r\n\r\nOld text`;
    const { body, quotedChars } = cleanReportBody(raw, "RE: Build", false);
    expect(body).toBe(OWN);
    expect(quotedChars).toBeGreaterThan("Old text".length);
  });

  test("cuts German and 'On … wrote:' attributions", () => {
    for (const marker of [
      "Am 01.09.2026 um 10:00 schrieb Bob <b@x.com>:",
      "On Mon, 1 Sep 2026, Bob\n<b@x.com> wrote:",
    ]) {
      const { body } = cleanReportBody(`${OWN}\n\n${marker}\n> old`, "Re: x", false);
      expect(body).toBe(OWN);
    }
  });

  test("cuts a trailing '>' block but keeps inline replies between quotes", () => {
    expect(cleanReportBody(`${OWN}\n\n> old line\n>\n> more`, "Re: x", false).body).toBe(OWN);
    const inline = `> question one?\n${OWN}\n> question two?\nYes, also done today.`;
    expect(cleanReportBody(inline, "Re: x", false).body).toBe(inline);
  });

  test("keeps everything when includeQuoted is set, for forwards, or when the own text is too short", () => {
    const raw = `${OWN}\n\nFrom: Bob\nSent: Monday\n\nOld text`;
    expect(cleanReportBody(raw, "Re: x", true)).toEqual({ body: raw, quotedChars: 0 });
    expect(cleanReportBody(raw, "WG: x", false).quotedChars).toBe(0);
    expect(cleanReportBody("FYI\n\nFrom: Bob\nSent: Monday\n\nOld text", "Re: x", false).quotedChars).toBe(0);
  });

  test("normalises line endings, drops mailto duplicates, blank-line runs and the signature", () => {
    const raw = "Mail bob@x.com<mailto:bob@x.com>  \r\n\r\n\r\n\r\nThanks\r\n-- \r\nBob\r\nACME Corp";
    expect(cleanReportBody(raw, "x", false)).toEqual({ body: "Mail bob@x.com\n\nThanks", quotedChars: 0 });
  });
});
