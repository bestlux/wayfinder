function featDocument(
  id: string,
  name: string,
  category: string,
  level: number,
  rules: Array<Record<string, unknown>>
) {
  return {
    _id: id,
    name,
    type: "feat",
    system: {
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      category,
      featType: { value: category },
      level: { value: level },
      rules,
      traits: {
        rarity: "common",
        value: category === "class" ? ["archetype", "dedication", "multiclass"] : [],
      },
    },
  };
}

export const CLERIC_DEDICATION = featDocument("smCDaPlpRDA47xjK", "Cleric Dedication", "class", 2, [
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.classfeatures.Item.Deity (Cleric)",
  },
  {
    key: "ActiveEffectLike",
    mode: "upgrade",
    path: "system.skills.religion.rank",
    value: 1,
  },
]);

export const DEITY_CLERIC = featDocument("DutW12WMFPHBoLTH", "Deity (Cleric)", "classfeature", 1, [
  {
    choices: {
      filter: [
        {
          or: ["item:category:deity", "item:category:pantheon", "item:category:covenant"],
        },
      ],
      itemType: "deity",
    },
    flag: "deity",
    key: "ChoiceSet",
    predicate: [{ not: "deity" }],
    prompt: "PF2E.SpecificRule.Prompt.Deity",
  },
  {
    allowDuplicate: false,
    key: "GrantItem",
    predicate: [{ not: "deity" }],
    uuid: "{item|flags.system.rulesSelections.deity}",
  },
  {
    adjustName: false,
    choices: [
      { label: "PF2E.TraitHoly", value: "holy" },
      { label: "PF2E.TraitUnholy", value: "unholy" },
      { label: "PF2E.NoneOption", value: "none" },
    ],
    key: "ChoiceSet",
    predicate: [
      {
        nor: ["sanctification:none", "sanctification:holy", "sanctification:unholy"],
      },
    ],
    prompt: "PF2E.SpecificRule.Prompt.Sanctification",
    rollOption: "sanctification",
    slug: "sanctification",
  },
]);

export const SUMMONER_DEDICATION = featDocument("SwzPqEsLzZpNufvm", "Summoner Dedication", "class", 2, [
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.classfeatures.Item.Eidolon",
  },
]);

export const EIDOLON = featDocument("qOEpe596B0UjhcG0", "Eidolon", "classfeature", 1, [
  {
    adjustName: false,
    choices: {
      filter: ["item:tag:summoner-eidolon"],
      itemType: "feat",
    },
    flag: "eidolon",
    key: "ChoiceSet",
  },
  {
    key: "GrantItem",
    uuid: "{item|flags.system.rulesSelections.eidolon}",
  },
  {
    allowDuplicate: false,
    key: "GrantItem",
    uuid: "Compendium.pf2e.actionspf2e.Item.Manifest Eidolon",
  },
]);

export const COMMANDER_DEDICATION = featDocument("e9iVLfL7KIfUG3NV", "Commander Dedication", "class", 2, [
  {
    key: "RollOption",
    option: "commanders-banner",
    toggleable: true,
    value: true,
  },
  {
    key: "Aura",
    predicate: ["commanders-banner"],
    radius: 30,
    slug: "commanders-banner",
  },
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.classfeatures.Item.Tactics",
  },
]);

const TACTIC_FILTER = [
  "item:trait:tactic",
  {
    or: ["item:tag:commander-mobility-tactic", "item:tag:commander-offensive-tactic"],
  },
];

export const TACTICS = featDocument(
  "2IysodKQuf62jmd7",
  "Tactics",
  "classfeature",
  1,
  ["firstTactic", "secondTactic", "thirdTactic", "fourthTactic", "fifthTactic"].flatMap((flag, index) => {
    const predicate = index >= 2 ? { predicate: ["class:commander"] } : {};
    return [
      {
        adjustName: false,
        choices: {
          filter: TACTIC_FILTER,
          itemType: "action",
        },
        flag,
        key: "ChoiceSet",
        prompt: "PF2E.SpecificRule.Commander.Tactics.Prompt",
        ...predicate,
      },
      {
        key: "GrantItem",
        uuid: `{item|flags.system.rulesSelections.${flag}}`,
        ...predicate,
      },
    ];
  })
);

export const CATHARTIC_MAGE_DEDICATION = featDocument("dkuY22d3yLUBcqhq", "Cathartic Mage Dedication", "class", 2, [
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.actionspf2e.Item.Catharsis",
  },
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.actionspf2e.Item.Settle Emotions",
  },
  {
    key: "GrantItem",
    uuid: "Compendium.pf2e.classfeatures.Item.Catharsis Emotion",
  },
]);

export const CATHARSIS_EMOTION = featDocument("aSOgbQWMwStTTmap", "Catharsis Emotion", "classfeature", 1, [
  {
    key: "AdjustModifier",
    mode: "override",
    selector: "will",
    value: 3,
  },
  {
    choices: [
      { label: "PF2E.SpecificRule.CatharticMage.Anger.Label", value: { label: "Anger", option: "anger" } },
      { label: "PF2E.SpecificRule.CatharticMage.Awe.Label", value: { label: "Awe", option: "awe" } },
      {
        label: "PF2E.SpecificRule.CatharticMage.Dedication.Label",
        value: { label: "Dedication", option: "dedication" },
      },
      { label: "PF2E.SpecificRule.CatharticMage.Fear.Label", value: { label: "Fear", option: "fear" } },
      { label: "PF2E.SpecificRule.CatharticMage.Hatred.Label", value: { label: "Hatred", option: "hatred" } },
      { label: "PF2E.SpecificRule.CatharticMage.Joy.Label", value: { label: "Joy", option: "joy" } },
      { label: "PF2E.SpecificRule.CatharticMage.Love.Label", value: { label: "Love", option: "love" } },
      { label: "PF2E.SpecificRule.CatharticMage.Misery.Label", value: { label: "Misery", option: "misery" } },
      { label: "PF2E.SpecificRule.CatharticMage.Pride.Label", value: { label: "Pride", option: "pride" } },
      { label: "PF2E.SpecificRule.CatharticMage.Remorse.Label", value: { label: "Remorse", option: "remorse" } },
    ],
    flag: "catharticMageDedication",
    key: "ChoiceSet",
    prompt: "PF2E.SpecificRule.CatharticMage.EmotionalState.Prompt",
  },
]);
