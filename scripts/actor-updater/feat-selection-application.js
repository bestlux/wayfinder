import { listActorItems } from "../build-state.js";
import { campaignFeatAllowsCandidate, resolveCampaignFeatSlotSetting, } from "../campaign-feat-sections.js";
import { fetchSelectionDocument } from "../pack/access.js";
import { createManualStaticGrantedItems, readManualStaticItemGrants, } from "../selector-application.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { stampSelectionFlags } from "./selection-flags.js";
import { createEmbeddedSource } from "./selection-source-application.js";
const DEFAULT_INSERT_DEPS = {
    fetchSelectionDocument,
    createEmbeddedSource: (selection, draft, steps) => createEmbeddedSource(selection, draft, steps),
    resolveCampaignFeatSlot: resolveCampaignFeatSlotSetting,
};
export async function insertFeatSelection(actor, selection, step, deps = DEFAULT_INSERT_DEPS, draft, steps = []) {
    const source = await deps.createEmbeddedSource(selection, draft, steps);
    if (!source) {
        return;
    }
    const slotData = resolveFeatSlotData(actor, selection, step, source, deps.resolveCampaignFeatSlot ?? resolveCampaignFeatSlotSetting);
    if (slotData) {
        applyFeatSlotData(source, slotData, step);
    }
    if (typeof actor.createEmbeddedDocuments === "function") {
        const inserted = await actor.createEmbeddedDocuments("Item", [source]);
        const createdParentIds = inserted.flatMap((item) => (typeof item?.id === "string" ? [item.id] : []));
        let createdChildIds = [];
        try {
            await stampSelectionFlags(actor, inserted, selection);
            const createdItem = inserted[0];
            if (createdItem?.id && readManualStaticItemGrants(source).length > 0) {
                if (typeof actor.deleteEmbeddedDocuments !== "function" ||
                    typeof actor.updateEmbeddedDocuments !== "function") {
                    throw new Error(`Cannot create the prepared static grants for ${selection.name}.`);
                }
                const prepared = await createManualStaticGrantedItems(actor, createdItem, source, {
                    parentSlotId: selection.slotId,
                    parentName: selection.name,
                    createEmbeddedSource: deps.createEmbeddedSource,
                    replaceDescendantsOwnedById: null,
                });
                createdChildIds = prepared.createdItemIds;
                if (prepared.updates.length > 0) {
                    await actor.updateEmbeddedDocuments("Item", prepared.updates);
                }
            }
        }
        catch (error) {
            if (typeof actor.deleteEmbeddedDocuments !== "function") {
                throw error;
            }
            try {
                await actor.deleteEmbeddedDocuments("Item", [...createdChildIds, ...createdParentIds]);
            }
            catch (rollbackError) {
                throw new AggregateError([error, rollbackError], `Failed to create ${selection.name} safely.`, {
                    cause: rollbackError,
                });
            }
            throw error;
        }
    }
}
export async function preflightFeatSelection(actor, selection, step, deps = DEFAULT_INSERT_DEPS) {
    const existing = listActorItems(actor).find((item) => itemMatchesSourceId(item, selection.uuid));
    const source = existing ?? (await deps.fetchSelectionDocument(selection));
    if (!source) {
        throw new Error(`The selected feat ${selection.name} is unavailable; the draft cannot be applied safely.`);
    }
    resolveFeatSlotData(actor, selection, step, source, deps.resolveCampaignFeatSlot ?? resolveCampaignFeatSlotSetting);
}
function applyFeatSlotData(source, slotData, step) {
    source.system ??= {};
    const system = source.system;
    system.location = slotData.slotId ?? slotData.groupId;
    system.level ??= {};
    if (typeof step?.level === "number") {
        system.level.taken = step.level;
    }
}
function resolveFeatSlotData(actor, selection, step, source, resolveCampaignFeatSlot) {
    const groupId = resolveFeatGroupId(selection, step);
    if (!groupId) {
        return null;
    }
    const group = (typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId]);
    if (step?.slotKind === "campaign-feat") {
        const campaignFeat = step.campaignFeat;
        if (!campaignFeat) {
            throw new Error("PF2E's campaign feat metadata is unavailable; the draft cannot be applied safely.");
        }
        const authority = resolveCampaignFeatSlot(campaignFeat.sectionId, campaignFeat.groupSlotId);
        if (!authority || authority.slot.level !== step.level) {
            throw new Error("PF2E's campaign feat slot configuration changed; the draft cannot be applied safely.");
        }
        if (!campaignFeatAllowsCandidate(authority.supported, authority.filter, featCategory(source), featTraits(source))) {
            throw new Error("The campaign feat no longer matches PF2E's current slot filters; the draft cannot be applied safely.");
        }
        if (!group) {
            throw new Error("PF2E's campaign feat group is unavailable; the draft cannot be applied safely.");
        }
        const slot = group.slots?.[campaignFeat.groupSlotId];
        if (slot && (slot.level !== step.level || (slot.feat && !featSlotAlreadySatisfied(actor, slot, selection)))) {
            throw new Error("PF2E's campaign feat slot is unavailable; the draft cannot be applied safely.");
        }
        return {
            groupId,
            slotId: campaignFeat.groupSlotId,
        };
    }
    if (step?.slotKind === "archetype-feat") {
        if (!group) {
            throw new Error("PF2E's Free Archetype feat group is unavailable; the draft cannot be applied safely.");
        }
        return {
            groupId,
            slotId: `archetype-${step.level}`,
        };
    }
    if (!group) {
        throw new Error(`PF2E's ${groupId} feat group is unavailable; the draft cannot be applied safely.`);
    }
    const slots = Object.values(group.slots ?? {});
    const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
    const canonicalSlotId = canonicalCoreFeatSlotId(groupId, step);
    const canonicalSlot = canonicalSlotId ? group.slots?.[canonicalSlotId] : null;
    if (canonicalSlot?.feat && !featSlotAlreadySatisfied(actor, canonicalSlot, selection)) {
        throw new Error(`PF2E's ${groupId} feat slot at level ${step?.level} is already occupied.`);
    }
    if (matchingLevel || canonicalSlotId) {
        return {
            groupId,
            slotId: matchingLevel?.id ?? canonicalSlotId,
        };
    }
    const firstOpen = slots.find((slot) => !slot.feat);
    return {
        groupId,
        slotId: firstOpen?.id ?? null,
    };
}
function featSlotAlreadySatisfied(actor, slot, selection) {
    const slotFeat = slot.feat;
    const item = slotFeat && typeof slotFeat === "object"
        ? slotFeat
        : listActorItems(actor).find((candidate) => candidate.id === slotFeat);
    return !!item && itemMatchesSourceId(item, selection.uuid);
}
function canonicalCoreFeatSlotId(groupId, step) {
    return typeof step?.level === "number" &&
        ["ancestry-feat", "class-feat", "skill-feat", "general-feat"].includes(step.slotKind)
        ? `${groupId}-${step.level}`
        : null;
}
function featCategory(source) {
    const system = source.system;
    const category = normalizedString(system?.category);
    if (category) {
        return category;
    }
    const featType = system?.featType;
    return normalizedString(featType?.value);
}
function featTraits(source) {
    const system = source.system;
    const traits = system?.traits;
    return Array.isArray(traits?.value)
        ? Array.from(new Set(traits.value.map(normalizedString).filter((value) => !!value)))
        : [];
}
function normalizedString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
function resolveFeatGroupId(selection, step) {
    switch (step?.slotKind) {
        case "ancestry-feat":
            return "ancestry";
        case "class-feat":
            return "class";
        case "archetype-feat":
            return "archetype";
        case "campaign-feat":
            return step.campaignFeat?.sectionId ?? null;
        case "skill-feat":
            return "skill";
        case "general-feat":
            return "general";
        default:
            switch (selection.featType) {
                case "ancestry":
                    return "ancestry";
                case "class":
                case "archetype":
                    return "class";
                case "skill":
                    return "skill";
                case "general":
                    return "general";
                default:
                    return null;
            }
    }
}
//# sourceMappingURL=feat-selection-application.js.map