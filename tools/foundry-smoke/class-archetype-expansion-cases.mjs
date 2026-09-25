import { smokeCases } from "./class-cases.mjs";

// Supplemental qualification stays separate from WF-080-51's frozen equipment matrix.
const barbarian = smokeCases.find((entry) => entry.id === "barbarian-l1-l5-apply-rerun");
const ranger = smokeCases.find((entry) => entry.id === "ranger-l1-l5-apply-rerun");
if (!barbarian || !ranger) throw new Error("Class-archetype smoke requires the standard Barbarian and Ranger fixtures.");

const bloodragerPath = "class-archetype-instinct-level-1";
const bloodragerTradition = "class-choice-bloodrager-dedication-skill-level-2";
const bloodragerTraining = "skill-training-bloodrager-dedication-level-2";
const bloodragerTrainingKey = "feat:bloodrager-dedication:tradition-training";
const vindicatorPath = "class-archetype-hunters-edge-level-1";
const vindicatorTerrain = "class-choice-vindicator-trackless-journey-level-5";

function bloodragerCase(tradition) {
  const skill = tradition === "arcane" ? "arcana" : "religion";
  const dedicationName = `Bloodrager Dedication (${tradition === "arcane" ? "Arcane" : "Divine"})`;
  // Acolyte already trains Religion; its divine case must choose a fallback at level 2.
  const trainingSkill = tradition === "arcane" ? "arcana" : "society";
  const attackStep = `spell-choice-bloodrager-${tradition}-attack-cantrip-level-2`;
  const otherStep = `spell-choice-bloodrager-${tradition}-cantrip-level-2`;
  const destination = `bloodrager-${tradition}-repertoire`;
  const otherCantrip = tradition === "arcane" ? "Shield" : "Guidance";
  return {
    ...barbarian,
    id: `barbarian-bloodrager-${tradition}-l1-l5-apply-rerun`,
    label: `Bloodrager ${tradition}${tradition === "divine" ? " trained-skill fallback" : ""} level 1 through 5 apply/rerun`,
    expectedStepIds: [bloodragerPath, bloodragerTradition, bloodragerTraining, attackStep, otherStep, "class-feat-level-4"],
    forbiddenStepIds: ["class-branch-instinct-level-1", "class-feat-level-2"],
    preferredSelections: {
      ...barbarian.preferredSelections,
      [bloodragerPath]: ["Bloodrager"],
      [bloodragerTradition]: [tradition, skill],
      [attackStep]: ["Needle Darts"],
      [otherStep]: [otherCantrip],
      "class-feat-level-1": ["Sudden Charge"],
      "class-feat-level-4": ["Raging Intimidation"],
    },
    preferredRuleChoices: { [bloodragerTrainingKey]: trainingSkill },
    preferredSkills: ["athletics", "medicine", "intimidation", "survival", "acrobatics", "stealth"],
    expectedSkillIncreaseSelections: {
      "skill-increase-level-3": "athletics",
      "skill-increase-level-5": "medicine",
    },
    expectedSkillRanks: { athletics: 2, medicine: 2, [skill]: 1, [trainingSkill]: 1 },
    expectedTraining: {
      // The visible training step also includes Acolyte's fixed Religion grant.
      "skill-training-barbarian-level-1": { fixedSkills: ["athletics", "medicine", "religion"], additionalCount: 2 },
    },
    expectedSpellChoiceCounts: { [attackStep]: 1, [otherStep]: 1 },
    expectedItemNames: ["Bloodrager", dedicationName, "Harvest Blood", "Needle Darts", otherCantrip, "Raging Intimidation"],
    expectedItemNameCounts: { Bloodrager: 1, [dedicationName]: 1, "Harvest Blood": 1, "Needle Darts": 1, [otherCantrip]: 1 },
    expectedItemRuleSelections: { [dedicationName]: { skill } },
    expectedItemLocations: { [dedicationName]: "class-2", "Raging Intimidation": "class-4" },
    forbiddenItemNames: ["Fury Instinct", "Animal Instinct"],
    expectedSpellcastingEntries: {
      [destination]: { ability: "cha", prepared: "spontaneous", tradition, proficiencyRank: 1, proficiencySlug: "" },
    },
    expectedItemDestinations: { "Needle Darts": destination, [otherCantrip]: destination },
  };
}

function vindicatorCase({ deityName, deityId, terrain }) {
  return {
    ...ranger,
    id: `ranger-vindicator-${terrain}-l1-l5-apply-rerun`,
    label: `Vindicator ${deityName} ${terrain} level 1 through 5 apply/rerun`,
    deityName,
    expectedStepIds: [vindicatorPath, "deity-level-1", "skill-training-ranger-level-1", vindicatorTerrain, "class-feat-level-4"],
    forbiddenStepIds: ["class-branch-hunters-edge-level-1", "class-feat-level-2"],
    preferredSelections: {
      ...ranger.preferredSelections,
      [vindicatorPath]: ["Vindicator"],
      [vindicatorTerrain]: [terrain === "urban" ? "Urban terrain" : "Natural terrain", terrain],
      "class-choice-vindicator-sanctification-level-1": ["Holy", "holy"],
      "class-feat-level-1": ["Monster Hunter"],
      "class-feat-level-4": ["Twin Takedown"],
    },
    preferredSkills: ["survival", "religion", "acrobatics", "athletics", "stealth", "medicine", "society"],
    expectedSkillIncreaseSelections: {
      "skill-increase-level-3": "survival",
      "skill-increase-level-5": "religion",
    },
    expectedSkillRanks: { survival: 2, religion: 2, nature: 0 },
    expectedTraining: {
      // The standard DEX fixture boosts INT at levels 1 and 5: 4 + INT is 5/6.
      "skill-training-ranger-level-1": { fixedSkills: ["religion", "survival"], additionalCountByTargetLevel: { 1: 5, 5: 6 } },
    },
    // PF2E 8.5 grants the feat unconditionally; its ItemAlteration predicate limits
    // the effect to the qualifying deity-favored simple/unarmed weapon.
    expectedItemNames: ["Vindicator", "Vindicator Dedication", "Vindicator's Mark", "Trackless Journey", deityName, "Twin Takedown", "Deadly Simplicity"],
    expectedItemNameCounts: { Vindicator: 1, "Vindicator Dedication": 1, "Vindicator's Mark": 1, "Trackless Journey": 1, [deityName]: 1, "Deadly Simplicity": 1 },
    expectedItemRuleSelections: {
      Vindicator: { deity: `Compendium.pf2e.deities.Item.${deityId}`, ...(deityName === "Sarenrae" ? { sanctification: "holy" } : {}) },
    },
    expectedItemLocations: { "Vindicator Dedication": "class-2", "Twin Takedown": "class-4" },
    forbiddenItemNames: ["Precision", "Flurry"],
    expectedSpellcastingEntries: {
      "vindicator-divine-focus": { ability: "wis", prepared: "focus", tradition: "divine", proficiencyRank: 1, proficiencySlug: "" },
    },
    expectedItemDestinations: { "Vindicator's Mark": "vindicator-divine-focus" },
    expectedFocusPool: 1,
    expectedTracklessJourneyTerrain: terrain,
  };
}

const arcaneBloodrager = bloodragerCase("arcane");
const divineBloodrager = bloodragerCase("divine");
const urbanVindicator = vindicatorCase({ deityName: "Sarenrae", deityId: "BNycwu3I21dTh4D9", terrain: "urban" });
const naturalVindicator = vindicatorCase({ deityName: "Pharasma", deityId: "QZD0u1jxwz0kj8uI", terrain: "natural" });
const risingBloodMagic = {
  ...arcaneBloodrager,
  id: "barbarian-bloodrager-rising-blood-magic-l1-l5-apply-rerun",
  label: "Bloodrager Rising Blood Magic first-rank spell level 1 through 5 apply/rerun",
  expectedStepIds: [...arcaneBloodrager.expectedStepIds, "spell-choice-bloodrager-arcane-rank-1-level-4"],
  preferredSelections: {
    ...arcaneBloodrager.preferredSelections,
    "class-feat-level-4": ["Rising Blood Magic"],
    "spell-choice-bloodrager-arcane-rank-1-level-4": ["Force Barrage"],
  },
  expectedItemNames: [...arcaneBloodrager.expectedItemNames.filter((name) => name !== "Raging Intimidation"), "Rising Blood Magic", "Force Barrage"],
  expectedItemNameCounts: { ...arcaneBloodrager.expectedItemNameCounts, "Rising Blood Magic": 1, "Force Barrage": 1 },
  expectedItemLocations: { "Bloodrager Dedication (Arcane)": "class-2", "Rising Blood Magic": "class-4" },
  expectedSpellChoiceCounts: { ...arcaneBloodrager.expectedSpellChoiceCounts, "spell-choice-bloodrager-arcane-rank-1-level-4": 1 },
  expectedSpellcastingEntries: {
    "bloodrager-arcane-repertoire": { ...arcaneBloodrager.expectedSpellcastingEntries["bloodrager-arcane-repertoire"], slots: { slot1: 1 } },
  },
  expectedItemDestinations: { ...arcaneBloodrager.expectedItemDestinations, "Force Barrage": "bloodrager-arcane-repertoire" },
};

export const classArchetypeExpansionCases = [
  {
    ...barbarian,
    id: "barbarian-standard-class-path-l1-l5-apply-rerun",
    expectedStepIds: [bloodragerPath, ...barbarian.expectedStepIds, "class-feat-level-2", "class-feat-level-4"],
    preferredSelections: { ...barbarian.preferredSelections, [bloodragerPath]: ["Standard class path"] },
    forbiddenItemNames: ["Bloodrager", "Bloodrager Dedication", "Bloodrager Dedication (Arcane)", "Bloodrager Dedication (Divine)", "Harvest Blood"],
  },
  {
    ...ranger,
    id: "ranger-standard-class-path-l1-l5-apply-rerun",
    expectedStepIds: [vindicatorPath, ...ranger.expectedStepIds, "class-feat-level-2", "class-feat-level-4"],
    preferredSelections: { ...ranger.preferredSelections, [vindicatorPath]: ["Standard class path"] },
    forbiddenItemNames: ["Vindicator", "Vindicator Dedication", "Vindicator's Mark"],
  },
  arcaneBloodrager,
  divineBloodrager,
  risingBloodMagic,
  urbanVindicator,
  naturalVindicator,
];
