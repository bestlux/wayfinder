import { slugifyName } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
export const STANDARD_CLASS_PATH = "standard";
const BATTLE_CREED = {
    value: "battle-creed",
    label: "Battle Creed",
    detail: "Become a Battle Harbinger. This replaces the normal doctrine progression, reduces prepared spell slots, and changes Divine Font into Battle Font.",
    img: "icons/skills/melee/weapons-crossed-swords-teal.webp",
    decisionSlotId: "class-archetype-doctrine-level-1",
    classSlug: "cleric",
    selectorTag: "cleric-doctrine",
    selector: {
        selection: {
            packId: "pf2e.classfeatures",
            documentId: "tyrBwBTzo5t9Zho7",
            uuid: "Compendium.pf2e.classfeatures.Item.tyrBwBTzo5t9Zho7",
            itemType: "feat",
            featType: "classfeature",
            name: "Doctrine",
            level: 1,
            slug: "doctrine",
        },
        flag: "doctrine",
        ruleIndex: 0,
    },
    selection: {
        packId: "pf2e.classfeatures",
        documentId: "49CkgA3kj7Im6gZ5",
        uuid: "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5",
        itemType: "feat",
        featType: "classfeature",
        name: "Battle Creed",
        level: 1,
        slug: "battle-creed",
    },
    reservedClassFeatLevels: [2],
    dedicationName: "Battle Harbinger Dedication",
    projectedFeatGrants: [
        {
            minimumLevel: 2,
            selection: {
                packId: "pf2e.feats-srd",
                documentId: "K7YK5ESDoreohCe8",
                uuid: "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8",
                itemType: "feat",
                featType: "class",
                name: "Battle Harbinger Dedication",
                level: 2,
                slug: "battle-harbinger-dedication",
            },
            staticFeatGrants: [
                {
                    packId: "pf2e.feats-srd",
                    documentId: "AmP0qu7c5dlBSath",
                    uuid: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath",
                    itemType: "feat",
                    featType: "general",
                    name: "Toughness",
                    level: 1,
                    slug: "toughness",
                },
            ],
        },
    ],
    fallbackFeatChoices: [
        {
            slotId: "class-archetype-battle-harbinger-toughness-replacement-level-2",
            level: 2,
            title: "Choose a general feat instead of Toughness",
            description: "Battle Harbinger Dedication normally grants Toughness. Because this actor already has Toughness from another source, choose another eligible general feat.",
            existingSourceUuid: "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath",
            originalRuleUuids: [
                "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath",
                "Compendium.pf2e.feats-srd.Item.Toughness",
            ],
            grantedBySourceUuid: "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8",
            flag: "toughnessFallback",
            filters: {
                itemType: "feat",
                packIds: ["pf2e.feats-srd"],
                featTypes: ["general"],
                maxLevel: 2,
            },
        },
    ],
    internalClassFeatureChoices: [
        {
            selection: {
                packId: "pf2e.classfeatures",
                documentId: "gblTFUOgolqFS9v4",
                uuid: "Compendium.pf2e.classfeatures.Item.gblTFUOgolqFS9v4",
                itemType: "feat",
                featType: "classfeature",
                name: "Divine Font",
                level: 1,
                slug: "divine-font",
            },
            sourceRuleIndex: 0,
            flag: "divineFont",
            value: "heal",
        },
    ],
};
const PROFILES = [BATTLE_CREED];
const PROFILES_BY_VALUE = new Map(PROFILES.map((profile) => [profile.value, profile]));
export function classArchetypeProfilesForSelector(branch) {
    return PROFILES.filter((profile) => profile.classSlug === branch.classSlug && profile.selectorTag === branch.optionTag);
}
export function classArchetypeSlotId(branch) {
    return branch.slotId.replace(/^class-branch-/, "class-archetype-");
}
export function buildClassArchetypeMeta(branch) {
    const profiles = classArchetypeProfilesForSelector(branch);
    if (profiles.length === 0) {
        return null;
    }
    return {
        slotId: classArchetypeSlotId(branch),
        selector: branch,
        standardValue: STANDARD_CLASS_PATH,
        sourceName: branch.selectorName,
        options: [
            {
                value: STANDARD_CLASS_PATH,
                label: "Standard class path",
                img: null,
                detail: `Continue with the normal ${branch.selectorName.toLowerCase()} choices.`,
            },
            ...profiles.map((profile) => ({
                value: profile.value,
                label: profile.label,
                img: profile.img,
                detail: profile.detail,
            })),
        ],
    };
}
export function classArchetypeProfile(value) {
    return value ? (PROFILES_BY_VALUE.get(value) ?? null) : null;
}
export function selectedClassArchetypeProfile(draft) {
    for (const value of Object.values(draft.classArchetypeChoices)) {
        const profile = classArchetypeProfile(value);
        if (profile) {
            return profile;
        }
    }
    return null;
}
export function selectedClassArchetypeSelection(draft) {
    const entry = Object.entries(draft.classArchetypeChoices).find(([, value]) => !!classArchetypeProfile(value));
    if (!entry) {
        return null;
    }
    const [slotId, value] = entry;
    const profile = classArchetypeProfile(value);
    return profile ? { ...profile.selection, slotId } : null;
}
export function projectedClassArchetypeFeatSelections(draft, targetLevel) {
    const profile = selectedClassArchetypeProfile(draft);
    if (!profile) {
        return [];
    }
    return profile.projectedFeatGrants
        .filter((grant) => grant.minimumLevel <= targetLevel)
        .map((grant) => ({
        ...grant.selection,
        slotId: `class-archetype-grant-${grant.selection.slug ?? slugifyName(grant.selection.name)}-level-${grant.minimumLevel}`,
    }));
}
export function projectedClassArchetypeStaticFeatSelections(draft, targetLevel) {
    const profile = selectedClassArchetypeProfile(draft);
    if (!profile) {
        return [];
    }
    return profile.projectedFeatGrants.flatMap((grant) => grant.minimumLevel <= targetLevel
        ? grant.staticFeatGrants.map((selection) => ({
            ...selection,
            slotId: `class-archetype-static-grant-${selection.slug ?? slugifyName(selection.name)}-level-${grant.minimumLevel}`,
        }))
        : []);
}
export function reservedClassFeatSlotIds(draft) {
    const profile = selectedClassArchetypeProfile(draft);
    return profile?.reservedClassFeatLevels.map((level) => `class-feat-level-${level}`) ?? [];
}
export function selectedClassArchetypeDedicationNames(draft) {
    const name = selectedClassArchetypeProfile(draft)?.dedicationName;
    return name ? [name] : [];
}
export function selectedClassArchetypeInternalChoices(draft) {
    return selectedClassArchetypeProfile(draft)?.internalClassFeatureChoices ?? [];
}
export function profileForSelection(selection) {
    if (!selection) {
        return null;
    }
    const uuid = selection.uuid.trim().toLowerCase();
    const slug = selection.slug ?? slugifyName(selection.name);
    return (PROFILES.find((profile) => profile.selection.uuid.toLowerCase() === uuid || (slug && profile.value === slug)) ??
        null);
}
export function classArchetypeProfileForDocument(document) {
    const sourceId = sourceIdOf(document)?.trim().toLowerCase() ?? null;
    const typed = document;
    const slug = typeof typed?.system?.slug === "string" ? typed.system.slug.trim().toLowerCase() : (slugifyName(typed?.name) ?? "");
    return (PROFILES.find((profile) => profile.selection.uuid.toLowerCase() === sourceId || (slug.length > 0 && profile.value === slug)) ?? null);
}
export function activeClassArchetypeProfile(draft, documents) {
    if (Object.keys(draft.classArchetypeChoices).length > 0) {
        return selectedClassArchetypeProfile(draft);
    }
    for (const document of documents) {
        const profile = classArchetypeProfileForDocument(document);
        if (profile) {
            return profile;
        }
    }
    return null;
}
export function withExistingClassArchetypeChoice(draft, documents) {
    if (Object.keys(draft.classArchetypeChoices).length > 0) {
        return draft;
    }
    const profile = activeClassArchetypeProfile(draft, documents);
    return profile
        ? {
            ...draft,
            classArchetypeChoices: {
                [profile.decisionSlotId]: profile.value,
            },
        }
        : draft;
}
export function migrateLegacyClassArchetypeBranches(branchSelections, classArchetypeChoices) {
    const migratedProfiles = [];
    for (const [slotId, selection] of Object.entries(branchSelections)) {
        const profile = profileForSelection(selection);
        if (!profile) {
            continue;
        }
        const targetSlotId = slotId.replace(/^class-branch-/, "class-archetype-");
        if (!Object.hasOwn(classArchetypeChoices, targetSlotId)) {
            classArchetypeChoices[targetSlotId] = profile.value;
        }
        delete branchSelections[slotId];
        if (!migratedProfiles.includes(profile)) {
            migratedProfiles.push(profile);
        }
    }
    return migratedProfiles;
}
export function isBattleCreedSelected(draft) {
    return selectedClassArchetypeProfile(draft)?.value === BATTLE_CREED.value;
}
export function documentIsBattleCreed(document) {
    return classArchetypeProfileForDocument(document)?.value === BATTLE_CREED.value;
}
//# sourceMappingURL=registry.js.map