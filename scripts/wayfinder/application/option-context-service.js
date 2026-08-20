import { mergeActorAndDraftArchetypeFeats, projectedArchetypeFeat } from "../../pack/archetype-legality.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntryForChoiceInItems } from "../../shared/spellcasting.js";
import { projectedClassArchetypeFeatSelections, projectedClassArchetypeStaticFeatSelections, withExistingClassArchetypeChoice, } from "../class-archetype/registry.js";
import { projectDraftSkillRanks } from "../domain/skill-rank-projection.js";
import { collectActorRuleSelectionRollOptions, collectSkillRankRollOptions } from "../projected-rule-options.js";
import { selectionTakenLevel } from "../selection-level.js";
export function extractContextTraits(document, extractDocumentSlug, fallbackSlug) {
    const typedDocument = document;
    const traits = Array.isArray(typedDocument?.system?.traits?.value) ? typedDocument.system.traits.value : [];
    const normalized = new Set(traits
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean));
    const slug = fallbackSlug ?? extractDocumentSlug(document);
    if (slug) {
        normalized.add(slug);
    }
    return Array.from(normalized);
}
export function resolveSanctificationChoice(args) {
    const { draft, actorItems, deityDocument } = args;
    const drafted = Object.entries(draft.classChoices).find(([slotId]) => /^class-choice-.+-sanctification-level-\d+$/.test(slotId))?.[1];
    if (drafted === "holy" || drafted === "unholy" || drafted === "none") {
        return drafted;
    }
    const actorSelection = actorItems
        .map((item) => item?.flags?.pf2e?.rulesSelections?.sanctification)
        .find((value) => typeof value === "string" && value.length > 0) ?? null;
    if (actorSelection === "holy" || actorSelection === "unholy" || actorSelection === "none") {
        return actorSelection;
    }
    const sanctification = deityDocument?.system?.sanctification;
    if (!sanctification || typeof sanctification !== "object") {
        return "none";
    }
    const modal = typeof sanctification.modal === "string" ? sanctification.modal.trim().toLowerCase() : "";
    const values = Array.isArray(sanctification.what)
        ? sanctification.what.filter((value) => typeof value === "string")
        : [];
    if (modal === "must" && values.length === 1) {
        const value = values[0]?.trim().toLowerCase();
        return value === "holy" || value === "unholy" ? value : "none";
    }
    if (values.length === 0) {
        return "none";
    }
    return null;
}
export async function resolveSelectionTraits(selection, deps) {
    if (!selection) {
        return [];
    }
    const document = await deps.fetchSelectionDocument(selection);
    return extractContextTraits(document, deps.extractDocumentSlug);
}
export async function resolveSelectionSlug(selection, deps) {
    if (!selection) {
        return null;
    }
    const document = await deps.fetchSelectionDocument(selection);
    return deps.extractDocumentSlug(document);
}
export async function resolveSelectionClassHasSpellcasting(selection, deps) {
    if (!selection) {
        return false;
    }
    return classDocumentHasSpellcasting(await deps.fetchSelectionDocument(selection));
}
export async function hasDedicationFeatInContext(args) {
    const projected = await buildProjectedArchetypeFeats(args);
    return projected.some((feat) => feat.traits.includes("dedication"));
}
function draftedFeatLevel(selection) {
    return selectionTakenLevel(selection);
}
function actorFeatLevel(item) {
    const typedItem = item;
    const takenLevel = numericLevel(typedItem?.system?.level?.taken);
    if (takenLevel !== null) {
        return takenLevel;
    }
    const location = typedItem?.system?.location;
    const locationValue = typeof location === "string"
        ? location
        : typeof location?.value === "string"
            ? String(location.value)
            : "";
    const locationLevel = numericLevel(locationValue.match(/-(\d+)$/)?.[1]);
    return locationLevel ?? numericLevel(typedItem?.system?.level?.value);
}
function isFeatAvailableByLevel(level, maximumFeatLevel) {
    return maximumFeatLevel === undefined || level === null || level <= maximumFeatLevel;
}
function numericLevel(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? Math.floor(numeric) : null;
}
export async function buildOptionContext(deps) {
    const actorItems = deps.listActorItems();
    const effectiveDraft = withExistingClassArchetypeChoice(deps.draft, actorItems);
    const [ancestryDocument, heritageDocument, classDocument, deityDocument, projectedArchetypeFeats] = await Promise.all([
        deps.resolveDocument("ancestry"),
        deps.resolveDocument("heritage"),
        deps.resolveDocument("class"),
        deps.resolveDocument("deity"),
        buildProjectedArchetypeFeats({
            ...deps,
            draft: effectiveDraft,
            listActorItems: () => actorItems,
        }),
    ]);
    const hasDedicationFeat = projectedArchetypeFeats.some((feat) => feat.traits.includes("dedication"));
    const ancestrySlug = deps.extractDocumentSlug(ancestryDocument);
    const selectedUuidsBySlotId = buildSelectedUuidsBySlotId(effectiveDraft);
    const selectedSpellChoicesBySlotId = buildSelectedSpellChoicesBySlotId(effectiveDraft, deps.steps ?? []);
    const actorSourceIds = buildActorSourceIds(actorItems);
    const actorSpellUuidsByDestinationKey = buildActorSpellUuidsByDestinationKey(actorItems, deps.steps ?? []);
    const skillRanks = buildProjectedSkillRanks(deps.skillRanks, effectiveDraft, deps.steps ?? [], skillProjectionBoundarySlotId(deps.maximumFeatLevel));
    const rollOptions = buildActiveRollOptions(effectiveDraft, deps.steps ?? [], actorItems, skillRanks);
    return {
        ancestrySlug,
        ancestryTraits: extractContextTraits(ancestryDocument, deps.extractDocumentSlug, ancestrySlug),
        heritageTraits: extractContextTraits(heritageDocument, deps.extractDocumentSlug),
        classSlug: deps.extractDocumentSlug(classDocument),
        classHasSpellcasting: classDocumentHasSpellcasting(classDocument),
        deitySelected: !!deityDocument,
        sanctification: resolveSanctificationChoice({
            draft: effectiveDraft,
            actorItems,
            deityDocument,
        }),
        hasDedicationFeat,
        ...(Object.keys(selectedUuidsBySlotId).length > 0 ? { selectedUuidsBySlotId } : {}),
        ...(Object.keys(selectedSpellChoicesBySlotId).length > 0 ? { selectedSpellChoicesBySlotId } : {}),
        ...(actorSourceIds.length > 0 ? { actorSourceIds } : {}),
        ...(Object.keys(actorSpellUuidsByDestinationKey).length > 0 ? { actorSpellUuidsByDestinationKey } : {}),
        ...(rollOptions.length > 0 ? { rollOptions } : {}),
        ...(skillRanks ? { skillRanks } : {}),
        projectedArchetypeFeats,
    };
}
async function buildProjectedArchetypeFeats(args) {
    const { draft, listActorItems, fetchSelectionDocument, extractDocumentSlug, excludedFeatSlotId, maximumFeatLevel } = args;
    const actorItems = listActorItems();
    const effectiveDraft = withExistingClassArchetypeChoice(draft, actorItems);
    const actorFeatItems = actorItems.filter((item) => {
        const traits = extractContextTraits(item, extractDocumentSlug);
        return (item?.type === "feat" &&
            (traits.includes("archetype") || traits.includes("dedication")) &&
            isFeatAvailableByLevel(actorFeatLevel(item), maximumFeatLevel));
    });
    const draftedFeatSelections = [
        ...Object.values(effectiveDraft.selections).filter((selection) => selection.itemType === "feat"),
        ...projectedClassArchetypeFeatSelections(effectiveDraft, effectiveDraft.targetLevel),
    ].filter((selection) => isDraftedFeatBeforeContext(selection, args.steps ?? [], excludedFeatSlotId, maximumFeatLevel));
    const actorFeats = await Promise.all(actorFeatItems.map(async (item) => {
        const sourceUuid = sourceIdOf(item);
        const parts = sourceUuid ? parseCompendiumItemUuid(sourceUuid) : null;
        const sourceDocument = parts
            ? await fetchSelectionDocument({
                slotId: "actor-source",
                packId: parts.packId,
                documentId: parts.documentId,
                uuid: sourceUuid ?? "",
                itemType: "feat",
                featType: null,
                name: item.name ?? "Unknown Feat",
                level: actorFeatLevel(item),
            })
            : null;
        return projectedArchetypeFeat(sourceDocument ?? item, parts?.packId ?? null, {
            uuid: sourceUuid,
            name: item.name,
        });
    }));
    const draftedDocuments = await Promise.all(draftedFeatSelections.map(async (selection) => ({
        selection,
        document: await fetchSelectionDocument(selection),
    })));
    const draftedFeats = draftedDocuments.map(({ selection, document }) => projectedArchetypeFeat(document, selection.packId, {
        uuid: selection.uuid,
        name: selection.name,
        slug: selection.slug,
    }));
    return mergeActorAndDraftArchetypeFeats(actorFeats, draftedFeats).filter((feat) => feat.traits.includes("archetype") || feat.traits.includes("dedication"));
}
function isDraftedFeatBeforeContext(selection, steps, excludedFeatSlotId, maximumFeatLevel) {
    if (selection.slotId === excludedFeatSlotId) {
        return false;
    }
    const currentIndex = excludedFeatSlotId ? steps.findIndex((step) => step.slotId === excludedFeatSlotId) : -1;
    const selectionIndex = steps.findIndex((step) => step.slotId === selection.slotId);
    if (currentIndex >= 0 && selectionIndex >= 0) {
        return selectionIndex < currentIndex;
    }
    const level = draftedFeatLevel(selection);
    if (!isFeatAvailableByLevel(level, maximumFeatLevel)) {
        return false;
    }
    if (!excludedFeatSlotId || maximumFeatLevel === undefined || level === null || level < maximumFeatLevel) {
        return true;
    }
    return featSlotPosition(selection.slotId) < featSlotPosition(excludedFeatSlotId);
}
function featSlotPosition(slotId) {
    if (slotId.startsWith("class-feat-")) {
        return 1;
    }
    if (slotId.startsWith("archetype-feat-")) {
        return 2;
    }
    return 0;
}
function buildActorSourceIds(actorItems) {
    return Array.from(new Set(actorItems
        .map((item) => sourceIdOf(item))
        .filter((sourceId) => typeof sourceId === "string" && sourceId.length > 0)));
}
function buildActorSpellUuidsByDestinationKey(actorItems, steps) {
    const destinationByEntryId = new Map();
    for (const step of steps) {
        if (step.kind !== "spell-choice") {
            continue;
        }
        const entry = findSpellcastingEntryForChoiceInItems(actorItems, step.spellChoice);
        if (typeof entry?.id === "string") {
            destinationByEntryId.set(entry.id, step.spellChoice.destination.key);
        }
    }
    const uuidsByDestination = new Map();
    for (const item of actorItems) {
        const typed = item;
        if (typed?.type !== "spell") {
            continue;
        }
        const rawLocation = typed.system?.location;
        const location = typeof rawLocation === "string"
            ? rawLocation
            : rawLocation && typeof rawLocation.value === "string"
                ? rawLocation.value
                : null;
        const destinationKey = location ? destinationByEntryId.get(location) : null;
        const sourceUuid = sourceIdOf(item);
        if (!destinationKey || !sourceUuid) {
            continue;
        }
        const uuids = uuidsByDestination.get(destinationKey) ?? new Set();
        uuids.add(sourceUuid);
        uuidsByDestination.set(destinationKey, uuids);
    }
    return Object.fromEntries(Array.from(uuidsByDestination, ([destinationKey, uuids]) => [destinationKey, Array.from(uuids)]));
}
function buildActiveRollOptions(draft, steps, actorItems, skillRanks) {
    return Array.from(new Set([
        ...collectDraftRollOptions(draft, steps),
        ...collectActorRuleSelectionRollOptions(actorItems),
        ...collectSkillRankRollOptions(skillRanks),
    ])).sort();
}
function collectDraftRollOptions(draft, steps) {
    const options = [];
    for (const step of steps) {
        if (step.kind === "singleton-choice") {
            const rollOption = normalizeString(step.singletonChoice.rollOption);
            const selection = normalizeString(draft.singletonChoices[step.slotId]);
            if (rollOption && selection) {
                options.push(`${rollOption}:${selection}`);
            }
            continue;
        }
        if (step.kind === "class-choice") {
            const rollOption = normalizeString(step.classChoice.rollOption ?? step.classChoice.flag);
            const selection = normalizeString(draft.classChoices[step.slotId]);
            if (rollOption && selection) {
                options.push(`${rollOption}:${selection}`);
            }
            continue;
        }
        if (step.kind === "class-branch") {
            const rollOption = normalizeString(step.branch?.rollOption);
            const selection = draft.branchSelections[step.slotId];
            const selectionSlug = normalizeSkillSlug(selection?.name);
            if (rollOption && selectionSlug) {
                options.push(`${rollOption}:${selectionSlug}`);
            }
            continue;
        }
        if (step.kind !== "skill-training") {
            continue;
        }
        const training = draft.skillTrainings[step.slotId];
        if (!training) {
            continue;
        }
        for (const choice of step.training.choiceRules) {
            const rollOption = normalizeString(choice.rollOption);
            const selection = normalizeString(training.ruleChoices[choice.key]);
            if (rollOption && selection) {
                options.push(`${rollOption}:${selection}`);
            }
        }
    }
    return options;
}
function buildProjectedSkillRanks(baseRanks, draft, steps, beforeSlotId) {
    const additionalTrainingSkillsBySlotId = {};
    for (const step of steps) {
        if (step.kind !== "skill-training") {
            continue;
        }
        const training = draft.skillTrainings[step.slotId];
        if (!training) {
            continue;
        }
        additionalTrainingSkillsBySlotId[step.slotId] = [
            ...step.training.fixedSkills,
            ...step.training.fixedLores,
            ...step.training.loreChoices.map((choice) => training.loreChoices[choice.key]),
        ];
    }
    const projected = projectDraftSkillRanks({
        baseSkillRanks: baseRanks ?? {},
        draft,
        beforeSlotId,
        additionalTrainingSkillsBySlotId,
    });
    return Object.keys(projected).length > 0 ? projected : null;
}
function skillProjectionBoundarySlotId(maximumFeatLevel) {
    return maximumFeatLevel === undefined ? undefined : `option-context-level-${maximumFeatLevel}`;
}
function buildSelectedUuidsBySlotId(draft) {
    const entries = [
        ...Object.entries(draft.selections),
        ...Object.entries(draft.branchSelections),
        ...projectedClassArchetypeFeatSelections(draft, draft.targetLevel).map((selection) => [selection.slotId, selection]),
        ...projectedClassArchetypeStaticFeatSelections(draft, draft.targetLevel).map((selection) => [selection.slotId, selection]),
    ]
        .map(([slotId, selection]) => [slotId, selection.uuid])
        .filter(([, uuid]) => typeof uuid === "string" && uuid.length > 0);
    return Object.fromEntries(entries);
}
function buildSelectedSpellChoicesBySlotId(draft, steps) {
    const destinationsBySlotId = new Map(steps.flatMap((step) => step.kind === "spell-choice" ? [[step.slotId, step.spellChoice.destination.key]] : []));
    return Object.fromEntries(Object.entries(draft.spellChoices).flatMap(([slotId, selections]) => {
        const destinationKey = destinationsBySlotId.get(slotId);
        if (!destinationKey) {
            return [];
        }
        const uuids = Array.from(new Set(selections
            .map((selection) => selection.uuid)
            .filter((uuid) => typeof uuid === "string" && uuid.length > 0)));
        return uuids.length > 0 ? [[slotId, { destinationKey, uuids }]] : [];
    }));
}
function classDocumentHasSpellcasting(document) {
    const value = document?.system?.spellcasting;
    return Number(value) > 0;
}
function normalizeString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
function normalizeSkillSlug(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
export async function buildContextNote(step, context, deps) {
    if (step.slotKind === "campaign-feat" &&
        step.campaignFeat?.supported.length === 1 &&
        step.campaignFeat.supported[0] === "ancestry") {
        const ancestryName = (await deps.resolveDocument("ancestry"))?.name;
        return ancestryName
            ? `${step.campaignFeat.sectionLabel} feats for ${ancestryName}. Anything that keys off your class is filtered against it.`
            : null;
    }
    switch (step.slotKind) {
        case "heritage": {
            const ancestryDocument = deps.resolveDocument("ancestry");
            const ancestryName = (await ancestryDocument)?.name;
            return ancestryName ? `${ancestryName} heritages, plus the versatile heritages still open to this build.` : null;
        }
        case "ancestry-feat": {
            const [ancestryDocument, heritageDocument] = await Promise.all([
                deps.resolveDocument("ancestry"),
                deps.resolveDocument("heritage"),
            ]);
            const ancestryName = ancestryDocument?.name;
            const heritage = heritageDocument;
            const isVersatile = heritage?.system?.ancestry === null;
            const heritageName = isVersatile ? heritage?.name : null;
            if (ancestryName && heritageName) {
                return `Ancestry feats for ${ancestryName}, plus what ${heritageName} opens up. Anything that keys off your class is filtered against it.`;
            }
            if (ancestryName) {
                return `Ancestry feats for ${ancestryName}. Anything that keys off your class is filtered against it.`;
            }
            return null;
        }
        case "class-feat": {
            const className = (await deps.resolveDocument("class"))?.name;
            if (!className) {
                return null;
            }
            const exceptionReview = archetypeExceptionReview(context);
            return context.hasDedicationFeat
                ? `${className} feats, the follow-ups your dedications unlock, and shared feats that list ${className}.${exceptionReview} Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`
                : `${className} feats, shared feats that list ${className}, and the dedications you currently qualify for. Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`;
        }
        case "archetype-feat":
            return context.hasDedicationFeat
                ? `Free Archetype feats that follow from the dedications you have taken, minus duplicates, lockouts, and multiclass limits.${archetypeExceptionReview(context)} Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`
                : "Dedications you currently qualify for, with your own class's multiclass limits applied. Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.";
        case "class-branch": {
            const className = (await deps.resolveDocument("class"))?.name;
            const selectorName = step.branch?.selectorName;
            if (step.branch?.optionTag === "champion-cause") {
                if (!context.deitySelected) {
                    return "Pick your deity first. Which causes are open to you depends on it.";
                }
                if (!className) {
                    return null;
                }
                if (context.sanctification === "holy" || context.sanctification === "unholy") {
                    return `${className} causes open to a ${context.sanctification} character.`;
                }
                if (context.sanctification === "none") {
                    return `${className} causes open to a character with no sanctification.`;
                }
                return `${className} causes. Your sanctification is not settled yet, so this list may narrow later.`;
            }
            if (className && selectorName) {
                return `${className} options from ${selectorName}. Wayfinder writes your pick straight into the class feature.`;
            }
            return className ? `${className} class options.` : null;
        }
        case "deity": {
            const className = (await deps.resolveDocument("class"))?.name;
            return className
                ? `Deities a ${className} can follow. Wayfinder wires your choice into the class feature that needs it.`
                : null;
        }
        case "class-choice": {
            if (step.classChoice?.dependsOn === "deity") {
                const deityName = (await deps.resolveDocument("deity"))?.name;
                return deityName ? `Choices ${deityName} opens up.` : "Pick your deity first. This choice depends on it.";
            }
            const className = (await deps.resolveDocument("class"))?.name;
            return className ? `Choices that come straight from your ${className} features.` : null;
        }
        case "spell-choice": {
            const spellChoice = step.spellChoice;
            if (!spellChoice) {
                return null;
            }
            if (spellChoice.dependsOn === "class-branch" &&
                spellChoice.curriculumSpellNames.length === 0 &&
                spellChoice.requiresCurriculum !== false) {
                return "Pick your arcane school first. It sets the curriculum these spells come from.";
            }
            const tradition = spellChoice.destination.tradition;
            const rankLabel = spellChoice.cantrip
                ? spellChoice.destination.type === "innate"
                    ? `${tradition} cantrips`
                    : spellChoice.excludedTraditions?.length
                        ? "cantrips outside your class tradition"
                        : `${tradition} cantrips`
                : spellChoice.minRank === spellChoice.maxRank
                    ? `rank ${spellChoice.maxRank} ${tradition} spells`
                    : `${tradition} spells of rank ${spellChoice.minRank} to ${spellChoice.maxRank}`;
            return `Adding ${rankLabel} to your ${spellChoice.destination.label}. What you prepare each day stays on the PF2E sheet.`;
        }
        case "skill-feat":
            return "Baseline skill feats. Archetype skill feats stay hidden until Wayfinder can follow that archetype's path.";
        case "general-feat":
            return "Every general feat from your enabled compendia. Wayfinder does not narrow this one by ancestry or class.";
        default:
            return null;
    }
}
function archetypeExceptionReview(context) {
    return context.projectedArchetypeFeats?.some((feat) => feat.unresolvedLockoutException)
        ? " Your build leans on a dedication exception your GM allowed, which Wayfinder does not handle on its own."
        : "";
}
//# sourceMappingURL=option-context-service.js.map