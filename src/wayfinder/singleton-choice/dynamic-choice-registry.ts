import type { ChoicePredicate, ProjectedDynamicChoice } from "../../types.js";
import {
  getDocumentRules,
  isChoicePredicate,
  isRecord,
  matchesChoicePredicateListAgainstRollOptions,
  toNonEmptyString,
} from "../rule-data.js";

export const EXEMPLAR_IKON_CHOICE_PATH = "flags.system.exemplar.ikons";

const REGISTERED_DYNAMIC_CHOICE_PATHS = new Set([EXEMPLAR_IKON_CHOICE_PATH]);

export function projectRegisteredDynamicChoices(documents: unknown[]): Record<string, ProjectedDynamicChoice[]> {
  const choicesByPath = new Map<string, Map<string, ProjectedDynamicChoice>>();

  for (const document of documents) {
    for (const rule of getDocumentRules(document)) {
      const path = toNonEmptyString(rule.path);
      if (
        rule.key !== "ActiveEffectLike" ||
        rule.mode !== "add" ||
        !path ||
        !REGISTERED_DYNAMIC_CHOICE_PATHS.has(path)
      ) {
        continue;
      }

      const choice = projectedChoice(rule.value);
      if (!choice) {
        continue;
      }

      const choices = choicesByPath.get(path) ?? new Map<string, ProjectedDynamicChoice>();
      choices.set(choice.value, choice);
      choicesByPath.set(path, choices);
    }
  }

  return Object.fromEntries(
    Array.from(choicesByPath, ([path, choices]) => [
      path,
      Array.from(choices.values()).sort((left, right) => left.value.localeCompare(right.value)),
    ])
  );
}

export function resolveRegisteredDynamicChoices(args: {
  path: string;
  projectedChoices?: Readonly<Record<string, ProjectedDynamicChoice[]>>;
  sourceDocument: unknown;
}): ProjectedDynamicChoice[] | null {
  if (!REGISTERED_DYNAMIC_CHOICE_PATHS.has(args.path)) {
    return null;
  }

  const activeRollOptions = sourceCompatibilityRollOptions(args.sourceDocument);
  return (args.projectedChoices?.[args.path] ?? []).filter((choice) =>
    matchesChoicePredicateListAgainstRollOptions(choice.predicate, activeRollOptions)
  );
}

function projectedChoice(value: unknown): ProjectedDynamicChoice | null {
  if (!isRecord(value)) {
    return null;
  }

  const choiceValue = toNonEmptyString(value.value);
  const label = toNonEmptyString(value.label);
  const predicate = normalizePredicate(value.predicate);
  return choiceValue && label && predicate ? { value: choiceValue, label, predicate } : null;
}

function normalizePredicate(value: unknown): ChoicePredicate[] | null {
  if (value === undefined) {
    return [];
  }

  const predicate = Array.isArray(value) ? value.filter(isChoicePredicate) : isChoicePredicate(value) ? [value] : null;
  return predicate && (!Array.isArray(value) || predicate.length === value.length) ? predicate : null;
}

function sourceCompatibilityRollOptions(sourceDocument: unknown): Set<string> {
  const otherTags = (sourceDocument as { system?: { traits?: { otherTags?: unknown } } } | null)?.system?.traits
    ?.otherTags;
  return new Set(
    (Array.isArray(otherTags) ? otherTags : [])
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => `parent:tag:${tag.trim().toLowerCase()}`)
      .filter((tag) => tag !== "parent:tag:")
  );
}
