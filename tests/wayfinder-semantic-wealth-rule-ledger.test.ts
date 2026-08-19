import { describe, expect, it } from "vitest";
import {
  resolveSemanticWealthCapability,
  SEMANTIC_WEALTH_POLICY_REF,
  SEMANTIC_WEALTH_RULES,
  type SemanticWealthRuleEntry,
} from "../src/wayfinder/domain/semantic-wealth-rule-ledger.js";

describe("semantic wealth rule ledger", () => {
  it("contains the complete cited 20-rule policy independently from generated wealth data", () => {
    expect(SEMANTIC_WEALTH_POLICY_REF).toEqual({
      policyId: "pf2e-remaster-semantic-wealth",
      policyVersion: 1,
    });
    expect(SEMANTIC_WEALTH_RULES).toHaveLength(20);
    expect(new Set(SEMANTIC_WEALTH_RULES.map((rule) => rule.key)).size).toBe(20);
    for (const rule of SEMANTIC_WEALTH_RULES) {
      expect(rule.citations.length).toBeGreaterThan(0);
      expect(rule.citations.every((citation) => citation.edition === "remaster" && citation.pages.length > 0)).toBe(
        true
      );
      expect(rule.semanticTestIds).toEqual([`WF-080-11:${rule.key}`]);
      expect(rule.lastVerifiedOn).toBe("2026-08-15");
      expect(Object.isFrozen(rule)).toBe(true);
    }
  });

  it("records only reviewed AoN identifiers", () => {
    expect(
      Object.fromEntries(
        SEMANTIC_WEALTH_RULES.flatMap((rule) =>
          rule.citations.flatMap((citation) =>
            citation.aonRuleId ? [[`${rule.key}:${citation.pages.join("-")}`, citation.aonRuleId]] : []
          )
        )
      )
    ).toEqual({
      "automatic-bonus-progression:83": 2741,
      "explicit-zero-price:267": 181,
      "higher-level-character-wealth:61-67": 2684,
      "level-0-starting-money:84-85": 2754,
      "size-priced-equipment:270": 2163,
    });
  });

  it("blocks only the capability whose injected rule citation is unresolved", () => {
    const rules = SEMANTIC_WEALTH_RULES.map((rule) =>
      rule.key === "explicit-zero-price" ? ({ ...rule, citations: [] } satisfies SemanticWealthRuleEntry) : rule
    );

    expect(resolveSemanticWealthCapability("price-resolution", rules)).toMatchObject({
      available: false,
      diagnostic: {
        code: "semantic-wealth-citation-unresolved",
        capability: "price-resolution",
        ruleKeys: ["explicit-zero-price"],
      },
    });
    expect(resolveSemanticWealthCapability("official-wealth", rules).available).toBe(true);
  });
});
