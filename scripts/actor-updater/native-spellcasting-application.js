import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import { extractDocumentSlug } from "../shared/slug.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import { SLOT_IDS } from "../wayfinder/slot-ids.js";
import { createEmbeddedSource } from "./selection-application.js";
import { createClericFontEntrySource, createClericPreparedEntrySource, ensureSpellcastingEntryFromSource, spellLocationId, syncSpellcastingEntry, } from "./spellcasting-entry-support.js";
export async function syncNativeClassSpellcasting(actor, draft) {
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
    if (typeof entry.id !== "string") {
        return null;
    }
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
    const [created] = typeof actor.createEmbeddedDocuments === "function" ? await actor.createEmbeddedDocuments("Item", [source]) : [];
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
//# sourceMappingURL=native-spellcasting-application.js.map