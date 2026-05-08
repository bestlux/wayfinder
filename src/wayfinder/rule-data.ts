import type { ChoicePredicate } from "../types.js";

interface RuleDocumentLike {
  system?: {
    level?: {
      value?: unknown;
    };
    rules?: unknown;
  };
}

export function getDocumentRules(document: unknown): Array<Record<string, unknown>> {
  const rules = (document as RuleDocumentLike | null | undefined)?.system?.rules;
  return Array.isArray(rules) ? rules.filter(isRecord) : [];
}

export function extractChoiceKey(rule: Record<string, unknown>): string | null {
  const candidates = [rule.flag, rule.rollOption, rule.slug];
  for (const candidate of candidates) {
    const normalized = toNonEmptyString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function toFeatureLevel(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

export function documentFeatureLevel(document: unknown): number {
  return toFeatureLevel((document as RuleDocumentLike | null | undefined)?.system?.level?.value);
}

export function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isChoicePredicate(value: unknown): value is ChoicePredicate {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => isChoicePredicate(entry));
  }

  if (!isRecord(value)) {
    return false;
  }

  if ("or" in value && value.or !== undefined && (!Array.isArray(value.or) || !value.or.every(isChoicePredicate))) {
    return false;
  }

  if ("nor" in value && value.nor !== undefined && (!Array.isArray(value.nor) || !value.nor.every(isChoicePredicate))) {
    return false;
  }

  if ("not" in value && value.not !== undefined && !isChoicePredicate(value.not)) {
    return false;
  }

  return true;
}

export function matchesChoicePredicateList(
  predicate: ChoicePredicate[],
  matchesString: (statement: string) => boolean
): boolean {
  return predicate.every((entry) => matchesChoicePredicate(entry, matchesString));
}

export function matchesChoicePredicate(
  predicate: ChoicePredicate,
  matchesString: (statement: string) => boolean
): boolean {
  if (typeof predicate === "string") {
    return matchesString(predicate);
  }

  if (Array.isArray(predicate)) {
    return matchesChoicePredicateList(predicate, matchesString);
  }

  if (Array.isArray(predicate.or)) {
    return predicate.or.some((entry) => matchesChoicePredicate(entry, matchesString));
  }

  if (Array.isArray(predicate.nor)) {
    return predicate.nor.every((entry) => !matchesChoicePredicate(entry, matchesString));
  }

  if (predicate.not) {
    return !matchesChoicePredicate(predicate.not, matchesString);
  }

  return true;
}

export function predicateIncludesString(predicate: ChoicePredicate, target: string): boolean {
  if (typeof predicate === "string") {
    return predicate.includes(target);
  }

  if (Array.isArray(predicate)) {
    return predicate.some((entry) => predicateIncludesString(entry, target));
  }

  if (!isRecord(predicate)) {
    return false;
  }

  return (
    (Array.isArray(predicate.or) && predicate.or.some((entry) => predicateIncludesString(entry, target))) ||
    (Array.isArray(predicate.nor) && predicate.nor.some((entry) => predicateIncludesString(entry, target))) ||
    (!!predicate.not && predicateIncludesString(predicate.not, target))
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
