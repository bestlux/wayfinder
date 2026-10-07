import { extractDocumentSlug, slugifyName } from "../shared/slug.js";
import { sourceIdOf } from "../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../types.js";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  matchesChoiceSetRulePredicate,
} from "./rule-data.js";

export interface ChoiceRuleSourceContext {
  sourceItemType: string;
  sourceSelection: SelectionRef | null;
  sourceDocument: unknown | null;
  sourceLevel?: number;
}

export function buildProjectedChoiceRuleRollOptions(args: {
  draft: DraftState;
  actorItems: unknown[];
  sources: ChoiceRuleSourceContext[];
  steps?: readonly PendingStep[];
  classSlug?: string | null;
  ancestrySlug?: string | null;
  deitySelected?: boolean;
  skillRanks?: Record<string, number>;
}): Set<string> {
  const active = new Set<string>();
  addOption(active, args.classSlug ? `class:${args.classSlug}` : null);
  addOption(active, args.ancestrySlug ? `ancestry:${args.ancestrySlug}` : null);
  addOption(active, args.deitySelected ? "deity" : null);
  addDraftSingletonRollOptions(active, args.draft);
  for (const option of collectSkillRankRollOptions(args.skillRanks)) {
    addOption(active, option);
  }

  const draftedChoices = args.sources.flatMap((source) => {
    if (!source.sourceDocument || !source.sourceSelection) return [];
    const sourceId = source.sourceSelection.uuid;
    const sourceSlug = sourceSlugFor(source);
    const sourceLevel = source.sourceLevel ?? documentFeatureLevel(source.sourceDocument);
    return getDocumentRules(source.sourceDocument).flatMap((rule, ruleIndex) => {
      const flag = extractChoiceKey(rule);
      const rollOption = normalize(rule.rollOption);
      if (rule.key !== "ChoiceSet" || !flag || !rollOption) return [];
      const values = draftedRuleSelectionValues(
        args.draft,
        source,
        sourceSlug,
        sourceLevel,
        flag,
        rollOption,
        ruleIndex,
        args.steps
      );
      return values.length > 0 ? [{ sourceId, flag, rollOption, rule, values }] : [];
    });
  });
  const overriddenSelections = new Map<string, Set<string>>();
  for (const choice of draftedChoices) {
    const flags = overriddenSelections.get(choice.sourceId) ?? new Set<string>();
    flags.add(choice.flag);
    overriddenSelections.set(choice.sourceId, flags);
  }

  for (const option of collectActorRuleSelectionRollOptions(args.actorItems, overriddenSelections)) {
    addOption(active, option);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const choice of draftedChoices) {
      if (!matchesChoiceSetRulePredicate(choice.rule, active)) continue;
      for (const value of choice.values) {
        const sizeBefore = active.size;
        addOption(active, `${choice.rollOption}:${value}`);
        changed ||= active.size > sizeBefore;
      }
    }
  }

  return active;
}

function addDraftSingletonRollOptions(active: Set<string>, draft: DraftState): void {
  for (const selection of Object.values(draft.selections)) {
    if (selection.itemType === "class") {
      const slug = normalize(selection.slug) ?? slugifyName(selection.name);
      addOption(active, slug ? `class:${slug}` : null);
    } else if (selection.itemType === "ancestry") {
      const slug = normalize(selection.slug) ?? slugifyName(selection.name);
      addOption(active, slug ? `ancestry:${slug}` : null);
    } else if (selection.itemType === "deity") {
      addOption(active, "deity");
    }
  }
}

export function collectActorRuleSelectionRollOptions(
  actorItems: unknown[],
  overriddenSelections?: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  return actorItems.flatMap((item) => {
    const typedItem = item as {
      flags?: {
        pf2e?: { rulesSelections?: Record<string, unknown> | null } | null;
        system?: { rulesSelections?: Record<string, unknown> | null } | null;
      } | null;
      system?: { rules?: unknown } | null;
    } | null;
    const rulesSelections = {
      ...(typedItem?.flags?.system?.rulesSelections ?? {}),
      ...(typedItem?.flags?.pf2e?.rulesSelections ?? {}),
    };

    return getDocumentRules(item).flatMap((rule) => {
      if (rule.key !== "ChoiceSet") {
        return [];
      }

      const flag = extractChoiceKey(rule);
      const sourceId = sourceIdOf(item);
      if (flag && sourceId && overriddenSelections?.get(sourceId)?.has(flag)) return [];
      const rollOption = normalize(rule.rollOption);
      const selection = flag ? normalize(rulesSelections[flag]) : null;
      return rollOption && selection ? [`${rollOption}:${selection}`] : [];
    });
  });
}

export function collectSkillRankRollOptions(skillRanks: Record<string, number> | null | undefined): string[] {
  return Object.entries(skillRanks ?? {}).flatMap(([rawSlug, rawRank]) => {
    const slug = normalize(rawSlug)
      ?.replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    const rank = Number(rawRank);
    return slug && Number.isFinite(rank) ? [`skill:${slug}:rank:${Math.max(0, Math.min(4, Math.floor(rank)))}`] : [];
  });
}

function draftedRuleSelectionValues(
  draft: DraftState,
  source: ChoiceRuleSourceContext,
  sourceSlug: string,
  sourceLevel: number,
  flag: string,
  rollOption: string,
  sourceRuleIndex: number,
  steps?: readonly PendingStep[]
): string[] {
  const values = new Set<string>();
  const singletonSlotId = `singleton-choice-${source.sourceItemType}-${sourceSlug}-${flag}-level-${sourceLevel}`;
  const classChoiceSlotId = `class-choice-${sourceSlug}-${flag}-level-${sourceLevel}`;
  if (steps === undefined) {
    addOption(values, draft.singletonChoices[singletonSlotId]);
  } else {
    for (const step of steps) {
      if (
        step.kind !== "singleton-choice" ||
        step.singletonChoice.sourceUuid !== source.sourceSelection?.uuid ||
        step.singletonChoice.sourceRuleIndex !== sourceRuleIndex ||
        step.singletonChoice.flag !== flag ||
        normalize(step.singletonChoice.rollOption) !== rollOption
      ) {
        continue;
      }
      const selection = draft.singletonChoices[step.slotId];
      if (step.singletonChoice.options.some((option) => option.value === selection)) {
        addOption(values, selection);
      }
    }
  }
  addOption(values, draft.classChoices[classChoiceSlotId]);

  // Training discovery uses the document id when raw data has no system slug.
  const trainingSourceSlug =
    normalize((source.sourceDocument as { system?: { slug?: unknown } } | null | undefined)?.system?.slug) ??
    source.sourceSelection?.documentId ??
    sourceSlug;
  const trainingKey = `${source.sourceItemType}:${trainingSourceSlug}:${flag}`;
  for (const training of Object.values(draft.skillTrainings)) {
    addOption(values, training.ruleChoices[trainingKey]);
  }

  const sourceSuffix = `-${source.sourceItemType}-${sourceSlug}-${flag}-level-${sourceLevel}`.toLowerCase();
  for (const [slotId, selection] of Object.entries(draft.selections)) {
    const normalizedSlotId = slotId.toLowerCase();
    if (
      (normalizedSlotId.startsWith("grant-choice-") || normalizedSlotId.startsWith("flag-choice-")) &&
      normalizedSlotId.endsWith(sourceSuffix)
    ) {
      addSelectionValues(values, selection);
    }
  }

  const branchSuffix = `-${sourceSlug}-${flag}-level-${sourceLevel}`.toLowerCase();
  for (const [slotId, selection] of Object.entries(draft.branchSelections)) {
    if (slotId.toLowerCase().endsWith(branchSuffix)) {
      addSelectionValues(values, selection);
    }
  }

  return Array.from(values);
}

function addSelectionValues(values: Set<string>, selection: SelectionRef | undefined): void {
  if (!selection) {
    return;
  }

  addOption(values, selection.uuid);
  addOption(values, selection.slug);
  addOption(values, selection.documentId);
  addOption(values, slugifyName(selection.name));
}

function sourceSlugFor(source: ChoiceRuleSourceContext): string {
  return extractDocumentSlug(source.sourceDocument) ?? source.sourceSelection?.documentId ?? "source";
}

function addOption(options: Set<string>, value: unknown): void {
  const normalized = normalize(value);
  if (normalized) {
    options.add(normalized);
  }
}

function normalize(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
