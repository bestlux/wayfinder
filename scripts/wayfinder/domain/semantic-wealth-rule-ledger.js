export const SEMANTIC_WEALTH_POLICY_REF = Object.freeze({
    policyId: "pf2e-remaster-semantic-wealth",
    policyVersion: 1,
});
const LAST_VERIFIED = "2026-08-15";
const PC = "Player Core";
const PC2 = "Player Core 2";
const GMC = "GM Core";
export const SEMANTIC_WEALTH_RULES = Object.freeze([
    entry("level-1-starting-money", ["official-wealth"], "Level 1 starts with 15 gp for equipment.", "executable", [
        citation(PC, [25]),
    ]),
    entry("higher-level-character-wealth", ["official-wealth"], "New or replacement higher-level characters use Character Wealth.", "executable", [citation(GMC, [61, 67], 2684)]),
    entry("wealth-recipes-are-alternatives", ["official-wealth"], "Permanent items plus currency and lump sum are alternatives.", "executable", [citation(GMC, [61])]),
    entry("party-size-is-separate", ["official-wealth"], "Party-size treasure adjustments do not alter individual Character Wealth.", "executable", [citation(GMC, [61])]),
    entry("baseline-permanent-item", ["allowance-assignment"], "One allowance funds one baseline permanent item.", "executable", [citation(GMC, [61])]),
    entry("property-and-material-cost", ["allowance-assignment"], "Property runes and precious materials are funded separately.", "executable", [citation(GMC, [61])]),
    entry("permanent-residual-spending", ["permanent-recipe"], "Residual currency buys consumables or permanent items below the starting level.", "executable", [citation(GMC, [61])]),
    entry("lower-level-substitution", ["allowance-assignment"], "A lower-level permanent item may consume a higher allowance.", "executable", [citation(GMC, [61])]),
    entry("no-substitution-rebate", ["allowance-assignment"], "Allowance substitution creates no cash rebate.", "executable", [citation(GMC, [61])]),
    entry("lump-sum-item-cap", ["lump-sum-recipe"], "Lump-sum purchases are Common and capped one level below the character.", "executable", [citation(GMC, [61])]),
    entry("rarity-discretion", ["equipment-authority", "gm-judgment"], "Restricted starting items outside policy or Access require a GM decision.", "authority-policy", [citation(GMC, [61])]),
    entry("source-rarity-and-access", ["equipment-authority"], "Source approval and rarity availability are independent; Access is specific.", "authority-policy", [citation(GMC, [9, 22, 23])]),
    entry("extra-current-level-item", ["gm-judgment"], "An extra current-level permanent allowance is an explicit GM judgment.", "gm-judgment", [citation(GMC, [61])], "Never infer this judgment from actor history."),
    entry("inherited-party-wealth", ["gm-judgment"], "Inherited party wealth requires an explicit handoff judgment.", "gm-judgment", [citation(GMC, [61])], "Never infer inherited wealth from inventory."),
    entry("explicit-zero-price", ["price-resolution"], "Explicit zero is a real Price; missing or invalid Price is not free.", "executable", [citation(PC, [267], 181)]),
    entry("size-priced-equipment", ["size-pricing"], "Ordinary larger gear scales by size while listed magic items and precious materials follow distinct rules.", "executable", [citation(PC, [270], 2163)]),
    entry("class-granted-equipment", ["class-grant-funding"], "Only a planned source-backed class grant is free of starting-wealth cost.", "executable", [citation(PC2, [58, 103])]),
    entry("titan-mauler-weapon", ["titan-mauler-grant"], "Titan Mauler grants one qualifying larger weapon with a 9 gp pre-size cap and no resale value.", "executable", [citation(PC2, [75])]),
    entry("automatic-bonus-progression", ["abp-guidance"], "ABP changes item guidance, not Character Wealth currency.", "executable", [citation(GMC, [83], 2741)]),
    entry("level-0-starting-money", ["level-0"], "Level 0 uses a separate 5 gp rule and is outside 0.8.0.", "out-of-scope", [citation(GMC, [84, 85], 2754)]),
]);
export function resolveSemanticWealthCapability(capability, rules = SEMANTIC_WEALTH_RULES) {
    const requiredKeys = SEMANTIC_WEALTH_RULES.filter((rule) => rule.capabilities.includes(capability)).map((rule) => rule.key);
    const matching = rules.filter((rule) => rule.capabilities.includes(capability));
    const suppliedCapabilityKeys = new Set(matching.map((rule) => rule.key));
    const missingKeys = requiredKeys.filter((key) => !suppliedCapabilityKeys.has(key));
    const unresolved = matching.filter((rule) => rule.citations.length === 0);
    if (requiredKeys.length === 0 || missingKeys.length > 0 || unresolved.length > 0) {
        const ruleKeys = [...new Set([...missingKeys, ...unresolved.map((rule) => rule.key)])];
        return {
            available: false,
            capability,
            rules: matching,
            diagnostic: {
                code: "semantic-wealth-citation-unresolved",
                capability,
                ruleKeys,
                message: requiredKeys.length === 0
                    ? `No reviewed semantic wealth rules map to ${capability}.`
                    : `Unresolved citations block ${capability}: ${ruleKeys.join(", ")}.`,
            },
        };
    }
    return { available: true, capability, rules: matching, diagnostic: null };
}
function citation(book, pages, aonRuleId) {
    return Object.freeze({
        book,
        edition: "remaster",
        pages: Object.freeze([...pages]),
        ...(aonRuleId ? { aonRuleId } : {}),
    });
}
function entry(key, capabilities, behavior, classification, citations, ambiguity = null) {
    return Object.freeze({
        key,
        capabilities: Object.freeze([...capabilities]),
        behavior,
        classification,
        citations: Object.freeze([...citations]),
        ambiguity,
        semanticTestIds: Object.freeze([`WF-080-11:${key}`]),
        lastVerifiedOn: LAST_VERIFIED,
    });
}
//# sourceMappingURL=semantic-wealth-rule-ledger.js.map