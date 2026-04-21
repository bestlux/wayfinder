import type { SelectionRef, SingletonChoiceMeta } from "../../types.js";
import { formatSlug } from "../formatting.js";

interface NamedDocumentLike {
  name?: unknown;
  system?: {
    slug?: unknown;
    level?: {
      value?: unknown;
    };
    rules?: unknown;
  };
}

export function discoverSingletonChoiceMeta(args: {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  sourceDocument: unknown;
  sourceSelection: SelectionRef;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): SingletonChoiceMeta[] {
  const { sourceItemType, sourceDocument, sourceSelection, extractSlug, localize } = args;
  const document = sourceDocument as NamedDocumentLike | null | undefined;
  const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
  const level = toFeatureLevel(document?.system?.level?.value);

  return findRelevantRules(sourceDocument).flatMap((rule, ruleIndex) => {
    const flag = extractChoiceKey(rule);
    if (rule.key !== "ChoiceSet" || !flag || !Array.isArray(rule.choices)) {
      return [];
    }

    const options = rule.choices
      .filter((choice): choice is { label?: unknown; value?: unknown; img?: unknown } => isRecord(choice))
      .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
      .map((choice) => ({
        value: String(choice.value),
        label: resolveChoiceLabel(
          typeof choice.label === "string" ? choice.label : undefined,
          String(choice.value),
          localize
        ),
        img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
        detail: null,
      }));

    if (options.length === 0) {
      return [];
    }

    return [
      {
        slotId: `singleton-choice-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
        sourceItemType,
        sourcePackId: sourceSelection.packId,
        sourceDocumentId: sourceSelection.documentId,
        sourceUuid: sourceSelection.uuid,
        sourceName: toNonEmptyString(document?.name) ?? sourceSelection.name,
        sourceRuleIndex: ruleIndex,
        flag,
        prompt: resolvePrompt(rule.prompt, localize),
        options,
      } satisfies SingletonChoiceMeta,
    ];
  });
}

function findRelevantRules(document: unknown): Array<Record<string, unknown>> {
  const rules = (document as NamedDocumentLike | null | undefined)?.system?.rules;
  return Array.isArray(rules) ? rules.filter(isRecord) : [];
}

function extractChoiceKey(rule: Record<string, unknown>): string | null {
  const candidates = [rule.flag, rule.rollOption, rule.slug];
  for (const candidate of candidates) {
    const normalized = toNonEmptyString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function resolvePrompt(prompt: unknown, localize: (value: string) => string): string | null {
  const raw = toNonEmptyString(prompt);
  if (!raw) {
    return null;
  }

  const localized = localize(raw);
  return localized && localized !== raw ? localized : raw;
}

function resolveChoiceLabel(
  rawLabel: string | undefined,
  fallbackValue: string,
  localize: (value: string) => string
): string {
  const trimmed = rawLabel?.trim();
  if (!trimmed) {
    return formatSlug(fallbackValue);
  }

  const localized = localize(trimmed);
  return localized && localized !== trimmed ? localized : trimmed;
}

function toFeatureLevel(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : 1;
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
