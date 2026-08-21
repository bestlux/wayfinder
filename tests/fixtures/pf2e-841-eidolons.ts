export const PF2E_841_DRAGON_EIDOLON_RULES = [
  {
    choices: [
      { label: "PF2E.TraitArcane", value: { skill: "arcana", tradition: "arcane" } },
      { label: "PF2E.TraitDivine", value: { skill: "religion", tradition: "divine" } },
      { label: "PF2E.TraitOccult", value: { skill: "occultism", tradition: "occult" } },
      { label: "PF2E.TraitPrimal", value: { skill: "nature", tradition: "primal" } },
    ],
    flag: "eidolonTradition",
    key: "ChoiceSet",
    prompt: "PF2E.SpecificRule.Prompt.Tradition",
  },
  {
    key: "ActiveEffectLike",
    mode: "override",
    path: "flags.system.eidolon.tradition",
    value: "{item|flags.system.rulesSelections.eidolonTradition.tradition}",
  },
  {
    key: "ActiveEffectLike",
    mode: "upgrade",
    path: "system.skills.{item|flags.system.rulesSelections.eidolonTradition.skill}.rank",
    value: 1,
  },
  {
    key: "ActiveEffectLike",
    mode: "upgrade",
    path: "system.skills.intimidation.rank",
    value: 1,
  },
];

export const PF2E_841_ANGEL_EIDOLON_RULES = [
  { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.diplomacy.rank", value: 1 },
  { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.religion.rank", value: 1 },
  {
    key: "ActiveEffectLike",
    mode: "override",
    path: "flags.system.eidolon.tradition",
    value: "divine",
  },
];

export function pf2e841EidolonEntry(
  documentId: string,
  name: string,
  slug: string,
  rules: unknown[]
): Record<string, unknown> {
  return {
    _id: documentId,
    name,
    type: "feat",
    system: {
      slug,
      category: "classfeature",
      level: { value: 1, taken: null },
      traits: {
        otherTags: ["summoner-eidolon"],
        value: ["summoner"],
        rarity: "common",
        toggles: { mindshift: null },
        config: {},
      },
      rules,
    },
  };
}

export function pf2e841DragonEidolonEntry(): Record<string, unknown> {
  return pf2e841EidolonEntry(
    "JttI3raKFGG4C8up",
    "Dragon Eidolon",
    "dragon-eidolon",
    structuredClone(PF2E_841_DRAGON_EIDOLON_RULES)
  );
}

export function pf2e841AngelEidolonEntry(): Record<string, unknown> {
  return pf2e841EidolonEntry(
    "hippAZGFRtFd26dd",
    "Angel Eidolon",
    "angel-eidolon",
    structuredClone(PF2E_841_ANGEL_EIDOLON_RULES)
  );
}
