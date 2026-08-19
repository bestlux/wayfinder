import { getCharacterWealthRow } from "./character-wealth-policy.js";
import {
  resolveSemanticWealthCapability,
  SEMANTIC_WEALTH_RULES,
  type SemanticWealthCapability,
  type SemanticWealthRuleEntry,
} from "./semantic-wealth-rule-ledger.js";

export type OfficialWealthRecipe = "permanent-items" | "lump-sum";
export type EquipmentRarity = "common" | "uncommon" | "rare" | "unique";
export type EquipmentPermanence = "consumable" | "permanent";

export interface SemanticWealthDiagnostic {
  readonly code:
    | "source-not-allowed"
    | "rarity-not-available"
    | "item-level-exceeds-cap"
    | "allowance-too-low"
    | "price-missing"
    | "price-unparseable"
    | "price-invalid"
    | "quantity-invalid"
    | "class-grant-provenance-missing"
    | "titan-mauler-ineligible"
    | "gm-judgment-invalid"
    | "level-0-unsupported"
    | "recipe-invalid"
    | "level-invalid"
    | "semantic-wealth-citation-unresolved";
  readonly ruleKey: string;
  readonly message: string;
}

export interface SemanticWealthResult<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly diagnostics: readonly SemanticWealthDiagnostic[];
}

export interface OfficialStartingWealth {
  readonly characterLevel: number;
  readonly recipe: OfficialWealthRecipe;
  readonly currencyCopper: number;
  readonly permanentItemAllowances: readonly { readonly itemLevel: number; readonly count: number }[];
}

function resolveOfficialStartingWealth(options: {
  characterLevel: number;
  partySize: number;
  recipe: OfficialWealthRecipe;
}): SemanticWealthResult<OfficialStartingWealth> {
  if (options.characterLevel === 0) {
    return failure("level-0-unsupported", "level-0-starting-money", "Level 0 acquisition is outside Wayfinder 0.8.0.");
  }
  if (!validLevel(options.characterLevel)) {
    return failure(
      "level-invalid",
      "higher-level-character-wealth",
      "Character level must be an integer from 1 through 20."
    );
  }
  if (options.recipe !== "permanent-items" && options.recipe !== "lump-sum") {
    return failure(
      "recipe-invalid",
      "wealth-recipes-are-alternatives",
      "Starting wealth must use exactly one official recipe."
    );
  }
  const row = getCharacterWealthRow(options.characterLevel);
  const permanentItemAllowances = options.recipe === "permanent-items" ? row.permanentItemAllowances : [];
  return success({
    characterLevel: options.characterLevel,
    recipe: options.recipe,
    currencyCopper: options.recipe === "permanent-items" ? row.permanentRecipeCurrencyCopper : row.lumpSumCopper,
    permanentItemAllowances,
  });
}

function evaluateEquipmentAuthority(options: {
  sourceAllowed: boolean;
  rarity: EquipmentRarity;
  blanketRarities: readonly EquipmentRarity[];
  hasCharacterAccess: boolean;
  approvedSourceException?: boolean;
  approvedRarityException?: boolean;
}): SemanticWealthResult<true> {
  const diagnostics: SemanticWealthDiagnostic[] = [];
  if (!options.sourceAllowed && !options.approvedSourceException) {
    diagnostics.push(
      diagnostic("source-not-allowed", "source-rarity-and-access", "The equipment source is not approved.")
    );
  }
  const rarityAvailable =
    options.rarity === "common" ||
    options.blanketRarities.includes(options.rarity) ||
    options.hasCharacterAccess ||
    !!options.approvedRarityException;
  if (!rarityAvailable) {
    diagnostics.push(
      diagnostic(
        "rarity-not-available",
        "rarity-discretion",
        "The item's rarity is not available through policy, Access, or approval."
      )
    );
  }
  return diagnostics.length > 0 ? { ok: false, value: null, diagnostics } : success(true);
}

function evaluatePermanentRecipePurchase(options: {
  characterLevel: number;
  itemLevel: number;
  permanence: EquipmentPermanence;
}): SemanticWealthResult<true> {
  if (
    !validLevel(options.characterLevel) ||
    !validItemLevel(options.itemLevel) ||
    options.itemLevel >= options.characterLevel
  ) {
    return failure(
      "item-level-exceeds-cap",
      "permanent-residual-spending",
      "Residual currency can buy only items below the starting level."
    );
  }
  return success(true);
}

function evaluateLumpSumPurchase(options: {
  characterLevel: number;
  itemLevel: number;
  rarity: EquipmentRarity;
}): SemanticWealthResult<true> {
  const diagnostics: SemanticWealthDiagnostic[] = [];
  if (options.rarity !== "common") {
    diagnostics.push(
      diagnostic(
        "rarity-not-available",
        "lump-sum-item-cap",
        "The official lump-sum recipe permits Common items by default."
      )
    );
  }
  if (
    !validLevel(options.characterLevel) ||
    !validItemLevel(options.itemLevel) ||
    options.itemLevel > options.characterLevel - 1
  ) {
    diagnostics.push(
      diagnostic(
        "item-level-exceeds-cap",
        "lump-sum-item-cap",
        `Lump-sum items must be level ${options.characterLevel - 1} or lower.`
      )
    );
  }
  return diagnostics.length > 0 ? { ok: false, value: null, diagnostics } : success(true);
}

export type AllowanceComponentKind = "baseline-item" | "property-rune" | "precious-material";

function evaluateAllowanceAssignment(options: {
  allowanceLevel: number;
  itemLevel: number;
  componentKind: AllowanceComponentKind;
  hasBaselineIdentity: boolean;
}): SemanticWealthResult<{ fundingLane: "allowance" | "currency"; currencyRebateCopper: 0 }> {
  if (options.componentKind !== "baseline-item") {
    return success({ fundingLane: "currency", currencyRebateCopper: 0 });
  }
  if (
    !options.hasBaselineIdentity ||
    !validItemLevel(options.itemLevel) ||
    !validItemLevel(options.allowanceLevel) ||
    options.itemLevel > options.allowanceLevel
  ) {
    return failure(
      "allowance-too-low",
      "lower-level-substitution",
      "The selected allowance cannot fund this baseline item."
    );
  }
  return success({ fundingLane: "allowance", currencyRebateCopper: 0 });
}

export type BasePriceInput =
  | { readonly kind: "priced"; readonly copper: number }
  | { readonly kind: "missing" }
  | { readonly kind: "unparseable" };

function resolveBasePrice(input: BasePriceInput): SemanticWealthResult<number> {
  if (input.kind === "missing") return failure("price-missing", "explicit-zero-price", "The item has no Price.");
  if (input.kind === "unparseable")
    return failure("price-unparseable", "explicit-zero-price", "The item Price cannot be parsed.");
  if (!Number.isInteger(input.copper) || input.copper < 0)
    return failure("price-invalid", "explicit-zero-price", "Price must be non-negative integer copper.");
  return success(input.copper);
}

function resolveRequestedPrice(options: {
  unitPriceCopper: number;
  pricePer: number;
  requestedQuantity: number;
}): SemanticWealthResult<number> {
  if (
    !Number.isInteger(options.unitPriceCopper) ||
    options.unitPriceCopper < 0 ||
    !Number.isInteger(options.pricePer) ||
    options.pricePer <= 0
  ) {
    return failure(
      "price-invalid",
      "explicit-zero-price",
      "Price and price-per values must be valid integer copper quantities."
    );
  }
  if (!Number.isInteger(options.requestedQuantity) || options.requestedQuantity <= 0) {
    return failure("quantity-invalid", "explicit-zero-price", "Requested quantity must be a positive integer.");
  }
  return success(Math.floor((options.requestedQuantity / options.pricePer) * options.unitPriceCopper));
}

export type EquipmentSize = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

function resolveSizePricing(options: {
  baseCopper: number;
  size: EquipmentSize;
  sizeSensitive: boolean;
  preciousMaterial: boolean;
}): SemanticWealthResult<{
  copper: number | null;
  strategy: "fixed-price" | "size-multiplier" | "adjusted-bulk-material";
}> {
  const base = resolveBasePrice({ kind: "priced", copper: options.baseCopper });
  if (!base.ok) return base as SemanticWealthResult<never>;
  if (options.preciousMaterial) return success({ copper: null, strategy: "adjusted-bulk-material" });
  if (!options.sizeSensitive) return success({ copper: options.baseCopper, strategy: "fixed-price" });
  const multiplier = options.size === "large" ? 2 : options.size === "huge" ? 4 : options.size === "gargantuan" ? 8 : 1;
  return success({ copper: options.baseCopper * multiplier, strategy: "size-multiplier" });
}

function evaluateClassGrantFunding(options: {
  planned: boolean;
  sourceSlotId?: string | null;
  sourceUuid?: string | null;
  expectedItemUuid?: string | null;
}): SemanticWealthResult<{ fundingLane: "class-grant" }> {
  if (
    !options.planned ||
    !nonEmpty(options.sourceSlotId) ||
    !nonEmpty(options.sourceUuid) ||
    !nonEmpty(options.expectedItemUuid)
  ) {
    return failure(
      "class-grant-provenance-missing",
      "class-granted-equipment",
      "Class-grant funding requires planned source, slot, and expected item identity."
    );
  }
  return success({ fundingLane: "class-grant" });
}

function evaluateTitanMaulerGrant(options: {
  isWeapon: boolean;
  isMeleeOrRanged: boolean;
  isOneSizeLarger: boolean;
  rarity: EquipmentRarity;
  hasCharacterAccess: boolean;
  basePriceCopper: number | null;
}): SemanticWealthResult<{ fundingLane: "class-grant"; resaleCopper: 0 }> {
  const eligible =
    options.isWeapon &&
    options.isMeleeOrRanged &&
    options.isOneSizeLarger &&
    (options.rarity === "common" || options.hasCharacterAccess) &&
    options.basePriceCopper !== null &&
    Number.isInteger(options.basePriceCopper) &&
    options.basePriceCopper >= 0 &&
    options.basePriceCopper <= 900;
  return eligible
    ? success({ fundingLane: "class-grant", resaleCopper: 0 })
    : failure(
        "titan-mauler-ineligible",
        "titan-mauler-weapon",
        "The weapon does not satisfy the Titan Mauler free-grant boundary."
      );
}

export type SemanticWealthGmJudgment =
  | {
      readonly kind: "extra-current-level-allowance";
      readonly recipe: "permanent-items";
      readonly authorId: string;
      readonly createdAt: string;
      readonly reason: string;
      readonly convertsToCash: false;
    }
  | {
      readonly kind: "inherited-wealth-handoff";
      readonly authorId: string;
      readonly createdAt: string;
      readonly reason: string;
      readonly permitsAdditiveAcquisition: false;
    };

function validateSemanticWealthGmJudgment(
  judgment: SemanticWealthGmJudgment
): SemanticWealthResult<SemanticWealthGmJudgment> {
  if (!nonEmpty(judgment.authorId) || !nonEmpty(judgment.createdAt) || !nonEmpty(judgment.reason)) {
    return failure(
      "gm-judgment-invalid",
      judgment.kind === "extra-current-level-allowance" ? "extra-current-level-item" : "inherited-party-wealth",
      "GM judgments require author, time, and reason."
    );
  }
  if (
    (judgment.kind === "extra-current-level-allowance" &&
      (judgment.recipe !== "permanent-items" || judgment.convertsToCash !== false)) ||
    (judgment.kind === "inherited-wealth-handoff" && judgment.permitsAdditiveAcquisition !== false)
  ) {
    return failure(
      "gm-judgment-invalid",
      judgment.kind === "extra-current-level-allowance" ? "extra-current-level-item" : "inherited-party-wealth",
      "The GM judgment attempts to widen the cited funding boundary."
    );
  }
  return success(judgment);
}

export type AbpItemCategory =
  | "potency"
  | "striking"
  | "resilient"
  | "redundant-numerical"
  | "property-rune"
  | "consumable"
  | "scroll"
  | "wand"
  | "other";

function classifyAbpEquipmentGuidance(category: AbpItemCategory): "suppress-or-warn" | "unchanged" {
  return category === "potency" ||
    category === "striking" ||
    category === "resilient" ||
    category === "redundant-numerical"
    ? "suppress-or-warn"
    : "unchanged";
}

export interface SemanticWealthPolicy {
  readonly resolveOfficialStartingWealth: (
    options: Parameters<typeof resolveOfficialStartingWealth>[0]
  ) => ReturnType<typeof resolveOfficialStartingWealth>;
  readonly evaluateEquipmentAuthority: (
    options: Parameters<typeof evaluateEquipmentAuthority>[0]
  ) => ReturnType<typeof evaluateEquipmentAuthority>;
  readonly evaluatePermanentRecipePurchase: (
    options: Parameters<typeof evaluatePermanentRecipePurchase>[0]
  ) => ReturnType<typeof evaluatePermanentRecipePurchase>;
  readonly evaluateLumpSumPurchase: (
    options: Parameters<typeof evaluateLumpSumPurchase>[0]
  ) => ReturnType<typeof evaluateLumpSumPurchase>;
  readonly evaluateAllowanceAssignment: (
    options: Parameters<typeof evaluateAllowanceAssignment>[0]
  ) => ReturnType<typeof evaluateAllowanceAssignment>;
  readonly resolveBasePrice: (input: BasePriceInput) => ReturnType<typeof resolveBasePrice>;
  readonly resolveRequestedPrice: (
    options: Parameters<typeof resolveRequestedPrice>[0]
  ) => ReturnType<typeof resolveRequestedPrice>;
  readonly resolveSizePricing: (
    options: Parameters<typeof resolveSizePricing>[0]
  ) => ReturnType<typeof resolveSizePricing>;
  readonly evaluateClassGrantFunding: (
    options: Parameters<typeof evaluateClassGrantFunding>[0]
  ) => ReturnType<typeof evaluateClassGrantFunding>;
  readonly evaluateTitanMaulerGrant: (
    options: Parameters<typeof evaluateTitanMaulerGrant>[0]
  ) => ReturnType<typeof evaluateTitanMaulerGrant>;
  readonly validateGmJudgment: (
    judgment: SemanticWealthGmJudgment
  ) => ReturnType<typeof validateSemanticWealthGmJudgment>;
  readonly classifyAbpGuidance: (
    category: AbpItemCategory
  ) => SemanticWealthResult<ReturnType<typeof classifyAbpEquipmentGuidance>>;
}

export function createSemanticWealthPolicy(
  rules: readonly SemanticWealthRuleEntry[] = SEMANTIC_WEALTH_RULES
): SemanticWealthPolicy {
  const policy: SemanticWealthPolicy = {
    resolveOfficialStartingWealth: (options) =>
      executeCapability("official-wealth", rules, () => resolveOfficialStartingWealth(options)),
    evaluateEquipmentAuthority: (options) =>
      executeCapability("equipment-authority", rules, () => evaluateEquipmentAuthority(options)),
    evaluatePermanentRecipePurchase: (options) =>
      executeCapability("permanent-recipe", rules, () => evaluatePermanentRecipePurchase(options)),
    evaluateLumpSumPurchase: (options) =>
      executeCapability("lump-sum-recipe", rules, () => evaluateLumpSumPurchase(options)),
    evaluateAllowanceAssignment: (options) =>
      executeCapability("allowance-assignment", rules, () => evaluateAllowanceAssignment(options)),
    resolveBasePrice: (input) => executeCapability("price-resolution", rules, () => resolveBasePrice(input)),
    resolveRequestedPrice: (options) =>
      executeCapability("price-resolution", rules, () => resolveRequestedPrice(options)),
    resolveSizePricing: (options) => executeCapability("size-pricing", rules, () => resolveSizePricing(options)),
    evaluateClassGrantFunding: (options) =>
      executeCapability("class-grant-funding", rules, () => evaluateClassGrantFunding(options)),
    evaluateTitanMaulerGrant: (options) =>
      executeCapability("titan-mauler-grant", rules, () => evaluateTitanMaulerGrant(options)),
    validateGmJudgment: (judgment) =>
      executeCapability("gm-judgment", rules, () => validateSemanticWealthGmJudgment(judgment)),
    classifyAbpGuidance: (category) =>
      executeCapability("abp-guidance", rules, () => success(classifyAbpEquipmentGuidance(category))),
  };
  return Object.freeze(policy);
}

export const SEMANTIC_WEALTH_POLICY = createSemanticWealthPolicy();

function success<T>(value: T): SemanticWealthResult<T> {
  return { ok: true, value, diagnostics: [] };
}

function failure<T>(code: SemanticWealthDiagnostic["code"], ruleKey: string, message: string): SemanticWealthResult<T> {
  return { ok: false, value: null, diagnostics: [diagnostic(code, ruleKey, message)] };
}

function diagnostic(
  code: SemanticWealthDiagnostic["code"],
  ruleKey: string,
  message: string
): SemanticWealthDiagnostic {
  return { code, ruleKey, message };
}

function executeCapability<T>(
  capability: SemanticWealthCapability,
  rules: readonly SemanticWealthRuleEntry[],
  operation: () => SemanticWealthResult<T>
): SemanticWealthResult<T> {
  const resolution = resolveSemanticWealthCapability(capability, rules);
  if (!resolution.available) {
    return failure(
      "semantic-wealth-citation-unresolved",
      resolution.diagnostic?.ruleKeys.join(",") || capability,
      resolution.diagnostic?.message ?? `Semantic wealth capability ${capability} is unavailable.`
    );
  }
  return operation();
}

function validLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

function validItemLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
