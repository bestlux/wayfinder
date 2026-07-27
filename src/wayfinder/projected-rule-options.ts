import { slugifyName } from "../shared/slug.js";
import type { DraftState, SelectionRef } from "../types.js";
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
  classSlug?: string | null;
  ancestrySlug?: string | null;
  deitySelected?: boolean;
}): Set<string> {
  const active = new Set<string>();
  addOption(active, args.classSlug ? `class:${args.classSlug}` : null);
  addOption(active, args.ancestrySlug ? `ancestry:${args.ancestrySlug}` : null);
  addOption(active, args.deitySelected ? "deity" : null);
  addDraftSingletonRollOptions(active, args.draft);

  for (const option of collectActorRuleSelectionRollOptions(args.actorItems)) {
    addOption(active, option);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const source of args.sources) {
      if (!source.sourceDocument || !source.sourceSelection) {
        continue;
      }

      const sourceSlug = sourceSlugFor(source);
      const sourceLevel = source.sourceLevel ?? documentFeatureLevel(source.sourceDocument);
      for (const rule of getDocumentRules(source.sourceDocument)) {
        if (rule.key !== "ChoiceSet" || !matchesChoiceSetRulePredicate(rule, active)) {
          continue;
        }

        const flag = extractChoiceKey(rule);
        const rollOption = normalize(rule.rollOption);
        if (!flag || !rollOption) {
          continue;
        }

        for (const value of draftedRuleSelectionValues(args.draft, source, sourceSlug, sourceLevel, flag)) {
          const sizeBefore = active.size;
          addOption(active, `${rollOption}:${value}`);
          changed ||= active.size > sizeBefore;
        }
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

export function collectActorRuleSelectionRollOptions(actorItems: unknown[]): string[] {
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
      const rollOption = normalize(rule.rollOption);
      const selection = flag ? normalize(rulesSelections[flag]) : null;
      return rollOption && selection ? [`${rollOption}:${selection}`] : [];
    });
  });
}

function draftedRuleSelectionValues(
  draft: DraftState,
  source: ChoiceRuleSourceContext,
  sourceSlug: string,
  sourceLevel: number,
  flag: string
): string[] {
  const values = new Set<string>();
  const singletonSlotId = `singleton-choice-${source.sourceItemType}-${sourceSlug}-${flag}-level-${sourceLevel}`;
  const classChoiceSlotId = `class-choice-${sourceSlug}-${flag}-level-${sourceLevel}`;
  addOption(values, draft.singletonChoices[singletonSlotId]);
  addOption(values, draft.classChoices[classChoiceSlotId]);

  const trainingKey = `${source.sourceItemType}:${sourceSlug}:${flag}`;
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
  const documentSlug = normalize(
    (source.sourceDocument as { system?: { slug?: unknown } } | null | undefined)?.system?.slug
  );
  return documentSlug ?? source.sourceSelection?.documentId ?? "source";
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
