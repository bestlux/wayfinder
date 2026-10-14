export interface EquipmentWeaponPrimaryDamage {
  readonly dice: number;
  readonly die: string | null;
  readonly modifier: number;
  readonly damageType: string;
}

export type EquipmentComparisonFacts =
  | {
      readonly kind: "weapon";
      readonly primary: EquipmentWeaponPrimaryDamage | null;
      readonly hasAdditionalEffects: boolean;
      /** True only when this projection added dice from the source striking rune. */
      readonly includesStriking: boolean;
    }
  | { readonly kind: "shield"; readonly acBonus: number | null };

const DAMAGE_DIES = new Set(["d4", "d6", "d8", "d10", "d12"]);
const DAMAGE_TYPES = new Set([
  "acid",
  "bleed",
  "bludgeoning",
  "cold",
  "electricity",
  "fire",
  "force",
  "mental",
  "piercing",
  "poison",
  "slashing",
  "sonic",
  "spirit",
  "untyped",
  "vitality",
  "void",
]);

/** Listed source facts for the default item use, before character or world preparation. */
export function normalizeEquipmentComparisonFacts(source: unknown): EquipmentComparisonFacts | null {
  const item = record(source);
  const type = typeof item?.type === "string" ? item.type.trim().toLowerCase() : null;
  if (type !== "weapon" && type !== "shield") return null;
  const system = record(item?.system);
  if (type === "shield") {
    const acBonus = system?.acBonus;
    return Object.freeze({
      kind: "shield",
      acBonus: typeof acBonus === "number" && Number.isFinite(acBonus) && acBonus >= 0 ? acBonus : null,
    });
  }

  const damage = record(system?.damage);
  const traits = record(system?.traits);
  const traitValues = strings(traits?.value);
  const otherTags = strings(traits?.otherTags ?? []);
  const runes = record(system?.runes);
  const propertyRunes = strings(runes?.property ?? []);
  const rules = system?.rules === undefined ? [] : Array.isArray(system.rules) ? system.rules : null;
  const hasAdditionalEffects =
    hasDamageExtras(damage, system) ||
    (runes?.property !== undefined && propertyRunes === null) ||
    (propertyRunes?.length ?? 0) > 0 ||
    traitValues?.some((trait) => trait === "combination" || trait === "double-barrel") === true ||
    system?.meleeUsage != null ||
    (system?.specific != null && system.specific !== false) ||
    (system?.rules !== undefined && (rules === null || rules.length > 0));
  let primary: EquipmentWeaponPrimaryDamage | null = null;
  let includesStriking = false;

  if (
    item &&
    system &&
    damage &&
    traits &&
    traitValues &&
    otherTags &&
    runes &&
    propertyRunes &&
    rules &&
    !hasUnsupportedWeaponForm(item, system, traits, traitValues, otherTags, runes, propertyRunes) &&
    !hasAmbiguousItemAlteration(rules)
  ) {
    const dice = damage.dice;
    const die = damage.die;
    const modifier = damage.modifier ?? 0;
    const damageType = damage.damageType;
    const striking = runes.striking;
    if (
      nonNegativeInteger(dice) &&
      (die === null || die === "" || (typeof die === "string" && DAMAGE_DIES.has(die))) &&
      typeof modifier === "number" &&
      Number.isSafeInteger(modifier) &&
      typeof damageType === "string" &&
      DAMAGE_TYPES.has(damageType) &&
      runeRank(striking)
    ) {
      // PF2E promotes legacy dice-without-die to a flat modifier, then suppresses those dice.
      const effectiveDie = typeof die === "string" && die !== "" ? die : null;
      const effectiveModifier = effectiveDie ? modifier : modifier || dice;
      const effectiveDice = effectiveDie ? (dice === 1 ? dice + striking : dice) : 0;
      if (effectiveDice > 0 || effectiveModifier > 0) {
        primary = Object.freeze({
          dice: effectiveDice,
          die: effectiveDice > 0 ? effectiveDie : null,
          modifier: effectiveModifier,
          damageType,
        });
        includesStriking = effectiveDie !== null && dice === 1 && striking > 0;
      }
    }
  }

  return Object.freeze({ kind: "weapon", primary, hasAdditionalEffects, includesStriking });
}

function hasUnsupportedWeaponForm(
  item: Readonly<Record<string, unknown>>,
  system: Readonly<Record<string, unknown>>,
  traits: Readonly<Record<string, unknown>>,
  traitValues: readonly string[],
  otherTags: readonly string[],
  runes: Readonly<Record<string, unknown>>,
  propertyRunes: readonly string[]
): boolean {
  const flags = record(record(item.flags)?.pf2e);
  const modular = record(traits.config)?.modular;
  const doubleBarrel = record(record(traits.toggles)?.doubleBarrel)?.selected;
  const grade = system.grade;
  return (
    (flags?.battleForm !== undefined && flags.battleForm !== false) ||
    (flags?.fixedAttack != null && flags.fixedAttack !== 0) ||
    (grade != null && grade !== "commercial") ||
    traitValues.some((trait) => trait === "tech" || trait === "analog" || trait === "modular") ||
    (modular != null && (!Array.isArray(modular) || modular.length > 0)) ||
    (doubleBarrel !== undefined && doubleBarrel !== false) ||
    otherTags.includes("handwraps-of-mighty-blows") ||
    system.slug === "handwraps-of-mighty-blows" ||
    (traitValues.includes("consumable") &&
      (runes.striking !== 0 || (runes.potency != null && runes.potency !== 0) || propertyRunes.length > 0))
  );
}

function hasAmbiguousItemAlteration(rules: readonly unknown[]): boolean {
  return rules.some((value) => {
    const rule = record(value);
    if (!rule || typeof rule.key !== "string") return true;
    return (
      rule.key === "ItemAlteration" &&
      (rule.itemId !== undefined || typeof rule.itemType !== "string" || rule.itemType === "weapon")
    );
  });
}

function hasDamageExtras(
  damage: Readonly<Record<string, unknown>> | null,
  system: Readonly<Record<string, unknown>> | null
): boolean {
  const persistent = damage?.persistent;
  const splash = system?.splashDamage;
  return (
    (persistent != null && record(persistent)?.number !== 0) ||
    (splash != null && record(splash)?.value !== 0 && record(splash)?.value !== null)
  );
}

function runeRank(value: unknown): value is number {
  return nonNegativeInteger(value) && value <= 4;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
