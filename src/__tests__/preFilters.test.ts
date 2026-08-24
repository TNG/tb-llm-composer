import { describe, expect, test } from "vitest";
import type { PreFilterRule } from "../optionsParams";
import {
  findMatchingPreFilterRule,
  matchesPreFilterRule,
  type PreFilterCandidate,
  toPreFilterField,
  toPreFilterOperator,
} from "../preFilters";

const candidate: PreFilterCandidate = {
  from: "Newsletter <news@Example.com>",
  to: "me@example.com, team@example.com",
  subject: "[CI] Nightly build failed",
  body: "The pipeline is red again.",
};

function rule(partial: Partial<PreFilterRule>): PreFilterRule {
  return { field: "from", operator: "contains", value: "", targetFolderPath: "", ...partial };
}

describe("matchesPreFilterRule", () => {
  test("contains is case-insensitive on the chosen field", () => {
    expect(matchesPreFilterRule(rule({ value: "@example.com" }), candidate)).toBe(true);
    expect(matchesPreFilterRule(rule({ field: "subject", value: "nightly" }), candidate)).toBe(true);
    expect(matchesPreFilterRule(rule({ field: "body", value: "pipeline" }), candidate)).toBe(true);
    expect(matchesPreFilterRule(rule({ field: "to", value: "team@" }), candidate)).toBe(true);
    expect(matchesPreFilterRule(rule({ field: "subject", value: "release" }), candidate)).toBe(false);
  });

  test("notContains inverts contains", () => {
    expect(matchesPreFilterRule(rule({ operator: "notContains", value: "other.org" }), candidate)).toBe(true);
    expect(matchesPreFilterRule(rule({ operator: "notContains", value: "example.com" }), candidate)).toBe(false);
  });

  test("is compares the whole (trimmed) field", () => {
    expect(
      matchesPreFilterRule(rule({ field: "body", operator: "is", value: "the pipeline is red again." }), candidate),
    ).toBe(true);
    expect(matchesPreFilterRule(rule({ field: "body", operator: "is", value: "pipeline" }), candidate)).toBe(false);
  });

  test("regex matches case-insensitively", () => {
    expect(matchesPreFilterRule(rule({ field: "subject", operator: "regex", value: "^\\[ci\\]" }), candidate)).toBe(
      true,
    );
    expect(matchesPreFilterRule(rule({ field: "subject", operator: "regex", value: "^build" }), candidate)).toBe(false);
  });

  test("an invalid regex never matches instead of throwing", () => {
    expect(matchesPreFilterRule(rule({ field: "subject", operator: "regex", value: "[unclosed" }), candidate)).toBe(
      false,
    );
  });

  test("an empty value never matches, even for notContains", () => {
    expect(matchesPreFilterRule(rule({ value: "   " }), candidate)).toBe(false);
    expect(matchesPreFilterRule(rule({ operator: "notContains", value: "" }), candidate)).toBe(false);
  });
});

describe("findMatchingPreFilterRule", () => {
  test("returns the first matching rule", () => {
    const first = rule({ field: "subject", value: "nightly", targetFolderPath: "/CI" });
    const second = rule({ field: "from", value: "@example.com", targetFolderPath: "/News" });
    expect(findMatchingPreFilterRule([first, second], candidate)).toBe(first);
    expect(findMatchingPreFilterRule([second, first], candidate)).toBe(second);
  });

  test("returns null when nothing matches", () => {
    expect(findMatchingPreFilterRule([rule({ value: "nobody@nowhere" })], candidate)).toBeNull();
  });
});

describe("coercion of stored values", () => {
  test("unknown field/operator fall back to sensible defaults", () => {
    expect(toPreFilterField("bogus")).toBe("from");
    expect(toPreFilterField("subject")).toBe("subject");
    expect(toPreFilterOperator("bogus")).toBe("contains");
    expect(toPreFilterOperator("regex")).toBe("regex");
  });
});
