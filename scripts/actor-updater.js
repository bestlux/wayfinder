import { BOOST_LEVELS, getEffectiveBuildState, listActorItems } from "./build-state.js";
import { applyClassBranchDraft, stripPreselectedClassBranchEntries } from "./class-branch-service.js";
import { applyClassFeatureChoiceDraft, stripPreselectedClassFeatureEntries } from "./class-feature-choice-service.js";
import { MODULE_ID } from "./constants.js";
import { fetchSelectionDocument } from "./pack-service.js";
import { cloneData } from "./shared/cloning.js";
import { extractDocumentSlug, slugifyName } from "./shared/slug.js";
import { itemMatchesSourceId, sourceIdOf } from "./shared/source-id.js";
import { SLOT_IDS } from "./wayfinder/slot-ids.js";
import { findSpellcastingEntryForChoice, wizardMaxSpellRank } from "./wayfinder/spell-choice-service.js";
const SINGLETON_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
export async function applyDraftToActor(actor, draft, steps) {
    const selections = orderSelections(draft, steps);
    const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
    for (const selection of selections.filter((entry) => SINGLETON_ITEM_TYPES.has(entry.itemType))) {
        await replaceSingletonItem(actor, selection, draft, steps);
    }
    const projectedTrainingRanks = await applyTrainingDraft(actor, draft, steps);
    await applyClassFeatureChoiceDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    await applyClassBranchDraft(actor, draft, steps, {
        createEmbeddedSource,
        fetchSelectionDocument,
    });
    await syncNativeClassSpellcasting(actor, draft);
    for (const selection of selections.filter((entry) => entry.itemType === "feat")) {
        if (hasSourceId(actor, selection.uuid)) {
            continue;
        }
        const step = stepsBySlotId.get(selection.slotId);
        await insertFeatSelection(actor, selection, step ?? null);
    }
    await applySpellChoiceDraft(actor, draft, steps);
    await applyBoostDraft(actor, draft);
    await applySkillIncreaseDraft(actor, draft, projectedTrainingRanks);
    const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
    if (draft.targetLevel > currentLevel) {
        await actor.update({
            "system.details.level.value": draft.targetLevel,
        });
    }
}
async function applyTrainingDraft(actor, draft, steps) {
    const projectedRanks = {};
    for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
        const rank = Number(data?.rank ?? 0);
        projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
    }
    const stepMap = new Map(steps.map((step) => [step.slotId, step]));
    const classUpdates = [];
    for (const [slotId, training] of Object.entries(draft.skillTrainings)) {
        const step = stepMap.get(slotId);
        if (step?.kind !== "skill-training" || !step.training) {
            continue;
        }
        const classItem = listActorItems(actor).find((item) => item?.type === "class");
        if (classItem?.id && step.training.choiceRules.length > 0) {
            const classRules = cloneData(Array.isArray(classItem.system?.rules) ? classItem.system.rules : []);
            const classUpdate = { _id: classItem.id };
            for (const choiceRule of step.training.choiceRules) {
                const selection = training.ruleChoices[choiceRule.flag];
                if (!selection) {
                    continue;
                }
                if (classRules[choiceRule.ruleIndex]) {
                    classRules[choiceRule.ruleIndex].selection = selection;
                }
                classUpdate[`flags.pf2e.rulesSelections.${choiceRule.flag}`] = selection;
                projectedRanks[selection] = Math.max(projectedRanks[selection] ?? 0, 1);
            }
            classUpdate["system.rules"] = classRules;
            classUpdates.push(classUpdate);
        }
        for (const slug of training.additional) {
            projectedRanks[slug] = Math.max(projectedRanks[slug] ?? 0, 1);
        }
    }
    if (classUpdates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", classUpdates);
    }
    const skillUpdates = Object.entries(projectedRanks)
        .filter(([slug, rank]) => {
        const current = Number(actor?.system?.skills?.[slug]?.rank ?? 0);
        return rank > current;
    })
        .map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]);
    if (skillUpdates.length > 0) {
        await actor.update(Object.fromEntries(skillUpdates));
    }
    return projectedRanks;
}
async function applySkillIncreaseDraft(actor, draft, baseRanks) {
    const projectedRanks = baseRanks ? { ...baseRanks } : {};
    if (!baseRanks) {
        for (const [slug, data] of Object.entries(actor?.system?.skills ?? {})) {
            const rank = Number(data?.rank ?? 0);
            projectedRanks[slug] = Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 0;
        }
    }
    const sortedEntries = Object.entries(draft.skillIncreases).sort(([left], [right]) => compareSkillIncreaseSlotIds(left, right));
    for (const [, slug] of sortedEntries) {
        if (typeof slug !== "string" || !slug) {
            continue;
        }
        const currentRank = projectedRanks[slug] ?? 0;
        projectedRanks[slug] = Math.min(4, currentRank + 1);
    }
    const updates = Object.entries(projectedRanks).map(([slug, rank]) => [`system.skills.${slug}.rank`, rank]);
    if (updates.length > 0) {
        await actor.update(Object.fromEntries(updates));
    }
}
function compareSkillIncreaseSlotIds(left, right) {
    const leftLevel = skillIncreaseLevelFromSlotId(left);
    const rightLevel = skillIncreaseLevelFromSlotId(right);
    if (leftLevel !== rightLevel) {
        return leftLevel - rightLevel;
    }
    return left.localeCompare(right);
}
function skillIncreaseLevelFromSlotId(slotId) {
    const match = /skill-increase-level-(\d+)/.exec(slotId);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
async function replaceSingletonItem(actor, selection, draft, steps) {
    const existing = Array.from(actor?.items ?? []).filter((item) => item.type === selection.itemType);
    if (existing.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", existing.map((item) => item.id));
    }
    const source = await createEmbeddedSource(selection, draft, steps);
    if (source) {
        await actor.createEmbeddedDocuments("Item", [source]);
    }
}
async function createEmbeddedSource(selection, draft, steps = []) {
    const document = await fetchSelectionDocument(selection);
    if (!document) {
        return null;
    }
    const source = document.toObject();
    if (selection.itemType === "class" && draft) {
        stripPreselectedClassFeatureEntries(source, draft, steps);
        stripPreselectedClassBranchEntries(source, draft, steps);
    }
    delete source._id;
    source._stats ??= {};
    source._stats.compendiumSource = selection.uuid;
    source.flags ??= {};
    source.flags.core ??= {};
    source.flags.core.sourceId = selection.uuid;
    source.flags[MODULE_ID] = {
        importedBy: MODULE_ID,
        slotId: selection.slotId,
    };
    return source;
}
async function insertFeatSelection(actor, selection, step) {
    const document = await fetchSelectionDocument(selection);
    if (!document) {
        return;
    }
    const slotData = resolveFeatSlotData(actor, selection, step);
    if (typeof actor?.feats?.insertFeat === "function") {
        const inserted = await actor.feats.insertFeat(document, slotData);
        await stampSelectionFlags(actor, inserted, selection);
        return;
    }
    const source = await createEmbeddedSource(selection);
    if (!source) {
        return;
    }
    if (slotData) {
        source.system ??= {};
        source.system.location = slotData.slotId ?? slotData.groupId;
        source.system.level ??= {};
        if (typeof step?.level === "number") {
            source.system.level.taken = step.level;
        }
    }
    await actor.createEmbeddedDocuments("Item", [source]);
}
function resolveFeatSlotData(actor, selection, step) {
    const groupId = resolveFeatGroupId(selection, step);
    if (!groupId) {
        return null;
    }
    const group = typeof actor?.feats?.get === "function" ? actor.feats.get(groupId) : actor?.feats?.[groupId];
    const slots = Object.values(group?.slots ?? {});
    if (slots.length === 0) {
        return { groupId, slotId: null };
    }
    const matchingLevel = slots.find((slot) => slot.level === step?.level && !slot.feat);
    const firstOpen = slots.find((slot) => !slot.feat);
    return {
        groupId,
        slotId: matchingLevel?.id ?? firstOpen?.id ?? null,
    };
}
function resolveFeatGroupId(selection, step) {
    switch (step?.slotKind) {
        case "ancestry-feat":
            return "ancestry";
        case "class-feat":
            return "class";
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
async function stampSelectionFlags(actor, items, selection) {
    if (!Array.isArray(items) || items.length === 0 || typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const updates = [];
    for (const item of items) {
        if (!item?.id) {
            continue;
        }
        updates.push({
            _id: item.id,
            "flags.core.sourceId": selection.uuid,
            [`flags.${MODULE_ID}.importedBy`]: MODULE_ID,
            [`flags.${MODULE_ID}.slotId`]: selection.slotId,
        });
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
}
async function applySpellChoiceDraft(actor, draft, steps) {
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
async function syncNativeClassSpellcasting(actor, draft) {
    const classSlug = getCurrentClassSlug(actor, draft);
    if (classSlug !== "cleric") {
        return;
    }
    await syncClericSpellcasting(actor, draft);
}
async function syncClericSpellcasting(actor, draft) {
    const preparedEntry = await ensureSpellcastingEntryFromSource(actor, createClericPreparedEntrySource(actor, draft), {
        destinationKey: "cleric-divine-prepared",
        matches: (item) => item?.type === "spellcastingEntry" &&
            String(item?.name ?? "") === "Divine Prepared Spells" &&
            String(item?.system?.tradition?.value ?? "")
                .trim()
                .toLowerCase() === "divine" &&
            String(item?.system?.prepared?.value ?? "")
                .trim()
                .toLowerCase() === "prepared" &&
            String(item?.system?.ability?.value ?? "")
                .trim()
                .toLowerCase() === "wis",
    });
    if (!preparedEntry?.id) {
        return;
    }
    const divineFont = resolveClericDivineFont(actor, draft);
    if (!divineFont) {
        return;
    }
    const fontKey = `cleric-divine-font-${divineFont}`;
    const fontEntry = await ensureSpellcastingEntryFromSource(actor, createClericFontEntrySource(actor, draft, divineFont), {
        destinationKey: fontKey,
        matches: (item) => item?.type === "spellcastingEntry" &&
            (String(item?.name ?? "").startsWith("Divine Font (") ||
                String(item?.flags?.[MODULE_ID]?.destinationKey ?? "").startsWith("cleric-divine-font-")),
    });
    if (!fontEntry?.id) {
        return;
    }
    await pruneExtraClericFontEntries(actor, fontEntry.id);
    const fontSpell = await ensureClericFontSpell(actor, fontEntry, divineFont);
    if (!fontSpell?.id) {
        return;
    }
    await syncSpellcastingEntry(actor, fontEntry, createClericFontEntrySource(actor, draft, divineFont, fontSpell.id));
}
async function ensureSpellcastingEntry(actor, step, draft) {
    const spellChoice = step.spellChoice;
    if (!spellChoice) {
        return null;
    }
    const desiredSource = createSpellcastingEntrySource(spellChoice, actor, draft);
    const existing = findSpellcastingEntryForChoice(actor, spellChoice);
    if (existing?.id) {
        if (spellChoice.destination.type !== "prepared") {
            await syncSpellcastingEntry(actor, existing, desiredSource);
        }
        return existing;
    }
    const [created] = await actor.createEmbeddedDocuments("Item", [desiredSource]);
    return created ?? null;
}
async function ensureSpellcastingEntryFromSource(actor, desiredSource, options) {
    const existing = listActorItems(actor).find((item) => item?.type === "spellcastingEntry" && item?.flags?.[MODULE_ID]?.destinationKey === options.destinationKey) ?? listActorItems(actor).find(options.matches);
    if (existing?.id) {
        await syncSpellcastingEntry(actor, existing, desiredSource);
        return existing;
    }
    const [created] = await actor.createEmbeddedDocuments("Item", [desiredSource]);
    return created ?? null;
}
function createSpellcastingEntrySource(spellChoice, actor, draft) {
    return {
        name: spellChoice.destination.entryName,
        type: "spellcastingEntry",
        img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
        system: {
            ability: {
                value: spellChoice.destination.ability,
            },
            autoHeightenLevel: {
                value: null,
            },
            description: {
                value: "",
            },
            prepared: {
                flexible: false,
                value: spellChoice.destination.prepared,
            },
            proficiency: {
                slug: "",
                value: 1,
            },
            publication: {
                license: "ORC",
                remaster: true,
                title: "",
            },
            rules: [],
            showSlotlessLevels: {
                value: true,
            },
            slots: buildSpellcastingEntrySlots(spellChoice, actor, draft),
            slug: null,
            spelldc: {
                dc: 0,
                value: 0,
            },
            tradition: {
                value: spellChoice.destination.tradition,
            },
            traits: {},
        },
        flags: {
            [MODULE_ID]: {
                importedBy: MODULE_ID,
                destinationKey: spellChoice.destination.key,
            },
        },
    };
}
function createClericPreparedEntrySource(actor, draft) {
    return {
        name: "Divine Prepared Spells",
        type: "spellcastingEntry",
        img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
        system: {
            ability: {
                value: "wis",
            },
            autoHeightenLevel: {
                value: null,
            },
            description: {
                value: "",
            },
            prepared: {
                flexible: false,
                value: "prepared",
            },
            proficiency: {
                slug: "",
                value: 1,
            },
            publication: {
                license: "ORC",
                remaster: true,
                title: "",
            },
            rules: [],
            showSlotlessLevels: {
                value: true,
            },
            slots: buildClericPreparedSlots(actor, draft),
            slug: null,
            spelldc: {
                dc: 0,
                value: 0,
            },
            tradition: {
                value: "divine",
            },
            traits: {},
        },
        flags: {
            [MODULE_ID]: {
                importedBy: MODULE_ID,
                destinationKey: "cleric-divine-prepared",
            },
        },
    };
}
function createClericFontEntrySource(actor, draft, divineFont, spellId = null) {
    const entryName = divineFont === "heal" ? "Divine Font (Healing)" : "Divine Font (Harmful)";
    const destinationKey = `cleric-divine-font-${divineFont}`;
    return {
        name: entryName,
        type: "spellcastingEntry",
        img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
        system: {
            ability: {
                value: "wis",
            },
            autoHeightenLevel: {
                value: null,
            },
            description: {
                value: "",
            },
            prepared: {
                flexible: false,
                value: "prepared",
            },
            proficiency: {
                slug: "",
                value: 1,
            },
            publication: {
                license: "ORC",
                remaster: true,
                title: "",
            },
            rules: [],
            showSlotlessLevels: {
                value: false,
            },
            slots: buildClericFontSlots(actor, draft, spellId),
            slug: null,
            spelldc: {
                dc: 0,
                value: 0,
            },
            tradition: {
                value: "divine",
            },
            traits: {},
        },
        flags: {
            [MODULE_ID]: {
                importedBy: MODULE_ID,
                destinationKey,
            },
        },
    };
}
async function syncSpellcastingEntry(actor, entry, desiredSource) {
    if (!entry?.id || typeof actor?.updateEmbeddedDocuments !== "function") {
        return;
    }
    const desiredSystem = desiredSource.system;
    const desiredFlags = desiredSource.flags;
    const mergedSlots = mergeSpellcastingEntrySlots(entry?.system?.slots, desiredSystem.slots);
    await actor.updateEmbeddedDocuments("Item", [
        {
            _id: entry.id,
            "system.ability.value": desiredSystem.ability?.value ?? "",
            "system.prepared.flexible": desiredSystem.prepared?.flexible ?? false,
            "system.prepared.value": desiredSystem.prepared?.value ?? "",
            "system.showSlotlessLevels.value": desiredSystem.showSlotlessLevels?.value ?? true,
            "system.slots": mergedSlots,
            "system.tradition.value": desiredSystem.tradition?.value ?? "",
            [`flags.${MODULE_ID}.destinationKey`]: desiredFlags?.[MODULE_ID]?.destinationKey ?? null,
            [`flags.${MODULE_ID}.importedBy`]: desiredFlags?.[MODULE_ID]?.importedBy ?? MODULE_ID,
        },
    ]);
    entry.system ??= {};
    entry.system.slots = mergedSlots;
}
function buildSpellcastingEntrySlots(spellChoice, actor, draft) {
    if (spellChoice.destination.key === "wizard-arcane-prepared") {
        return buildWizardSpellcastingSlots(actor, draft);
    }
    if (spellChoice.destination.key === "cleric-divine-prepared") {
        return buildClericPreparedSlots(actor, draft);
    }
    return {};
}
function buildClericPreparedSlots(actor, draft) {
    const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
    const maxRank = wizardMaxSpellRank(currentLevel);
    const fullRanks = Math.floor(currentLevel / 2);
    const slots = {
        slot0: makePreparedSlotGroup(5),
    };
    for (let rank = 1; rank <= maxRank; rank += 1) {
        slots[`slot${rank}`] = makePreparedSlotGroup(rank <= fullRanks ? 3 : 2);
    }
    return slots;
}
function buildClericFontSlots(actor, draft, spellId) {
    const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
    const maxRank = wizardMaxSpellRank(currentLevel);
    const slotCount = currentLevel >= 15 ? 6 : currentLevel >= 5 ? 5 : 4;
    return {
        [`slot${maxRank}`]: makePreparedSlotGroup(slotCount, spellId),
    };
}
function buildWizardSpellcastingSlots(actor, draft) {
    const currentLevel = Math.max(1, Number(actor?.system?.details?.level?.value ?? 1) || 1, draft.targetLevel || 1);
    const maxRank = wizardMaxSpellRank(currentLevel);
    const schoolName = getEffectiveWizardSchoolName(actor, draft);
    const hasCurriculum = !isUnifiedMagicalTheorySchool(schoolName);
    const cantripSlots = hasCurriculum ? 6 : 5;
    const rankSlots = hasCurriculum ? 3 : 2;
    const slots = {};
    slots.slot0 = makePreparedSlotGroup(cantripSlots);
    for (let rank = 1; rank <= maxRank; rank += 1) {
        slots[`slot${rank}`] = makePreparedSlotGroup(rankSlots);
    }
    return slots;
}
function makePreparedSlotGroup(count, spellId = null) {
    return {
        max: count,
        value: count,
        prepared: Array.from({ length: count }, () => ({ id: spellId, expended: false })),
    };
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
function mergeSpellcastingEntrySlots(existingSlots, desiredSlots) {
    const merged = {};
    for (const [slotKey, desiredGroup] of Object.entries(desiredSlots ?? {})) {
        const desiredMax = Number(desiredGroup?.max ?? 0);
        const existingGroup = existingSlots?.[slotKey];
        const existingMax = Number(existingGroup?.max ?? 0);
        const existingPrepared = Array.isArray(existingGroup?.prepared) ? existingGroup.prepared : [];
        const desiredPreparedSlots = Array.isArray(desiredGroup?.prepared) ? desiredGroup.prepared : [];
        const mergedPrepared = Array.from({ length: desiredMax }, (_, index) => {
            const slot = existingPrepared[index];
            const desiredSlot = desiredPreparedSlots[index];
            const desiredId = typeof desiredSlot?.id === "string" ? desiredSlot.id : undefined;
            const existingId = typeof slot?.id === "string" || slot?.id === null ? slot.id : null;
            return {
                id: desiredId === undefined ? existingId : desiredId,
                expended: desiredId === undefined
                    ? Boolean(slot?.expended)
                    : desiredId === existingId
                        ? Boolean(slot?.expended)
                        : false,
            };
        });
        merged[slotKey] = {
            max: desiredMax,
            value: Math.min(desiredMax, Math.max(0, existingMax < desiredMax ? desiredMax : Number(existingGroup?.value ?? desiredGroup?.value ?? desiredMax) || 0)),
            prepared: mergedPrepared,
        };
    }
    return merged;
}
function getCurrentClassSlug(actor, draft) {
    const actorClass = listActorItems(actor).find((item) => item?.type === "class");
    const actorSlug = extractDocumentSlug(actorClass);
    if (actorSlug) {
        return actorSlug;
    }
    const draftedClass = draft.selections[SLOT_IDS.class];
    return extractDocumentSlug(draftedClass);
}
function resolveClericDivineFont(actor, draft) {
    const drafted = Object.entries(draft.classChoices).find(([slotId]) => slotId.includes("-divine-font-") && /-level-\d+$/.test(slotId))?.[1];
    if (drafted === "heal" || drafted === "harm") {
        return drafted;
    }
    const actorSelection = listActorItems(actor)
        .map((item) => item?.flags?.pf2e?.rulesSelections?.divineFont)
        .find((value) => typeof value === "string" && value.length > 0) ?? null;
    if (actorSelection === "heal" || actorSelection === "harm") {
        return actorSelection;
    }
    const deity = listActorItems(actor).find((item) => item?.type === "deity");
    const fonts = Array.isArray(deity?.system?.font)
        ? deity.system.font.filter((value) => typeof value === "string")
        : [];
    if (fonts.length === 1) {
        const only = fonts[0]?.trim().toLowerCase();
        return only === "heal" || only === "harm" ? only : null;
    }
    return null;
}
async function pruneExtraClericFontEntries(actor, keepEntryId) {
    if (typeof actor?.deleteEmbeddedDocuments !== "function") {
        return;
    }
    const extraEntries = listActorItems(actor).filter((item) => item?.type === "spellcastingEntry" && item?.id !== keepEntryId && isClericFontEntry(item));
    if (extraEntries.length === 0) {
        return;
    }
    const extraEntryIds = new Set(extraEntries.map((item) => item.id).filter((id) => !!id));
    const extraSpellIds = listActorItems(actor)
        .filter((item) => item?.type === "spell" && extraEntryIds.has(spellLocationId(item) ?? ""))
        .map((item) => item.id)
        .filter((id) => !!id);
    const deleteIds = [...extraSpellIds, ...Array.from(extraEntryIds)];
    if (deleteIds.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", deleteIds);
    }
}
async function ensureClericFontSpell(actor, entry, divineFont) {
    const desiredSelection = divineFontSpellSelection(entry.id, divineFont);
    const desiredSourceId = desiredSelection.uuid;
    const entrySpells = listActorItems(actor).filter((item) => item?.type === "spell" && spellLocationId(item) === entry.id);
    const keep = entrySpells.find((item) => itemMatchesSourceId(item, desiredSourceId)) ?? null;
    const obsoleteIds = entrySpells
        .filter((item) => !keep || item.id !== keep.id)
        .map((item) => item.id)
        .filter((id) => !!id);
    if (obsoleteIds.length > 0 && typeof actor?.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("Item", obsoleteIds);
    }
    if (keep) {
        return keep;
    }
    const source = await createEmbeddedSource(desiredSelection);
    if (!source) {
        return null;
    }
    source.system ??= {};
    source.system.location ??= {};
    if (typeof source.system.location === "object" && source.system.location !== null) {
        source.system.location.value = entry.id;
    }
    else {
        source.system.location = { value: entry.id };
    }
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        importedBy: MODULE_ID,
        destinationKey: `cleric-divine-font-${divineFont}`,
    };
    const [created] = await actor.createEmbeddedDocuments("Item", [source]);
    return created ?? null;
}
function divineFontSpellSelection(entryId, divineFont) {
    const documentId = divineFont === "heal" ? "rfZpqmj0AIIdkVIs" : "wdA52JJnsuQWeyqz";
    const name = divineFont === "heal" ? "Heal" : "Harm";
    return {
        slotId: `cleric-divine-font-spell-${entryId}`,
        packId: "pf2e.spells-srd",
        documentId,
        uuid: `Compendium.pf2e.spells-srd.Item.${documentId}`,
        itemType: "spell",
        featType: null,
        name,
        level: 1,
    };
}
function isClericFontEntry(item) {
    if (item?.type !== "spellcastingEntry") {
        return false;
    }
    return (String(item?.name ?? "").startsWith("Divine Font (") ||
        String(item?.flags?.[MODULE_ID]?.destinationKey ?? "").startsWith("cleric-divine-font-"));
}
function spellLocationId(item) {
    const location = typeof item?.system?.location?.value === "string"
        ? item.system.location.value
        : typeof item?.system?.location === "string"
            ? item.system.location
            : null;
    return location && location.length > 0 ? location : null;
}
function getEffectiveWizardSchoolName(actor, draft) {
    const createdSchool = listActorItems(actor).find((item) => item?.flags?.[MODULE_ID]?.slotId === SLOT_IDS.wizardArcaneSchool);
    if (typeof createdSchool?.name === "string" && createdSchool.name.trim()) {
        return createdSchool.name;
    }
    const draftedSchool = draft.branchSelections[SLOT_IDS.wizardArcaneSchool];
    return typeof draftedSchool?.name === "string" && draftedSchool.name.trim() ? draftedSchool.name : null;
}
function isUnifiedMagicalTheorySchool(name) {
    return slugifyName(name) === "school-of-unified-magical-theory";
}
function orderSelections(draft, steps) {
    const order = new Map();
    steps.forEach((step, index) => order.set(step.slotId, index));
    return Object.values(draft.selections).sort((left, right) => {
        return (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0);
    });
}
function hasSourceId(actor, sourceId) {
    return listActorItems(actor).some((item) => itemMatchesSourceId(item, sourceId));
}
async function applyBoostDraft(actor, draft) {
    const buildState = await getEffectiveBuildState(actor, draft);
    const updates = [];
    const ancestryItem = listActorItems(actor).find((item) => item?.type === "ancestry");
    if (ancestryItem && buildState.ancestry) {
        const ancestryUpdate = { _id: ancestryItem.id };
        if (buildState.ancestry.mode === "alternate") {
            ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
        }
        else {
            ancestryUpdate["system.-=alternateAncestryBoosts"] = null;
        }
        for (const [slot, value] of Object.entries(buildState.ancestry.selectedBoosts)) {
            ancestryUpdate[`system.boosts.${slot}.selected`] = value;
        }
        ancestryUpdate["system.voluntary.flaws"] = buildState.ancestry.voluntary.enabled
            ? buildState.ancestry.voluntary.flaws
            : [];
        if (buildState.ancestry.voluntary.enabled && buildState.ancestry.voluntary.legacy) {
            ancestryUpdate["system.voluntary.boost"] = buildState.ancestry.voluntary.boost;
        }
        else {
            ancestryUpdate["system.voluntary.-=boost"] = null;
        }
        updates.push(ancestryUpdate);
    }
    const backgroundItem = listActorItems(actor).find((item) => item?.type === "background");
    if (backgroundItem && buildState.background) {
        const backgroundUpdate = { _id: backgroundItem.id };
        for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
            backgroundUpdate[`system.boosts.${slot}.selected`] = value;
        }
        updates.push(backgroundUpdate);
    }
    const classItem = listActorItems(actor).find((item) => item?.type === "class");
    if (classItem && buildState.class) {
        updates.push({
            _id: classItem.id,
            "system.keyAbility.selected": buildState.class.selectedKeyAbility,
        });
    }
    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
    const actorBoostUpdate = Object.fromEntries(BOOST_LEVELS.map((level) => [`system.build.attributes.boosts.${level}`, buildState.levelBoosts[level]]));
    await actor.update(actorBoostUpdate);
}
//# sourceMappingURL=actor-updater.js.map