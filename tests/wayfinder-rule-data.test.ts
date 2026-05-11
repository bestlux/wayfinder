import { describe, expect, it } from "vitest";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  isChoicePredicate,
  matchesChoicePredicate,
  matchesChoicePredicateList,
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
    expect(matchesChoicePredicate(["item:type:feat", "item:rarity:rare"], matches)).toBe(false);
  });

  it("evaluates comparison predicates through the caller-owned matcher", () => {
    const active = new Set(["lte:item:level:1", "gt:actor:level:2"]);
    const matches = (statement: string) => active.has(statement);

    expect(matchesChoicePredicate({ lte: ["item:level", 1] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ gt: ["actor:level", "2"] }, matches)).toBe(true);
    expect(matchesChoicePredicate({ lte: ["item:level", 2] }, matches)).toBe(false);
    expect(matchesChoicePredicate({ not: { lte: ["item:level", 2] } }, matches)).toBe(true);
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
});
