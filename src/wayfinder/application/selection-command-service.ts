import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import { classArchetypeProfile } from "../class-archetype/registry.js";
import { writeDraftStepSelection } from "../draft-decisions.js";
import { sameMembers } from "../formatting.js";
import { SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";

export interface SelectionCommandState {
  draft: DraftState;
  previewValueByStepId: Map<string, string>;
  recentlyInvalidatedStepIds: Set<string>;
}

export type SelectionCommandWarning = "duplicate-selection" | "language-choice-full" | "spell-choice-full";

export interface SelectionCommandResult {
  kind: "noop" | "warning" | "changed";
  warning: SelectionCommandWarning | null;
  statusNote: string | null;
  shouldAdvance: boolean;
  shouldRender: boolean;
}

interface ChooseSelectionOptionDependencies {
  resolveSelection: (rawValue: string, step: PendingStep) => Promise<SelectionRef | null>;
  hasDuplicateDraftSelection: (selection: SelectionRef) => boolean;
  resolveSelectionTraits: (selection: SelectionRef | null) => Promise<string[]>;
  resolveSelectionSlug: (selection: SelectionRef | null) => Promise<string | null>;
  invalidateSelection: (slotId: string) => string[];
  invalidateSelectionsByPrefix: (prefix: string) => string[];
  invalidateSingletonChoicesBySource: (
    sourceItemType: "ancestry" | "heritage" | "background" | "class" | "deity"
  ) => Promise<string[]>;
  invalidateGrantSelectionsBySource: (
    sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
  ) => Promise<string[]>;
  invalidateGrantSelectionsByDependency: (dependency: "class" | "deity") => Promise<string[]>;
  invalidateFlagChoicesBySource: (
    sourceItemType: "ancestry" | "heritage" | "background" | "feat" | "classfeature"
  ) => Promise<string[]>;
  invalidateFlagChoicesByDependency: (dependency: "ancestry" | "class") => Promise<string[]>;
  invalidateClassChoicesByDependency: (dependency: "class" | "deity") => Promise<string[]>;
  invalidateBranchSelectionsByDependency: (dependency: "class" | "deity") => Promise<string[]>;
  invalidateSpellChoicesByDependency: (dependency: "class" | "class-branch") => Promise<string[]>;
  resetAncestryBoostDraft: () => boolean;
  resetBackgroundBoostDraft: () => boolean;
  resetClassBoostDraft: () => boolean;
}

interface SelectClassChoiceDependencies {
  invalidateSelectionsByPrefix: (prefix: string) => string[];
  invalidateBranchSelectionsByDependency: (dependency: "class" | "deity") => Promise<string[]>;
  invalidateClassChoicesBySourceChoice: (sourceUuid: string, flag: string) => Promise<string[]>;
  invalidateGrantSelectionsBySource: (sourceItemType: "classfeature") => Promise<string[]>;
  invalidateFlagChoicesBySource: (sourceItemType: "classfeature") => Promise<string[]>;
  invalidateSpellChoicesByDependency: (dependency: "class-branch") => Promise<string[]>;
}

interface SelectClassArchetypeDependencies {
  invalidateSelection: (slotId: string) => string[];
  invalidateSelectionsByPrefix: (prefix: string) => string[];
  invalidateGrantSelectionsBySource: (sourceItemType: "classfeature") => Promise<string[]>;
  invalidateFlagChoicesBySource: (sourceItemType: "classfeature") => Promise<string[]>;
}

interface SelectSingletonChoiceDependencies {
  buildPlan: () => Promise<{ steps: PendingStep[] }>;
}

const SINGLETON_CHOICE_NOOP_RESULT: SelectionCommandResult = {
  kind: "noop",
  warning: null,
  statusNote: null,
  shouldAdvance: false,
  shouldRender: false,
};

interface ToggleSpellChoiceDependencies {
  resolveSelection: (rawValue: string, step: PendingStep) => Promise<SelectionRef | null>;
  selectionExistsOnActor: (selection: SelectionRef, step: PendingStep) => boolean;
  destinationKeyForSlotId?: (slotId: string) => string | null;
}

const NOOP_RESULT: SelectionCommandResult = {
  kind: "noop",
  warning: null,
  statusNote: null,
  shouldAdvance: false,
  shouldRender: false,
};

export async function chooseSelectionOption(
  state: SelectionCommandState,
  step: PendingStep,
  rawValue: string,
  deps: ChooseSelectionOptionDependencies
): Promise<SelectionCommandResult> {
  const selection = await deps.resolveSelection(rawValue, step);
  if (!selection) {
    return NOOP_RESULT;
  }

  if (deps.hasDuplicateDraftSelection(selection)) {
    return warningResult("duplicate-selection");
  }

  const previousSelection = writeDraftStepSelection(state.draft, step, selection);
  state.recentlyInvalidatedStepIds.delete(selection.slotId);

  let statusNote: string | null = null;

  if (step.slotKind === "ancestry" && previousSelection?.uuid !== selection.uuid) {
    const invalidated = [
      ...deps.invalidateSelection(SLOT_IDS.heritage),
      ...(await deps.invalidateSingletonChoicesBySource("ancestry")),
      ...(await deps.invalidateSingletonChoicesBySource("heritage")),
      ...(await deps.invalidateGrantSelectionsBySource("ancestry")),
      ...(await deps.invalidateGrantSelectionsBySource("heritage")),
      ...(await deps.invalidateFlagChoicesBySource("ancestry")),
      ...(await deps.invalidateFlagChoicesBySource("heritage")),
      ...(await deps.invalidateFlagChoicesByDependency("ancestry")),
      ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.languageChoice),
      ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat),
    ];
    const boostReset = deps.resetAncestryBoostDraft();
    if (boostReset) {
      state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    if (invalidated.length > 0 || boostReset) {
      statusNote = boostReset
        ? "Ancestry changed. Wayfinder cleared ancestry-specific boost draft choices and marked dependent heritage, ancestry choice, language, and ancestry-feat picks for review."
        : "Ancestry changed. Wayfinder marked dependent heritage, ancestry choice, language, and ancestry-feat draft picks for review.";
    }
  }

  if (step.slotKind === "heritage" && previousSelection?.uuid !== selection.uuid) {
    const previousTraits = await deps.resolveSelectionTraits(previousSelection);
    const nextTraits = await deps.resolveSelectionTraits(selection);
    const invalidated = [
      ...(await deps.invalidateSingletonChoicesBySource("heritage")),
      ...(await deps.invalidateGrantSelectionsBySource("heritage")),
      ...(await deps.invalidateFlagChoicesBySource("heritage")),
      ...(!sameMembers(previousTraits, nextTraits)
        ? deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat)
        : []),
    ];
    if (invalidated.length > 0) {
      statusNote =
        "Heritage changed. Wayfinder marked heritage-driven choices and ancestry-feat draft picks for review.";
    }
  }

  if (step.slotKind === "background" && previousSelection?.uuid !== selection.uuid) {
    const invalidated = [
      ...(await deps.invalidateSingletonChoicesBySource("background")),
      ...(await deps.invalidateGrantSelectionsBySource("background")),
      ...(await deps.invalidateFlagChoicesBySource("background")),
    ];
    const boostReset = deps.resetBackgroundBoostDraft();
    if (boostReset || invalidated.length > 0) {
      state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
      statusNote = boostReset
        ? "Background changed. Wayfinder cleared background boost draft choices and marked background-driven choices for review."
        : "Background changed. Wayfinder marked background-driven choices for review.";
    }
  }

  if (step.slotKind === "class" && previousSelection?.uuid !== selection.uuid) {
    const previousClassSlug = await deps.resolveSelectionSlug(previousSelection);
    const nextClassSlug = await deps.resolveSelectionSlug(selection);
    const boostReset = deps.resetClassBoostDraft();
    if (boostReset) {
      state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
    }
    if (previousClassSlug !== nextClassSlug) {
      const invalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat);
      const archetypeFeatInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.archetypeFeat);
      const deityInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.deity);
      const classArchetypeInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classArchetype);
      const branchInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
      const classChoiceInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
      const trainingInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining);
      const spellInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice);
      const singletonInvalidated = [
        ...(await deps.invalidateSingletonChoicesBySource("class")),
        ...(await deps.invalidateSingletonChoicesBySource("deity")),
      ];
      const grantInvalidated = [
        ...(await deps.invalidateGrantSelectionsByDependency("class")),
        ...(await deps.invalidateGrantSelectionsByDependency("deity")),
        ...(await deps.invalidateGrantSelectionsBySource("classfeature")),
        ...(await deps.invalidateFlagChoicesByDependency("class")),
        ...(await deps.invalidateFlagChoicesBySource("classfeature")),
      ];
      if (
        invalidated.length > 0 ||
        archetypeFeatInvalidated.length > 0 ||
        deityInvalidated.length > 0 ||
        classArchetypeInvalidated.length > 0 ||
        branchInvalidated.length > 0 ||
        classChoiceInvalidated.length > 0 ||
        trainingInvalidated.length > 0 ||
        spellInvalidated.length > 0 ||
        singletonInvalidated.length > 0 ||
        grantInvalidated.length > 0 ||
        boostReset
      ) {
        statusNote = boostReset
          ? "Class changed. Wayfinder cleared the key-ability draft choice and marked drafted deity, class training, class path, class choice, related singleton choices, spell, class feat, and Free Archetype selections for review."
          : "Class changed. Wayfinder marked drafted deity, class training, class path, class choice, related singleton choices, spell, class feat, and Free Archetype selections for review.";
      }
    } else if (boostReset) {
      statusNote = "Class changed. Wayfinder cleared the key-ability draft choice for review.";
    }
  }

  if (step.slotKind === "deity" && previousSelection?.uuid !== selection.uuid) {
    const invalidatedSingletonChoices = await deps.invalidateSingletonChoicesBySource("deity");
    const invalidatedGrantChoices = await deps.invalidateGrantSelectionsByDependency("deity");
    const invalidatedChoices = await deps.invalidateClassChoicesByDependency("deity");
    const invalidatedBranches = await deps.invalidateBranchSelectionsByDependency("deity");
    if (
      invalidatedChoices.length > 0 ||
      invalidatedBranches.length > 0 ||
      invalidatedSingletonChoices.length > 0 ||
      invalidatedGrantChoices.length > 0
    ) {
      statusNote =
        "Deity changed. Wayfinder marked dependent class choices, class paths, and deity-driven choices for review.";
    }
  }

  if (step.slotKind === "ancestry-feat" && previousSelection?.uuid !== selection.uuid) {
    const invalidated = [
      ...(await deps.invalidateGrantSelectionsBySource("feat")),
      ...(await deps.invalidateFlagChoicesBySource("feat")),
    ];
    if (invalidated.length > 0) {
      statusNote = "Ancestry feat changed. Wayfinder marked dependent granted feat choices for review.";
    }
  }

  if (
    (step.slotKind === "class-feat" ||
      step.slotKind === "archetype-feat" ||
      step.slotKind === "general-feat" ||
      step.slotKind === "skill-feat") &&
    previousSelection?.uuid !== selection.uuid
  ) {
    const [previousTraits, nextTraits] = await Promise.all([
      deps.resolveSelectionTraits(previousSelection),
      deps.resolveSelectionTraits(selection),
    ]);
    const dedicationContextChanged = previousTraits.includes("dedication") || nextTraits.includes("dedication");
    const archetypeInvalidated = dedicationContextChanged
      ? deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.archetypeFeat)
      : [];
    if (dedicationContextChanged && step.slotKind === "archetype-feat") {
      state.draft.selections[step.slotId] = selection;
      state.recentlyInvalidatedStepIds.delete(step.slotId);
    }
    const otherArchetypeInvalidated = archetypeInvalidated.filter((slotId) => slotId !== step.slotId);
    const invalidated = [
      ...(await deps.invalidateGrantSelectionsBySource("feat")),
      ...(await deps.invalidateFlagChoicesBySource("feat")),
    ];
    if (otherArchetypeInvalidated.length > 0) {
      statusNote = "Dedication changed. Wayfinder marked Free Archetype selections for review.";
    } else if (invalidated.length > 0) {
      statusNote = "Feat changed. Wayfinder marked dependent feat choices for review.";
    }
  }

  if (step.kind === "class-branch" && previousSelection?.uuid !== selection.uuid) {
    const invalidatedSpells = await deps.invalidateSpellChoicesByDependency("class-branch");
    const invalidatedGrantChoices = await deps.invalidateGrantSelectionsBySource("classfeature");
    const invalidatedFlagChoices = await deps.invalidateFlagChoicesBySource("classfeature");
    if (
      (invalidatedSpells.length > 0 || invalidatedGrantChoices.length > 0 || invalidatedFlagChoices.length > 0) &&
      step.branch?.flag === "arcaneSchool"
    ) {
      statusNote = "Arcane school changed. Wayfinder marked dependent school choices for review.";
    }
  }

  state.previewValueByStepId.set(step.id, rawValue);
  return changedResult({ statusNote, shouldAdvance: true });
}

export async function selectSingletonChoiceValue(
  state: SelectionCommandState,
  step: PendingStep | null,
  value: string,
  deps?: SelectSingletonChoiceDependencies
): Promise<SelectionCommandResult> {
  const stepId = step?.slotId ?? "";
  if (!stepId) {
    return SINGLETON_CHOICE_NOOP_RESULT;
  }

  const wasSelected = state.draft.singletonChoices[stepId] === value;
  if (wasSelected) {
    delete state.draft.singletonChoices[stepId];
    state.recentlyInvalidatedStepIds.delete(stepId);
    return changedResult({ shouldRender: true });
  }

  state.draft.singletonChoices[stepId] = value;
  state.recentlyInvalidatedStepIds.delete(stepId);
  if (step?.kind === "singleton-choice" && deps) {
    await clearHiddenSingletonFollowUps(state, step, deps);
  }
  return changedResult({ shouldAdvance: true });
}

async function clearHiddenSingletonFollowUps(
  state: SelectionCommandState,
  changedStep: Extract<PendingStep, { kind: "singleton-choice" }>,
  deps: SelectSingletonChoiceDependencies
): Promise<void> {
  const plan = await deps.buildPlan();
  const visibleSlotIds = new Set(
    plan.steps.filter((step) => step.kind === "singleton-choice").map((step) => step.slotId)
  );
  const sourceUuid = changedStep.singletonChoice.sourceUuid;
  const sourceSlotPrefix = singletonChoiceSourceSlotPrefix(changedStep);

  for (const slotId of Object.keys(state.draft.singletonChoices)) {
    if (slotId === changedStep.slotId || visibleSlotIds.has(slotId)) {
      continue;
    }

    if (!sourceSlotPrefix || !slotId.startsWith(`${sourceSlotPrefix}-`)) {
      continue;
    }

    delete state.draft.singletonChoices[slotId];
    state.recentlyInvalidatedStepIds.add(slotId);
  }

  for (const visibleStep of plan.steps) {
    if (visibleStep.kind !== "singleton-choice" || visibleStep.singletonChoice.sourceUuid !== sourceUuid) {
      continue;
    }

    state.recentlyInvalidatedStepIds.delete(visibleStep.slotId);
  }
}

function singletonChoiceSourceSlotPrefix(step: Extract<PendingStep, { kind: "singleton-choice" }>): string | null {
  const suffix = `-${step.singletonChoice.flag}-level-${step.level}`;
  return step.slotId.endsWith(suffix) ? step.slotId.slice(0, -suffix.length) : null;
}

export async function toggleLanguageChoiceValue(
  state: SelectionCommandState,
  step: PendingStep | null,
  value: string
): Promise<SelectionCommandResult> {
  if (!step || step.kind !== "language-choice") {
    return NOOP_RESULT;
  }

  const current = state.draft.languageChoices[step.slotId] ?? [];
  if (current.includes(value)) {
    const next = current.filter((entry) => entry !== value);
    if (next.length > 0) {
      state.draft.languageChoices[step.slotId] = next;
    } else {
      delete state.draft.languageChoices[step.slotId];
    }
    state.recentlyInvalidatedStepIds.delete(step.slotId);
    return changedResult({ shouldRender: true });
  }

  if (current.length >= step.languageChoice.count) {
    return warningResult("language-choice-full");
  }

  state.draft.languageChoices[step.slotId] = [...current, value];
  state.recentlyInvalidatedStepIds.delete(step.slotId);
  return current.length + 1 >= step.languageChoice.count
    ? changedResult({ shouldAdvance: true })
    : changedResult({ shouldRender: true });
}

export async function selectClassChoiceValue(
  state: SelectionCommandState,
  step: PendingStep | null,
  value: string,
  deps: SelectClassChoiceDependencies
): Promise<SelectionCommandResult> {
  const stepId = step?.slotId ?? "";
  if (!stepId) {
    return NOOP_RESULT;
  }

  const invalidatesDeityBranches = step?.classChoice?.flag === "sanctification";
  const wasSelected = state.draft.classChoices[stepId] === value;
  if (wasSelected) {
    delete state.draft.classChoices[stepId];
    const statusNote = await invalidateClassChoiceDependents(step ?? null, deps);
    state.recentlyInvalidatedStepIds.delete(stepId);
    return changedResult({ statusNote, shouldRender: true });
  }

  const previousValue = state.draft.classChoices[stepId] ?? null;
  state.draft.classChoices[stepId] = value;
  let statusNote: string | null = null;
  if (previousValue !== null && previousValue !== value) {
    statusNote = await invalidateClassChoiceDependents(step ?? null, deps);
  } else if (invalidatesDeityBranches && previousValue !== value) {
    statusNote = await invalidateClassChoiceDependents(step ?? null, deps);
  }
  state.recentlyInvalidatedStepIds.delete(stepId);
  return changedResult({ statusNote, shouldAdvance: true });
}

export async function selectClassArchetypeValue(
  state: SelectionCommandState,
  step: PendingStep | null,
  value: string,
  deps: SelectClassArchetypeDependencies
): Promise<SelectionCommandResult> {
  if (
    !step ||
    step.kind !== "class-archetype" ||
    !step.classArchetype.options.some((option) => option.value === value) ||
    state.draft.classArchetypeChoices[step.slotId] === value
  ) {
    return NOOP_RESULT;
  }

  const invalidated = [
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch),
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice),
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining),
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice),
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat),
    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.archetypeFeat),
    ...(await deps.invalidateGrantSelectionsBySource("classfeature")),
    ...(await deps.invalidateFlagChoicesBySource("classfeature")),
  ];

  const profile = classArchetypeProfile(value);
  const projectedStaticGrantUuids = new Set(
    profile?.projectedFeatGrants.flatMap((grant) =>
      grant.minimumLevel <= state.draft.targetLevel ? grant.staticFeatGrants.map((selection) => selection.uuid) : []
    ) ?? []
  );
  for (const [slotId, selection] of Object.entries(state.draft.selections)) {
    if (slotId.startsWith(SLOT_PREFIXES.classArchetype) || projectedStaticGrantUuids.has(selection.uuid)) {
      invalidated.push(...deps.invalidateSelection(slotId));
    }
  }

  state.draft.classArchetypeChoices[step.slotId] = value;
  state.recentlyInvalidatedStepIds.delete(step.slotId);
  return changedResult({
    statusNote:
      invalidated.length > 0
        ? "Class path changed. Wayfinder reset dependent class choices, training, feats, and spells for review."
        : null,
    shouldAdvance: true,
  });
}

async function invalidateClassChoiceDependents(
  step: PendingStep | null,
  deps: SelectClassChoiceDependencies
): Promise<string | null> {
  const branchInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
  const deityBranchInvalidated =
    step?.classChoice?.flag === "sanctification" || step?.classChoice?.dependsOn === "deity"
      ? await deps.invalidateBranchSelectionsByDependency("deity")
      : [];
  const choiceInvalidated = step?.classChoice
    ? await deps.invalidateClassChoicesBySourceChoice(step.classChoice.sourceUuid, step.classChoice.flag)
    : [];
  const grantInvalidated = await deps.invalidateGrantSelectionsBySource("classfeature");
  const flagInvalidated = await deps.invalidateFlagChoicesBySource("classfeature");
  const spellInvalidated = await deps.invalidateSpellChoicesByDependency("class-branch");
  const invalidatedCount =
    branchInvalidated.length +
    deityBranchInvalidated.length +
    choiceInvalidated.length +
    grantInvalidated.length +
    flagInvalidated.length +
    spellInvalidated.length;

  if (invalidatedCount === 0) {
    return null;
  }

  if (step?.classChoice?.flag === "sanctification") {
    return "Sanctification changed. Wayfinder marked class paths for review.";
  }

  return "Class choice changed. Wayfinder reset class paths, class-feature choices, and spell choices for review.";
}

export async function toggleSpellChoiceSelection(
  state: SelectionCommandState,
  step: PendingStep | null,
  rawValue: string,
  deps: ToggleSpellChoiceDependencies
): Promise<SelectionCommandResult> {
  if (!step || step.kind !== "spell-choice") {
    return NOOP_RESULT;
  }

  const selection = await deps.resolveSelection(rawValue, step);
  if (!selection) {
    return NOOP_RESULT;
  }

  state.draft.spellChoices[step.slotId] ??= [];
  const current = state.draft.spellChoices[step.slotId];
  const existingIndex = current.findIndex((entry) => entry.uuid === selection.uuid);
  if (existingIndex !== -1) {
    current.splice(existingIndex, 1);
    if (current.length === 0) {
      delete state.draft.spellChoices[step.slotId];
    }
    state.recentlyInvalidatedStepIds.delete(step.slotId);
    return changedResult({ shouldRender: true });
  }

  const selectedElsewhere = Object.entries(state.draft.spellChoices).some(([slotId, selections]) => {
    if (slotId === step.slotId) {
      return false;
    }

    const otherDestinationKey = deps.destinationKeyForSlotId?.(slotId) ?? null;
    return (
      (!otherDestinationKey || otherDestinationKey === step.spellChoice.destination.key) &&
      selections.some((entry) => entry.uuid === selection.uuid)
    );
  });
  if (selectedElsewhere || deps.selectionExistsOnActor(selection, step)) {
    return warningResult("duplicate-selection");
  }

  const requiredCount = step.spellChoice?.count ?? 0;
  if (current.length >= requiredCount) {
    return warningResult("spell-choice-full");
  }

  current.push(selection);
  state.recentlyInvalidatedStepIds.delete(step.slotId);
  return current.length >= requiredCount
    ? changedResult({ shouldAdvance: true })
    : changedResult({ shouldRender: true });
}

function changedResult(args: {
  statusNote?: string | null;
  shouldAdvance?: boolean;
  shouldRender?: boolean;
}): SelectionCommandResult {
  return {
    kind: "changed",
    warning: null,
    statusNote: args.statusNote ?? null,
    shouldAdvance: args.shouldAdvance ?? false,
    shouldRender: args.shouldRender ?? false,
  };
}

function warningResult(warning: SelectionCommandWarning): SelectionCommandResult {
  return {
    kind: "warning",
    warning,
    statusNote: null,
    shouldAdvance: false,
    shouldRender: false,
  };
}
