import { describe, expect, it } from "vitest";
import { createSemanticWealthPolicy, SEMANTIC_WEALTH_POLICY } from "../src/wayfinder/domain/semantic-wealth-policy.js";
import { SEMANTIC_WEALTH_RULES } from "../src/wayfinder/domain/semantic-wealth-rule-ledger.js";

const {
  classifyAbpGuidance,
  evaluateAllowanceAssignment,
  evaluateClassGrantFunding,
  evaluateEquipmentAuthority,
  evaluateLumpSumPurchase,
  evaluatePermanentRecipePurchase,
  evaluateTitanMaulerGrant,
  resolveBasePrice,
  resolveOfficialStartingWealth,
  resolveRequestedPrice,
  resolveSizePricing,
  validateGmJudgment,
} = SEMANTIC_WEALTH_POLICY;

describe("semantic wealth policy", () => {
  it("keeps official recipes alternative, level-1 equivalent, and independent of party size", () => {
    expect(
      resolveOfficialStartingWealth({ characterLevel: 1, partySize: 1, recipe: "permanent-items" }).value
    ).toMatchObject({ currencyCopper: 1_500, permanentItemAllowances: [] });
    expect(resolveOfficialStartingWealth({ characterLevel: 1, partySize: 8, recipe: "lump-sum" }).value).toMatchObject({
      currencyCopper: 1_500,
      permanentItemAllowances: [],
    });
    expect(
      resolveOfficialStartingWealth({ characterLevel: 5, partySize: 2, recipe: "permanent-items" }).value
    ).toMatchObject({
      currencyCopper: 5_000,
      permanentItemAllowances: [
        { itemLevel: 4, count: 1 },
        { itemLevel: 3, count: 2 },
        { itemLevel: 2, count: 1 },
        { itemLevel: 1, count: 2 },
      ],
    });
    expect(resolveOfficialStartingWealth({ characterLevel: 5, partySize: 6, recipe: "lump-sum" }).value).toMatchObject({
      currencyCopper: 27_000,
      permanentItemAllowances: [],
    });
    expect(
      resolveOfficialStartingWealth({ characterLevel: 0, partySize: 4, recipe: "lump-sum" }).diagnostics[0]?.code
    ).toBe("level-0-unsupported");
  });

  it("treats source and rarity as independent authority facts", () => {
    expect(
      evaluateEquipmentAuthority({
        sourceAllowed: true,
        rarity: "rare",
        blanketRarities: ["common"],
        hasCharacterAccess: true,
      }).ok
    ).toBe(true);
    expect(
      evaluateEquipmentAuthority({
        sourceAllowed: false,
        rarity: "rare",
        blanketRarities: ["common"],
        hasCharacterAccess: true,
      }).diagnostics.map((entry) => entry.code)
    ).toEqual(["source-not-allowed"]);
    expect(
      evaluateEquipmentAuthority({
        sourceAllowed: true,
        rarity: "rare",
        blanketRarities: ["common"],
        hasCharacterAccess: false,
      }).diagnostics.map((entry) => entry.code)
    ).toEqual(["rarity-not-available"]);
    expect(
      evaluateEquipmentAuthority({
        sourceAllowed: false,
        rarity: "rare",
        blanketRarities: ["common"],
        hasCharacterAccess: false,
      }).diagnostics.map((entry) => entry.code)
    ).toEqual(["source-not-allowed", "rarity-not-available"]);
  });

  it("enforces permanent residual and lump-sum level boundaries", () => {
    expect(evaluatePermanentRecipePurchase({ characterLevel: 5, itemLevel: 4, permanence: "permanent" }).ok).toBe(true);
    expect(evaluatePermanentRecipePurchase({ characterLevel: 5, itemLevel: 4, permanence: "consumable" }).ok).toBe(
      true
    );
    expect(evaluatePermanentRecipePurchase({ characterLevel: 5, itemLevel: 5, permanence: "permanent" }).ok).toBe(
      false
    );
    expect(evaluateLumpSumPurchase({ characterLevel: 5, itemLevel: 4, rarity: "common" }).ok).toBe(true);
    expect(evaluateLumpSumPurchase({ characterLevel: 5, itemLevel: 5, rarity: "common" }).diagnostics[0]?.code).toBe(
      "item-level-exceeds-cap"
    );
    expect(evaluateLumpSumPurchase({ characterLevel: 5, itemLevel: 4, rarity: "uncommon" }).diagnostics[0]?.code).toBe(
      "rarity-not-available"
    );
  });

  it("assigns lower-level baseline items without a rebate and funds additions with currency", () => {
    expect(
      evaluateAllowanceAssignment({
        allowanceLevel: 4,
        itemLevel: 2,
        componentKind: "baseline-item",
        hasBaselineIdentity: true,
      }).value
    ).toEqual({ fundingLane: "allowance", currencyRebateCopper: 0 });
    expect(
      evaluateAllowanceAssignment({
        allowanceLevel: 2,
        itemLevel: 3,
        componentKind: "baseline-item",
        hasBaselineIdentity: true,
      }).ok
    ).toBe(false);
    expect(
      evaluateAllowanceAssignment({
        allowanceLevel: 4,
        itemLevel: 4,
        componentKind: "property-rune",
        hasBaselineIdentity: true,
      }).value
    ).toEqual({ fundingLane: "currency", currencyRebateCopper: 0 });
    expect(
      evaluateAllowanceAssignment({
        allowanceLevel: 4,
        itemLevel: 4,
        componentKind: "precious-material",
        hasBaselineIdentity: true,
      }).value?.fundingLane
    ).toBe("currency");
  });

  it("distinguishes explicit zero Price from missing, malformed, and quantity-aware pricing", () => {
    expect(resolveBasePrice({ kind: "priced", copper: 0 })).toMatchObject({ ok: true, value: 0 });
    expect(resolveBasePrice({ kind: "missing" }).diagnostics[0]?.code).toBe("price-missing");
    expect(resolveBasePrice({ kind: "unparseable" }).diagnostics[0]?.code).toBe("price-unparseable");
    expect(resolveRequestedPrice({ unitPriceCopper: 100, pricePer: 10, requestedQuantity: 21 }).value).toBe(300);
    expect(resolveRequestedPrice({ unitPriceCopper: 100, pricePer: 0, requestedQuantity: 1 }).ok).toBe(false);
  });

  it("applies ordinary size multipliers without repricing listed magic items or precious material", () => {
    for (const [size, copper] of [
      ["tiny", 100],
      ["small", 100],
      ["medium", 100],
      ["large", 200],
      ["huge", 400],
      ["gargantuan", 800],
    ] as const) {
      expect(
        resolveSizePricing({ baseCopper: 100, size, listedMagicPrice: false, preciousMaterial: false }).value?.copper
      ).toBe(copper);
    }
    expect(
      resolveSizePricing({ baseCopper: 100, size: "gargantuan", listedMagicPrice: true, preciousMaterial: false }).value
    ).toEqual({ copper: 100, strategy: "listed" });
    expect(
      resolveSizePricing({ baseCopper: 100, size: "large", listedMagicPrice: false, preciousMaterial: true }).value
    ).toEqual({ copper: null, strategy: "adjusted-bulk-material" });
  });

  it("requires planned class-grant provenance and enforces every Titan Mauler boundary", () => {
    expect(
      evaluateClassGrantFunding({
        planned: true,
        sourceSlotId: "class-level-1",
        sourceUuid: "Compendium.pf2e.classfeatures.Item.source",
        expectedItemUuid: "Compendium.pf2e.equipment-srd.Item.item",
      }).ok
    ).toBe(true);
    expect(evaluateClassGrantFunding({ planned: false }).diagnostics[0]?.code).toBe("class-grant-provenance-missing");
    const eligible = {
      isWeapon: true,
      isMeleeOrRanged: true,
      isOneSizeLarger: true,
      rarity: "common" as const,
      hasCharacterAccess: false,
      basePriceCopper: 900,
    };
    expect(evaluateTitanMaulerGrant(eligible).value).toEqual({ fundingLane: "class-grant", resaleCopper: 0 });
    for (const patch of [
      { basePriceCopper: 901 },
      { isWeapon: false },
      { isMeleeOrRanged: false },
      { isOneSizeLarger: false },
      { rarity: "uncommon" as const },
    ]) {
      expect(evaluateTitanMaulerGrant({ ...eligible, ...patch }).ok).toBe(false);
    }
    expect(evaluateTitanMaulerGrant({ ...eligible, rarity: "uncommon", hasCharacterAccess: true }).ok).toBe(true);
  });

  it("keeps GM judgments explicit and ABP limited to numerical guidance", () => {
    expect(
      validateGmJudgment({
        kind: "extra-current-level-allowance",
        recipe: "permanent-items",
        authorId: "gm",
        createdAt: "2026-08-18T00:00:00Z",
        reason: "Joining mid-level",
        convertsToCash: false,
      }).ok
    ).toBe(true);
    expect(
      validateGmJudgment({
        kind: "inherited-wealth-handoff",
        authorId: "",
        createdAt: "2026-08-18T00:00:00Z",
        reason: "Inherited gear",
        permitsAdditiveAcquisition: false,
      }).ok
    ).toBe(false);
    expect(
      ["potency", "striking", "resilient", "redundant-numerical"].map(
        (category) => classifyAbpGuidance(category as never).value
      )
    ).toEqual(["suppress-or-warn", "suppress-or-warn", "suppress-or-warn", "suppress-or-warn"]);
    expect(
      ["property-rune", "consumable", "scroll", "wand", "other"].map(
        (category) => classifyAbpGuidance(category as never).value
      )
    ).toEqual(["unchanged", "unchanged", "unchanged", "unchanged", "unchanged"]);
  });

  it("rejects forged GM-judgment widening at the runtime boundary", () => {
    expect(
      validateGmJudgment({
        kind: "extra-current-level-allowance",
        recipe: "permanent-items",
        authorId: "gm",
        createdAt: "2026-08-18T00:00:00Z",
        reason: "forged",
        convertsToCash: true,
      } as never).diagnostics[0]?.code
    ).toBe("gm-judgment-invalid");
    expect(
      validateGmJudgment({
        kind: "inherited-wealth-handoff",
        authorId: "gm",
        createdAt: "2026-08-18T00:00:00Z",
        reason: "forged",
        permitsAdditiveAcquisition: true,
      } as never).diagnostics[0]?.code
    ).toBe("gm-judgment-invalid");
  });

  it("blocks only executable capabilities whose citations are unresolved", () => {
    const rules = SEMANTIC_WEALTH_RULES.map((rule) =>
      rule.key === "explicit-zero-price" ? { ...rule, citations: [] } : rule
    );
    const policy = createSemanticWealthPolicy(rules);

    expect(policy.resolveBasePrice({ kind: "priced", copper: 0 }).diagnostics[0]?.code).toBe(
      "semantic-wealth-citation-unresolved"
    );
    expect(policy.evaluateLumpSumPurchase({ characterLevel: 5, itemLevel: 4, rarity: "common" }).ok).toBe(true);
  });

  it("fails closed for invalid runtime recipe and level values", () => {
    expect(
      resolveOfficialStartingWealth({ characterLevel: 5, partySize: 4, recipe: "both" } as never).diagnostics[0]?.code
    ).toBe("recipe-invalid");
    expect(
      resolveOfficialStartingWealth({ characterLevel: 21, partySize: 4, recipe: "lump-sum" }).diagnostics[0]?.code
    ).toBe("level-invalid");
  });
});
