import type { AcquisitionLocalize } from "../application/acquisition-localization.js";
import type { EquipmentComparisonFacts } from "../application/equipment-comparison-facts.js";

export function localizeEquipmentComparison(
  facts: EquipmentComparisonFacts | null | undefined,
  localize: AcquisitionLocalize
): { readonly label: string | null; readonly explanation: string | null } {
  if (!facts) return { label: null, explanation: null };
  if (facts.kind === "shield") {
    return {
      label:
        facts.acBonus === null
          ? localize("wayfinder-pf2e.StartingEquipment.Comparison.ShieldUnavailable")
          : localize("wayfinder-pf2e.StartingEquipment.Comparison.Shield", { ac: facts.acBonus }),
      explanation: localize("wayfinder-pf2e.StartingEquipment.Comparison.ShieldExplanation"),
    };
  }
  const primary = facts.primary;
  if (!primary) {
    return {
      label: localize("wayfinder-pf2e.StartingEquipment.Comparison.WeaponUnavailable"),
      explanation: localize("wayfinder-pf2e.StartingEquipment.Comparison.WeaponExplanation"),
    };
  }
  const dice = primary.die && primary.dice > 0 ? `${primary.dice}${primary.die}` : "";
  const modifier =
    primary.modifier === 0
      ? ""
      : dice
        ? `${primary.modifier > 0 ? "+" : "−"}${Math.abs(primary.modifier)}`
        : String(primary.modifier);
  const damage = `${dice}${modifier} ${damageTypeLabel(primary.damageType, localize)}`;
  const label = localize("wayfinder-pf2e.StartingEquipment.Comparison.Weapon", { damage });
  return {
    label: facts.hasAdditionalEffects
      ? localize("wayfinder-pf2e.StartingEquipment.Comparison.WithEffects", { damage: label })
      : label,
    explanation: localize("wayfinder-pf2e.StartingEquipment.Comparison.WeaponExplanation"),
  };
}

function damageTypeLabel(damageType: string, localize: AcquisitionLocalize): string {
  const config = (globalThis as { CONFIG?: { PF2E?: { damageTypes?: Readonly<Record<string, unknown>> } } }).CONFIG;
  const key = config?.PF2E?.damageTypes?.[damageType];
  if (typeof key !== "string") return damageType;
  try {
    const label = localize(key);
    return label && label !== key ? label : damageType;
  } catch {
    return damageType;
  }
}
