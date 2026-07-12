const commonAncestry = ["Cooperative Nature", "Haughty Obstinacy"];
const commonGeneral = ["Toughness", "Fleet"];
const commonSkillFeats = ["Cat Fall", "Forager", "Acrobatic Performer", "Group Impression", "Quick Jump"];

function freeArchetypeCase({
  archetypeDedication,
  archetypeFollowUp,
  className,
  classSlug,
  classFeats,
  keyAbility,
  preferredSkills,
}) {
  return {
    id: `free-archetype-${classSlug}-${archetypeDedication.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: `${className} ${archetypeDedication} Free Archetype level 1 through 5 apply/rerun`,
    className,
    classSlug,
    keyAbility,
    targetLevel: 5,
    expectedItemNames: [archetypeDedication, archetypeFollowUp],
    expectedItemLocations: {
      [archetypeDedication]: "archetype-2",
      [archetypeFollowUp]: "archetype-4",
    },
    expectedStepIds: [
      "class-feat-level-2",
      "archetype-feat-level-2",
      "class-feat-level-4",
      "archetype-feat-level-4",
    ],
    preferredSelections: {
      "ancestry-feat": commonAncestry,
      "class-feat": classFeats,
      "general-feat": commonGeneral,
      "skill-feat": commonSkillFeats,
      "archetype-feat-level-2": [archetypeDedication],
      "archetype-feat-level-4": [archetypeFollowUp],
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
    preferredSkills: ["athletics", "acrobatics", "crafting", "medicine", "society", "survival"],
  }),
  freeArchetypeCase({
    archetypeDedication: "Acrobat Dedication",
    archetypeFollowUp: "Contortionist",
    className: "Rogue",
    classSlug: "rogue",
    classFeats: ["Nimble Dodge", "Trap Finder", "Mobility"],
    keyAbility: "dex",
    preferredSkills: ["acrobatics", "stealth", "thievery", "deception", "diplomacy", "society", "athletics"],
  }),
];
