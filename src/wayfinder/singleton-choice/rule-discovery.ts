import type { ChoicePredicate, SelectionRef, SingletonChoiceMeta } from "../../types.js";
import {
  getConfiguredSkills,
  isConfiguredSkillSlug,
  resolveSkillLabel,
  type SkillConfigMap,
} from "../class-choice/skill-config.js";
import { formatSlug } from "../formatting.js";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  isChoicePredicate,
  isRecord,
  toNonEmptyString,
} from "../rule-data.js";

interface NamedDocumentLike {
  name?: unknown;
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
  includeTrainingChoices?: boolean;
}): SingletonChoiceSpec[] {
  const { sourceItemType, sourceDocument, sourceSlug, sourceLevel, localize, includeTrainingChoices = false } = args;
  const level = sourceLevel ?? documentFeatureLevel(sourceDocument);
  const configuredSkills = getConfiguredSkills();
  const rules = getDocumentRules(sourceDocument);

  return rules.flatMap((rule, sourceRuleIndex) => {
    const flag = extractChoiceKey(rule);
    if (rule.key !== "ChoiceSet" || !flag) {
      return [];
    }
    if (isGrantSelectorChoice(rules, flag)) {
      return [];
    }

    const options = resolveChoiceOptions(rule, localize, configuredSkills);
    if (
      !options ||
      options.options.length === 0 ||
      (!includeTrainingChoices && shouldSkipSingletonChoice(args.sourceItemType, options.optionDomain))
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

function isGrantSelectorChoice(rules: Array<Record<string, unknown>>, flag: string): boolean {
  return rules.some(
    (entry) =>
      entry.key === "GrantItem" && typeof entry.uuid === "string" && entry.uuid.includes(`rulesSelections.${flag}`)
  );
}

function shouldSkipSingletonChoice(
  sourceItemType: SingletonChoiceMeta["sourceItemType"],
  optionDomain: "generic" | "skill" | "lore"
): boolean {
  // Starting skill and lore choices belong to the skill training workflow so
  // they stay in one draft store and do not reappear as separate singleton steps.
  return ["ancestry", "heritage", "background", "class", "feat"].includes(sourceItemType) && optionDomain !== "generic";
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
