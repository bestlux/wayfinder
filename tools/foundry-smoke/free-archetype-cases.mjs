const commonAncestry = ["Cooperative Nature", "Haughty Obstinacy"];
const commonGeneral = ["Toughness", "Fleet"];
const commonSkillFeats = ["Cat Fall", "Forager", "Acrobatic Performer", "Group Impression", "Quick Jump"];

function freeArchetypeCase({
  archetypeDedication,
  archetypeFollowUp,
  className,
  classSlug,
  classFeats,
  expectedItemNameCounts,
  expectedItemNames = [],
  expectedItemRuleSelections,
  expectedItemTraitCounts,
  expectedStepIds = [],
  forbiddenStepIds,
  keyAbility,
  lockedOutDedication,
  preferredSelections = {},
  preferredSkills,
  targetLevel = 5,
}) {
  const hasFollowUp = typeof archetypeFollowUp === "string" && archetypeFollowUp.length > 0;
  return {
    id: `free-archetype-${classSlug}-${archetypeDedication.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: `${className} ${archetypeDedication} Free Archetype level 1 through ${targetLevel} apply/rerun`,
    className,
    classSlug,
    keyAbility,
    targetLevel,
    expectedItemNames: [archetypeDedication, ...(hasFollowUp ? [archetypeFollowUp] : []), ...expectedItemNames],
    expectedItemNameCounts,
    expectedItemRuleSelections,
    expectedItemTraitCounts,
    expectedItemLocations: {
      [archetypeDedication]: "archetype-2",
      ...(hasFollowUp ? { [archetypeFollowUp]: "archetype-4" } : {}),
    },
    expectedStepIds: [
      "class-feat-level-2",
      "archetype-feat-level-2",
      ...(targetLevel >= 4 ? ["class-feat-level-4", "archetype-feat-level-4"] : []),
      ...expectedStepIds,
    ],
    forbiddenStepIds,
    expectedPickerOptions:
      hasFollowUp && lockedOutDedication
        ? {
            "archetype-feat-level-4": {
              present: [archetypeFollowUp],
              absent: [lockedOutDedication],
            },
          }
        : undefined,
    preferredSelections: {
      "ancestry-feat": commonAncestry,
      "class-feat": classFeats,
      "general-feat": commonGeneral,
      "skill-feat": commonSkillFeats,
      "archetype-feat-level-2": [archetypeDedication],
      ...(hasFollowUp ? { "archetype-feat-level-4": [archetypeFollowUp] } : {}),
      ...preferredSelections,
    },
    preferredSkills,
  };
}

export const freeArchetypeSmokeCases = [
  freeArchetypeCase({
    archetypeDedication: "Archer Dedication",
    archetypeFollowUp: "Quick Shot",
    className: "Fighter",
    classSlug: "fighter",
    classFeats: ["Sudden Charge", "Reactive Shield", "Point Blank Stance"],
    keyAbility: "str",
    lockedOutDedication: "Acrobat Dedication",
    preferredSkills: ["athletics", "acrobatics", "crafting", "medicine", "society", "survival"],
  }),
  freeArchetypeCase({
    archetypeDedication: "Acrobat Dedication",
    archetypeFollowUp: "Contortionist",
    className: "Rogue",
    classSlug: "rogue",
    classFeats: ["Nimble Dodge", "Trap Finder", "Mobility"],
    keyAbility: "dex",
    lockedOutDedication: "Archer Dedication",
    preferredSkills: ["acrobatics", "stealth", "thievery", "deception", "diplomacy", "society", "athletics"],
  }),
  freeArchetypeCase({
    archetypeDedication: "Commander Dedication",
    archetypeFollowUp: null,
    className: "Fighter",
    classSlug: "fighter",
    classFeats: ["Sudden Charge", "Reactive Shield"],
    expectedItemNames: ["Tactics", "Coordinating Maneuvers", "Defensive Retreat"],
    expectedItemNameCounts: {
      "Coordinating Maneuvers": 1,
      "Defensive Retreat": 1,
    },
    expectedItemRuleSelections: {
      Tactics: {
        firstTactic: "Compendium.pf2e.actionspf2e.Item.Kp325Qf0qpF6RCDE",
        secondTactic: "Compendium.pf2e.actionspf2e.Item.UJi0VYnhVSdnl9II",
      },
    },
    expectedItemTraitCounts: { tactic: 2 },
    expectedStepIds: [
      "grant-choice-class-classfeature-tactics-firstTactic-level-2",
      "grant-choice-class-classfeature-tactics-secondTactic-level-2",
    ],
    forbiddenStepIds: [
      "grant-choice-class-classfeature-tactics-thirdTactic-level-2",
      "grant-choice-class-classfeature-tactics-fourthTactic-level-2",
      "grant-choice-class-classfeature-tactics-fifthTactic-level-2",
    ],
    keyAbility: "str",
    lockedOutDedication: null,
    preferredSelections: {
      "grant-choice-class-classfeature-tactics-firstTactic-level-2": ["Coordinating Maneuvers"],
      "grant-choice-class-classfeature-tactics-secondTactic-level-2": ["Defensive Retreat"],
    },
    preferredSkills: ["athletics", "warfare-lore", "diplomacy", "intimidation", "society", "survival"],
    targetLevel: 2,
  }),
];
