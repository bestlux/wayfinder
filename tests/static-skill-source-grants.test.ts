import { describe, expect, it } from "vitest";
import {
  canonicalizeSkillSourceGrants,
  projectStaticSkillSourceGrants,
} from "../src/wayfinder/domain/static-skill-source-grants";

const validSkillSlugs = new Set(["arcana", "diplomacy", "intimidation", "religion", "survival"]);
const sourceId = "Compendium.pf2e.feats-srd.Item.aQNsD2t0Tb4vToA4";
const marks = [
  { selection: "burning-sun", slug: "diplomacy" },
  { selection: "deaths-head", slug: "survival" },
  { selection: "defiled-corpse", slug: "religion" },
  { selection: "empty-hand", slug: "intimidation" },
];

describe("static skill source grants", () => {
  it.each(marks)("projects only the selected $selection grant", ({ selection, slug }) => {
    expect(
      projectStaticSkillSourceGrants({
        document: holdMarkDocument(),
        sourceId,
        validSkillSlugs,
        activeRollOptions: new Set([`hold-mark:${selection}`]),
      })
    ).toEqual([{ slug, rank: 1, sourceId }]);
  });

  it("does not project conditional skills before a mark is selected", () => {
    expect(projectStaticSkillSourceGrants({ document: holdMarkDocument(), sourceId, validSkillSlugs })).toEqual([]);
  });

  it("preserves unconditional fixed training and upgrade or override grants", () => {
    const document = {
      system: {
        trainedSkills: { value: [" Arcana ", "unknown"] },
        rules: [
          rankRule("arcana", { mode: "upgrade", value: 2 }),
          rankRule("religion", { mode: "override", value: 1, predicate: [] }),
          rankRule("survival", { mode: undefined, value: 1 }),
        ],
      },
    };

    expect(projectStaticSkillSourceGrants({ document, sourceId, validSkillSlugs })).toEqual([
      { slug: "arcana", rank: 2, sourceId },
      { slug: "religion", rank: 1, sourceId },
      { slug: "survival", rank: 1, sourceId },
    ]);
  });

  it("rejects unsupported predicates instead of discarding their conditions", () => {
    const document = {
      system: {
        rules: [
          rankRule("arcana", { predicate: ["hold-mark:burning-sun", { unsupported: true }] }),
          rankRule("religion", { predicate: { unsupported: true } }),
          rankRule("survival", { predicate: null }),
        ],
      },
    };

    expect(
      projectStaticSkillSourceGrants({
        document,
        sourceId,
        validSkillSlugs,
        activeRollOptions: new Set(["hold-mark:burning-sun"]),
      })
    ).toEqual([]);
  });

  it("evaluates supported predicate combinations against projected options", () => {
    const document = {
      system: {
        rules: [
          rankRule("arcana", {
            predicate: [{ and: ["class:cleric", { not: "hold-mark:deaths-head" }] }],
          }),
          rankRule("religion", { predicate: [{ or: ["class:psychic", "hold-mark:defiled-corpse"] }] }),
        ],
      },
    };

    expect(
      projectStaticSkillSourceGrants({
        document,
        sourceId,
        validSkillSlugs,
        activeRollOptions: new Set(["class:cleric"]),
      })
    ).toEqual([{ slug: "arcana", rank: 1, sourceId }]);
  });

  it.each([
    "add",
    "subtract",
    "multiply",
    "downgrade",
    "remove",
  ])("does not treat %s as a fixed minimum-rank grant", (mode) => {
    expect(
      projectStaticSkillSourceGrants({
        document: { system: { rules: [rankRule("arcana", { mode })] } },
        sourceId,
        validSkillSlugs,
      })
    ).toEqual([]);
  });
});

describe("canonical skill source grants", () => {
  it("deduplicates repeated source references while preserving independent same-skill grants", () => {
    const grants = [
      { slug: " Arcana ", rank: 1, sourceId: "class" },
      { slug: "arcana", rank: 2, sourceId: "class" },
      { slug: "arcana", rank: 1, sourceId: "background" },
      { slug: "survival", rank: 1 },
      { slug: "survival", rank: 1 },
    ];
    const input = structuredClone(grants);
    const result = canonicalizeSkillSourceGrants(grants);

    expect(result).toEqual([
      { slug: "survival", rank: 1 },
      { slug: "arcana", rank: 1, sourceId: "background" },
      { slug: "arcana", rank: 2, sourceId: "class" },
    ]);
    expect(canonicalizeSkillSourceGrants([...grants].reverse())).toEqual(result);
    expect(grants).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
  });

  it("keeps source identity case-sensitive and normalizes ranks consistently", () => {
    expect(
      canonicalizeSkillSourceGrants([
        { slug: "arcana", rank: 9.2, sourceId: "Compendium.pack.Item.AbCd" },
        { slug: "arcana", rank: 1, sourceId: "Compendium.pack.Item.abcd" },
        { slug: "religion", rank: Number.NaN },
        { slug: "", rank: 1 },
      ])
    ).toEqual([
      { slug: "arcana", rank: 1, sourceId: "Compendium.pack.Item.abcd" },
      { slug: "arcana", rank: 4, sourceId: "Compendium.pack.Item.AbCd" },
    ]);
  });
});

function rankRule(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    key: "ActiveEffectLike",
    mode: "upgrade",
    path: `system.skills.${slug}.rank`,
    value: 1,
    ...overrides,
  };
}

function holdMarkDocument() {
  return {
    system: {
      rules: marks.map(({ selection, slug }) => rankRule(slug, { predicate: [`hold-mark:${selection}`] })),
    },
  };
}
