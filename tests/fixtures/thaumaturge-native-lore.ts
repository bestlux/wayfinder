import type { EmbeddedItemSource } from "../../src/shared/actor-model";

export const THAUMATURGE_NATIVE_LORE_CLASS_UUID = "Compendium.pf2e.classes.Item.Y5GsHqzCzJlKka6x";
export const THAUMATURGE_NATIVE_LORE_UUID = "Compendium.pf2e.classfeatures.Item.cvQmPkJtybMcHinK";

// Reviewed rule facts from official pf2e-8.5.1 / pf2e-8.6.1; no copied feature prose.
export function thaumaturgeLoreClassSource(): EmbeddedItemSource {
  return {
    type: "class",
    name: "Thaumaturge",
    system: {
      slug: "thaumaturge",
      trainedSkills: { value: ["arcana", "nature", "occultism", "religion"], additional: 3, custom: "Esoteric Lore" },
      items: {
        "7qJbx": { level: 1, name: "Esoteric Lore", uuid: THAUMATURGE_NATIVE_LORE_UUID },
      },
      rules: [],
    },
  };
}

export function thaumaturgeLoreFeatureSource(version: "8.5.1" | "8.6.1" = "8.6.1"): EmbeddedItemSource {
  const grant = { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.1Bt7uCW2WI4sM84P" };
  return {
    name: "Esoteric Lore",
    type: "feat",
    system: {
      slug: "esoteric-lore",
      category: "classfeature",
      level: { value: 1 },
      rules:
        version === "8.5.1"
          ? [
              {
                ability: "cha",
                force: true,
                key: "FlatModifier",
                selector: ["esoteric", "esoteric-lore", "lore-esoteric"],
                type: "ability",
              },
              grant,
            ]
          : [
              grant,
              {
                key: "ActiveEffectLike",
                mode: "override",
                path: "system.skills.esoteric-lore",
                value: {
                  attribute: "cha",
                  label: "{item|name}",
                  rank: "match(when(gte(@actor.level, 15), 4), when(gte(@actor.level, 7), 3),when(gte(@actor.level, 3), 2),1)",
                },
              },
            ],
    },
  };
}
