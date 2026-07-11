import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { isBattleCreedSelected } from "../wayfinder/class-archetype/registry.js";
import { SLOT_IDS } from "../wayfinder/slot-ids.js";
import { createEmbeddedSource } from "./selection-application.js";
import { createBattleFontEntrySource, createClericFontEntrySource, createClericPreparedEntrySource, ensureSpellcastingEntryFromSource, spellLocationId, syncSpellcastingEntry, } from "./spellcasting-entry-support.js";
const BATTLE_CREED_UUID = "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5";
export async function syncNativeClassSpellcasting(actor, draft) {
    const classSlug = getCurrentClassSlug(actor, draft);
    if (classSlug !== "cleric") {
        return;
    }
    await syncClericSpellcasting(actor, draft);
}
async function syncClericSpellcasting(actor, draft) {
    const usesBattleCreed = hasBattleCreed(actor, draft);
    const preparedEntry = await ensureSpellcastingEntryFromSource(actor, createClericPreparedEntrySource(actor, draft, usesBattleCreed ? "battle-creed" : "standard"), {
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
    if (usesBattleCreed) {
        await syncBattleFont(actor, draft);
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
    const [fontSpell] = await reconcileClericFontSpells(actor, fontEntry, [divineFontSpellSelection(fontEntry.id, divineFont)], fontKey);
    if (!fontSpell?.id) {
        return;
    }
    await syncSpellcastingEntry(actor, fontEntry, createClericFontEntrySource(actor, draft, divineFont, fontSpell.id));
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
function hasBattleCreed(actor, draft) {
    return (isBattleCreedSelected(draft) ||
        listActorItems(actor).some((item) => itemMatchesSourceId(item, BATTLE_CREED_UUID)));
}
async function syncBattleFont(actor, draft) {
    const fontEntry = await ensureSpellcastingEntryFromSource(actor, createBattleFontEntrySource(actor, draft), {
        destinationKey: "cleric-battle-font",
        matches: (item) => isClericFontEntry(item),
    });
    if (!fontEntry?.id) {
        return;
    }
    await pruneExtraClericFontEntries(actor, fontEntry.id);
    const fontSpells = await reconcileClericFontSpells(actor, fontEntry, battleFontSpellSelections(fontEntry.id), "cleric-battle-font");
    if (fontSpells.length !== 2) {
        return;
    }
    await syncSpellcastingEntry(actor, fontEntry, createBattleFontEntrySource(actor, draft));
    await sanitizeBattleFontPreparedSlots(actor, fontEntry, new Set(fontSpells.flatMap((spell) => (spell.id ? [spell.id] : []))));
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
async function reconcileClericFontSpells(actor, entry, desiredSelections, destinationKey) {
    if (typeof entry.id !== "string") {
        return [];
    }
    const entrySpells = listActorItems(actor).filter((item) => item?.type === "spell" && spellLocationId(item) === entry.id);
    const keptByUuid = new Map();
    for (const selection of desiredSelections) {
        const keep = entrySpells.find((item) => !Array.from(keptByUuid.values()).includes(item) && itemMatchesSourceId(item, selection.uuid));
        if (keep) {
            keptByUuid.set(selection.uuid, keep);
        }
    }
    const keptIds = new Set(Array.from(keptByUuid.values()).flatMap((item) => (item.id ? [item.id] : [])));
    const obsoleteIds = entrySpells
        .filter((item) => !item.id || !keptIds.has(item.id))
        .map((item) => item.id)
        .filter((id) => !!id);
    if (obsoleteIds.length > 0 && typeof actor?.deleteEmbeddedDocuments === "function") {
        await actor.deleteEmbeddedDocuments("Item", obsoleteIds);
    }
    for (const desiredSelection of desiredSelections) {
        if (keptByUuid.has(desiredSelection.uuid)) {
            continue;
        }
        const source = await createEmbeddedSource(desiredSelection);
        if (!source) {
            continue;
        }
        source.system ??= {};
        source.system.location = { value: entry.id };
        source.flags ??= {};
        source.flags[MODULE_ID] = {
            importedBy: MODULE_ID,
            destinationKey,
        };
        const [created] = typeof actor.createEmbeddedDocuments === "function" ? await actor.createEmbeddedDocuments("Item", [source]) : [];
        if (created) {
            keptByUuid.set(desiredSelection.uuid, created);
        }
    }
    return desiredSelections.flatMap((selection) => {
        const item = keptByUuid.get(selection.uuid);
        return item ? [item] : [];
    });
}
async function sanitizeBattleFontPreparedSlots(actor, entry, allowedSpellIds) {
    if (!entry.id || !entry.system?.slots || typeof actor.updateEmbeddedDocuments !== "function") {
        return;
    }
    const slots = entry.system.slots;
    const sanitized = Object.fromEntries(Object.entries(slots).map(([slotKey, group]) => [
        slotKey,
        {
            ...group,
            prepared: Array.isArray(group.prepared)
                ? group.prepared.map((slot) => typeof slot?.id === "string" && allowedSpellIds.has(slot.id) ? slot : { id: null, expended: false })
                : [],
        },
    ]));
    await actor.updateEmbeddedDocuments("Item", [{ _id: entry.id, "system.slots": sanitized }]);
    entry.system.slots = sanitized;
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
function battleFontSpellSelections(entryId) {
    return [
        {
            slotId: `cleric-battle-font-spell-${entryId}-bane`,
            packId: "pf2e.spells-srd",
            documentId: "7ZinJNzxq0XF0oMx",
            uuid: "Compendium.pf2e.spells-srd.Item.7ZinJNzxq0XF0oMx",
            itemType: "spell",
            featType: null,
            name: "Bane",
            level: 1,
            slug: "bane",
        },
        {
            slotId: `cleric-battle-font-spell-${entryId}-bless`,
            packId: "pf2e.spells-srd",
            documentId: "XSujb7EsSwKl19Uu",
            uuid: "Compendium.pf2e.spells-srd.Item.XSujb7EsSwKl19Uu",
            itemType: "spell",
            featType: null,
            name: "Bless",
            level: 1,
            slug: "bless",
        },
    ];
}
function isClericFontEntry(item) {
    if (item?.type !== "spellcastingEntry") {
        return false;
    }
    return (String(item?.name ?? "").startsWith("Divine Font (") ||
        String(item?.name ?? "") === "Battle Font" ||
        String(item?.flags?.[MODULE_ID]?.destinationKey ?? "").startsWith("cleric-divine-font-") ||
        String(item?.flags?.[MODULE_ID]?.destinationKey ?? "") === "cleric-battle-font");
}
//# sourceMappingURL=native-spellcasting-application.js.map