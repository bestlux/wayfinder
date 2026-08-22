import { describe, expect, it } from "vitest";
import { resolveChoiceSetFilters } from "../src/wayfinder/choice-set-filters";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  isChoicePredicate,
  matchesChoicePredicate,
  matchesChoicePredicateList,
  matchesChoiceSetRulePredicate,
  predicateIncludesString,
  toNonEmptyString,
} from "../src/wayfinder/rule-data";

describe("wayfinder rule data helpers", () => {
  it("extracts rules and normalizes shared ChoiceSet fields", () => {
    const document = {
      system: {
        level: { value: "2.9" },
        rules: [{ key: "ChoiceSet", rollOption: "school" }, null, { key: "GrantItem" }],
      },
    };

    expect(getDocumentRules(document)).toEqual([{ key: "ChoiceSet", rollOption: "school" }, { key: "GrantItem" }]);
    expect(documentFeatureLevel(document)).toBe(2);
    expect(extractChoiceKey(getDocumentRules(document)[0])).toBe("school");
  });

  it("keeps predicate and string guards aligned across rule discovery paths", () => {
    expect(toNonEmptyString("  arcane-school  ")).toBe("arcane-school");
    expect(toNonEmptyString(" ")).toBeNull();
    expect(isChoicePredicate(["item:level:1", { or: ["item:type:feat", { not: "item:rarity:rare" }] }])).toBe(true);
    expect(isChoicePredicate([{ nor: ["item:level:1", 2] }])).toBe(false);
  });

  it("evaluates shared predicate trees with caller-owned string matching", () => {
    const active = new Set(["deity:primary:font:heal", "item:type:feat"]);
    const matches = (statement: string) => active.has(statement);

    expect(matchesChoicePredicateList(["item:type:feat", { not: "item:rarity:rare" }], matches)).toBe(true);
    expect(matchesChoicePredicate({ or: ["item:rarity:rare", "deity:primary:font:heal"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ nor: ["item:rarity:rare", "item:type:spell"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ nand: ["item:type:feat", "item:rarity:rare"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ nand: ["item:type:feat", "deity:primary:font:heal"] }, matches)).toBe(false);
    expect(matchesChoicePredicate(["item:type:feat", "item:rarity:rare"], matches)).toBe(false);
    expect(matchesChoicePredicate({ xor: ["item:type:feat", "item:rarity:rare"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ if: "item:type:feat", then: "deity:primary:font:heal" }, matches)).toBe(true);
    expect(matchesChoicePredicate({ if: "item:type:feat", then: "item:rarity:rare" }, matches)).toBe(false);
    expect(matchesChoicePredicate({ iff: ["item:type:feat", "deity:primary:font:heal"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ iff: ["item:type:feat", "item:rarity:rare"] }, matches)).toBe(false);
  });

  it("rejects unknown predicate objects instead of treating them as active", () => {
    expect(isChoicePredicate({ unsupported: ["item:type:feat"] })).toBe(false);
    expect(matchesChoiceSetRulePredicate({ predicate: [{ unsupported: ["item:type:feat"] }] }, new Set())).toBe(false);
  });

  it("evaluates comparison predicates through the caller-owned matcher", () => {
    const active = new Set(["lte:item:level:1", "gt:actor:level:2"]);
    const matches = (statement: string) => active.has(statement);

    expect(matchesChoicePredicate({ lte: ["item:level", 1] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ gt: ["actor:level", "2"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ lte: ["item:level", 2] }, matches)).toBe(false);
    expect(matchesChoicePredicate({ not: { lte: ["item:level", 2] } }, matches)).toBe(true);
  });

  it("evaluates numeric rule comparisons against projected roll-option values", () => {
    const active = new Set(["skill:crafting:rank:1", "self:level:5"]);

    expect(matchesChoiceSetRulePredicate({ predicate: [{ gte: ["skill:crafting:rank", 1] }] }, active)).toBe(true);
    expect(matchesChoiceSetRulePredicate({ predicate: [{ lte: ["skill:crafting:rank", 1] }] }, active)).toBe(true);
    expect(matchesChoiceSetRulePredicate({ predicate: [{ gt: ["skill:crafting:rank", 1] }] }, active)).toBe(false);
    expect(matchesChoiceSetRulePredicate({ predicate: [{ lt: ["self:level", 6] }] }, active)).toBe(true);
    expect(matchesChoiceSetRulePredicate({ predicate: [{ eq: ["self:level", 5] }] }, active)).toBe(true);
    expect(matchesChoicePredicate({ eq: ["arcane", "arcane"] }, () => false)).toBe(true);
  });

  it("finds predicate string fragments inside nested branches", () => {
    expect(
      predicateIncludesString(
        ["item:level:1", { or: ["item:trait:general", { not: "item:trait:{actor|system.details.class.trait}" }] }],
        "{actor|system.details.class.trait}"
      )
    ).toBe(true);
    expect(predicateIncludesString({ nor: ["item:level:2"] }, "{actor|system.details.class.trait}")).toBe(false);
  });

  it("preserves valid nested query predicates and rejects malformed elements", () => {
    const nested = { xor: ["item:trait:air", { and: ["item:trait:earth", { not: "item:rarity:rare" }] }] };

    expect(
      resolveChoiceSetFilters({ key: "ChoiceSet", choices: { filter: ["item:type:feat", nested] } }, { sourceLevel: 1 })
        ?.filters.predicate
    ).toEqual(["item:type:feat", nested]);
    expect(
      resolveChoiceSetFilters(
        { key: "ChoiceSet", choices: { filter: ["item:type:feat", { unsupported: ["item:trait:air"] }] } },
        { sourceLevel: 1 }
      )
    ).toBeNull();
  });

  it("distinguishes a source document's self level from its acquisition level", () => {
    expect(
      resolveChoiceSetFilters(
        {
          key: "ChoiceSet",
          choices: {
            itemType: "feat",
            filter: [{ lte: ["item:level", "self:level"] }, { gte: ["item:level", "parent:granter:level"] }],
          },
        },
        { sourceLevel: 1, sourceDocumentLevel: 2 }
      )?.filters.predicate
    ).toEqual([{ lte: ["item:level", 2] }, { gte: ["item:level", 1] }]);
  });

  it("resolves Kineticist gate placeholders throughout nested impulse predicates", () => {
    const result = resolveChoiceSetFilters(
      {
        key: "ChoiceSet",
        choices: {
          itemType: "feat",
          filter: [
            "item:trait:impulse",
            {
              or: [
                "item:trait:{actor|flags.system.kineticist.gate.one}",
                {
                  not: {
                    xor: [
                      "item:trait:{actor|flags.system.kineticist.gate.one}",
                      "item:trait:{actor|flags.system.kineticist.gate.two}",
                      "item:trait:{actor|flags.system.kineticist.gate.three}",
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      {
        sourceLevel: 5,
        actorContext: { kineticistGateElements: ["fire", "water"] },
        requireResolvedActorPlaceholders: true,
      }
    );

    expect(result?.actorDependencies).toEqual(["class"]);
    expect(result?.filters.predicate).toEqual([
      "item:trait:impulse",
      {
        or: [
          "item:trait:fire",
          {
            not: {
              xor: ["item:trait:fire", "item:trait:water", "item:trait:wayfinder-unselected-kineticist-gate-3"],
            },
          },
        ],
      },
    ]);
  });
});
