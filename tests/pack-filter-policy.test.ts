import { beforeEach, describe, expect, it } from "vitest";
import { invalidatePackSourceCaches, type PackIndexEntry } from "../src/pack/access";
import { getTraitCatalog, matchesFilters } from "../src/pack/filter-policy";
import type { ChoicePredicate, OptionContext, PendingStep } from "../src/types";
import { createPickItemStep } from "../src/wayfinder/domain/step-types";

const testGlobals = globalThis as typeof globalThis & { CONFIG: any; game: any };

const EMPTY_CONTEXT: OptionContext = {
  ancestrySlug: null,
  ancestryTraits: [],
  heritageTraits: [],
  classSlug: null,
  classHasSpellcasting: false,
  deitySelected: false,
  sanctification: null,
  hasDedicationFeat: false,
};

describe("pack filter policy hardening", () => {
  beforeEach(() => {
    invalidatePackSourceCaches();
    testGlobals.CONFIG = {
      PF2E: {
        ancestryTraits: { human: "Human" },
        classTraits: { fighter: "Fighter" },
      },
    };
    testGlobals.game = {
      packs: new Map(),
      settings: { get: () => "synthetic-content.*" },
    };
  });

  it("unions configured identities with enabled root ancestry and heritage documents only", async () => {
    setPack("synthetic-content.people", [
      identityEntry("star-eye", "Star Eye", "ancestry"),
      identityEntry("moon-touched", "Moon-Touched", "heritage"),
      featEntry("borrowed-arms", ["weapon"]),
      identityEntry("ignored-profession", "Ignored Profession", "background"),
    ]);

    const catalog = await getTraitCatalog("ancestry-feat");

    expect([...catalog].sort()).toEqual(["human", "moon-touched", "star-eye"]);

    const step = createPickItemStep("ancestry-feat", 1, "Ancestry feat", "", {
      itemType: "feat",
      featTypes: ["ancestry"],
      maxLevel: 1,
    });
    const context = { ...EMPTY_CONTEXT, ancestrySlug: "star-eye", ancestryTraits: ["star-eye"] };
    expect(
      matchesFilters(
        ancestryFeatEntry("focused-gaze", ["star-eye"]),
        "synthetic-content.people",
        step,
        context,
        catalog
      )
    ).toBe(true);
    expect(
      matchesFilters(
        ancestryFeatEntry("moon-step", ["moon-touched"]),
        "synthetic-content.people",
        step,
        context,
        catalog
      )
    ).toBe(false);
    expect(
      matchesFilters(ancestryFeatEntry("open-training", ["weapon"]), "synthetic-content.people", step, context, catalog)
    ).toBe(true);
  });

  it("retains excluded companion identities as negative knowledge for ancestry-feat filtering", async () => {
    const ape = identityEntry("ape", "Ape", "ancestry");
    ape.system.boosts = { 0: { value: [] }, 1: { value: [] }, 2: { value: [] } };
    ape.system.rules = [
      { key: "ActiveEffectLike", path: "system.abilities.str.mod", value: 3 },
      { key: "ActiveEffectLike", path: "flags.system.companionCompendia.kind", value: "animal" },
    ];
    ape.system.traits = { value: ["animal"] };
    setPack("synthetic-content.people", [ape]);

    const catalog = await getTraitCatalog("ancestry-feat");
    const step = createPickItemStep("ancestry-feat", 1, "Ancestry feat", "", {
      itemType: "feat",
      featTypes: ["ancestry"],
      maxLevel: 1,
    });

    expect(catalog).toContain("ape");
    expect(
      matchesFilters(
        ancestryFeatEntry("companion-training", ["ape"]),
        "synthetic-content.people",
        step,
        { ...EMPTY_CONTEXT, ancestrySlug: "human", ancestryTraits: ["human"] },
        catalog
      )
    ).toBe(false);
  });

  it("unions configured class identities with enabled root class documents only", async () => {
    setPack("synthetic-content.classes", [
      identityEntry("cosmonaut", "Cosmonaut", "class"),
      featEntry("cosmonaut-training", ["cosmonaut"]),
    ]);

    const catalog = await getTraitCatalog("class-feat");

    expect([...catalog].sort()).toEqual(["cosmonaut", "fighter"]);
  });

  it("refreshes indexes and identity catalogs through the public invalidation service", async () => {
    const entries = [identityEntry("star-eye", "Star Eye", "ancestry")];
    setPack("synthetic-content.people", entries);

    expect(await getTraitCatalog("ancestry-feat")).toContain("star-eye");
    entries.splice(0, entries.length, identityEntry("cloudborn", "Cloudborn", "ancestry"));
    expect(await getTraitCatalog("ancestry-feat")).not.toContain("cloudborn");

    invalidatePackSourceCaches();

    const refreshed = await getTraitCatalog("ancestry-feat");
    expect(refreshed).toContain("cloudborn");
    expect(refreshed).not.toContain("star-eye");
  });

  it.each([
    undefined,
    null,
    "",
    false,
    {},
    -1,
    1.5,
    "0x1",
    "not-a-level",
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects malformed bounded level %s", (level) => {
    const entry = featEntry("malformed-level", ["general"]);
    entry.system.level = { value: level };

    expect(matchesFilters(entry, "synthetic-content.feats", boundedFeatStep(), EMPTY_CONTEXT, new Set())).toBe(false);
  });

  it("accepts finite numeric and numeric-string levels within the bound", () => {
    for (const level of [1, "1"]) {
      const entry = featEntry("valid-level", ["general"]);
      entry.system.level = { value: level };
      expect(matchesFilters(entry, "synthetic-content.feats", boundedFeatStep(), EMPTY_CONTEXT, new Set())).toBe(true);
    }
  });

  it.each([
    ["and", { and: ["item:trait:alpha", "item:level:2"] }, true],
    ["nand", { nand: ["item:trait:alpha", "item:level:2"] }, false],
    ["or", { or: ["item:trait:missing", "item:trait:alpha"] }, true],
    ["xor", { xor: ["item:trait:alpha", "item:trait:missing"] }, true],
    ["nor", { nor: ["item:trait:missing", "item:level:1"] }, true],
    ["not", { not: "item:trait:missing" }, true],
    ["if-then", { if: "item:trait:alpha", then: "item:level:2" }, true],
    ["iff", { iff: ["item:trait:alpha", "item:level:2"] }, true],
    ["eq", { eq: ["item:level", 2] }, true],
    ["eq-string", { eq: ["same-value", "same-value"] }, true],
    ["lt", { lt: ["item:level", 3] }, true],
    ["lte", { lte: ["item:level", 2] }, true],
    ["gt", { gt: ["item:level", 1] }, true],
    ["gte", { gte: ["item:level", 2] }, true],
  ] satisfies Array<
    [string, ChoicePredicate, boolean]
  >)("evaluates the supported typed %s predicate", (_name, predicate, expected) => {
    expect(matchesPredicate(predicate)).toBe(expected);
  });

  it.each([
    ["unknown string", "actor:unsupported"],
    ["negated unknown", { not: "actor:unsupported" }],
    ["unknown object", {}],
    ["unknown comparison operand", { eq: ["actor:level", 2] }],
    ["unknown nested in xor", { xor: ["item:trait:alpha", "actor:unsupported"] }],
    ["unknown condition", { if: "actor:unsupported", then: "item:level:2" }],
  ] satisfies Array<[string, ChoicePredicate]>)("fails closed for %s", (_name, predicate) => {
    expect(matchesPredicate(predicate)).toBe(false);
  });
});

function matchesPredicate(predicate: ChoicePredicate): boolean {
  const step = createPickItemStep("grant-choice", 2, "Source-authored choice", "", {
    itemType: "feat",
    predicate: [predicate],
  });
  const entry = featEntry("candidate", ["alpha"]);
  entry.system.level = { value: 2 };
  return matchesFilters(entry, "synthetic-content.feats", step, EMPTY_CONTEXT, new Set());
}

function boundedFeatStep(): PendingStep {
  return createPickItemStep("general-feat", 2, "Bounded feat", "", {
    itemType: "feat",
    maxLevel: 2,
  });
}

function setPack(id: string, entries: PackIndexEntry[]): void {
  testGlobals.game.packs.set(id, {
    documentName: "Item",
    metadata: { id, type: "Item" },
    getIndex: async () => entries,
  });
}

function identityEntry(slug: string, name: string, type: string): PackIndexEntry {
  return {
    _id: slug,
    name,
    type,
    system: {
      slug,
      ...(type === "ancestry"
        ? {
            boosts: {
              0: { value: ["str", "dex", "con", "int", "wis", "cha"] },
              1: { value: [] },
              2: { value: ["str", "dex", "con", "int", "wis", "cha"] },
            },
            languages: { value: ["common"], custom: "" },
          }
        : {}),
      traits: { value: [slug, "humanoid"] },
    },
  };
}

function featEntry(slug: string, traits: string[]): PackIndexEntry & { system: Record<string, any> } {
  return {
    _id: slug,
    name: slug,
    type: "feat",
    system: {
      slug,
      category: "general",
      featType: { value: "general" },
      level: { value: 1 },
      traits: { value: traits },
    },
  };
}

function ancestryFeatEntry(slug: string, traits: string[]): PackIndexEntry & { system: Record<string, any> } {
  const entry = featEntry(slug, traits);
  entry.system.category = "ancestry";
  entry.system.featType = { value: "ancestry" };
  return entry;
}
