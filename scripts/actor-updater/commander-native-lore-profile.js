const COMMANDER_SOURCE_UUID = "Compendium.pf2e.classes.Item.Oyee5Ds9uwYLEkD0";
const WARFARE_LORE_RANK_FORMULA = "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3),when(gte(@actor.level, 3), 2),1)";
/**
 * PF2E 8.6.1 creates this derived Lore from a whole-skill rule before Wayfinder
 * trains skills. Its rank follows the current actor level, then PF2E prepares
 * the final rank when Apply persists the target level. It is not manual training.
 */
export function projectCommanderNativeLoreExpectation(args) {
    if (args.sourceId !== COMMANDER_SOURCE_UUID)
        return [];
    const document = asRecord(args.document);
    const system = asRecord(document?.system);
    const rules = system?.rules;
    // Earlier reviewed Commander sources have no native Lore rule.
    if (rules === undefined || (Array.isArray(rules) && rules.length === 0))
        return [];
    const rule = Array.isArray(rules) && rules.length === 1 ? asRecord(rules[0]) : null;
    const value = asRecord(rule?.value);
    if (document?.type !== "class" ||
        system?.slug !== "commander" ||
        !hasExactKeys(rule, ["key", "mode", "path", "value"]) ||
        rule?.key !== "ActiveEffectLike" ||
        rule.mode !== "override" ||
        rule.path !== "system.skills.warfare-lore" ||
        !hasExactKeys(value, ["attribute", "label", "rank"]) ||
        value?.attribute !== "int" ||
        value.label !== "PF2E.SpecificLore.Warfare" ||
        value.rank !== WARFARE_LORE_RANK_FORMULA ||
        typeof args.currentActorLevel !== "number" ||
        !Number.isInteger(args.currentActorLevel) ||
        args.currentActorLevel < 1 ||
        args.currentActorLevel > 20) {
        throw new Error("Commander native Warfare Lore changed; reopen Wayfinder and review the class source before Apply.");
    }
    const rank = args.currentActorLevel >= 15 ? 4 : args.currentActorLevel >= 7 ? 3 : args.currentActorLevel >= 3 ? 2 : 1;
    return Object.freeze([Object.freeze({ slug: "warfare-lore", rank, sourceId: args.sourceId })]);
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
//# sourceMappingURL=commander-native-lore-profile.js.map