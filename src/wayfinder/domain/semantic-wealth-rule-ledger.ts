export const SEMANTIC_WEALTH_POLICY_REF = Object.freeze({
  policyId: "pf2e-remaster-semantic-wealth" as const,
  policyVersion: 1,
});

export type SemanticWealthRuleKey =
  | "level-1-starting-money"
  | "higher-level-character-wealth"
  | "wealth-recipes-are-alternatives"
  | "party-size-is-separate"
  | "baseline-permanent-item"
  | "property-and-material-cost"
  | "permanent-residual-spending"
  | "lower-level-substitution"
  | "no-substitution-rebate"
  | "lump-sum-item-cap"
  | "rarity-discretion"
  | "source-rarity-and-access"
  | "extra-current-level-item"
  | "inherited-party-wealth"
  | "explicit-zero-price"
  | "size-priced-equipment"
  | "class-granted-equipment"
  | "titan-mauler-weapon"
  | "automatic-bonus-progression"
  | "level-0-starting-money";

export type SemanticWealthCapability =
  | "official-wealth"
  | "equipment-authority"
  | "permanent-recipe"
  | "lump-sum-recipe"
  | "allowance-assignment"
  | "price-resolution"
  | "size-pricing"
  | "class-grant-funding"
  | "titan-mauler-grant"
  | "gm-judgment"
  | "abp-guidance"
  | "level-0";

export interface SemanticWealthCitation {
  readonly book: "Player Core" | "Player Core 2" | "GM Core";
  readonly edition: "remaster";
  readonly pages: readonly number[];
  readonly aonRuleId?: number;
}

export interface SemanticWealthRuleEntry {
  readonly key: SemanticWealthRuleKey;
  readonly capabilities: readonly SemanticWealthCapability[];
  readonly behavior: string;
  readonly classification: "executable" | "authority-policy" | "gm-judgment" | "out-of-scope";
  readonly citations: readonly SemanticWealthCitation[];
  readonly ambiguity: string | null;
  readonly semanticTestIds: readonly string[];
  readonly lastVerifiedOn: "2026-08-15";
}

export interface SemanticWealthCapabilityResolution {
  readonly available: boolean;
  readonly capability: SemanticWealthCapability;
  readonly rules: readonly SemanticWealthRuleEntry[];
  readonly diagnostic: {
    readonly code: "semantic-wealth-citation-unresolved";
    readonly capability: SemanticWealthCapability;
    readonly ruleKeys: readonly SemanticWealthRuleKey[];
    readonly message: string;
  } | null;
}

const LAST_VERIFIED = "2026-08-15" as const;
const PC = "Player Core" as const;
const PC2 = "Player Core 2" as const;
const GMC = "GM Core" as const;

export const SEMANTIC_WEALTH_RULES: readonly SemanticWealthRuleEntry[] = Object.freeze([
  entry("level-1-starting-money", ["official-wealth"], "Level 1 starts with 15 gp for equipment.", "executable", [
    citation(PC, [25]),
  ]),
  entry(
    "higher-level-character-wealth",
    ["official-wealth"],
    "New or replacement higher-level characters use Character Wealth.",
    "executable",
    [citation(GMC, [61, 67], 2684)]
  ),
  entry(
    "wealth-recipes-are-alternatives",
    ["official-wealth"],
    "Permanent items plus currency and lump sum are alternatives.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "party-size-is-separate",
    ["official-wealth"],
    "Party-size treasure adjustments do not alter individual Character Wealth.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "baseline-permanent-item",
    ["allowance-assignment"],
    "One allowance funds one baseline permanent item.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "property-and-material-cost",
    ["allowance-assignment"],
    "Property runes and precious materials are funded separately.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "permanent-residual-spending",
    ["permanent-recipe"],
    "Residual currency buys consumables or permanent items below the starting level.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "lower-level-substitution",
    ["allowance-assignment"],
    "A lower-level permanent item may consume a higher allowance.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "no-substitution-rebate",
    ["allowance-assignment"],
    "Allowance substitution creates no cash rebate.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "lump-sum-item-cap",
    ["lump-sum-recipe"],
    "Lump-sum purchases are Common and capped one level below the character.",
    "executable",
    [citation(GMC, [61])]
  ),
  entry(
    "rarity-discretion",
    ["equipment-authority", "gm-judgment"],
    "Restricted starting items outside policy or Access require a GM decision.",
    "authority-policy",
    [citation(GMC, [61])]
  ),
  entry(
    "source-rarity-and-access",
    ["equipment-authority"],
    "Source approval and rarity availability are independent; Access is specific.",
    "authority-policy",
    [citation(GMC, [9, 22, 23])]
  ),
  entry(
    "extra-current-level-item",
    ["gm-judgment"],
    "An extra current-level permanent allowance is an explicit GM judgment.",
    "gm-judgment",
    [citation(GMC, [61])],
    "Never infer this judgment from actor history."
  ),
  entry(
    "inherited-party-wealth",
    ["gm-judgment"],
    "Inherited party wealth requires an explicit handoff judgment.",
    "gm-judgment",
    [citation(GMC, [61])],
    "Never infer inherited wealth from inventory."
  ),
  entry(
    "explicit-zero-price",
    ["price-resolution"],
    "Explicit zero is a real Price; missing or invalid Price is not free.",
    "executable",
    [citation(PC, [267], 181)]
  ),
  entry(
    "size-priced-equipment",
    ["size-pricing"],
    "Ordinary larger gear scales by size while listed magic items and precious materials follow distinct rules.",
    "executable",
    [citation(PC, [270], 2163)]
  ),
  entry(
    "class-granted-equipment",
    ["class-grant-funding"],
    "Only a planned source-backed class grant is free of starting-wealth cost.",
    "executable",
    [citation(PC2, [58, 103])]
  ),
  entry(
    "titan-mauler-weapon",
    ["titan-mauler-grant"],
    "Titan Mauler grants one qualifying larger weapon with a 9 gp pre-size cap and no resale value.",
    "executable",
    [citation(PC2, [75])]
  ),
  entry(
    "automatic-bonus-progression",
    ["abp-guidance"],
    "ABP changes item guidance, not Character Wealth currency.",
    "executable",
    [citation(GMC, [83], 2741)]
  ),
  entry(
    "level-0-starting-money",
    ["level-0"],
    "Level 0 uses a separate 5 gp rule and is outside 0.8.0.",
    "out-of-scope",
    [citation(GMC, [84, 85], 2754)]
  ),
]);

export function resolveSemanticWealthCapability(
  capability: SemanticWealthCapability,
  rules: readonly SemanticWealthRuleEntry[] = SEMANTIC_WEALTH_RULES
): SemanticWealthCapabilityResolution {
  const matching = rules.filter((rule) => rule.capabilities.includes(capability));
  const unresolved = matching.filter((rule) => rule.citations.length === 0);
  if (matching.length === 0 || unresolved.length > 0) {
    const ruleKeys = unresolved.length > 0 ? unresolved.map((rule) => rule.key) : [];
    return {
      available: false,
      capability,
      rules: matching,
      diagnostic: {
        code: "semantic-wealth-citation-unresolved",
        capability,
        ruleKeys,
        message:
          matching.length === 0
            ? `No reviewed semantic wealth rules map to ${capability}.`
            : `Unresolved citations block ${capability}: ${ruleKeys.join(", ")}.`,
      },
    };
  }
  return { available: true, capability, rules: matching, diagnostic: null };
}

function citation(
  book: SemanticWealthCitation["book"],
  pages: readonly number[],
  aonRuleId?: number
): SemanticWealthCitation {
  return Object.freeze({
    book,
    edition: "remaster" as const,
    pages: Object.freeze([...pages]),
    ...(aonRuleId ? { aonRuleId } : {}),
  });
}

function entry(
  key: SemanticWealthRuleKey,
  capabilities: readonly SemanticWealthCapability[],
  behavior: string,
  classification: SemanticWealthRuleEntry["classification"],
  citations: readonly SemanticWealthCitation[],
  ambiguity: string | null = null
): SemanticWealthRuleEntry {
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
