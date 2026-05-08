import { stripPreselectedClassBranchEntries } from "../class-branch-service.js";
import { stripPreselectedClassFeatureEntries } from "../class-feature-choice-service.js";
import { fetchSelectionDocument } from "../pack-service.js";
import type { EmbeddedItemSource, LooseRecord } from "../shared/actor-model.js";
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import {
  applyRuleSelectionToSource,
  ensureRuleSelections,
  stampImportedItemSource,
} from "../shared/pf2e-item-source.js";
import { extractDocumentSlug, slugifyName } from "../shared/slug.js";
import type { AbilityKey, DraftState, PendingStep, SelectionRef } from "../types.js";
import { stripManualSystemItemGrants } from "./manual-system-item-grants.js";
import { EXPLICIT_GRANT_SOURCE_ITEM_TYPES } from "./selection-constants.js";
import type { CreateEmbeddedSourceDependencies } from "./selection-dependencies.js";

export const DEFAULT_CREATE_DEPS: CreateEmbeddedSourceDependencies = {
  fetchSelectionDocument,
  stripPreselectedClassFeatureEntries,
  stripPreselectedClassBranchEntries,
};

export async function createEmbeddedSource(
  selection: SelectionRef,
  draft?: DraftState,
  steps: PendingStep[] = [],
  deps: CreateEmbeddedSourceDependencies = DEFAULT_CREATE_DEPS
): Promise<EmbeddedItemSource | null> {
  const document = await deps.fetchSelectionDocument(selection);
  if (!document) {
    return null;
  }

  const source = document.toObject();
  if (selection.itemType === "class" && draft) {
    deps.stripPreselectedClassFeatureEntries(source, draft, steps);
    deps.stripPreselectedClassBranchEntries(source, draft, steps);
  }
  if (draft) {
    stripManualSystemItemGrants(source);
    applyPendingSingletonChoices(source, selection, draft, steps);
    applyPendingBoostSelections(source, selection, draft);
    await applyPendingGrantChoiceSelections(source, selection, draft, steps, deps);
    applyPendingTrainingSelections(source, selection, draft, steps);
  }
  if (draft && selection.itemType === "feat") {
    await applyPendingFeatSpellChoices(source, selection, draft, steps, deps);
  }

  stampImportedItemSource(source, { sourceId: selection.uuid, slotId: selection.slotId });
  return source;
}

function applyPendingBoostSelections(source: EmbeddedItemSource, selection: SelectionRef, draft: DraftState): void {
  if (!["ancestry", "background", "class"].includes(selection.itemType)) {
    return;
  }

  if (selection.itemType === "ancestry") {
    const ancestryBoosts = draft.boosts.ancestry;
    if (
      !ancestryBoosts.modeTouched &&
      Object.keys(ancestryBoosts.selectedBoosts).length === 0 &&
      !ancestryBoosts.voluntary.touched &&
      !ancestryBoosts.voluntary.enabled
    ) {
      return;
    }

    source.system ??= {};
    if (ancestryBoosts.mode === "alternate") {
      source.system.alternateAncestryBoosts = [...ancestryBoosts.alternateBoosts];
    } else if (ancestryBoosts.modeTouched) {
      delete source.system.alternateAncestryBoosts;
    }

    applySelectedBoosts(source, ancestryBoosts.selectedBoosts);

    source.system.voluntary ??= {};
    source.system.voluntary.flaws = ancestryBoosts.voluntary.enabled ? [...ancestryBoosts.voluntary.flaws] : [];
    if (ancestryBoosts.voluntary.enabled && ancestryBoosts.voluntary.legacy) {
      source.system.voluntary.boost = ancestryBoosts.voluntary.boost;
    } else {
      delete source.system.voluntary.boost;
    }
    return;
  }

  if (selection.itemType === "background") {
    if (Object.keys(draft.boosts.background.selectedBoosts).length === 0) {
      return;
    }
    source.system ??= {};
    applySelectedBoosts(source, draft.boosts.background.selectedBoosts);
    return;
  }

  if (selection.itemType === "class") {
    if (!draft.boosts.class.keyAbility) {
      return;
    }
    source.system ??= {};
    source.system.keyAbility ??= {};
    source.system.keyAbility.selected = draft.boosts.class.keyAbility;
  }
}

function applySelectedBoosts(source: EmbeddedItemSource, selectedBoosts: Record<string, AbilityKey | null>): void {
  source.system ??= {};
  source.system.boosts ??= {};
  for (const [slot, selected] of Object.entries(selectedBoosts)) {
    const boost = source.system.boosts[slot];
    if (boost && typeof boost === "object") {
      boost.selected = selected;
    }
  }
}

function applyPendingSingletonChoices(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[]
): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (
      step.kind !== "singleton-choice" ||
      !step.singletonChoice ||
      step.singletonChoice.sourceUuid !== selection.uuid
    ) {
      continue;
    }

    const value = draft.singletonChoices[step.slotId];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    applyRuleSelection(source, step.singletonChoice.sourceRuleIndex, step.singletonChoice.flag, value);
  }
}

function applyPendingTrainingSelections(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[]
): void {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (step.kind !== "skill-training" || !step.training) {
      continue;
    }

    const training = draft.skillTrainings[step.slotId];
    if (!training) {
      continue;
    }

    for (const choiceRule of step.training.choiceRules) {
      const choice = training.ruleChoices[choiceRule.key];
      if (choice) {
        applyTrainingRuleSelection(source, selection, choiceRule.persistence, choiceRule.flag, choice);
      }
    }

    for (const loreChoice of step.training.loreChoices) {
      const choice = training.loreChoices[loreChoice.key];
      if (choice) {
        applyTrainingRuleSelection(source, selection, loreChoice.persistence, loreChoice.flag, choice);
      }
    }
  }
}

function applyTrainingRuleSelection(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  persistence: { sourceUuid: string; sourceRuleIndex: number } | null,
  flag: string,
  value: string
): void {
  if (!persistence || persistence.sourceUuid !== selection.uuid) {
    return;
  }

  applyRuleSelection(source, persistence.sourceRuleIndex, flag, value);
}

async function applyPendingGrantChoiceSelections(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies
): Promise<void> {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  ensureRuleSelections(source);

  const grantRuleIndexesToRemove = new Set<number>();
  for (const step of steps) {
    if (step.kind !== "pick-item" || !step.grantSelection || step.grantSelection.selectorUuid !== selection.uuid) {
      continue;
    }

    const grantedSelection = draft.selections[step.slotId];
    if (!grantedSelection) {
      continue;
    }

    applyRuleSelection(source, step.grantSelection.selectorRuleIndex, step.grantSelection.flag, grantedSelection.uuid);

    const grantRule = rules[step.grantSelection.grantRuleIndex];
    if (grantRule && typeof grantRule === "object") {
      const preselectChoices = await collectGrantedItemPreselectChoices(grantedSelection, draft, steps, deps);
      if (Object.keys(preselectChoices).length > 0) {
        const ruleRecord = grantRule as LooseRecord;
        ruleRecord.preselectChoices = {
          ...(isLooseRecord(ruleRecord.preselectChoices) ? ruleRecord.preselectChoices : {}),
          ...preselectChoices,
        };
      }
    }

    if (
      EXPLICIT_GRANT_SOURCE_ITEM_TYPES.has(step.grantSelection.sourceItemType) &&
      !usesNativeGrantItemCreation(step)
    ) {
      grantRuleIndexesToRemove.add(step.grantSelection.grantRuleIndex);
    }
  }

  if (grantRuleIndexesToRemove.size > 0) {
    source.system ??= {};
    source.system.rules = rules.filter((_rule, index) => !grantRuleIndexesToRemove.has(index));
  }
}

async function collectGrantedItemPreselectChoices(
  grantedSelection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies
): Promise<Record<string, string>> {
  const preselectChoices: Record<string, string> = {};

  for (const step of steps) {
    if (step.kind === "skill-training" && step.training && draft.skillTrainings[step.slotId]) {
      const training = draft.skillTrainings[step.slotId];
      for (const choiceRule of step.training.choiceRules) {
        const value = training.ruleChoices[choiceRule.key];
        if (choiceRule.persistence?.sourceUuid === grantedSelection.uuid && value) {
          preselectChoices[choiceRule.flag] = value;
        }
      }

      for (const loreChoice of step.training.loreChoices) {
        const value = training.loreChoices[loreChoice.key];
        if (loreChoice.persistence?.sourceUuid === grantedSelection.uuid && value) {
          preselectChoices[loreChoice.flag] = value;
        }
      }
    }

    if (step.kind === "spell-choice" && step.spellChoice?.sourceUuid === grantedSelection.uuid) {
      const spellSelections = draft.spellChoices[step.slotId] ?? [];
      const spellSelection = spellSelections[0];
      if (spellSelection) {
        const flag = await resolveGrantedSpellChoiceFlag(grantedSelection, deps);
        if (flag) {
          preselectChoices[flag] = await resolveSpellChoiceSelectionValue(spellSelection, deps);
        }
      }
    }

    if (step.kind === "singleton-choice" && step.singletonChoice?.sourceUuid === grantedSelection.uuid) {
      const value = draft.singletonChoices[step.slotId];
      if (typeof value === "string" && value.length > 0) {
        preselectChoices[step.singletonChoice.flag] = value;
      }
    }

    if (step.kind === "pick-item" && step.grantSelection?.selectorUuid === grantedSelection.uuid) {
      const nestedSelection = draft.selections[step.slotId];
      if (nestedSelection) {
        preselectChoices[step.grantSelection.flag] = nestedSelection.uuid;
      }
    }

    if (step.kind === "class-choice" && step.classChoice?.sourceUuid === grantedSelection.uuid) {
      const value = draft.classChoices[step.slotId];
      if (typeof value === "string" && value.length > 0) {
        preselectChoices[step.classChoice.flag] = value;
      }
    }
  }

  return preselectChoices;
}

async function resolveGrantedSpellChoiceFlag(
  grantedSelection: SelectionRef,
  deps: CreateEmbeddedSourceDependencies
): Promise<string | null> {
  const document = await deps.fetchSelectionDocument(grantedSelection);
  const source = document?.toObject();
  const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
  const rule = rules.find((entry) => isSpellChoiceRule(entry));
  return typeof rule?.flag === "string" ? rule.flag : null;
}

async function applyPendingFeatSpellChoices(
  source: EmbeddedItemSource,
  selection: SelectionRef,
  draft: DraftState,
  steps: PendingStep[],
  deps: CreateEmbeddedSourceDependencies
): Promise<void> {
  const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
  if (rules.length === 0) {
    return;
  }

  for (const step of steps) {
    if (step.kind !== "spell-choice" || !step.spellChoice || step.spellChoice.sourceUuid !== selection.uuid) {
      continue;
    }

    const spellSelection = draft.spellChoices[step.slotId]?.[0];
    if (!spellSelection) {
      continue;
    }

    const ruleIndex = rules.findIndex((rule) => isSpellChoiceRule(rule));
    const rule = ruleIndex >= 0 ? rules[ruleIndex] : null;
    const flag = typeof rule?.flag === "string" ? rule.flag : null;
    if (!flag) {
      continue;
    }

    const spellSlug = await resolveSpellChoiceSelectionValue(spellSelection, deps);
    applyRuleSelection(source, ruleIndex, flag, spellSlug);
  }
}

async function resolveSpellChoiceSelectionValue(
  spellSelection: SelectionRef,
  deps: CreateEmbeddedSourceDependencies
): Promise<string> {
  const spellDocument = await deps.fetchSelectionDocument(spellSelection);
  return (
    extractDocumentSlug(spellDocument) ??
    extractDocumentSlug(spellDocument?.toObject()) ??
    slugifyName(spellSelection.name) ??
    spellSelection.documentId
  );
}

function applyRuleSelection(source: EmbeddedItemSource, sourceRuleIndex: number, flag: string, value: string): void {
  applyRuleSelectionToSource(source, sourceRuleIndex, flag, value);
}

function isSpellChoiceRule(rule: LooseRecord): boolean {
  const choices = rule.choices as { itemType?: unknown; slugsAsValues?: unknown } | null | undefined;
  return rule.key === "ChoiceSet" && typeof rule.flag === "string" && choices?.itemType === "spell";
}

function isLooseRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
