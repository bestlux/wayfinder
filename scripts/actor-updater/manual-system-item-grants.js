import { MODULE_ID } from "../constants.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { applyRuleSelectionToSource } from "../shared/pf2e-item-source.js";
import { slugifyName } from "../shared/slug.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
const CLAN_DAGGER_FEATURE_UUID = "Compendium.pf2e.ancestryfeatures.Item.Clan Dagger";
const CLAN_DAGGER_FEATURE_SOURCE_IDS = new Set([
    CLAN_DAGGER_FEATURE_UUID,
    "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
]);
export function stripManualSystemItemGrants(source) {
    const systemItems = source.system?.items;
    if (!isLooseRecord(systemItems)) {
        return;
    }
    const manualGrants = [];
    for (const [key, value] of Object.entries(systemItems)) {
        if (!isLooseRecord(value) || !isClanDaggerSystemItemGrant(value)) {
            continue;
        }
        const uuid = typeof value.uuid === "string" ? value.uuid : CLAN_DAGGER_FEATURE_UUID;
        manualGrants.push({
            key,
            uuid,
            name: typeof value.name === "string" && value.name.trim().length > 0 ? value.name : "Clan Dagger",
            defaultChoices: {
                clanWeapon: "clan-dagger",
            },
        });
        delete systemItems[key];
    }
    if (manualGrants.length === 0) {
        return;
    }
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        manualSystemItemGrants: manualGrants,
    };
}
export function readManualSystemItemGrants(item) {
    const grants = item.flags?.[MODULE_ID]?.manualSystemItemGrants;
    if (!Array.isArray(grants)) {
        return [];
    }
    return grants.flatMap((grant) => {
        if (!isLooseRecord(grant) || typeof grant.uuid !== "string" || typeof grant.name !== "string") {
            return [];
        }
        return [
            {
                key: typeof grant.key === "string" && grant.key.trim().length > 0
                    ? grant.key.trim()
                    : (slugifyName(grant.name) ?? "grant"),
                uuid: grant.uuid,
                name: grant.name,
                defaultChoices: isLooseRecord(grant.defaultChoices)
                    ? Object.fromEntries(Object.entries(grant.defaultChoices).filter((entry) => typeof entry[1] === "string"))
                    : {},
            },
        ];
    });
}
export function selectionFromSystemGrant(grant) {
    const parsed = parseCompendiumItemUuid(grant.uuid);
    return {
        slotId: `system-grant-${slugifyName(grant.name) ?? "item"}`,
        packId: parsed?.packId ?? "pf2e.feats-srd",
        documentId: parsed?.documentId ?? grant.name,
        uuid: grant.uuid,
        itemType: "feat",
        featType: "ancestryfeature",
        name: grant.name,
        level: null,
    };
}
export function grantSourceMatches(item, uuid) {
    return itemMatchesSourceId(item, uuid) || (CLAN_DAGGER_FEATURE_SOURCE_IDS.has(uuid) && item.name === "Clan Dagger");
}
export function applyManualGrantChoices(source, choices) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    for (const [flag, value] of Object.entries(choices)) {
        const ruleIndex = rules.findIndex((rule) => isLooseRecord(rule) && rule.key === "ChoiceSet" && rule.flag === flag);
        if (ruleIndex >= 0) {
            applyRuleSelectionToSource(source, ruleIndex, flag, value);
        }
    }
}
function isClanDaggerSystemItemGrant(value) {
    const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
    const uuid = typeof value.uuid === "string" ? value.uuid.trim() : "";
    return name === "clan dagger" || CLAN_DAGGER_FEATURE_SOURCE_IDS.has(uuid);
}
function isLooseRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=manual-system-item-grants.js.map