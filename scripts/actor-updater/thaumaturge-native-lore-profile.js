const THAUMATURGE_SOURCE_UUID = "Compendium.pf2e.classes.Item.Y5GsHqzCzJlKka6x";
const ESOTERIC_LORE_SOURCE_UUID = "Compendium.pf2e.classfeatures.Item.cvQmPkJtybMcHinK";
const ESOTERIC_LORE_SOURCE_ALIAS = "Compendium.pf2e.classfeatures.Item.Esoteric Lore";
const DUBIOUS_KNOWLEDGE_SOURCE_UUID = "Compendium.pf2e.feats-srd.Item.1Bt7uCW2WI4sM84P";
const DUBIOUS_KNOWLEDGE_SOURCE_ALIAS = "Compendium.pf2e.feats-srd.Item.Dubious Knowledge";
const ESOTERIC_LORE_RANK_FORMULA = "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3),when(gte(@actor.level, 3), 2),1)";
const SOURCE_CHANGED_MESSAGE = "Thaumaturge native Esoteric Lore changed; reopen Wayfinder and review the class source before Apply.";
export function isThaumaturgeNativeLoreExpectation(grant) {
    return grant.slug === "esoteric-lore" && grant.sourceId === ESOTERIC_LORE_SOURCE_UUID;
}
/** Inspect this native child without adding it to Wayfinder's materialized grants. */
export function thaumaturgeNativeLoreSourceSelection(args) {
    if (args.sourceId !== THAUMATURGE_SOURCE_UUID)
        return null;
    const document = asRecord(args.document);
    const system = asRecord(document?.system);
    const items = asRecord(system?.items);
    const links = Object.values(items ?? {})
        .map(asRecord)
        .filter((entry) => {
        return entry?.uuid === ESOTERIC_LORE_SOURCE_UUID || entry?.uuid === ESOTERIC_LORE_SOURCE_ALIAS;
    });
    if (links.length === 0)
        return null;
    const link = links[0];
    if (document?.type !== "class" ||
        system?.slug !== "thaumaturge" ||
        links.length !== 1 ||
        !link ||
        link.level !== 1 ||
        Object.keys(link).some((key) => !["uuid", "level", "name", "img"].includes(key))) {
        throw new Error(SOURCE_CHANGED_MESSAGE);
    }
    return {
        slotId: "native-thaumaturge-esoteric-lore",
        packId: "pf2e.classfeatures",
        documentId: "cvQmPkJtybMcHinK",
        uuid: ESOTERIC_LORE_SOURCE_UUID,
        itemType: "feat",
        featType: "classfeature",
        name: "Esoteric Lore",
        level: 1,
    };
}
/** PF2E 8.6.1 prepares this derived skill before Wayfinder trains manual skills. */
export function projectThaumaturgeNativeLoreExpectation(args) {
    if (!thaumaturgeNativeLoreSourceSelection(args))
        return [];
    const document = asRecord(args.loreDocument);
    const system = asRecord(document?.system);
    const level = asRecord(system?.level);
    const rules = system?.rules;
    if (document?.type !== "feat" ||
        system?.slug !== "esoteric-lore" ||
        system.category !== "classfeature" ||
        level?.value !== 1 ||
        !Array.isArray(rules) ||
        rules.length !== 2) {
        throw new Error(SOURCE_CHANGED_MESSAGE);
    }
    const first = asRecord(rules[0]);
    const second = asRecord(rules[1]);
    // PF2E 8.5.1 modifies an ordinary Lore item; it does not prepare a native skill.
    if (hasExactKeys(first, ["ability", "force", "key", "selector", "type"]) &&
        first?.ability === "cha" &&
        first.force === true &&
        first.key === "FlatModifier" &&
        first.type === "ability" &&
        JSON.stringify(first.selector) === JSON.stringify(["esoteric", "esoteric-lore", "lore-esoteric"]) &&
        isDubiousKnowledgeGrant(second)) {
        return [];
    }
    const value = asRecord(second?.value);
    if (!isDubiousKnowledgeGrant(first) ||
        !hasExactKeys(second, ["key", "mode", "path", "value"]) ||
        second?.key !== "ActiveEffectLike" ||
        second.mode !== "override" ||
        second.path !== "system.skills.esoteric-lore" ||
        !hasExactKeys(value, ["attribute", "label", "rank"]) ||
        value?.attribute !== "cha" ||
        value.label !== "{item|name}" ||
        value.rank !== ESOTERIC_LORE_RANK_FORMULA ||
        typeof args.currentActorLevel !== "number" ||
        !Number.isInteger(args.currentActorLevel) ||
        args.currentActorLevel < 1 ||
        args.currentActorLevel > 20) {
        throw new Error(SOURCE_CHANGED_MESSAGE);
    }
    const rank = args.currentActorLevel >= 15 ? 4 : args.currentActorLevel >= 7 ? 3 : args.currentActorLevel >= 3 ? 2 : 1;
    return Object.freeze([Object.freeze({ slug: "esoteric-lore", rank, sourceId: ESOTERIC_LORE_SOURCE_UUID })]);
}
function isDubiousKnowledgeGrant(rule) {
    return (rule?.key === "GrantItem" &&
        [DUBIOUS_KNOWLEDGE_SOURCE_UUID, DUBIOUS_KNOWLEDGE_SOURCE_ALIAS].includes(String(rule.uuid)) &&
        Object.keys(rule).every((key) => ["key", "uuid", "flag", "allowDuplicate"].includes(key)) &&
        (rule.flag === undefined || rule.flag === "dubiousKnowledge") &&
        (rule.allowDuplicate === undefined || rule.allowDuplicate === true));
}
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function hasExactKeys(value, expected) {
    return (value !== null &&
        Object.keys(value).length === expected.length &&
        expected.every((key) => Object.hasOwn(value, key)));
}
//# sourceMappingURL=thaumaturge-native-lore-profile.js.map