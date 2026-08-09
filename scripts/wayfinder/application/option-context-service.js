import { projectedArchetypeFeat } from "../../pack/archetype-legality.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntryForChoiceInItems } from "../../shared/spellcasting.js";
import { projectedClassArchetypeFeatSelections, projectedClassArchetypeStaticFeatSelections, withExistingClassArchetypeChoice, } from "../class-archetype/registry.js";
import { projectDraftSkillRanks } from "../domain/skill-rank-projection.js";
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
export async function hasDedicationFeatInContext(args) {
    const projected = await buildProjectedArchetypeFeats(args);
    return projected.some((feat) => feat.traits.includes("dedication"));
}
function draftedFeatLevel(selection) {
    const slotLevel = selection.slotId.match(/-level-(\d+)$/)?.[1];
    return numericLevel(slotLevel) ?? numericLevel(selection.level);
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
    const rollOptions = buildActiveRollOptions(effectiveDraft, deps.steps ?? [], actorItems);
    const skillRanks = buildProjectedSkillRanks(deps.skillRanks, effectiveDraft, deps.steps ?? [], skillProjectionBoundarySlotId(deps.maximumFeatLevel));
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
    return [...actorFeats, ...draftedFeats].filter((feat) => feat.traits.includes("archetype") || feat.traits.includes("dedication"));
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
function buildActiveRollOptions(draft, steps, actorItems) {
    return Array.from(new Set([...collectDraftRollOptions(draft, steps), ...collectActorRuleSelectionRollOptions(actorItems)])).sort();
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
function collectActorRuleSelectionRollOptions(actorItems) {
    return actorItems.flatMap((item) => {
        const typedItem = item;
        const rules = Array.isArray(typedItem?.system?.rules) ? typedItem.system.rules : [];
        const rulesSelections = {
            ...(typedItem?.flags?.system?.rulesSelections ?? {}),
            ...(typedItem?.flags?.pf2e?.rulesSelections ?? {}),
        };
        return rules.flatMap((rule) => {
            if (!isRecord(rule) || rule.key !== "ChoiceSet") {
                return [];
            }
            const flag = normalizeString(rule.flag) ?? normalizeString(rule.rollOption) ?? normalizeString(rule.slug);
            const rollOption = normalizeString(rule.rollOption);
            const selection = flag ? normalizeString(rulesSelections[flag]) : null;
            return rollOption && selection ? [`${rollOption}:${selection}`] : [];
        });
    });
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
function isRecord(value) {
    return !!value && typeof value === "object";
}
export async function buildContextNote(step, context, deps) {
    if (step.slotKind === "campaign-feat" &&
        step.campaignFeat?.supported.length === 1 &&
        step.campaignFeat.supported[0] === "ancestry") {
        const ancestryName = (await deps.resolveDocument("ancestry"))?.name;
        return ancestryName
            ? `Showing ${step.campaignFeat.sectionLabel} feats keyed to ${ancestryName}. Class-dependent feats are filtered against the drafted class.`
            : null;
    }
    switch (step.slotKind) {
        case "heritage": {
            const ancestryDocument = deps.resolveDocument("ancestry");
            const ancestryName = (await ancestryDocument)?.name;
            return ancestryName
                ? `Showing ${ancestryName} heritages and versatile heritage options that remain legal for this draft.`
                : null;
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
                return `Showing ancestry feats keyed to ${ancestryName} plus versatile-heritage feats unlocked by ${heritageName}. Class-dependent feats are filtered against the drafted class.`;
            }
            if (ancestryName) {
                return `Showing ancestry feats keyed to ${ancestryName}. Class-dependent feats are filtered against the drafted class.`;
            }
            return null;
        }
        case "class-feat": {
            const className = (await deps.resolveDocument("class"))?.name;
            if (!className) {
                return null;
            }
            return context.hasDedicationFeat
                ? `Showing feats keyed to ${className} plus legal archetype follow-up feats unlocked by projected dedications. Shared class feats that list ${className} also remain available. Special dedication exceptions, unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.`
                : `Showing feats keyed to ${className} plus dedications legal for the projected draft. Shared class feats that list ${className} also remain available. Unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.`;
        }
        case "archetype-feat":
            return context.hasDedicationFeat
                ? "Showing Free Archetype feats legal for resolved dedication families, standard lockouts, duplicates, current-class multiclass limits, and supported skill-rank prerequisites. Special dedication exceptions, unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation."
                : "Showing dedications legal for the projected draft, including current-class multiclass limits and supported skill-rank prerequisites. Unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.";
        case "class-branch": {
            const className = (await deps.resolveDocument("class"))?.name;
            const selectorName = step.branch?.selectorName;
            if (step.branch?.optionTag === "champion-cause") {
                if (!context.deitySelected) {
                    return "Resolve the deity step first so Wayfinder can narrow champion causes to the legal sanctification path.";
                }
                const sanctificationLabel = context.sanctification === "holy"
                    ? "holy"
                    : context.sanctification === "unholy"
                        ? "unholy"
                        : context.sanctification === "none"
                            ? "non-sanctified"
                            : "currently unresolved";
                return className
                    ? `Showing ${className} causes currently legal for the ${sanctificationLabel} sanctification state in this draft.`
                    : null;
            }
            if (className && selectorName) {
                return `Showing ${className} options granted by ${selectorName}. Wayfinder will write the selector choice into PF2E's native class-feature data on apply.`;
            }
            return className ? `Showing class branch options keyed to ${className}.` : null;
        }
        case "deity": {
            const className = (await deps.resolveDocument("class"))?.name;
            return className
                ? `Showing deity choices currently legal for ${className}. Wayfinder will wire the selected deity into PF2E's native class-feature data on apply.`
                : null;
        }
        case "class-choice": {
            if (step.classChoice?.dependsOn === "deity") {
                const deityName = (await deps.resolveDocument("deity"))?.name;
                return deityName
                    ? `Showing choices unlocked by ${deityName}. Wayfinder will write this directly into the granting class feature on apply.`
                    : "Resolve the deity step first so Wayfinder can narrow this class choice.";
            }
            const className = (await deps.resolveDocument("class"))?.name;
            return className
                ? `Showing direct class-feature choices from ${className}. Wayfinder will write this directly into the granting class feature on apply.`
                : null;
        }
        case "spell-choice": {
            const spellChoice = step.spellChoice;
            if (!spellChoice) {
                return null;
            }
            if (spellChoice.dependsOn === "class-branch" &&
                spellChoice.curriculumSpellNames.length === 0 &&
                spellChoice.requiresCurriculum !== false) {
                return "Resolve the arcane school step first so Wayfinder can narrow this list to the chosen curriculum.";
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
            const sourceLabel = spellChoice.sourceName || "Wizard Spellcasting";
            return `Showing ${rankLabel} that will be added to the ${spellChoice.destination.label}. Source: ${sourceLabel}. Daily prepared loadouts remain on PF2E's character sheet.`;
        }
        case "skill-feat":
            return "Showing baseline skill feats. Archetype-tagged skill feats stay hidden until Wayfinder tracks a specific archetype path.";
        case "general-feat":
            return "Showing the full general-feat pool from the enabled compendia. Wayfinder does not narrow this step by ancestry or class draft.";
        default:
            return null;
    }
}
//# sourceMappingURL=option-context-service.js.map