import { OFFICIAL_PACKS } from "../constants.js";
import { toCompendiumItemUuid } from "../shared/compendium.js";
import { allowsActorOwnedGrantAdoption } from "../shared/grant-creation-policy.js";
import { resolveStaticGrantChoiceSources } from "../wayfinder/static-grant-choice-sources.js";
import { fetchSelectionDocument, getGamePack, getPackIndex } from "./access.js";
import { buildStaticGrantChoiceDisclosure, classifyEmbeddedChoices } from "./embedded-choice-policy.js";
import { extractEntrySlug, extractEntryTraits, numericOrNull, resolveFeatType, stringOrNull } from "./entry.js";
import { classifyFilterDecision, classifyHeritageContext, getPackageAncestryCatalog, getTraitCatalog, resolvePackIds, } from "./filter-policy.js";
const EMPTY_OPTION_CONTEXT = {
    ancestrySlug: null,
    ancestryTraits: [],
    heritageTraits: [],
    classSlug: null,
    classHasSpellcasting: false,
    deitySelected: false,
    sanctification: null,
    hasDedicationFeat: false,
};
export async function getOptionsForStep(step, context = EMPTY_OPTION_CONTEXT) {
    return (await getOptionQueryForStep(step, context)).options;
}
export async function getOptionQueryForStep(step, context = EMPTY_OPTION_CONTEXT) {
    if ((step.kind !== "pick-item" && step.kind !== "class-branch" && step.kind !== "spell-choice") || !step.filters) {
        return { options: [], suppressedOptions: [] };
    }
    const packIds = resolvePackIds(step.slotKind, step.filters);
    const traitCatalog = await getTraitCatalog(step.slotKind);
    const packageAncestries = step.slotKind === "heritage" ? await getPackageAncestryCatalog() : new Map();
    const results = [];
    const suppressedOptions = [];
    for (const packId of packIds) {
        const pack = getGamePack(packId);
        if (!pack) {
            continue;
        }
        const index = await getPackIndex(pack, packId);
        for (const entry of index) {
            const filterDecision = classifyFilterDecision(entry, packId, step, context, traitCatalog);
            if (filterDecision.kind === "exclude" && filterDecision.category === "ordinary-legality") {
                continue;
            }
            const heritageDecision = step.slotKind === "heritage"
                ? classifyHeritageContext(entry, packId, context, packageAncestries)
                : { kind: "include" };
            if (heritageDecision.kind === "exclude" && heritageDecision.category === "ordinary-legality") {
                continue;
            }
            const level = numericOrNull(entry?.system?.level?.value);
            const featType = resolveFeatType(entry);
            const slug = extractEntrySlug(entry);
            const traits = extractEntryTraits(entry);
            const documentId = String(entry._id);
            const uuid = toCompendiumItemUuid(packId, documentId);
            if (isSelectedInDifferentDraftSlot(step, uuid, context) || isOwnedByActor(step, uuid, context)) {
                continue;
            }
            const name = String(entry.name ?? "Unknown Option");
            if (filterDecision.kind === "exclude" || heritageDecision.kind === "exclude") {
                suppressedOptions.push({
                    uuid,
                    name,
                    reason: heritageDecision.kind === "exclude"
                        ? "ambiguous-heritage-ownership"
                        : filterDecision.kind === "exclude" && filterDecision.category === "fail-closed-policy"
                            ? filterDecision.reason
                            : "unvalidated-eligibility",
                });
                continue;
            }
            results.push({
                entry,
                option: {
                    value: `${packId}:${documentId}`,
                    packId,
                    documentId,
                    uuid,
                    img: String(entry.img ?? ""),
                    itemType: String(entry.type ?? ""),
                    featType,
                    name,
                    level,
                    slug,
                    traits,
                    rarity: stringOrNull(entry?.system?.traits?.rarity),
                    source: stringOrNull(entry?.system?.publication?.title) ??
                        stringOrNull(pack.metadata?.label) ??
                        stringOrNull(pack.title) ??
                        stringOrNull(pack.metadata?.packageName),
                    label: level === null ? name : `${name} (Level ${level})`,
                },
            });
        }
    }
    const enriched = await Promise.all(results.map(async ({ entry, option }) => ({
        ...option,
        disclosure: await resolveOptionDisclosure(entry, option, context, step),
    })));
    return {
        options: dedupeAndSort(enriched),
        suppressedOptions: dedupeSuppressedOptions(suppressedOptions),
    };
}
async function resolveOptionDisclosure(entry, option, context, step) {
    const disclosures = [await resolveStaticGrantDisclosure(entry, option, context)];
    if (step.slotKind === "class" && !OFFICIAL_PACKS.class.some((officialPackId) => officialPackId === option.packId)) {
        disclosures.push("Third-party class: Wayfinder uses structured PF2E data and generic milestones, but custom spellcasting, resources, and prose-only restrictions may require manual setup and rules review.");
    }
    const combined = disclosures.filter((disclosure) => !!disclosure).join(" ");
    return combined || null;
}
async function resolveStaticGrantDisclosure(entry, option, context) {
    const sourceSelection = {
        slotId: "static-grant-disclosure-probe",
        packId: option.packId,
        documentId: option.documentId,
        uuid: option.uuid,
        itemType: option.itemType,
        featType: option.featType,
        name: option.name,
        level: option.level,
        slug: option.slug,
    };
    const staticGrantSources = await resolveStaticGrantChoiceSources({
        sources: [{ sourceSelection, sourceDocument: entry }],
        fetchSelectionDocument,
        activeRollOptions: new Set(context.rollOptions ?? []),
    });
    if (staticGrantSources.length === 0) {
        return null;
    }
    return buildStaticGrantChoiceDisclosure(classifyEmbeddedChoices(entry, option.packId, {
        sourceItemType: "feat",
        classSlug: context.classSlug,
        optionContext: context,
        requireResolvedActorPlaceholders: true,
        staticGrantSources,
    }));
}
export async function resolveSelection(rawValue, step, context = EMPTY_OPTION_CONTEXT) {
    const options = await getOptionsForStep(step, context);
    const selected = options.find((option) => option.value === rawValue);
    if (!selected) {
        return null;
    }
    return {
        slotId: step.slotId,
        packId: selected.packId,
        documentId: selected.documentId,
        uuid: selected.uuid,
        itemType: selected.itemType,
        featType: selected.featType,
        name: selected.name,
        level: selected.level,
        slug: selected.slug,
    };
}
function isSelectedInDifferentDraftSlot(step, uuid, context) {
    const selectedUuidsBySlotId = context.selectedUuidsBySlotId ?? {};
    const selectedSpellChoicesBySlotId = context.selectedSpellChoicesBySlotId ?? {};
    const destinationKey = step.kind === "spell-choice" ? step.spellChoice.destination.key : null;
    const normalizedUuid = uuid.trim().toLowerCase();
    return (Object.entries(selectedUuidsBySlotId).some(([slotId, selectedUuid]) => slotId !== step.slotId && selectedUuid.trim().toLowerCase() === normalizedUuid) ||
        Object.entries(selectedSpellChoicesBySlotId).some(([slotId, selected]) => slotId !== step.slotId &&
            destinationKey === selected.destinationKey &&
            selected.uuids.some((selectedUuid) => selectedUuid.trim().toLowerCase() === normalizedUuid)));
}
function isOwnedByActor(step, uuid, context) {
    if (allowsActorOwnedGrantAdoption(step)) {
        return false;
    }
    const normalizedUuid = uuid.trim().toLowerCase();
    if (step.kind === "spell-choice") {
        return (context.actorSpellUuidsByDestinationKey?.[step.spellChoice.destination.key] ?? []).some((sourceId) => sourceId.trim().toLowerCase() === normalizedUuid);
    }
    const actorSourceIds = context.actorSourceIds ?? [];
    if (actorSourceIds.length === 0) {
        return false;
    }
    return actorSourceIds.some((sourceId) => sourceId.trim().toLowerCase() === normalizedUuid);
}
function dedupeAndSort(options) {
    const deduped = new Map();
    for (const option of options) {
        deduped.set(option.uuid, option);
    }
    return Array.from(deduped.values()).sort((left, right) => {
        const leftLevel = left.level ?? 0;
        const rightLevel = right.level ?? 0;
        if (leftLevel !== rightLevel) {
            return leftLevel - rightLevel;
        }
        return left.name.localeCompare(right.name);
    });
}
function dedupeSuppressedOptions(options) {
    return Array.from(new Map(options.map((option) => [option.uuid, option])).values()).sort((left, right) => left.name.localeCompare(right.name));
}
//# sourceMappingURL=options.js.map