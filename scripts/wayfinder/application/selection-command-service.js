import { classArchetypeProfile } from "../class-archetype/registry.js";
import { readDraftStepSelection, writeDraftStepSelection } from "../draft-decisions.js";
import { sameMembers } from "../formatting.js";
import { SLOT_IDS, SLOT_PREFIXES } from "../slot-ids.js";
const SINGLETON_CHOICE_NOOP_RESULT = {
    kind: "noop",
    warning: null,
    statusNote: null,
    shouldAdvance: false,
    shouldRender: false,
};
const NOOP_RESULT = {
    kind: "noop",
    warning: null,
    statusNote: null,
    shouldAdvance: false,
    shouldRender: false,
};
export async function chooseSelectionOption(state, step, rawValue, deps) {
    const selection = await deps.resolveSelection(rawValue, step);
    if (!selection) {
        return NOOP_RESULT;
    }
    if (deps.hasDuplicateDraftSelection(selection)) {
        return warningResult("duplicate-selection");
    }
    const previousSelection = readDraftStepSelection(state.draft, step);
    const classTransition = step.slotKind === "class" && previousSelection?.uuid !== selection.uuid
        ? await Promise.all([
            deps.resolveSelectionSlug(previousSelection),
            deps.resolveSelectionSlug(selection),
            deps.resolveSelectionClassHasSpellcasting(previousSelection),
            deps.resolveSelectionClassHasSpellcasting(selection),
        ])
        : null;
    writeDraftStepSelection(state.draft, step, selection);
    state.recentlyInvalidatedStepIds.delete(selection.slotId);
    let statusNote = null;
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
            ...(await deps.invalidateCampaignFeatSelectionsByFeatType("ancestry")),
            ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.languageChoice),
            ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat),
        ];
        const boostReset = deps.resetAncestryBoostDraft();
        if (boostReset) {
            state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
        }
        if (invalidated.length > 0 || boostReset) {
            statusNote = boostReset
                ? "New ancestry, so your ancestry boosts are cleared. Heritage, languages, and ancestry feats need another look."
                : "New ancestry. Heritage, languages, and ancestry feats need another look.";
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
                ? [
                    ...deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat),
                    ...(await deps.invalidateCampaignFeatSelectionsByFeatType("ancestry")),
                ]
                : []),
        ];
        if (invalidated.length > 0) {
            statusNote = "New heritage. Anything it granted, plus your ancestry feats, needs another look.";
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
                ? "New background, so its boosts are cleared. The skills and feat it granted need another look."
                : "New background. The skills and feat it granted need another look.";
        }
    }
    if (step.slotKind === "class" && previousSelection?.uuid !== selection.uuid) {
        const [previousClassSlug, nextClassSlug, previousClassHasSpellcasting, nextClassHasSpellcasting] = classTransition ?? [null, null, false, false];
        const boostReset = deps.resetClassBoostDraft();
        if (boostReset) {
            state.recentlyInvalidatedStepIds.add(SLOT_IDS.abilityBoostsLevel1);
        }
        const spellcastingCapabilityChanged = previousClassHasSpellcasting !== nextClassHasSpellcasting;
        if (previousClassSlug !== nextClassSlug || spellcastingCapabilityChanged) {
            const invalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classFeat);
            const archetypeFeatInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.archetypeFeat);
            const deityInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.deity);
            const classArchetypeInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classArchetype);
            const branchInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
            const classChoiceInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classChoice);
            const trainingInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.skillTraining);
            const spellInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.spellChoice);
            const ancestryFeatInvalidated = spellcastingCapabilityChanged
                ? deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.ancestryFeat)
                : [];
            const campaignAncestryFeatInvalidated = spellcastingCapabilityChanged
                ? await deps.invalidateCampaignFeatSelectionsByFeatType("ancestry")
                : [];
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
            if (invalidated.length > 0 ||
                archetypeFeatInvalidated.length > 0 ||
                deityInvalidated.length > 0 ||
                classArchetypeInvalidated.length > 0 ||
                branchInvalidated.length > 0 ||
                classChoiceInvalidated.length > 0 ||
                trainingInvalidated.length > 0 ||
                spellInvalidated.length > 0 ||
                ancestryFeatInvalidated.length > 0 ||
                campaignAncestryFeatInvalidated.length > 0 ||
                singletonInvalidated.length > 0 ||
                grantInvalidated.length > 0 ||
                boostReset) {
                const featScope = ancestryFeatInvalidated.length > 0 || campaignAncestryFeatInvalidated.length > 0
                    ? "your ancestry feats, class feats, and Free Archetype feats"
                    : "your class feats and Free Archetype feats";
                statusNote = boostReset
                    ? `New class, so your key ability is cleared. Your deity, class training, class path, and spells need another look, along with ${featScope}.`
                    : `New class. Your deity, class training, class path, and spells need another look, along with ${featScope}.`;
            }
        }
        else if (boostReset) {
            statusNote = "New class, so your key ability is cleared. Pick it again.";
        }
    }
    if (step.slotKind === "deity" && previousSelection?.uuid !== selection.uuid) {
        const invalidatedSingletonChoices = await deps.invalidateSingletonChoicesBySource("deity");
        const invalidatedGrantChoices = await deps.invalidateGrantSelectionsByDependency("deity");
        const invalidatedChoices = await deps.invalidateClassChoicesByDependency("deity");
        const invalidatedBranches = await deps.invalidateBranchSelectionsByDependency("deity");
        if (invalidatedChoices.length > 0 ||
            invalidatedBranches.length > 0 ||
            invalidatedSingletonChoices.length > 0 ||
            invalidatedGrantChoices.length > 0) {
            statusNote = "New deity. Your class path and anything else your deity shapes need another look.";
        }
    }
    if ((step.slotKind === "ancestry-feat" || (step.slotKind === "campaign-feat" && selection.featType === "ancestry")) &&
        previousSelection?.uuid !== selection.uuid) {
        const invalidated = [
            ...(await deps.invalidateGrantSelectionsBySource("feat")),
            ...(await deps.invalidateFlagChoicesBySource("feat")),
        ];
        if (invalidated.length > 0) {
            statusNote = "New ancestry feat. Any choices the old one granted need another look.";
        }
    }
    if ((step.slotKind === "class-feat" ||
        step.slotKind === "archetype-feat" ||
        (step.slotKind === "campaign-feat" && selection.featType !== "ancestry") ||
        step.slotKind === "general-feat" ||
        step.slotKind === "skill-feat") &&
        previousSelection?.uuid !== selection.uuid) {
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
            statusNote = "Different dedication. Your Free Archetype feats need another look.";
        }
        else if (invalidated.length > 0) {
            statusNote = "New feat. Any choices the old one granted need another look.";
        }
    }
    if (step.kind === "class-branch" && previousSelection?.uuid !== selection.uuid) {
        const invalidatedSpells = await deps.invalidateSpellChoicesByDependency("class-branch");
        const invalidatedGrantChoices = await deps.invalidateGrantSelectionsBySource("classfeature");
        const invalidatedFlagChoices = await deps.invalidateFlagChoicesBySource("classfeature");
        if ((invalidatedSpells.length > 0 || invalidatedGrantChoices.length > 0 || invalidatedFlagChoices.length > 0) &&
            step.branch?.flag === "arcaneSchool") {
            statusNote = "New arcane school. Your curriculum spells need another look.";
        }
    }
    if (previousSelection?.uuid !== selection.uuid) {
        const invalidatedSpellChoices = (await deps.invalidateOrphanedSpellChoices?.()) ?? [];
        if (invalidatedSpellChoices.length > 0 && !statusNote) {
            statusNote = "Some spell steps no longer exist, so their spells and access notes came off the draft.";
        }
    }
    state.previewValueByStepId.set(step.id, rawValue);
    return changedResult({ statusNote, shouldAdvance: true });
}
export async function selectSingletonChoiceValue(state, step, value, deps) {
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
async function clearHiddenSingletonFollowUps(state, changedStep, deps) {
    const plan = await deps.buildPlan();
    const visibleSlotIds = new Set(plan.steps.filter((step) => step.kind === "singleton-choice").map((step) => step.slotId));
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
function singletonChoiceSourceSlotPrefix(step) {
    const suffix = `-${step.singletonChoice.flag}-level-${step.level}`;
    return step.slotId.endsWith(suffix) ? step.slotId.slice(0, -suffix.length) : null;
}
export async function toggleLanguageChoiceValue(state, step, value) {
    if (!step || step.kind !== "language-choice") {
        return NOOP_RESULT;
    }
    const current = state.draft.languageChoices[step.slotId] ?? [];
    if (current.includes(value)) {
        const next = current.filter((entry) => entry !== value);
        if (next.length > 0) {
            state.draft.languageChoices[step.slotId] = next;
        }
        else {
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
export async function selectClassChoiceValue(state, step, value, deps) {
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
    let statusNote = null;
    if (previousValue !== null && previousValue !== value) {
        statusNote = await invalidateClassChoiceDependents(step ?? null, deps);
    }
    else if (invalidatesDeityBranches && previousValue !== value) {
        statusNote = await invalidateClassChoiceDependents(step ?? null, deps);
    }
    state.recentlyInvalidatedStepIds.delete(stepId);
    return changedResult({ statusNote, shouldAdvance: true });
}
export async function selectClassArchetypeValue(state, step, value, deps) {
    if (!step ||
        step.kind !== "class-archetype" ||
        !step.classArchetype.options.some((option) => option.value === value) ||
        state.draft.classArchetypeChoices[step.slotId] === value) {
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
    const projectedStaticGrantUuids = new Set(profile?.projectedFeatGrants.flatMap((grant) => grant.minimumLevel <= state.draft.targetLevel ? grant.staticFeatGrants.map((selection) => selection.uuid) : []) ?? []);
    for (const [slotId, selection] of Object.entries(state.draft.selections)) {
        if (slotId.startsWith(SLOT_PREFIXES.classArchetype) || projectedStaticGrantUuids.has(selection.uuid)) {
            invalidated.push(...deps.invalidateSelection(slotId));
        }
    }
    state.draft.classArchetypeChoices[step.slotId] = value;
    state.recentlyInvalidatedStepIds.delete(step.slotId);
    return changedResult({
        statusNote: invalidated.length > 0
            ? "New class path. The choices, training, feats, and spells it fed into all need another look."
            : null,
        shouldAdvance: true,
    });
}
async function invalidateClassChoiceDependents(step, deps) {
    const branchInvalidated = deps.invalidateSelectionsByPrefix(SLOT_PREFIXES.classBranch);
    const deityBranchInvalidated = step?.classChoice?.flag === "sanctification" || step?.classChoice?.dependsOn === "deity"
        ? await deps.invalidateBranchSelectionsByDependency("deity")
        : [];
    const choiceInvalidated = step?.classChoice
        ? await deps.invalidateClassChoicesBySourceChoice(step.classChoice.sourceUuid, step.classChoice.flag)
        : [];
    const grantInvalidated = await deps.invalidateGrantSelectionsBySource("classfeature");
    const flagInvalidated = await deps.invalidateFlagChoicesBySource("classfeature");
    const spellInvalidated = await deps.invalidateSpellChoicesByDependency("class-branch");
    const invalidatedCount = branchInvalidated.length +
        deityBranchInvalidated.length +
        choiceInvalidated.length +
        grantInvalidated.length +
        flagInvalidated.length +
        spellInvalidated.length;
    if (invalidatedCount === 0) {
        return null;
    }
    if (step?.classChoice?.flag === "sanctification") {
        return "Sanctification changed. Your class path needs another look.";
    }
    return "That choice changed. Your class path, class features, and spells need another look.";
}
export async function toggleSpellChoiceSelection(state, step, rawValue, deps) {
    if (!step || step.kind !== "spell-choice") {
        return NOOP_RESULT;
    }
    const current = state.draft.spellChoices[step.slotId] ?? [];
    const existingIndex = current.findIndex((entry) => `${entry.packId}:${entry.documentId}` === rawValue);
    if (existingIndex !== -1) {
        current.splice(existingIndex, 1);
        if (current.length === 0) {
            delete state.draft.spellChoices[step.slotId];
        }
        state.recentlyInvalidatedStepIds.delete(step.slotId);
        return changedResult({ shouldRender: true });
    }
    const selection = await deps.resolveSelection(rawValue, step);
    if (!selection) {
        return NOOP_RESULT;
    }
    state.draft.spellChoices[step.slotId] ??= [];
    const nextSelections = state.draft.spellChoices[step.slotId];
    const selectedElsewhere = Object.entries(state.draft.spellChoices).some(([slotId, selections]) => {
        if (slotId === step.slotId) {
            return false;
        }
        const otherDestinationKey = deps.destinationKeyForSlotId?.(slotId) ?? null;
        return ((!otherDestinationKey || otherDestinationKey === step.spellChoice.destination.key) &&
            selections.some((entry) => entry.uuid === selection.uuid));
    });
    if (selectedElsewhere || deps.selectionExistsOnActor(selection, step)) {
        return warningResult("duplicate-selection");
    }
    const requiredCount = step.spellChoice?.count ?? 0;
    nextSelections.push(selection);
    state.recentlyInvalidatedStepIds.delete(step.slotId);
    return nextSelections.length === requiredCount
        ? changedResult({ shouldAdvance: true })
        : changedResult({ shouldRender: true });
}
function changedResult(args) {
    return {
        kind: "changed",
        warning: null,
        statusNote: args.statusNote ?? null,
        shouldAdvance: args.shouldAdvance ?? false,
        shouldRender: args.shouldRender ?? false,
    };
}
function warningResult(warning) {
    return {
        kind: "warning",
        warning,
        statusNote: null,
        shouldAdvance: false,
        shouldRender: false,
    };
}
//# sourceMappingURL=selection-command-service.js.map