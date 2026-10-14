export function localizeEquipmentComparison(facts, localize) {
    if (!facts)
        return { label: null, explanation: null };
    if (facts.kind === "shield") {
        return {
            label: facts.acBonus === null
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
    const modifier = primary.modifier === 0
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
function damageTypeLabel(damageType, localize) {
    const config = globalThis.CONFIG;
    const key = config?.PF2E?.damageTypes?.[damageType];
    if (typeof key !== "string")
        return damageType;
    try {
        const label = localize(key);
        return label && label !== key ? label : damageType;
    }
    catch {
        return damageType;
    }
}
//# sourceMappingURL=equipment-comparison-label.js.map