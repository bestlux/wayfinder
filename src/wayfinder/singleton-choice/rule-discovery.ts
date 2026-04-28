import type { ChoicePredicate, SelectionRef, SingletonChoiceMeta } from "../../types.js";
import {
  getConfiguredSkills,
  isConfiguredSkillSlug,
  resolveSkillLabel,
  type SkillConfigMap,
} from "../class-choice/skill-config.js";
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

export interface SingletonChoiceSpec {
  sourceRuleIndex: number;
  slotId: string;
  flag: string;
  prompt: string | null;
  predicate: ChoicePredicate[];
  rollOption: string | null;
  optionDomain: "generic" | "skill" | "lore";
  options: Array<{
    value: string;
    label: string;
    img: string | null;
    detail: string | null;
  }>;
}

export function discoverSingletonChoiceMeta(args: {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  sourceDocument: unknown;
  sourceSelection: SelectionRef;
  sourceLevel?: number;
  extractSlug: (document: unknown) => string | null;
  localize: (value: string) => string;
}): SingletonChoiceMeta[] {
  const { sourceItemType, sourceDocument, sourceSelection, sourceLevel, extractSlug, localize } = args;
  const document = sourceDocument as NamedDocumentLike | null | undefined;
  return discoverSingletonChoiceSpecs({
    sourceItemType,
    sourceDocument,
    sourceSlug: extractSlug(sourceDocument) ?? sourceSelection.documentId,
    sourceLevel,
    localize,
  }).map(
    (choice) =>
      ({
        slotId: choice.slotId,
        sourceItemType,
        sourcePackId: sourceSelection.packId,
        sourceDocumentId: sourceSelection.documentId,
        sourceUuid: sourceSelection.uuid,
        sourceName: toNonEmptyString(document?.name) ?? sourceSelection.name,
        sourceRuleIndex: choice.sourceRuleIndex,
        flag: choice.flag,
        prompt: choice.prompt,
        predicate: choice.predicate,
        rollOption: choice.rollOption,
        options: choice.options,
      }) satisfies SingletonChoiceMeta
  );
}

export function discoverSingletonChoiceSpecs(args: {
  sourceItemType: SingletonChoiceMeta["sourceItemType"];
  sourceDocument: unknown;
  sourceSlug: string;
  sourceLevel?: number;
  localize: (value: string) => string;
}): SingletonChoiceSpec[] {
  const { sourceItemType, sourceDocument, sourceSlug, sourceLevel, localize } = args;
  const document = sourceDocument as NamedDocumentLike | null | undefined;
  const level = sourceLevel ?? toFeatureLevel(document?.system?.level?.value);
  const configuredSkills = getConfiguredSkills();

  return findRelevantRules(sourceDocument).flatMap((rule, sourceRuleIndex) => {
    const flag = extractChoiceKey(rule);
    if (rule.key !== "ChoiceSet" || !flag) {
      return [];
    }

    const options = resolveChoiceOptions(rule, localize, configuredSkills);
    if (
      !options ||
      options.options.length === 0 ||
      shouldSkipSingletonChoice(args.sourceItemType, options.optionDomain)
    ) {
      return [];
    }

    return [
      {
        sourceRuleIndex,
        slotId: `singleton-choice-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`,
        flag,
        prompt: resolvePrompt(rule.prompt, localize),
        predicate: extractPredicate(rule.predicate),
        rollOption: toNonEmptyString(rule.rollOption),
        optionDomain: options.optionDomain,
        options: options.options,
      } satisfies SingletonChoiceSpec,
    ];
  });
}

function shouldSkipSingletonChoice(
  sourceItemType: SingletonChoiceMeta["sourceItemType"],
  optionDomain: "generic" | "skill" | "lore"
): boolean {
  // Starting skill and lore choices belong to the skill training workflow so
  // they stay in one draft store and do not reappear as separate singleton steps.
  return ["ancestry", "heritage", "background", "class", "feat"].includes(sourceItemType) && optionDomain !== "generic";
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

function extractPredicate(value: unknown): ChoicePredicate[] {
  return Array.isArray(value) ? value.filter(isChoicePredicate) : [];
}

function resolveChoiceOptions(
  rule: Record<string, unknown>,
  localize: (value: string) => string,
  configuredSkills: SkillConfigMap
): { optionDomain: "generic" | "skill" | "lore"; options: SingletonChoiceSpec["options"] } | null {
  if (Array.isArray(rule.choices)) {
    const options = rule.choices
      .filter((choice): choice is { label?: unknown; value?: unknown; img?: unknown } => isRecord(choice))
      .filter((choice) => typeof choice.value === "string" && choice.value.length > 0)
      .map((choice) => {
        const rawValue = String(choice.value).trim();
        const normalizedSkillValue = rawValue.toLowerCase();
        const skillChoice = isConfiguredSkillSlug(normalizedSkillValue, configuredSkills);
        const value = skillChoice ? normalizedSkillValue : rawValue;
        return {
          value,
          label: skillChoice
            ? resolveSkillLabel(
                normalizedSkillValue,
                typeof choice.label === "string" ? choice.label : undefined,
                localize,
                configuredSkills
              )
            : resolveChoiceLabel(typeof choice.label === "string" ? choice.label : undefined, value, localize),
          img: typeof choice.img === "string" && choice.img.length > 0 ? choice.img : null,
          detail: null,
        };
      });

    if (options.length === 0) {
      return null;
    }

    const everySkill = options.every((choice) => isConfiguredSkillSlug(choice.value, configuredSkills));
    const everyLore = options.every((choice) => /\blore\b/i.test(choice.label));
    return {
      optionDomain: everySkill ? "skill" : everyLore ? "lore" : "generic",
      options,
    };
  }

  const choiceConfig = isRecord(rule.choices) ? rule.choices : null;
  if (choiceConfig?.config === "skills") {
    const options = Object.entries(configuredSkills)
      .map(([slug, entry]) => ({
        value: slug,
        label: resolveSkillLabel(slug, entry.label, localize, configuredSkills),
        img: null,
        detail: null,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));

    return {
      optionDomain: "skill",
      options,
    };
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

function isChoicePredicate(value: unknown): value is ChoicePredicate {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
