function collectReservedRuleChoiceSkills(preferredRuleChoices) {
  if (!preferredRuleChoices || typeof preferredRuleChoices !== "object" || Array.isArray(preferredRuleChoices)) {
    return [];
  }

  return Array.from(
    new Set(
      Object.values(preferredRuleChoices)
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

// An explicit rule-choice preference is plan-wide test intent. Generic training
// must not consume it before the owning conditional choice is filled.
function selectAdditionalSkills({
  availableSkills,
  fallbackSkills,
  preferredSkills,
  requiredCount,
  reservedSkills,
  usedSkills,
}) {
  const available = new Set(availableSkills ?? []);
  const reserved = new Set(reservedSkills ?? []);
  const used = new Set(usedSkills ?? []);
  const selected = [];
  const limit = Math.max(0, Number(requiredCount) || 0);

  for (const skill of [...(preferredSkills ?? []), ...(fallbackSkills ?? [])]) {
    if (selected.length >= limit) break;
    if (!available.has(skill) || reserved.has(skill) || used.has(skill)) continue;
    selected.push(skill);
    used.add(skill);
  }

  return selected;
}

globalThis.__wayfinderSmokeSkillSelectionPolicy = Object.freeze({
  collectReservedRuleChoiceSkills,
  selectAdditionalSkills,
});
