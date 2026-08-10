import { toCompendiumItemUuid } from "../shared/compendium.js";
import type { OptionContext, PendingStep, SelectionRef } from "../types.js";
import { buildChoiceRollOptions, discoverClassChoiceMeta } from "../wayfinder/class-choice/rule-discovery.js";
import { discoverFlagChoiceMeta } from "../wayfinder/flag-choice/rule-discovery.js";
import { discoverGrantSelectionMeta } from "../wayfinder/grant-choice/rule-discovery.js";
import { matchesChoiceSetRulePredicate } from "../wayfinder/rule-data.js";
import { discoverSingletonChoiceSpecs } from "../wayfinder/singleton-choice/rule-discovery.js";
import { discoverSourceSkillTrainingMeta } from "../wayfinder/skill-training/source-discovery.js";
import type { StaticGrantChoiceSource } from "../wayfinder/static-grant-choice-sources.js";
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
  staticGrants: StaticGrantEmbeddedChoiceClassification[];
}

export interface StaticGrantEmbeddedChoiceClassification {
  covered: number[];
  uncovered: number[];
  rules: EmbeddedChoiceRuleCoverage[];
  grantRuleIndex: number;
  sourceName: string;
  sourceUuid: string;
}

export interface EmbeddedChoiceClassificationOptions {
  sourceItemType?: EmbeddedChoiceSourceItemType;
  classSlug?: string | null;
  effectiveDeityDocument?: unknown | null;
  localize?: (value: string) => string;
  optionContext?: Pick<OptionContext, "ancestrySlug" | "classSlug" | "deitySelected" | "rollOptions"> | null;
  requireResolvedActorPlaceholders?: boolean;
  staticGrantSources?: StaticGrantChoiceSource[];
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

  if (
    !["ancestry-feat", "class-feat", "archetype-feat", "campaign-feat", "general-feat", "skill-feat"].includes(
      step.slotKind
    )
  ) {
    return false;
  }

  // Suppression is intentionally limited to uncovered ChoiceSets owned by the
  // option itself. Unsupported choices on statically granted children are
  // disclosed on the still-selectable option; hiding those options would turn
  // an honest PF2E handoff into a silent omission.
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

  return ["ancestry-feat", "class-feat", "archetype-feat", "campaign-feat", "general-feat", "skill-feat"].includes(
    step.slotKind
  );
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
  const choiceSetRuleIndexes = getActiveChoiceSetRuleIndexes(entry, options);
  const ownChoices = classifyOwnEmbeddedChoices(entry, packId, choiceSetRuleIndexes, options);
  const staticGrants = (options.staticGrantSources ?? []).map((source) => {
    const grantedEntry = source.sourceDocument as PackIndexEntry;
    const grantedRuleIndexes = getActiveChoiceSetRuleIndexes(grantedEntry, options);
    const grantedChoices = source.supportsGuidedChoices
      ? classifyOwnEmbeddedChoices(grantedEntry, source.sourceSelection.packId, grantedRuleIndexes, {
          ...options,
          sourceItemType: source.sourceItemType,
          staticGrantSources: [],
        })
      : {
          covered: [],
          uncovered: grantedRuleIndexes,
          rules: grantedRuleIndexes.map((ruleIndex) => ({ ruleIndex, coveredBy: [] })),
        };
    return {
      ...grantedChoices,
      grantRuleIndex: source.grantRuleIndex,
      sourceName: source.sourceSelection.name,
      sourceUuid: source.sourceSelection.uuid,
    } satisfies StaticGrantEmbeddedChoiceClassification;
  });

  return { ...ownChoices, staticGrants };
}

function classifyOwnEmbeddedChoices(
  entry: PackIndexEntry,
  packId: string,
  choiceSetRuleIndexes: number[],
  options: EmbeddedChoiceClassificationOptions
): Omit<EmbeddedChoiceClassification, "staticGrants"> {
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
  const activeRollOptions = buildActiveRuleRollOptions(options);
  for (const ruleIndex of choiceSetRuleIndexes) {
    coveredByRuleIndex.set(ruleIndex, new Set());
  }

  for (const meta of discoverGrantSelectionMeta({
    sourceItemType,
    sourceDocument: entry,
    sourceSelection,
    sourceLevel: numericOrNull(entry?.system?.level?.value) ?? undefined,
    extractSlug: extractEntrySlug,
    activeRollOptions,
  })) {
    markCovered(coveredByRuleIndex, meta.selectorRuleIndex, "grant-choice");
  }

  markFlagChoiceCoverage(entry, sourceItemType, sourceSelection, coveredByRuleIndex, options);

  if (sourceItemType === "feat") {
    markFeatSingletonCoverage(
      entry,
      sourceSelection,
      coveredByRuleIndex,
      options.localize ?? identity,
      activeRollOptions
    );
    markFeatSkillTrainingCoverage(
      entry,
      sourceSelection,
      coveredByRuleIndex,
      options.localize ?? identity,
      activeRollOptions
    );
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

export function buildStaticGrantChoiceDisclosure(classification: EmbeddedChoiceClassification): string | null {
  const disclosures = classification.staticGrants.flatMap((grant) => {
    if (grant.uncovered.length === 0) {
      return [];
    }

    const noun = deriveChoiceNoun(grant.sourceName);
    if (!noun) {
      const countLabel = grant.uncovered.length === 1 ? "a choice" : `${grant.uncovered.length} choices`;
      return [`PF2E will ask you to make ${countLabel} for ${grant.sourceName} when this is applied.`];
    }

    const countLabel =
      grant.uncovered.length === 1
        ? `${indefiniteArticle(noun)} ${noun}`
        : `${grant.uncovered.length} ${pluralize(noun)}`;
    return [`PF2E will ask you to choose ${countLabel} when this is applied.`];
  });

  return disclosures.length > 0 ? disclosures.join(" ") : null;
}

function deriveChoiceNoun(sourceName: string): string | null {
  const words = sourceName.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  return words.length > 0 ? singularize(words.at(-1)!.toLowerCase()) : null;
}

function singularize(noun: string): string {
  return noun.endsWith("s") && !noun.endsWith("ss") ? noun.slice(0, -1) : noun;
}

function pluralize(noun: string): string {
  if (noun.endsWith("y") && !/[aeiou]y$/i.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }
  return noun.endsWith("s") ? noun : `${noun}s`;
}

function indefiniteArticle(noun: string): "a" | "an" {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

function markFlagChoiceCoverage(
  entry: PackIndexEntry,
  sourceItemType: EmbeddedChoiceSourceItemType,
  sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  options: EmbeddedChoiceClassificationOptions
): void {
  const activeRollOptions = buildActiveRuleRollOptions(options);
  for (const meta of discoverFlagChoiceMeta({
    sourceItemType,
    sourceDocument: entry,
    sourceSelection,
    sourceLevel: numericOrNull(entry?.system?.level?.value) ?? undefined,
    extractSlug: extractEntrySlug,
    actorContext: {
      ancestrySlug: options.optionContext?.ancestrySlug,
      classSlug: options.optionContext?.classSlug,
    },
    requireResolvedActorPlaceholders: options.requireResolvedActorPlaceholders,
    activeRollOptions,
  })) {
    markCovered(coveredByRuleIndex, meta.sourceRuleIndex, "flag-choice");
  }
}

function markFeatSingletonCoverage(
  entry: PackIndexEntry,
  _sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  localize: (value: string) => string,
  activeRollOptions: ReadonlySet<string>
): void {
  for (const spec of discoverSingletonChoiceSpecs({
    sourceItemType: "feat",
    sourceDocument: entry,
    sourceSlug: extractEntrySlug(entry) ?? String(entry._id ?? "feat"),
    localize,
    activeRollOptions,
  })) {
    markCovered(coveredByRuleIndex, spec.sourceRuleIndex, "singleton-choice");
  }
}

function markFeatSkillTrainingCoverage(
  entry: PackIndexEntry,
  sourceSelection: SelectionRef,
  coveredByRuleIndex: Map<number, Set<EmbeddedChoiceCoverageLane>>,
  localize: (value: string) => string,
  activeRollOptions: ReadonlySet<string>
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
    activeRollOptions,
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
  const activeRollOptions = buildActiveRuleRollOptions(options);
  for (const option of buildChoiceRollOptions(options.effectiveDeityDocument ?? null)) {
    activeRollOptions.add(option);
  }
  for (const meta of discoverClassChoiceMeta({
    sourceDocument: entry,
    sourceSelection,
    classSlug: options.classSlug ?? options.optionContext?.classSlug ?? null,
    extractSlug: extractEntrySlug,
    localize: options.localize ?? identity,
    rollOptions: activeRollOptions,
    assumeFirstChoiceSelection: true,
  })) {
    markCovered(coveredByRuleIndex, meta.sourceRuleIndex, "class-choice");
  }
}

function getActiveChoiceSetRuleIndexes(entry: PackIndexEntry, options: EmbeddedChoiceClassificationOptions): number[] {
  const activeRollOptions = buildActiveRuleRollOptions(options);
  const rules = entry?.system?.rules;
  return Array.isArray(rules)
    ? rules.flatMap((rule, ruleIndex) =>
        isRecord(rule) && rule.key === "ChoiceSet" && matchesChoiceSetRulePredicate(rule, activeRollOptions)
          ? [ruleIndex]
          : []
      )
    : [];
}

function buildActiveRuleRollOptions(options: EmbeddedChoiceClassificationOptions): Set<string> {
  const active = new Set((options.optionContext?.rollOptions ?? []).map((option) => option.trim().toLowerCase()));
  const classSlug = options.optionContext?.classSlug ?? options.classSlug;
  if (classSlug) {
    active.add(`class:${classSlug}`.toLowerCase());
  }
  if (options.optionContext?.ancestrySlug) {
    active.add(`ancestry:${options.optionContext.ancestrySlug}`.toLowerCase());
  }
  if (options.optionContext?.deitySelected) {
    active.add("deity");
  }
  return active;
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
