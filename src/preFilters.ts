import type { PreFilterField, PreFilterOperator, PreFilterRule } from "./optionsParams";

/** The message fields a pre-filter rule can be matched against. */
export interface PreFilterCandidate {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export const PRE_FILTER_FIELDS: ReadonlyArray<{ value: PreFilterField; label: string }> = [
  { value: "from", label: "From" },
  { value: "to", label: "To" },
  { value: "subject", label: "Subject" },
  { value: "body", label: "Body" },
];

export const PRE_FILTER_OPERATORS: ReadonlyArray<{ value: PreFilterOperator; label: string }> = [
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "is", label: "is" },
  { value: "regex", label: "matches regex" },
];

function isPreFilterField(value: string): value is PreFilterField {
  return PRE_FILTER_FIELDS.some((field) => field.value === value);
}

function isPreFilterOperator(value: string): value is PreFilterOperator {
  return PRE_FILTER_OPERATORS.some((operator) => operator.value === value);
}

/** Coerce an arbitrary stored/DOM string to a known field, defaulting to "from". */
export function toPreFilterField(value: string): PreFilterField {
  return isPreFilterField(value) ? value : "from";
}

/** Coerce an arbitrary stored/DOM string to a known operator, defaulting to "contains". */
export function toPreFilterOperator(value: string): PreFilterOperator {
  return isPreFilterOperator(value) ? value : "contains";
}

function fieldValue(candidate: PreFilterCandidate, field: PreFilterField): string {
  switch (field) {
    case "to":
      return candidate.to;
    case "subject":
      return candidate.subject;
    case "body":
      return candidate.body;
    default:
      return candidate.from;
  }
}

/**
 * Does one pre-filter rule match a message? Comparisons are case-insensitive; a rule with an empty
 * value never matches, and an invalid regex is reported once and treated as a non-match rather than
 * aborting the whole organise run.
 */
export function matchesPreFilterRule(rule: PreFilterRule, candidate: PreFilterCandidate): boolean {
  const needle = rule.value.trim();
  if (!needle) return false;

  const haystack = fieldValue(candidate, toPreFilterField(rule.field));

  switch (toPreFilterOperator(rule.operator)) {
    case "contains":
      return haystack.toLowerCase().includes(needle.toLowerCase());
    case "notContains":
      return !haystack.toLowerCase().includes(needle.toLowerCase());
    case "is":
      return haystack.trim().toLowerCase() === needle.toLowerCase();
    case "regex":
      try {
        return new RegExp(needle, "i").test(haystack);
      } catch (e) {
        console.warn("PRE-FILTER: invalid regex, rule skipped:", needle, e);
        return false;
      }
  }
}

/** First matching rule wins — rules are evaluated top to bottom, like Thunderbird's own filters. */
export function findMatchingPreFilterRule(rules: PreFilterRule[], candidate: PreFilterCandidate): PreFilterRule | null {
  for (const rule of rules) {
    if (matchesPreFilterRule(rule, candidate)) return rule;
  }
  return null;
}
