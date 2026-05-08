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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
