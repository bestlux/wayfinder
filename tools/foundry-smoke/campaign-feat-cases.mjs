export const ancestryParagonSection = {
  id: "xdy_ancestryparagon",
  label: "Ancestry Paragon",
  supported: ["ancestry"],
  slots: [1, 3, 7, 11, 15, 19],
};

export const campaignFeatSmokeCases = [
  {
    id: "ancestry-paragon-fighter-l1-l3",
    label: "Fighter Ancestry Paragon level 1 through 3 apply/rerun",
    className: "Fighter",
    classSlug: "fighter",
    keyAbility: "str",
    targetLevel: 3,
    expectedItemNames: ["Haughty Obstinacy", "Gloomseer"],
    expectedItemLocations: {
      "Haughty Obstinacy": "xdy_ancestryparagon-1",
      Gloomseer: "xdy_ancestryparagon-3",
    },
    expectedStepIds: [
      "ancestry-feat-level-1",
      "campaign-feat-xdy_ancestryparagon-level-1",
      "campaign-feat-xdy_ancestryparagon-level-3",
    ],
    preferredSelections: {
      "ancestry-feat-level-1": ["Cooperative Nature"],
      "campaign-feat-xdy_ancestryparagon-level-1": ["Haughty Obstinacy"],
      "campaign-feat-xdy_ancestryparagon-level-3": ["Gloomseer"],
      "class-feat": ["Sudden Charge", "Reactive Shield"],
      "general-feat": ["Toughness", "Fleet"],
      "skill-feat": ["Cat Fall", "Forager", "Quick Jump"],
    },
    preferredSkills: ["athletics", "acrobatics", "crafting", "medicine", "society", "survival"],
  },
];
