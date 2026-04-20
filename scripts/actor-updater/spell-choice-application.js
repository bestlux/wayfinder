import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { cloneData } from "../shared/cloning.js";
import { sourceIdOf } from "../shared/source-id.js";
import { createEmbeddedSource, hasSourceId, stampSelectionFlags } from "./selection-application.js";
import { ensureSpellcastingEntry, spellLocationId } from "./spellcasting-entry-support.js";
export async function applySpellChoiceDraft(actor, draft, steps) {
    const stepMap = new Map(steps.map((step) => [step.slotId, step]));
    for (const [slotId, selections] of Object.entries(draft.spellChoices)) {
        const step = stepMap.get(slotId);
        if (step?.kind !== "spell-choice" || !step.spellChoice || selections.length === 0) {
            continue;
        }
        const entry = await ensureSpellcastingEntry(actor, step, draft);
        if (!entry?.id) {
            continue;
        }
        await reconcileSpellChoiceSlot(actor, slotId, selections);
        for (const selection of selections) {
            if (hasSourceId(actor, selection.uuid)) {
                continue;
            }
            const source = await createEmbeddedSource(selection);
            if (!source) {
                continue;
            }
            source.system ??= {};
            source.system.location ??= {};
            if (typeof source.system.location === "object" && source.system.location !== null) {
                source.system.location.value = entry.id;
            }
            else {
                source.system.location = { value: entry.id };
            }
            const created = await actor.createEmbeddedDocuments("Item", [source]);
            await stampSelectionFlags(actor, created, selection);
        }
        if (step.spellChoice.destination.type === "prepared") {
            await syncPreparedSpellChoiceSelections(actor, entry.id, step.spellChoice, slotId, selections);
        }
    }
}
async function reconcileSpellChoiceSlot(actor, slotId, selections) {
    if (typeof actor?.deleteEmbeddedDocuments !== "function") {
        return;
    }
    const desiredCounts = new Map();
    for (const selection of selections) {
        desiredCounts.set(selection.uuid, (desiredCounts.get(selection.uuid) ?? 0) + 1);
    }
    const matchedCounts = new Map();
    const obsoleteIds = [];
    for (const item of listActorItems(actor).filter((candidate) => candidate?.type === "spell" && candidate?.flags?.[MODULE_ID]?.slotId === slotId)) {
        if (!item?.id) {
            continue;
        }
        const sourceId = sourceIdOf(item);
        if (!sourceId) {
            obsoleteIds.push(item.id);
            continue;
        }
        const desiredCount = desiredCounts.get(sourceId) ?? 0;
        const matched = matchedCounts.get(sourceId) ?? 0;
        if (matched >= desiredCount) {
            obsoleteIds.push(item.id);
            continue;
        }
        matchedCounts.set(sourceId, matched + 1);
    }
    if (obsoleteIds.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", obsoleteIds);
    }
}
async function syncPreparedSpellChoiceSelections(actor, entryId, spellChoice, slotId, selections) {
    if (!entryId || typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const entry = listActorItems(actor).find((item) => item?.id === entryId);
    if (!entry?.id) {
        return;
    }
    const currentSlots = cloneData(entry?.system?.slots ?? {});
    const assignedSpellIdsBySlotKey = collectPreparedSpellChoiceAssignments(actor, entryId, spellChoice, slotId, selections);
    const affectedSlotKeys = getPreparedSpellChoiceSlotKeys(spellChoice);
    for (const slotKey of affectedSlotKeys) {
        const group = currentSlots[slotKey];
        if (!group || !Array.isArray(group.prepared)) {
            continue;
        }
        const assignedIds = assignedSpellIdsBySlotKey.get(slotKey) ?? [];
        group.prepared = group.prepared.map((slot, index) => {
            const desiredId = assignedIds[index] ?? null;
            const existingId = typeof slot?.id === "string" || slot?.id === null ? slot.id : null;
            return {
                id: desiredId,
                expended: desiredId !== null && desiredId === existingId ? Boolean(slot?.expended) : false,
            };
        });
    }
    await actor.updateEmbeddedDocuments("Item", [
        {
            _id: entry.id,
            "system.slots": currentSlots,
        },
    ]);
    entry.system ??= {};
    entry.system.slots = currentSlots;
}
function collectPreparedSpellChoiceAssignments(actor, entryId, spellChoice, slotId, selections) {
    const entrySpells = listActorItems(actor).filter((item) => item?.type === "spell" &&
        spellLocationId(item) === entryId &&
        item?.flags?.[MODULE_ID]?.slotId === slotId &&
        typeof item?.id === "string");
    const unusedBySource = new Map();
    for (const item of entrySpells) {
        const sourceId = sourceIdOf(item);
        if (!sourceId) {
            continue;
        }
        const items = unusedBySource.get(sourceId) ?? [];
        items.push(item);
        unusedBySource.set(sourceId, items);
    }
    const assigned = new Map();
    for (const selection of selections) {
        const items = unusedBySource.get(selection.uuid) ?? [];
        const item = items.shift();
        if (!item?.id) {
            continue;
        }
        const spellRank = spellChoice.cantrip
            ? 0
            : Math.max(1, Number(item?.system?.level?.value ?? selection.level ?? 1) || 1);
        const slotKey = `slot${spellRank}`;
        const slotAssignments = assigned.get(slotKey) ?? [];
        slotAssignments.push(item.id);
        assigned.set(slotKey, slotAssignments);
    }
    return assigned;
}
function getPreparedSpellChoiceSlotKeys(spellChoice) {
    if (spellChoice.cantrip) {
        return ["slot0"];
    }
    const slotKeys = [];
    for (let rank = spellChoice.minRank; rank <= spellChoice.maxRank; rank += 1) {
        slotKeys.push(`slot${rank}`);
    }
    return slotKeys;
}
//# sourceMappingURL=spell-choice-application.js.map