import { describe, expect, it } from "vitest";
import { SEMANTIC_WEALTH_RULES } from "../scripts/wayfinder/domain/semantic-wealth-rule-ledger.js";
import {
  assertWf08050SemanticRuleRows,
  validateWf08050ReleaseContract,
  wf08050ReleaseContract,
} from "../tools/starting-equipment/release-contract.mjs";

describe("WF-080-50 release contract", () => {
  it("binds every required row and acceptance fact to executable repository evidence", async () => {
    await expect(validateWf08050ReleaseContract()).resolves.toEqual({
      numericRowCount: 20,
      semanticRowCount: 20,
      factCount: 39,
      evidenceCount: 96,
    });
  }, 10_000);

  it("fails closed for missing or duplicate numeric, semantic, and acceptance mappings", async () => {
    const missingNumeric = cloneContract();
    missingNumeric.numericRows.pop();
    await expect(validateWf08050ReleaseContract(missingNumeric)).rejects.toThrow(/numeric row coverage mismatch/i);

    const duplicateSemantic = cloneContract();
    duplicateSemantic.semanticRows[1]!.key = duplicateSemantic.semanticRows[0]!.key;
    await expect(validateWf08050ReleaseContract(duplicateSemantic)).rejects.toThrow(/duplicate semantic row mappings/i);

    const missingFact = cloneContract();
    missingFact.facts.pop();
    await expect(validateWf08050ReleaseContract(missingFact)).rejects.toThrow(/acceptance fact coverage mismatch/i);

    const duplicateFact = cloneContract();
    duplicateFact.facts[1]!.id = duplicateFact.facts[0]!.id;
    await expect(validateWf08050ReleaseContract(duplicateFact)).rejects.toThrow(/duplicate acceptance fact mappings/i);
  });

  it("requires unique executable evidence on every mapped row and fact", async () => {
    const emptyNumeric = cloneContract();
    emptyNumeric.numericRows[0]!.evidence = null;
    await expect(validateWf08050ReleaseContract(emptyNumeric)).rejects.toThrow(
      /numeric row 1 requires executable evidence/i
    );

    const emptySemantic = cloneContract();
    emptySemantic.semanticRows[0]!.evidence = [];
    await expect(validateWf08050ReleaseContract(emptySemantic)).rejects.toThrow(
      /semantic row level-1-starting-money requires executable evidence/i
    );

    const emptyFact = cloneContract();
    emptyFact.facts[0]!.evidence = [];
    await expect(validateWf08050ReleaseContract(emptyFact)).rejects.toThrow(
      /acceptance fact policy-material-drift requires executable evidence/i
    );

    const duplicateEvidence = cloneContract();
    duplicateEvidence.facts[0]!.evidence.push(structuredClone(duplicateEvidence.facts[0]!.evidence[0]!));
    await expect(validateWf08050ReleaseContract(duplicateEvidence)).rejects.toThrow(/contains duplicate evidence/i);
  });

  it("pins every semantic row field, capability, classification, and citation", () => {
    expect(() => assertWf08050SemanticRuleRows(SEMANTIC_WEALTH_RULES)).not.toThrow();

    for (const mutate of [
      (rules: any[]) => (rules[0].behavior = `${rules[0].behavior} drift`),
      (rules: any[]) => rules[0].capabilities.push("gm-judgment"),
      (rules: any[]) => (rules[0].classification = "out-of-scope"),
      (rules: any[]) => rules[0].citations[0].pages.push(999),
    ]) {
      const changed = structuredClone(SEMANTIC_WEALTH_RULES) as any[];
      mutate(changed);
      expect(() => assertWf08050SemanticRuleRows(changed)).toThrow(/semantic wealth rows drifted/i);
    }
  });

  it("verifies referenced test suites and exact test titles from source", async () => {
    const missingSuite = cloneContract();
    missingSuite.facts[0]!.evidence[0]!.file = "tests/missing-wf08050-suite.test.ts";
    await expect(validateWf08050ReleaseContract(missingSuite)).rejects.toThrow(/cannot read test suite/i);

    const missingTitle = cloneContract();
    deadTestSyntaxWitness();
    missingTitle.facts[0]!.evidence[0]!.file = "tests/starting-equipment-release-contract.test.ts";
    missingTitle.facts[0]!.evidence[0]!.title = "dead syntax is not an executable Vitest registration";
    await expect(validateWf08050ReleaseContract(missingTitle)).rejects.toThrow(/missing test title/i);
  });

  it("verifies exported smoke case ids and rejects duplicate case mappings", async () => {
    const missingCase = cloneContract();
    const retainAll = missingCase.facts.find((entry) => entry.id === "retain-all")!;
    const caseEvidence = retainAll.evidence.find((entry) => entry.kind === "case")!;
    caseEvidence.id = "missing-retain-all-case";
    await expect(validateWf08050ReleaseContract(missingCase)).rejects.toThrow(/missing exported case id/i);

    const duplicateCase = cloneContract();
    const duplicateRetainAll = duplicateCase.facts.find((entry) => entry.id === "retain-all")!;
    duplicateRetainAll.evidence.push(
      structuredClone(duplicateRetainAll.evidence.find((entry) => entry.kind === "case")!)
    );
    await expect(validateWf08050ReleaseContract(duplicateCase)).rejects.toThrow(
      /duplicate (?:exported case mappings|evidence)/i
    );
  });

  it("pins the actual generated-output and package-build evidence", async () => {
    const missingPackageBuild = cloneContract();
    const packageFact = missingPackageBuild.facts.find((entry) => entry.id === "package-contract")!;
    packageFact.evidence = packageFact.evidence.filter(
      (entry) => entry.title !== "builds a normal release package without inspection-only qualification metadata"
    );
    await expect(validateWf08050ReleaseContract(missingPackageBuild)).rejects.toThrow(/executable mapping drifted/i);

    const replacedGeneratedGate = cloneContract();
    const generatedFact = replacedGeneratedGate.facts.find((entry) => entry.id === "generated-scripts")!;
    generatedFact.evidence[1]!.title = "requires the concise notice set and original runtime icon";
    await expect(validateWf08050ReleaseContract(replacedGeneratedGate)).rejects.toThrow(/executable mapping drifted/i);
  }, 10_000);
});

function cloneContract(): any {
  return structuredClone(wf08050ReleaseContract);
}

function deadTestSyntaxWitness(): void {
  const it = (_title: string, _callback: () => void) => undefined;
  it("dead syntax is not an executable Vitest registration", () => undefined);
}
