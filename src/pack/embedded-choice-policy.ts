import { toCompendiumItemUuid } from "../shared/compendium.js";
import type { OptionContext, PendingStep, SelectionRef } from "../types.js";
import { buildChoiceRollOptions, discoverClassChoiceMeta } from "../wayfinder/class-choice/rule-discovery.js";
import { discoverFlagChoiceMeta } from "../wayfinder/flag-choice/rule-discovery.js";
import { discoverGrantSelectionMeta } from "../wayfinder/grant-choice/rule-discovery.js";
import { discoverSingletonChoiceSpecs } from "../wayfinder/singleton-choice/rule-discovery.js";
import { discoverSourceSkillTrainingMeta } from "../wayfinder/skill-training/source-discovery.js";
import type { PackIndexEntry } from "./access.js";
import { extractEntrySlug, isRecord, numericOrNull, resolveFeatType } from "./entry.js";

type EmbeddedChoiceSourceItemType = "feat" | "classfeature";
type EmbeddedChoiceCoverageLane =
  | "grant-choice"
  | "flag-choice"
  | "singleton-choice"
  | "skill-training"
  | "class-choice";

export interface EmbeddedChoiceRuleCoverage {
  ruleIndex: number;
  coveredBy: EmbeddedChoiceCoverageLane[];
}

export interface EmbeddedChoiceClassification {
  covered: number[];
  uncovered: number[];
  rules: EmbeddedChoiceRuleCoverage[];
}

export interface EmbeddedChoiceClassificationOptions {
  sourceItemType?: EmbeddedChoiceSourceItemType;
  classSlug?: string | null;
  effectiveDeityDocument?: unknown | null;
  localize?: (value: string) => string;
  optionContext?: Pick<OptionContext, "ancestrySlug" | "classSlug"> | null;
  requireResolvedActorPlaceholders?: boolean;
}

export function hasUnsupportedEmbeddedChoiceSet(
  entry: PackIndexEntry,
  packId: string,
  step: PendingStep,
  optionContext?: OptionContext
): boolean {
  if (!entryHasChoiceSetRule(entry)) {
    return false;
  }

  if (step.kind === "class-branch") {
    // Predicate-backed branch steps come from a curated selector rule whose
    // options were already guided end-to-end before per-rule coverage existed
    // (for example Psychic conscious minds); keep those visible. Tag-based
    // branch steps had no such curation, so classify their options per rule.
    if (Array.isArray(step.filters?.predicate) && step.filters.predicate.length > 0) {
      return false;
    }

    return (
      classifyEmbeddedChoices(entry, packId, {
        sourceItemType: "classfeature",
        optionContext,
        requireResolvedActorPlaceholders: true,
      }).uncovered.length > 0
    );
  }

  if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
    return false;
  }

  if (!["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind)) {
    return false;
  }

  return (
    classifyEmbeddedChoices(entry, packId, {
      sourceItemType: "feat",
      optionContext,
      requireResolvedActorPlaceholders: true,
    }).uncovered.length > 0
  );
}

export function hidesUnsupportedEmbeddedChoiceSets(step: PendingStep): boolean {
  if (step.kind === "class-branch") {
    return !Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0;
  }

  if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
    return false;
  }

  return ["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}

function entryHasChoiceSetRule(entry: PackIndexEntry): boolean {
  const rules = entry?.system?.rules;
  return Array.isArray(rules) && rules.some((rule) => isRecord(rule) && rule.key === "ChoiceSet");
}

export function classifyEmbeddedChoices(
  entry: PackIndexEntry,
  packId: string,
  options: EmbeddedChoiceClassificationOptions = {}
): EmbeddedChoiceClassification {
  const choiceSetRuleIndexes = getChoiceSetRuleIndexes(entry);
  if (choiceSetRuleIndexes.length === 0) {
    return { covered: [], uncovered: [], rules: [] };
  }

  const sourceItemType = options.sourceItemType ?? inferSourceItemType(entry, packId);
  const sourceSelection = sourceSelectionFromEntry(entry, packId);
  if (!sourceSelection) {
    return {
      covered: [],
      uncovered: choiceSetRuleIndexes,
      rules: choiceSetRuleIndexes.map((ruleIndex) => ({ ruleIndex, coveredBy: [] })),
    };
  }

  const coveredByRuleIndex = new Map<number, Set<EmbeddedChoiceCoverageLane>>();
  for (const ruleIndex of choiceSetRuleIndexes) {
    coveredByRuleIndex.set(ruleIndex, new Set());
  }

  for (const meta of discoverGrantSelectionMeta({
    sourceItemType,
    sourceDocument: entry,
    sourceSelection,
    extractSlug: extractEntrySlug,
  })) {
    markCovered(coveredByRuleIndex, meta.selectorRuleIndex, "grant-choice");
  }

  markFlagChoiceCoverage(entry, sourceItemType, sourceSelection, coveredByRuleIndex, options);

  if (sourceItemType === "feat") {
    markFeatSingletonCoverage(entry, sourceSelection, coveredByRuleIndex, options.localize ?? identity);
    markFeatSkillTrainingCoverage(entry, sourceSelection, coveredByRuleIndex, options.localize ?? identity);
  }

  if (sourceItemType === "classfeature") {
    markClassChoiceCoverage(entry, sourceSelection, coveredByRuleIndex, options);
  }

  const rules = choiceSetRuleIndexes.map((ruleIndex) => ({
    ruleIndex,
    coveredBy: Array.from(coveredByRuleIndex.get(ruleIndex) ?? []),
  }));

  return {
    covered: rules.filter((rule) => rule.coveredBy.length > 0).map((rule) => rule.ruleIndex),
    uncovered: rules.filter((rule) => rule.coveredBy.length === 0).map((rule) => rule.ruleIndex),
    rules,
  };
}

function markFlagChoiceCoverage(
  entry: PackIndexEntry,
  sourceItemType: EmbeddedChoiceSourceItemType,
  sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  options: EmbeddedChoiceClassificationOptions
): void {
  for (const meta of discoverFlagChoiceMeta({
    sourceItemType,
    sourceDocument: entry,
    sourceSelection,
    extractSlug: extractEntrySlug,
    actorContext: {
      ancestrySlug: options.optionContext?.ancestrySlug,
      classSlug: options.optionContext?.classSlug,
    },
    requireResolvedActorPlaceholders: options.requireResolvedActorPlaceholders,
  })) {
    markCovered(coveredByRuleIndex, meta.sourceRuleIndex, "flag-choice");
  }
}

function markFeatSingletonCoverage(
  entry: PackIndexEntry,
  _sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  localize: (value: string) => string
): void {
  for (const spec of discoverSingletonChoiceSpecs({
    sourceItemType: "feat",
    sourceDocument: entry,
    sourceSlug: extractEntrySlug(entry) ?? String(entry._id ?? "feat"),
    localize,
  })) {
    markCovered(coveredByRuleIndex, spec.sourceRuleIndex, "singleton-choice");
  }
}

function markFeatSkillTrainingCoverage(
  entry: PackIndexEntry,
  sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  localize: (value: string) => string
): void {
  const training = discoverSourceSkillTrainingMeta({
    sources: [
      {
        sourceItemType: "feat",
        sourceSelection,
        sourceDocument: entry,
      },
    ],
    localize,
  });

  for (const choice of [...training.choiceRules, ...training.loreChoices]) {
    const sourceRuleIndex = choice.persistence?.sourceRuleIndex;
    if (typeof sourceRuleIndex === "number") {
      markCovered(coveredByRuleIndex, sourceRuleIndex, "skill-training");
    }
  }
}

function markClassChoiceCoverage(
  entry: PackIndexEntry,
  sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  options: EmbeddedChoiceClassificationOptions
): void {
  for (const meta of discoverClassChoiceMeta({
    sourceDocument: entry,
    sourceSelection,
    classSlug: options.classSlug ?? null,
    extractSlug: extractEntrySlug,
    localize: options.localize ?? identity,
    rollOptions: buildChoiceRollOptions(options.effectiveDeityDocument ?? null),
    assumeFirstChoiceSelection: true,
  })) {
    markCovered(coveredByRuleIndex, meta.sourceRuleIndex, "class-choice");
  }
}

function getChoiceSetRuleIndexes(entry: PackIndexEntry): number[] {
  const rules = entry?.system?.rules;
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.flatMap((rule, ruleIndex) => (isRecord(rule) && rule.key === "ChoiceSet" ? [ruleIndex] : []));
}

function markCovered(
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  ruleIndex: number,
  lane: EmbeddedChoiceCoverageLane
): void {
  coveredByRuleIndex.get(ruleIndex)?.add(lane);
}

function inferSourceItemType(entry: PackIndexEntry, packId: string): EmbeddedChoiceSourceItemType {
  return packId === "pf2e.classfeatures" || resolveFeatType(entry) === "classfeature" ? "classfeature" : "feat";
}

function sourceSelectionFromEntry(entry: PackIndexEntry, packId: string): SelectionRef | null {
  if (entry.type !== "feat") {
    return null;
  }

  const documentId = String(entry._id ?? "");
  if (!documentId) {
    return null;
  }

  return {
    slotId: "embedded-choice-probe",
    packId,
    documentId,
    uuid: toCompendiumItemUuid(packId, documentId),
    itemType: "feat",
    featType: resolveFeatType(entry),
    name: String(entry.name ?? documentId),
    level: numericOrNull(entry?.system?.level?.value),
  };
}

function identity(value: string): string {
  return value;
}
