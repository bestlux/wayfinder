import { describe, expect, it } from "vitest";
import {
  documentFeatureLevel,
  extractChoiceKey,
  getDocumentRules,
  isChoicePredicate,
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
});
