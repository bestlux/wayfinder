import { describe, expect, it } from "vitest";
import type { SelectionRef } from "../src/types";
import { discoverSourceSkillTrainingMeta } from "../src/wayfinder/skill-training/source-discovery";

describe("wayfinder skill training source discovery", () => {
  it("discovers fixed feat-granted skills and lore from ancestry feats like Elven Lore", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("ancestry-feat-level-1", "elven-lore", "Elven Lore"),
          sourceDocument: {
            name: "Elven Lore",
            system: {
              slug: "elven-lore",
              description: {
                value:
                  "<p>You've studied traditional elven arts, learning about arcane magic and the world around you. You gain the trained proficiency rank in Arcana and Nature. If you would automatically become trained in one of those skills (from your background or class, for example), you instead become trained in a skill of your choice.</p><p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Elf Lore.</p>",
              },
              rules: [
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.arcana.rank",
                  value: 1,
                },
                {
                  key: "ActiveEffectLike",
                  mode: "upgrade",
                  path: "system.skills.nature.rank",
                  value: 1,
                },
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value.replace(/^PF2E\.Skill\./, ""),
    });

    expect(training).toMatchObject({
      fixedSkills: ["arcana", "nature"],
      fixedLores: ["Elf Lore"],
      choiceRules: [],
      loreChoices: [],
    });
  });

  it("normalizes explicit UUID labels when deriving Additional Lore grants", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("ancestry-feat-level-1", "elven-lore", "Elven Lore"),
          sourceDocument: {
            name: "Elven Lore",
            system: {
              slug: "elven-lore",
              description: {
                value:
                  "<p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore]{Additional Lore} general feat for Elf Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Elf Lore"]);
  });

  it("discovers multiple fixed lores from a single Additional Lore grant", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "viking-dedication", "Viking Dedication"),
          sourceDocument: {
            name: "Viking Dedication",
            system: {
              slug: "viking-dedication",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Sailing Lore and Warfare Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Sailing Lore", "Warfare Lore"]);
  });

  it("discovers fixed Additional Lore grants expressed with 'in'", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "xenoarchaeologist", "Xenoarchaeologist"),
          sourceDocument: {
            name: "Xenoarchaeologist",
            system: {
              slug: "xenoarchaeologist",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.sf2e.feats.Item.Additional Lore]{ Additional Lore} general feat in Delve Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.sf2e.feats.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Delve Lore"]);
  });

  it("treats chosen-lore Additional Lore grants as lore choices, not fixed lore", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "gnome-obsession", "Gnome Obsession"),
          sourceDocument: {
            name: "Gnome Obsession",
            system: {
              slug: "gnome-obsession",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] feat and the @UUID[Compendium.pf2e.feats-srd.Item.Assurance] feat for the chosen Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Gnome Obsession",
        allowCustom: true,
        suggestions: [],
        placeholder: "Custom Lore",
      },
    ]);
  });

  it("treats partially open Additional Lore grants as lore choices", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "pirate-dedication", "Pirate Dedication"),
          sourceDocument: {
            name: "Pirate Dedication",
            system: {
              slug: "pirate-dedication",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for Sailing Lore or for a specific coastal city you have a connection to (such as Port Peril Lore).</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Pirate Dedication",
        allowCustom: true,
        suggestions: ["Sailing Lore"],
        placeholder: "Port Peril Lore",
      },
    ]);
  });

  it("treats lore subcategory Additional Lore grants as custom lore choices", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "nephilim-lore", "Nephilim Lore"),
          sourceDocument: {
            name: "Nephilim Lore",
            system: {
              slug: "nephilim-lore",
              description: {
                value:
                  "<p>You also gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] general feat for a Lore subcategory of a plane to which you trace your lineage.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual([]);
    expect(training.loreChoices).toMatchObject([
      {
        sourceLabel: "Nephilim Lore",
        allowCustom: true,
      },
    ]);
  });

  it("discovers explicit lore subcategory labels after em dashes", () => {
    const training = discoverSourceSkillTrainingMeta({
      sources: [
        {
          sourceItemType: "feat",
          sourceSelection: selection("feat-slot", "heroic-scion", "Heroic Scion"),
          sourceDocument: {
            name: "Heroic Scion",
            system: {
              slug: "heroic-scion",
              description: {
                value:
                  "<p>You gain the @UUID[Compendium.pf2e.feats-srd.Item.Additional Lore] feat for a special Lore skill subcategory—Incarnation Lore.</p>",
              },
              rules: [
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.feats-srd.Item.Additional Lore",
                },
              ],
            },
          },
        },
      ],
      localize: (value) => value,
    });

    expect(training.fixedLores).toEqual(["Incarnation Lore"]);
  });
});

function selection(slotId: string, documentId: string, name = documentId): SelectionRef {
  return {
    slotId,
    packId: "pf2e.feats-srd",
    documentId,
    uuid: `Compendium.pf2e.feats-srd.Item.${documentId}`,
    itemType: "feat",
    featType: "ancestry",
    name,
    level: 1,
  };
}
