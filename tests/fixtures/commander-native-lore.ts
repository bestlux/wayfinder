import type { EmbeddedItemSource } from "../../src/shared/actor-model";

export const COMMANDER_NATIVE_LORE_UUID = "Compendium.pf2e.classes.Item.Oyee5Ds9uwYLEkD0";

// Minimal native PF2E 8.6.1 rule data; no copied class prose.
export function commanderNativeLoreSource(): EmbeddedItemSource {
  return {
    name: "Commander",
    type: "class",
    system: {
      slug: "commander",
      trainedSkills: { value: ["society"], additional: 2 },
      rules: [
        {
          key: "ActiveEffectLike",
          mode: "override",
          path: "system.skills.warfare-lore",
          value: {
            attribute: "int",
            label: "PF2E.SpecificLore.Warfare",
            rank: "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3),when(gte(@actor.level, 3), 2),1)",
          },
        },
      ],
    },
  };
}
