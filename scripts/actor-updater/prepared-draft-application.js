import { listActorItems } from "../build-state.js";
import { resolveCampaignFeatSlotSetting } from "../campaign-feat-sections.js";
import { applyClassArchetypeDraft } from "../class-archetype-service.js";
import { applyClassBranchDraft, createBranchSelectorSelection } from "../class-branch-service.js";
import { applyClassFeatureChoiceDraft } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { readManualStaticItemGrants, selectionFromManualStaticGrant, } from "../selector-application.js";
import { cloneData } from "../shared/cloning.js";
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { findSpellcastingEntryForChoice } from "../shared/spellcasting.js";
import { activeClassArchetypeProfile } from "../wayfinder/class-archetype/registry.js";
import { maxProficiencyRank, projectDraftSkillRanks } from "../wayfinder/domain/skill-rank-projection.js";
import { applyBoostDraft } from "./boost-application.js";
import { createSingletonGrantItems } from "./explicit-grant-application.js";
import { buildLanguageChoiceUpdate } from "./language-choice-application.js";
import { readManualSystemItemGrants, selectionFromSystemGrant } from "./manual-system-item-grants.js";
import { nativeSpellcastingSourceSelections, syncNativeClassSpellcasting } from "./native-spellcasting-application.js";
import { createEmbeddedSource, createSingletonSystemGrantItems, hasSourceId, insertFeatSelection, orderSelections, preflightFeatSelection, replaceSingletonItems, restoreSingletonSourceSlotFlags, singletonSelections, } from "./selection-application.js";
import { DEFAULT_CREATE_DEPS } from "./selection-source-application.js";
import { applySingletonChoiceDraft } from "./singleton-choice-application.js";
import { applySpellChoiceDraft } from "./spell-choice-application.js";
import { spellLocationId } from "./spellcasting-entry-support.js";
import { applySkillIncreaseDraft, applyTrainingDraft, buildTrainingActorUpdate } from "./training-application.js";
export class DraftApplyPhaseError extends Error {
    phase;
    completedPhases;
    completedReceipts;
    partialReceipt;
    constructor(phase, completedReceipts, partialReceipt, cause) {
        const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
        super(`Wayfinder apply failed during ${phase}.${detail}`, { cause });
        this.name = "DraftApplyPhaseError";
        this.phase = phase;
        this.completedReceipts = cloneData(completedReceipts);
        this.completedPhases = this.completedReceipts.map((receipt) => receipt.phase);
        this.partialReceipt = partialReceipt;
    }
}
const PHASE_IDS = [
    "singleton-replacements",
    "singleton-system-grants",
    "singleton-explicit-grants",
    "singleton-choice-persistence-early",
    "skill-training-items",
    "class-archetype",
    "class-branches",
    "class-feature-choices",
    "native-spellcasting-before-feats",
    "feat-selections",
    "singleton-choice-persistence-late",
    "spell-choices",
    "native-spellcasting-after-spells",
    "boost-item-updates",
    "source-flag-restoration",
    "verify-outcome",
    "finalize-actor",
];
const PF2E_SKILL_SLUGS = new Set([
    "acrobatics",
    "arcana",
    "athletics",
    "crafting",
    "deception",
    "diplomacy",
    "intimidation",
    "medicine",
    "nature",
    "occultism",
    "performance",
    "religion",
    "society",
    "stealth",
    "survival",
    "thievery",
]);
const DEFAULT_PREPARE_DEPS = {
    createEmbeddedSource,
    fetchSelectionDocument,
    preflightFeatSelection,
    resolveCampaignFeatSlot: resolveCampaignFeatSlotSetting,
};
export async function prepareDraftApplication(actor, draftInput, stepsInput, depsInput = {}) {
    const deps = { ...DEFAULT_PREPARE_DEPS, ...depsInput };
    assertActorAuthority(actor, deps.validateActorAuthority);
    const draft = cloneData(draftInput);
    const steps = cloneData(stepsInput);
    const activeSlotIds = new Set(steps.map((step) => step.slotId));
    const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
    const selections = orderSelections(draft, steps).filter((selection) => activeSlotIds.has(selection.slotId));
    const pendingFeatSelections = selections.filter((selection) => {
        const step = stepsBySlotId.get(selection.slotId);
        return (!!step &&
            selection.itemType === "feat" &&
            !(step.kind === "pick-item" && step.slotKind === "flag-choice") &&
            !usesNativeGrantItemCreation(step));
    });
    await validateMutationCapabilities(actor, selections, steps);
    validateDraftChoiceValues(actor, draft, steps, deps.validSkillSlugs);
    const sources = await prepareSourceCatalog(actor, draft, steps, selections, deps);
    await validateSelectedEligibility(draft, steps, selections, deps);
    await validatePersistenceTargets(actor, draft, steps, deps);
    validateSpellDestinations(actor, draft, steps);
    for (const selection of pendingFeatSelections) {
        await deps.preflightFeatSelection(actor, selection, stepsBySlotId.get(selection.slotId) ?? null, sources.insertDependencies);
    }
    return {
        actor,
        draft,
        steps,
        phaseIds: PHASE_IDS,
        selections,
        pendingFeatSelections,
        stepsBySlotId,
        deferredActorUpdate: buildLanguageChoiceUpdate(draft, steps),
        validateActorAuthority: deps.validateActorAuthority,
        sources,
    };
}
function validateDraftChoiceValues(actor, draft, steps, configuredSkillSlugs) {
    const activeSlotIds = new Set(steps.map((step) => step.slotId));
    const validSkillSlugs = new Set([
        ...PF2E_SKILL_SLUGS,
        ...Object.keys(actor.system?.skills ?? {}),
        ...(configuredSkillSlugs ?? []),
    ]);
    const activeRankDraft = {
        skillIncreases: Object.fromEntries(Object.entries(draft.skillIncreases).filter(([slotId]) => activeSlotIds.has(slotId))),
        skillTrainings: Object.fromEntries(Object.entries(draft.skillTrainings).filter(([slotId]) => activeSlotIds.has(slotId))),
    };
    for (const step of steps) {
        if (step.kind === "singleton-choice") {
            assertListedChoice(step, draft.singletonChoices[step.slotId], step.singletonChoice.options);
        }
        else if (step.kind === "class-choice") {
            assertListedChoice(step, draft.classChoices[step.slotId], step.classChoice.options);
        }
        else if (step.kind === "class-archetype") {
            assertListedChoice(step, draft.classArchetypeChoices[step.slotId], step.classArchetype.options);
        }
        else if (step.kind === "language-choice") {
            const selected = draft.languageChoices[step.slotId] ?? [];
            const allowed = new Set(step.languageChoice.options.map((option) => option.value));
            if (selected.length > step.languageChoice.count || selected.some((value) => !allowed.has(value))) {
                throw staleChoiceError(step);
            }
        }
        else if (step.kind === "skill-training") {
            validateTrainingChoices(draft, step, validSkillSlugs);
        }
        else if (step.kind === "skill-increase") {
            const selected = draft.skillIncreases[step.slotId];
            if (selected && !validSkillSlugs.has(selected))
                throw staleChoiceError(step);
            if (selected) {
                const ranks = projectDraftSkillRanks({
                    baseSkillRanks: Object.fromEntries(Object.entries(actor.system?.skills ?? {}).map(([slug, data]) => [
                        slug,
                        Number(data?.rank ?? 0),
                    ])),
                    draft: activeRankDraft,
                    beforeSlotId: step.slotId,
                });
                if ((ranks[selected] ?? 0) >= maxProficiencyRank(step.level))
                    throw staleChoiceError(step);
            }
        }
        else if (step.kind === "spell-choice") {
            const selected = draft.spellChoices[step.slotId] ?? [];
            if (selected.length !== step.spellChoice.count)
                throw staleChoiceError(step);
        }
    }
}
function assertListedChoice(step, selected, options) {
    if (selected && !options.some((option) => option.value === selected)) {
        throw staleChoiceError(step);
    }
}
function validateTrainingChoices(draft, step, validSkillSlugs) {
    const training = draft.skillTrainings[step.slotId];
    if (!training)
        return;
    if (training.additional.length > step.training.additionalCount ||
        training.additional.some((slug) => !validSkillSlugs.has(slug))) {
        throw staleChoiceError(step);
    }
    for (const choice of step.training.choiceRules) {
        const selected = training.ruleChoices[choice.key];
        if (!selected)
            continue;
        const allowed = [...choice.options, ...(choice.fallbackOptions ?? [])].some((option) => option.slug === selected);
        if (!allowed)
            throw staleChoiceError(step);
    }
    for (const choice of step.training.loreChoices) {
        const selected = training.loreChoices[choice.key];
        if (selected && !choice.allowCustom && !choice.suggestions.includes(selected)) {
            throw staleChoiceError(step);
        }
    }
}
function staleChoiceError(step) {
    return new Error(`${step.title} changed after this draft was prepared; review that choice before applying.`);
}
async function validateSelectedEligibility(draft, steps, activeSelections, deps) {
    if (!deps.validateSelectionEligibility)
        return;
    const selectionsBySlot = new Map();
    for (const selection of activeSelections) {
        selectionsBySlot.set(selection.slotId, [...(selectionsBySlot.get(selection.slotId) ?? []), selection]);
    }
    for (const selection of Object.values(draft.branchSelections)) {
        selectionsBySlot.set(selection.slotId, [...(selectionsBySlot.get(selection.slotId) ?? []), selection]);
    }
    for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
        selectionsBySlot.set(slotId, selections);
    }
    for (const step of steps) {
        for (const selection of selectionsBySlot.get(step.slotId) ?? []) {
            if (!(await deps.validateSelectionEligibility(selection, step))) {
                throw new Error(`${selection.name} is no longer eligible for ${step.title}; the draft cannot be applied safely.`);
            }
        }
    }
}
export async function executePreparedDraftApplication(prepared, options = {}) {
    assertActorAuthority(prepared.actor, prepared.validateActorAuthority);
    const receipts = [];
    let projectedTrainingRanks = {};
    for (const phase of prepared.phaseIds) {
        const beforeItems = snapshotPhaseItems(prepared.actor);
        try {
            await options.beforePhase?.(phase);
            switch (phase) {
                case "singleton-replacements":
                    await replaceSingletonItems(prepared.actor, singletonSelections(prepared.selections), prepared.draft, prepared.steps, prepared.sources.createDependencies);
                    break;
                case "singleton-system-grants":
                    await createSingletonSystemGrantItems(prepared.actor, prepared.draft, prepared.steps, prepared.sources.insertDependencies);
                    break;
                case "singleton-explicit-grants":
                    await createSingletonGrantItems(prepared.actor, prepared.draft, prepared.steps, prepared.sources.insertDependencies);
                    refreshActorData(prepared.actor);
                    break;
                case "singleton-choice-persistence-early":
                    await applySingletonChoiceDraft(prepared.actor, prepared.draft, prepared.steps);
                    break;
                case "skill-training-items":
                    projectedTrainingRanks = await applyTrainingDraft(prepared.actor, prepared.draft, prepared.steps, {
                        persistActorUpdate: false,
                    });
                    Object.assign(prepared.deferredActorUpdate, buildTrainingActorUpdate(prepared.actor, projectedTrainingRanks));
                    break;
                case "class-archetype":
                    await applyClassArchetypeDraft(prepared.actor, prepared.draft, prepared.steps, {
                        createEmbeddedSource: prepared.sources.createEmbeddedSource,
                        fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
                    });
                    break;
                case "class-branches":
                    await applyClassBranchDraft(prepared.actor, prepared.draft, prepared.steps, {
                        createEmbeddedSource: prepared.sources.createEmbeddedSource,
                        fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
                    });
                    break;
                case "class-feature-choices":
                    await applyClassFeatureChoiceDraft(prepared.actor, prepared.draft, prepared.steps, {
                        createEmbeddedSource: prepared.sources.createEmbeddedSource,
                        fetchSelectionDocument: prepared.sources.fetchSelectionDocument,
                    });
                    break;
                case "native-spellcasting-before-feats":
                    await syncNativeClassSpellcasting(prepared.actor, prepared.draft, prepared.sources.createEmbeddedSource);
                    break;
                case "feat-selections":
                    for (const selection of prepared.pendingFeatSelections) {
                        const step = prepared.stepsBySlotId.get(selection.slotId);
                        if (!step || hasSourceId(prepared.actor, selection.uuid)) {
                            continue;
                        }
                        await insertFeatSelection(prepared.actor, selection, step, prepared.sources.insertDependencies, prepared.draft, prepared.steps);
                    }
                    break;
                case "singleton-choice-persistence-late":
                    await applySingletonChoiceDraft(prepared.actor, prepared.draft, prepared.steps);
                    break;
                case "spell-choices":
                    await applySpellChoiceDraft(prepared.actor, prepared.draft, prepared.steps, prepared.sources.createEmbeddedSource);
                    break;
                case "native-spellcasting-after-spells":
                    await syncNativeClassSpellcasting(prepared.actor, prepared.draft, prepared.sources.createEmbeddedSource);
                    break;
                case "boost-item-updates": {
                    const boostResult = await applyBoostDraft(prepared.actor, prepared.draft, undefined, {
                        persistActorUpdate: false,
                    });
                    Object.assign(prepared.deferredActorUpdate, boostResult.actorUpdate);
                    const skillIncreaseUpdate = await applySkillIncreaseDraft(prepared.actor, prepared.draft, projectedTrainingRanks, {
                        persistActorUpdate: false,
                        activeSlotIds: new Set(prepared.steps.filter((step) => step.kind === "skill-increase").map((step) => step.slotId)),
                    });
                    Object.assign(prepared.deferredActorUpdate, skillIncreaseUpdate);
                    break;
                }
                case "source-flag-restoration":
                    await restoreSingletonSourceSlotFlags(prepared.actor, prepared.draft);
                    addLevelUpdate(prepared);
                    break;
                case "verify-outcome":
                    verifyPreparedOutcome(prepared);
                    break;
                case "finalize-actor":
                    await prepared.actor.update?.({
                        ...prepared.deferredActorUpdate,
                        ...(options.finalActorUpdate ?? {}),
                    });
                    break;
            }
            receipts.push(buildPhaseReceipt(phase, beforeItems, prepared.actor, {
                ...prepared.deferredActorUpdate,
                ...(options.finalActorUpdate ?? {}),
            }));
        }
        catch (error) {
            throw new DraftApplyPhaseError(phase, receipts, buildPhaseReceipt(phase, beforeItems, prepared.actor, {
                ...prepared.deferredActorUpdate,
                ...(options.finalActorUpdate ?? {}),
            }), error);
        }
    }
    return {
        actorUpdate: { ...prepared.deferredActorUpdate },
        receipts,
    };
}
function snapshotPhaseItems(actor) {
    return new Map(listActorItems(actor).flatMap((item) => {
        if (!item.id)
            return [];
        return [
            [
                item.id,
                JSON.stringify({
                    type: item.type,
                    name: item.name,
                    sourceId: item.flags?.core?.sourceId ?? item.sourceId ?? null,
                    system: item.system,
                    wayfinder: item.flags?.[MODULE_ID],
                    pf2e: item.flags?.pf2e,
                }),
            ],
        ];
    }));
}
function buildPhaseReceipt(phase, before, actor, actorUpdate) {
    const after = snapshotPhaseItems(actor);
    return {
        phase,
        createdItemIds: [...after.keys()].filter((id) => !before.has(id)),
        deletedItemIds: [...before.keys()].filter((id) => !after.has(id)),
        updatedItemIds: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
        actorUpdatePaths: phase === "finalize-actor" ? Object.keys(actorUpdate) : [],
    };
}
function verifyPreparedOutcome(prepared) {
    const actorItems = listActorItems(prepared.actor);
    for (const selection of prepared.sources.expectedSelections) {
        if (!actorItems.some((item) => itemMatchesSourceId(item, selection.uuid))) {
            throw new Error(`${selection.name} was not created or retained by PF2E; the draft was not finalized.`);
        }
    }
    for (const selection of prepared.pendingFeatSelections) {
        const step = prepared.stepsBySlotId.get(selection.slotId);
        const expectedLocation = step ? expectedFeatLocation(step) : null;
        if (!expectedLocation)
            continue;
        const item = actorItems.find((candidate) => itemMatchesSourceId(candidate, selection.uuid));
        if (!item || actorItemLocation(item) !== expectedLocation) {
            throw new Error(`${selection.name} was not placed in PF2E's expected ${expectedLocation} feat slot.`);
        }
    }
    for (const step of prepared.steps) {
        if (step.kind !== "spell-choice")
            continue;
        const selections = prepared.draft.spellChoices[step.slotId] ?? [];
        if (selections.length === 0)
            continue;
        const entry = findSpellcastingEntryForChoice(prepared.actor, step.spellChoice);
        if (!entry?.id) {
            throw new Error(`${step.title} has no prepared PF2E spellcasting destination.`);
        }
        const actualCounts = new Map();
        for (const item of actorItems) {
            if (item.type !== "spell" || spellLocationId(item) !== entry.id)
                continue;
            const match = selections.find((selection) => itemMatchesSourceId(item, selection.uuid));
            if (match)
                actualCounts.set(match.uuid, (actualCounts.get(match.uuid) ?? 0) + 1);
        }
        const expectedCounts = new Map();
        for (const selection of selections) {
            expectedCounts.set(selection.uuid, (expectedCounts.get(selection.uuid) ?? 0) + 1);
        }
        for (const [uuid, count] of expectedCounts) {
            if ((actualCounts.get(uuid) ?? 0) < count) {
                throw new Error(`${step.title} did not create every selected spell; the draft was not finalized.`);
            }
        }
    }
    verifyTrainingLoreOutcomes(prepared, actorItems);
}
function verifyTrainingLoreOutcomes(prepared, actorItems) {
    const expectedByName = new Map();
    for (const step of prepared.steps) {
        if (step.kind !== "skill-training")
            continue;
        const training = prepared.draft.skillTrainings[step.slotId];
        if (!training)
            continue;
        for (const entry of [
            ...step.training.fixedLores.map((name, index) => ({ name, key: `fixed:${index}` })),
            ...step.training.loreChoices.flatMap((choice) => {
                const name = training.loreChoices[choice.key];
                return name ? [{ name, key: choice.key }] : [];
            }),
        ]) {
            const normalizedName = normalizeLoreName(entry.name);
            expectedByName.set(normalizedName.toLowerCase(), {
                name: normalizedName,
                slotId: step.slotId,
                key: entry.key,
            });
        }
    }
    for (const [normalizedKey, entry] of expectedByName) {
        const item = actorItems.find((candidate) => candidate.type === "lore" && normalizeLoreName(candidate.name ?? "").toLowerCase() === normalizedKey);
        const flags = item?.flags?.[MODULE_ID];
        const rank = Number(item?.system?.proficient?.value ?? 0);
        if (!item || rank < 1 || flags?.slotId !== entry.slotId || flags.trainingKey !== entry.key) {
            throw new Error(`${entry.name} was not created or updated by PF2E; the draft was not finalized.`);
        }
    }
}
function normalizeLoreName(value) {
    const trimmed = value.trim().replace(/\s+/gu, " ");
    return /\blore\b$/iu.test(trimmed) ? trimmed : `${trimmed} Lore`;
}
function expectedFeatLocation(step) {
    switch (step.slotKind) {
        case "ancestry-feat":
            return `ancestry-${step.level}`;
        case "class-feat":
            return `class-${step.level}`;
        case "skill-feat":
            return `skill-${step.level}`;
        case "general-feat":
            return `general-${step.level}`;
        case "archetype-feat":
            return `archetype-${step.level}`;
        case "campaign-feat":
            return step.campaignFeat?.groupSlotId ?? null;
        default:
            return null;
    }
}
function actorItemLocation(item) {
    const location = item.system?.location;
    if (typeof location === "string")
        return location;
    if (location && typeof location === "object" && "value" in location && typeof location.value === "string") {
        return location.value;
    }
    return null;
}
function assertActorAuthority(actor, validateActorAuthority) {
    if (validateActorAuthority && !validateActorAuthority(actor)) {
        throw new Error("The current user can no longer modify this PF2E character.");
    }
}
async function prepareSourceCatalog(actor, draft, steps, activeSelections, deps) {
    const refs = collectSourceRefs(actor, draft, steps, activeSelections);
    const sourcesByKey = new Map();
    const sourcesByUuid = new Map();
    const documentsByUuid = new Map();
    const expectedSelections = [];
    const nonMaterializedSelectionKeys = new Set(steps.flatMap((step) => {
        const selection = step.kind === "pick-item" && step.flagChoice ? draft.selections[step.slotId] : null;
        return selection ? [sourceCatalogKey(selection)] : [];
    }));
    const campaignAuthorities = new Map();
    for (const step of steps) {
        if (step.slotKind === "campaign-feat" && step.campaignFeat) {
            const key = `${step.campaignFeat.sectionId}#${step.campaignFeat.groupSlotId}`;
            if (!campaignAuthorities.has(key)) {
                const authority = deps.resolveCampaignFeatSlot(step.campaignFeat.sectionId, step.campaignFeat.groupSlotId);
                campaignAuthorities.set(key, authority ? cloneData(authority) : null);
            }
        }
    }
    const pending = [...refs.values()];
    for (let index = 0; index < pending.length; index += 1) {
        const selection = pending[index];
        if (!selection || sourcesByKey.has(sourceCatalogKey(selection)))
            continue;
        if (!nonMaterializedSelectionKeys.has(sourceCatalogKey(selection))) {
            expectedSelections.push(selection);
        }
        const existing = listActorItems(actor).find((item) => itemMatchesSourceId(item, selection.uuid));
        const document = await deps.fetchSelectionDocument(selection);
        const existingSource = existing ? snapshotActorItemSource(existing) : null;
        const resolvedSource = await deps.createEmbeddedSource(selection, draft, steps);
        const source = resolvedSource ?? existingSource;
        if (!source) {
            throw new Error(`Cannot prepare ${selection.name}: source document ${selection.uuid} could not be resolved.`);
        }
        sourcesByKey.set(sourceCatalogKey(selection), cloneData(source));
        if (!sourcesByUuid.has(selection.uuid))
            sourcesByUuid.set(selection.uuid, cloneData(source));
        if (!documentsByUuid.has(selection.uuid)) {
            documentsByUuid.set(selection.uuid, cloneData(existingSource ?? document?.toObject() ?? source));
        }
        for (const grant of readManualSystemItemGrants(source)) {
            pending.push(selectionFromSystemGrant(grant));
        }
        for (const grant of readManualStaticItemGrants(source)) {
            const childSelection = selectionFromManualStaticGrant(grant, selection.slotId);
            if (childSelection)
                pending.push(childSelection);
        }
    }
    const resolvePreparedSource = (selection) => {
        const prepared = sourcesByKey.get(sourceCatalogKey(selection)) ?? sourcesByUuid.get(selection.uuid);
        if (!prepared) {
            throw new Error(`Cannot execute ${selection.name}: its source was not included in the prepared application.`);
        }
        return prepareCachedSource(prepared, selection);
    };
    const createDependencies = {
        ...DEFAULT_CREATE_DEPS,
        resolvePreparedSource,
    };
    const fetchFromCatalog = async (selection) => {
        const documentSource = documentsByUuid.get(selection.uuid);
        if (!documentSource) {
            throw new Error(`Cannot execute ${selection.name}: its source document was not prepared.`);
        }
        const source = cloneData(documentSource);
        return {
            ...source,
            toObject: () => cloneData(source),
        };
    };
    const createFromCatalog = async (selection) => resolvePreparedSource(selection);
    return {
        createEmbeddedSource: createFromCatalog,
        createDependencies,
        insertDependencies: {
            fetchSelectionDocument: fetchFromCatalog,
            createEmbeddedSource: createFromCatalog,
            resolveCampaignFeatSlot: (sectionId, slotId) => campaignAuthorities.get(`${sectionId}#${slotId}`) ?? null,
        },
        fetchSelectionDocument: fetchFromCatalog,
        expectedSelections,
    };
}
function sourceCatalogKey(selection) {
    return `${selection.uuid}#${selection.slotId}`;
}
function snapshotActorItemSource(item) {
    const toObject = item.toObject;
    const source = cloneData(typeof toObject === "function" ? toObject.call(item) : { ...item });
    delete source.id;
    delete source._id;
    return source;
}
function prepareCachedSource(sourceInput, selection) {
    const source = cloneData(sourceInput);
    delete source.id;
    delete source._id;
    source.flags ??= {};
    source.flags.core = { ...(source.flags.core ?? {}), sourceId: selection.uuid };
    source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        importedBy: MODULE_ID,
        slotId: selection.slotId,
    };
    return source;
}
function collectSourceRefs(actor, draft, steps, activeSelections) {
    const refs = new Map();
    const add = (selection) => {
        refs.set(`${selection.uuid}#${selection.slotId}`, selection);
    };
    activeSelections.forEach(add);
    const activeSlotIds = new Set(steps.map((step) => step.slotId));
    Object.values(draft.branchSelections)
        .filter((selection) => activeSlotIds.has(selection.slotId))
        .forEach(add);
    for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
        if (activeSlotIds.has(slotId))
            selections.forEach(add);
    }
    const activeProfile = activeClassArchetypeProfile(draft, listActorItems(actor));
    if (activeProfile) {
        add({ ...activeProfile.selection, slotId: activeProfile.decisionSlotId });
        add({ ...activeProfile.selector.selection, slotId: activeProfile.decisionSlotId });
    }
    for (const internalChoice of activeProfile?.internalClassFeatureChoices ?? []) {
        add({
            ...internalChoice.selection,
            slotId: `class-archetype-internal-${internalChoice.selection.slug ?? internalChoice.selection.documentId}`,
        });
    }
    nativeSpellcastingSourceSelections(actor, draft).forEach(add);
    for (const step of steps) {
        if (step.kind === "class-branch" && step.branch && draft.branchSelections[step.slotId]) {
            add(createBranchSelectorSelection(step.branch, step.slotId));
        }
        else if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
            add(sourceSelection(step.slotId, step.classChoice));
        }
        else if (step.kind === "singleton-choice" && step.singletonChoice && draft.singletonChoices[step.slotId]) {
            add(sourceSelection(step.slotId, step.singletonChoice));
        }
        else if (step.kind === "pick-item" && step.flagChoice && draft.selections[step.slotId]) {
            add(sourceSelection(step.slotId, step.flagChoice));
        }
        else if (step.kind === "pick-item" && step.grantSelection && draft.selections[step.slotId]) {
            add({
                slotId: step.slotId,
                packId: step.grantSelection.selectorPackId,
                documentId: step.grantSelection.selectorDocumentId,
                uuid: step.grantSelection.selectorUuid,
                itemType: step.grantSelection.sourceItemType === "classfeature" ? "feat" : step.grantSelection.sourceItemType,
                featType: step.grantSelection.sourceItemType === "classfeature" ? "classfeature" : null,
                name: step.grantSelection.selectorName,
                level: step.level,
            });
        }
        else if (step.kind === "class-archetype") {
            const value = draft.classArchetypeChoices[step.slotId];
            if (value && value !== step.classArchetype.standardValue) {
                add({
                    slotId: step.slotId,
                    packId: step.classArchetype.selector.selectorPackId,
                    documentId: step.classArchetype.selector.selectorDocumentId,
                    uuid: step.classArchetype.selector.selectorUuid,
                    itemType: "feat",
                    featType: "classfeature",
                    name: step.classArchetype.selector.selectorName,
                    level: step.level,
                });
            }
        }
    }
    return refs;
}
async function validatePersistenceTargets(actor, draft, steps, deps) {
    const activeProfile = activeClassArchetypeProfile(draft, listActorItems(actor));
    for (const internalChoice of activeProfile?.internalClassFeatureChoices ?? []) {
        await validateRuleTarget(actor, {
            ...internalChoice.selection,
            slotId: `class-archetype-internal-${internalChoice.selection.slug ?? internalChoice.selection.documentId}`,
        }, { sourceRuleIndex: internalChoice.sourceRuleIndex, flag: internalChoice.flag }, deps);
    }
    for (const step of steps) {
        if (step.kind === "singleton-choice" && step.singletonChoice && draft.singletonChoices[step.slotId]) {
            await validateRuleTarget(actor, sourceSelection(step.slotId, step.singletonChoice), step.singletonChoice, deps);
        }
        if (step.kind === "class-choice" && step.classChoice && draft.classChoices[step.slotId]) {
            await validateRuleTarget(actor, sourceSelection(step.slotId, step.classChoice), step.classChoice, deps);
        }
        if (step.kind === "pick-item" && step.flagChoice && draft.selections[step.slotId]) {
            await validateRuleTarget(actor, sourceSelection(step.slotId, step.flagChoice), step.flagChoice, deps);
        }
        if (step.kind === "skill-training" && step.training) {
            const training = draft.skillTrainings[step.slotId];
            if (!training)
                continue;
            for (const choice of step.training.choiceRules) {
                if (training.ruleChoices[choice.key] && choice.persistence) {
                    await validateRuleTarget(actor, sourceSelection(step.slotId, choice.persistence), { sourceRuleIndex: choice.persistence.sourceRuleIndex, flag: choice.flag }, deps);
                }
            }
            for (const choice of step.training.loreChoices) {
                if (training.loreChoices[choice.key] && choice.persistence) {
                    await validateRuleTarget(actor, sourceSelection(step.slotId, choice.persistence), { sourceRuleIndex: choice.persistence.sourceRuleIndex, flag: choice.flag }, deps);
                }
            }
        }
    }
}
async function validateRuleTarget(actor, selection, target, deps) {
    const actorItem = listActorItems(actor).find((item) => itemMatchesSourceId(item, selection.uuid));
    const document = actorItem ? null : await deps.fetchSelectionDocument(selection);
    const source = actorItem ?? document?.toObject();
    const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
    const rule = rules[target.sourceRuleIndex];
    if (!rule ||
        typeof rule !== "object" ||
        rule.key !== "ChoiceSet" ||
        effectiveChoiceFlag(rule, source) !== target.flag) {
        throw new Error(`Cannot persist ${target.flag}: its PF2E choice target changed or is unavailable.`);
    }
}
function effectiveChoiceFlag(rule, source) {
    for (const value of [rule.flag, rule.slug]) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.replace(/[^-a-z0-9]/giu, "");
        }
    }
    const sourceSlug = source?.system?.slug;
    if (typeof sourceSlug !== "string")
        return null;
    const parts = sourceSlug
        .trim()
        .split(/[^a-z0-9]+/iu)
        .filter(Boolean);
    if (parts.length === 0)
        return null;
    return parts
        .map((part, index) => (index === 0 ? part.toLowerCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
        .join("");
}
function validateSpellDestinations(actor, draft, steps) {
    const plannedDestinationKeys = new Set();
    for (const step of steps) {
        if (step.kind !== "spell-choice" || (draft.spellChoices[step.slotId]?.length ?? 0) === 0) {
            continue;
        }
        if (!step.spellChoice.reuseExistingEntryOnly) {
            plannedDestinationKeys.add(step.spellChoice.destination.key);
            continue;
        }
        const entry = findSpellcastingEntryForChoice(actor, step.spellChoice);
        if (!entry?.id && !plannedDestinationKeys.has(step.spellChoice.destination.key)) {
            throw new Error(`Cannot place ${step.title}: its PF2E spellcasting destination is unavailable.`);
        }
    }
}
async function validateMutationCapabilities(actor, selections, steps) {
    if (selections.length > 0 && typeof actor.createEmbeddedDocuments !== "function") {
        throw new Error("This actor cannot create the selected PF2E items.");
    }
    if (steps.some((step) => ["singleton-choice", "class-choice", "class-branch", "spell-choice", "skill-training"].includes(step.kind)) &&
        typeof actor.updateEmbeddedDocuments !== "function") {
        throw new Error("This actor cannot persist the selected PF2E item choices.");
    }
    if (typeof actor.update !== "function") {
        throw new Error("This actor cannot finalize the Wayfinder draft.");
    }
}
function sourceSelection(slotId, meta) {
    const sourceItemType = meta.sourceItemType ?? "feat";
    return {
        slotId,
        packId: meta.sourcePackId,
        documentId: meta.sourceDocumentId,
        uuid: meta.sourceUuid,
        itemType: sourceItemType === "classfeature" ? "feat" : sourceItemType,
        featType: sourceItemType === "classfeature" || sourceItemType === "feat" ? "classfeature" : null,
        name: meta.sourceName ?? meta.sourceUuid,
        level: null,
    };
}
function addLevelUpdate(prepared) {
    const currentLevel = Number(prepared.actor?.system?.details?.level?.value ?? 1) || 1;
    if (prepared.draft.targetLevel > currentLevel) {
        prepared.deferredActorUpdate["system.details.level.value"] = prepared.draft.targetLevel;
    }
}
function refreshActorData(actor) {
    if (hasPreparedPf2eFlagAlias(actor))
        return;
    actor.prepareData?.();
}
function hasPreparedPf2eFlagAlias(actor) {
    const flags = actor.flags;
    if (!flags || typeof flags !== "object")
        return false;
    const descriptor = Object.getOwnPropertyDescriptor(flags, "system");
    return !!descriptor && descriptor.configurable === false;
}
//# sourceMappingURL=prepared-draft-application.js.map