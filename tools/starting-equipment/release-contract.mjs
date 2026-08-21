#!/usr/bin/env node

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { assertGeneratedScriptsCurrent } from "../release/check-generated-scripts.mjs";

const DEFAULT_REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const execFileAsync = promisify(execFile);
const GENERATED_ARTIFACT_CHECK_TIMEOUT_MS = 20_000;
const SEMANTIC_RULES_DIGEST = "sha256:dc4a57ca21387be073952a1dadcb42309df2fdee6581aa538f1c9749523df2b5";
const CONTRACT_MAPPING_DIGEST = "sha256:f37329725019474fb52b866ee911347d32ceb68f067f8fdde369376341480c62";
const NUMERIC_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
const SEMANTIC_RULE_BINDINGS = Object.freeze([
  semanticBinding(
    "level-1-starting-money",
    "keeps official recipes alternative, level-1 equivalent, and independent of party size",
  ),
  semanticBinding(
    "higher-level-character-wealth",
    "keeps official recipes alternative, level-1 equivalent, and independent of party size",
  ),
  semanticBinding(
    "wealth-recipes-are-alternatives",
    "keeps official recipes alternative, level-1 equivalent, and independent of party size",
  ),
  semanticBinding(
    "party-size-is-separate",
    "keeps official recipes alternative, level-1 equivalent, and independent of party size",
  ),
  semanticBinding("baseline-permanent-item", "assigns lower-level baseline items without a rebate and funds additions with currency"),
  semanticBinding("property-and-material-cost", "assigns lower-level baseline items without a rebate and funds additions with currency"),
  semanticBinding("permanent-residual-spending", "enforces permanent residual and lump-sum level boundaries"),
  semanticBinding("lower-level-substitution", "assigns lower-level baseline items without a rebate and funds additions with currency"),
  semanticBinding("no-substitution-rebate", "assigns lower-level baseline items without a rebate and funds additions with currency"),
  semanticBinding("lump-sum-item-cap", "enforces permanent residual and lump-sum level boundaries"),
  semanticBinding("rarity-discretion", "treats source and rarity as independent authority facts"),
  semanticBinding("source-rarity-and-access", "treats source and rarity as independent authority facts"),
  semanticBinding("extra-current-level-item", "keeps GM judgments explicit and ABP limited to numerical guidance"),
  semanticBinding("inherited-party-wealth", "keeps GM judgments explicit and ABP limited to numerical guidance"),
  semanticBinding(
    "explicit-zero-price",
    "distinguishes explicit zero Price from missing, malformed, and quantity-aware pricing",
  ),
  semanticBinding(
    "size-priced-equipment",
    "applies ordinary size multipliers without repricing fixed prices or precious material",
  ),
  semanticBinding(
    "class-granted-equipment",
    "requires planned class-grant provenance and enforces every Titan Mauler boundary",
  ),
  semanticBinding(
    "titan-mauler-weapon",
    "requires planned class-grant provenance and enforces every Titan Mauler boundary",
  ),
  semanticBinding("automatic-bonus-progression", "keeps GM judgments explicit and ABP limited to numerical guidance"),
  semanticBinding(
    "level-0-starting-money",
    "keeps official recipes alternative, level-1 equivalent, and independent of party size",
  ),
]);
const SEMANTIC_RULE_KEYS = Object.freeze(SEMANTIC_RULE_BINDINGS.map((entry) => entry.key));
const REQUIRED_FACT_IDS = Object.freeze([
  "policy-material-drift",
  "policy-irrelevant-drift",
  "economic-empty",
  "economic-foreign",
  "economic-partial",
  "economic-completed",
  "recipe-official-permanent",
  "recipe-official-lump-sum",
  "recipe-custom",
  "approval-request-and-approve",
  "approval-revoke-and-invalidate",
  "approval-non-gm-denial",
  "price-denominations",
  "price-explicit-zero",
  "price-quantities",
  "price-per",
  "equipment-sizes",
  "allowance-assignment",
  "planned-build-grants",
  "configured-equipment",
  "retain-all",
  "kit-containers",
  "source-isolation",
  "grant-formula-book",
  "grant-titan-mauler",
  "grant-dwarf-clan-dagger",
  "grant-sarangay-head-gem",
  "grant-dynamic-routes",
  "reload-after-item-n",
  "reload-before-currency",
  "reload-during-currency-convergence",
  "reload-before-final-state",
  "reload-after-final-state",
  "manifest-nonreplacement",
  "second-acquisition-rejection",
  "localization-en-cn-parity",
  "generated-wealth",
  "generated-scripts",
  "package-contract",
]);

const wealthRowsTest = testEvidence(
  "tests/wayfinder-character-wealth-policy.test.ts",
  "returns every reviewed remaster row exactly",
);
export const wf08050ReleaseContract = Object.freeze({
  version: 1,
  numericRows: Object.freeze(NUMERIC_LEVELS.map((characterLevel) => ({ characterLevel, evidence: wealthRowsTest }))),
  semanticRows: Object.freeze(
    SEMANTIC_RULE_BINDINGS.map((entry) => ({
      key: entry.key,
      evidence: testEvidence("tests/wayfinder-semantic-wealth-policy.test.ts", entry.title),
    })),
  ),
  facts: Object.freeze([
    fact(
      "policy-material-drift",
      testEvidence(
        "tests/wayfinder-equipment-policy.test.ts",
        "fingerprints canonical material and invalidates only selected source drift",
      ),
    ),
    fact(
      "policy-irrelevant-drift",
      testEvidence(
        "tests/wayfinder-economic-baseline.test.ts",
        "detects only material baseline changes and performs zero writes on drift",
      ),
    ),
    fact(
      "economic-empty",
      testEvidence("tests/wayfinder-economic-baseline.test.ts", "admits an empty level-1 actor without a start claim"),
    ),
    fact(
      "economic-foreign",
      testEvidence(
        "tests/wayfinder-economic-baseline.test.ts",
        "routes foreign physical items, currency, and unresolved grants to handoff",
      ),
    ),
    fact(
      "economic-partial",
      testEvidence(
        "tests/wayfinder-economic-baseline.test.ts",
        "recognizes only exact same-draft and same-batch partial outputs as retry",
      ),
    ),
    fact(
      "economic-completed",
      testEvidence(
        "tests/wayfinder-economic-baseline.test.ts",
        "blocks completed acquisition and prior character outcomes before emptiness can grant wealth",
      ),
    ),
    fact(
      "recipe-official-permanent",
      testEvidence("tests/wayfinder-equipment-policy.test.ts", "resolves every official higher-level wealth row exactly"),
      caseEvidence("tools/foundry-smoke/wave3-equipment-cases.mjs", "wave3EquipmentCases", "level-20-permanent-items"),
    ),
    fact(
      "recipe-official-lump-sum",
      testEvidence("tests/wayfinder-semantic-wealth-policy.test.ts", "enforces permanent residual and lump-sum level boundaries"),
      caseEvidence("tools/foundry-smoke/wave3-equipment-cases.mjs", "wave3EquipmentCases", "level-5-lump-sum"),
    ),
    fact(
      "recipe-custom",
      testEvidence(
        "tests/wayfinder-equipment-policy.test.ts",
        "uses trusted exact-fact GM judgments for custom sums and extra allowances",
      ),
      caseEvidence("tools/foundry-smoke/wave3-equipment-cases.mjs", "wave3EquipmentCases", "level-5-custom-lump-sum"),
    ),
    fact(
      "approval-request-and-approve",
      testEvidence(
        "tests/wayfinder-starting-equipment-command-service.test.ts",
        "approves exact current item facts and persists a dormant policy exception",
      ),
    ),
    fact(
      "approval-revoke-and-invalidate",
      testEvidence(
        "tests/wayfinder-starting-equipment-command-service.test.ts",
        "re-resolves policy after approval revocation and invalidates a reviewed purchase",
      ),
    ),
    fact(
      "approval-non-gm-denial",
      testEvidence(
        "tests/wayfinder-starting-equipment-command-service.test.ts",
        "keeps the draft unchanged when a non-GM revocation is denied",
      ),
    ),
    fact(
      "price-denominations",
      testEvidence(
        "tests/wayfinder-acquisition-ledger.test.ts",
        "normalizes mixed denominations and distinguishes explicit zero from missing Price",
      ),
    ),
    fact(
      "price-explicit-zero",
      testEvidence(
        "tests/wayfinder-semantic-wealth-policy.test.ts",
        "distinguishes explicit zero Price from missing, malformed, and quantity-aware pricing",
      ),
    ),
    fact(
      "price-quantities",
      testEvidence(
        "tests/wayfinder-starting-equipment-command-service.test.ts",
        "owns add, quantity, and remove transitions and invalidates prior review",
      ),
    ),
    fact(
      "price-per",
      testEvidence(
        "tests/wayfinder-acquisition-ledger.test.ts",
        "applies price.per to source and requested quantity using PF2E copper rounding",
      ),
    ),
    fact(
      "equipment-sizes",
      testEvidence(
        "tests/wayfinder-acquisition-ledger.test.ts",
        "applies size only to ordinary size-sensitive base prices",
      ),
      caseEvidence("tools/foundry-smoke/wave4-equipment-cases.mjs", "wave4EquipmentCases", "physical-prepared-boundaries"),
    ),
    fact(
      "allowance-assignment",
      testEvidence(
        "tests/wayfinder-acquisition-ledger.test.ts",
        "assigns allowances deterministically and charges only configuration supplements",
      ),
    ),
    fact(
      "planned-build-grants",
      testEvidence(
        "tests/wayfinder-acquisition-ledger.test.ts",
        "requires complete planned provenance for zero-cost class grants",
      ),
    ),
    fact(
      "configured-equipment",
      testEvidence(
        "tests/wayfinder-equipment-acquisition-runtime-service.test.ts",
        "prepares one non-specific configured weapon with exact PF2E component pricing",
      ),
      caseEvidence("tools/foundry-smoke/wave3-equipment-cases.mjs", "wave3EquipmentCases", "configured-item-exception"),
    ),
    fact(
      "retain-all",
      testEvidence("tests/wayfinder-acquisition-execution-service.test.ts", "retains the full budget without creating an item"),
      caseEvidence("tools/foundry-smoke/acquisition-cases.mjs", "acquisitionSmokeCases", "equipment-l1-owner-retain-all"),
    ),
    fact(
      "kit-containers",
      testEvidence(
        "tests/wayfinder-pf2e-kit-adapter.test.ts",
        "captures a random-ID-free exact Adventurer's Pack graph and treats Small as Medium",
      ),
      caseEvidence("tools/foundry-smoke/wave4-equipment-cases.mjs", "wave4EquipmentCases", "adventurers-pack-retry"),
    ),
    fact(
      "source-isolation",
      testEvidence(
        "tests/wayfinder-equipment-source-policy.test.ts",
        "honors explicit load false without inheriting role-dependent source visibility",
      ),
      caseEvidence("tools/foundry-smoke/wave4-equipment-cases.mjs", "wave4EquipmentCases", "supplemental-source-isolation"),
    ),
    fact(
      "grant-formula-book",
      testEvidence(
        "tests/wayfinder-class-grant-projection-service.test.ts",
        "projects the exact Alchemist native Formula Book chain from a prepared Coins shape",
      ),
    ),
    fact(
      "grant-titan-mauler",
      testEvidence(
        "tests/wayfinder-class-grant-projection-service.test.ts",
        "binds Giant Instinct to one reviewed eligible Titan Mauler weapon",
      ),
    ),
    fact(
      "grant-dwarf-clan-dagger",
      testEvidence(
        "tests/wayfinder-class-grant-projection-service.test.ts",
        "projects the deterministic Dwarf Clan Dagger native chain from a prepared Coins shape",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-dwarf-clan-dagger-native-retry",
      ),
    ),
    fact(
      "grant-sarangay-head-gem",
      testEvidence(
        "tests/wayfinder-class-grant-projection-service.test.ts",
        "projects the exact Sarangay Head Gem native chain from a prepared Coins shape",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-sarangay-head-gem-native-retry",
      ),
    ),
    fact(
      "grant-dynamic-routes",
      testEvidence(
        "tests/pf2e-grant-coverage-scanner.test.ts",
        "recursively discovers level-one static, choice-backed, and dynamic equipment routes",
      ),
    ),
    fact(
      "reload-after-item-n",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "reload-converges the persisted 'item-after-n' boundary without duplicate wealth",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-common-purchase-retry",
      ),
    ),
    fact(
      "reload-before-currency",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "reload-converges the persisted 'currency-before' boundary without duplicate wealth",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-common-purchase-currency-before-retry",
      ),
    ),
    fact(
      "reload-during-currency-convergence",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "captures exact convergence when PF2E mutates currency and then rejects",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-common-purchase-currency-after-retry",
      ),
    ),
    fact(
      "reload-before-final-state",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "reload-converges the persisted 'final-state-before' boundary without duplicate wealth",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-common-purchase-final-before-retry",
      ),
    ),
    fact(
      "reload-after-final-state",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "reload-converges the persisted 'final-state-after' boundary without duplicate wealth",
      ),
      caseEvidence(
        "tools/foundry-smoke/acquisition-cases.mjs",
        "acquisitionSmokeCases",
        "equipment-l1-owner-common-purchase-final-after-ack",
      ),
    ),
    fact(
      "manifest-nonreplacement",
      testEvidence(
        "tests/wayfinder-acquisition-execution-service.test.ts",
        "rejects a different completed manifest during recovery",
      ),
    ),
    fact(
      "second-acquisition-rejection",
      testEvidence(
        "tests/wayfinder-economic-baseline.test.ts",
        "blocks completed acquisition and prior character outcomes before emptiness can grant wealth",
      ),
    ),
    fact(
      "localization-en-cn-parity",
      testEvidence(
        "tests/wayfinder-acquisition-localization.test.ts",
        "keeps recursive English and Chinese key parity with nonempty values and matching placeholders",
      ),
    ),
    fact(
      "generated-wealth",
      testEvidence(
        "tests/wayfinder-character-wealth-generation.test.ts",
        "regenerates byte-for-byte and validates both semantic and artifact digests",
      ),
    ),
    fact(
      "generated-scripts",
      testEvidence(
        "tests/release-package-contract.test.ts",
        "detects missing and changed generated script output without mutating the checked-in tree",
      ),
      testEvidence(
        "tests/release-package-contract.test.ts",
        "binds generated wealth and scripts checks before the release build",
      ),
    ),
    fact(
      "package-contract",
      testEvidence("tests/release-package-contract.test.ts", "derives every shipped module, style, and locale from module.json"),
      testEvidence(
        "tests/release-package-contract.test.ts",
        "builds a normal release package without inspection-only qualification metadata",
      ),
    ),
  ]),
});

export async function validateWf08050ReleaseContract(contract = wf08050ReleaseContract, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const failures = [];
  validateExactMapping(
    contract?.numericRows?.map((entry) => entry?.characterLevel),
    NUMERIC_LEVELS,
    "numeric row",
    failures,
  );
  validateExactMapping(
    contract?.semanticRows?.map((entry) => entry?.key),
    SEMANTIC_RULE_KEYS,
    "semantic row",
    failures,
  );
  validateExactMapping(
    contract?.facts?.map((entry) => entry?.id),
    REQUIRED_FACT_IDS,
    "acceptance fact",
    failures,
  );

  await validateNumericSourceRows(repoRoot, contract?.numericRows ?? [], failures);
  await validateSemanticSourceRows(repoRoot, contract?.semanticRows ?? [], failures);
  throwContractFailures(failures);

  const mappings = [
    ...(contract?.numericRows ?? []).map((entry) => ({
      label: `numeric row ${String(entry?.characterLevel)}`,
      evidence: evidenceEntries(entry),
    })),
    ...(contract?.semanticRows ?? []).map((entry) => ({
      label: `semantic row ${String(entry?.key)}`,
      evidence: evidenceEntries(entry),
    })),
    ...(contract?.facts ?? []).map((entry) => ({
      label: `acceptance fact ${String(entry?.id)}`,
      evidence: evidenceEntries(entry),
    })),
  ];
  for (const mapping of mappings) {
    if (mapping.evidence.length === 0) {
      failures.push(`${mapping.label} requires executable evidence.`);
      continue;
    }
    const malformedEvidence = mapping.evidence.filter((entry) => !entry || typeof entry !== "object");
    if (malformedEvidence.length > 0) failures.push(`${mapping.label} contains malformed evidence.`);
    const duplicateEvidence = duplicates(
      mapping.evidence.filter((entry) => entry && typeof entry === "object").map(evidenceKey),
    );
    if (duplicateEvidence.length > 0) {
      failures.push(`${mapping.label} contains duplicate evidence: ${duplicateEvidence.join(", ")}.`);
    }
  }
  throwContractFailures(failures);

  const evidence = mappings.flatMap((mapping) => mapping.evidence);
  const caseExportCache = new Map();
  const caseMappingKeys = [];
  for (const entry of evidence) {
    if (entry.kind === "case") {
      caseMappingKeys.push(`${entry.file}:${entry.exportName}:${entry.id}`);
      await validateCaseEvidence(repoRoot, entry, caseExportCache, failures);
    } else if (entry.kind !== "test") {
      failures.push(`Unsupported WF-080-50 evidence kind: ${String(entry.kind)}.`);
    }
  }
  const duplicateCases = duplicates(caseMappingKeys);
  if (duplicateCases.length > 0) {
    failures.push(`Duplicate exported case mappings: ${duplicateCases.join(", ")}.`);
  }
  throwContractFailures(failures);

  const testEvidenceEntries = evidence.filter((entry) => entry.kind === "test");
  const collectedTests = await collectVitestTests(repoRoot, testEvidenceEntries, failures);
  for (const entry of testEvidenceEntries) validateTestEvidence(entry, collectedTests, failures);
  throwContractFailures(failures);

  const mappingDigest = `sha256:${createHash("sha256").update(JSON.stringify(contract)).digest("hex")}`;
  if (mappingDigest !== CONTRACT_MAPPING_DIGEST) {
    failures.push(`WF-080-50 executable mapping drifted; expected ${CONTRACT_MAPPING_DIGEST}, observed ${mappingDigest}.`);
  }
  throwContractFailures(failures);

  await runGeneratedArtifactChecks(repoRoot, failures);

  throwContractFailures(failures);
  return Object.freeze({
    numericRowCount: contract.numericRows.length,
    semanticRowCount: contract.semanticRows.length,
    factCount: contract.facts.length,
    evidenceCount: evidence.length,
  });
}

function fact(id, ...evidence) {
  return Object.freeze({ id, evidence: Object.freeze(evidence) });
}

function semanticBinding(key, title) {
  return Object.freeze({ key, title });
}

function testEvidence(file, title) {
  return Object.freeze({ kind: "test", file, title });
}

function caseEvidence(file, exportName, id) {
  return Object.freeze({ kind: "case", file, exportName, id });
}

function evidenceEntries(mapping) {
  if (Array.isArray(mapping?.evidence)) return mapping.evidence;
  return mapping?.evidence === undefined || mapping?.evidence === null ? [] : [mapping.evidence];
}

function evidenceKey(evidence) {
  if (evidence.kind === "test") return `test:${evidence.file}:${evidence.title}`;
  if (evidence.kind === "case") return `case:${evidence.file}:${evidence.exportName}:${evidence.id}`;
  return `unsupported:${String(evidence.kind)}`;
}

function validateExactMapping(observed, expected, label, failures) {
  if (!Array.isArray(observed)) {
    failures.push(`WF-080-50 ${label} mapping is missing.`);
    return;
  }
  const duplicateValues = duplicates(observed);
  if (duplicateValues.length > 0) failures.push(`Duplicate ${label} mappings: ${duplicateValues.join(", ")}.`);
  const observedSet = new Set(observed);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !observedSet.has(value));
  const unexpected = observed.filter((value) => !expectedSet.has(value));
  if (missing.length > 0 || unexpected.length > 0) {
    failures.push(
      `${label} coverage mismatch; missing=${missing.join(",") || "none"}, unexpected=${unexpected.join(",") || "none"}.`,
    );
  }
}

async function validateNumericSourceRows(repoRoot, mappings, failures) {
  try {
    const fixture = JSON.parse(
      await readFile(
        path.join(repoRoot, "tools/starting-equipment/fixtures/pf2e-8.4.0-character-wealth-policy.json"),
        "utf8",
      ),
    );
    validateExactMapping(
      fixture?.rows?.map((row) => row?.characterLevel),
      mappings.map((entry) => entry?.characterLevel),
      "generated wealth source row",
      failures,
    );
  } catch (error) {
    failures.push(`Cannot read generated wealth source rows: ${errorMessage(error)}.`);
  }
}

async function validateSemanticSourceRows(repoRoot, mappings, failures) {
  try {
    const sourcePath = path.join(repoRoot, "src/wayfinder/domain/semantic-wealth-rule-ledger.ts");
    const sourceText = await readFile(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const keys = [];
    walk(sourceFile, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "entry" &&
        isStaticText(node.arguments[0])
      ) {
        keys.push(node.arguments[0].text);
      }
    });
    validateExactMapping(keys, mappings.map((entry) => entry?.key), "semantic source row", failures);

    const runtimeModule = await import(
      pathToFileURL(path.join(repoRoot, "scripts/wayfinder/domain/semantic-wealth-rule-ledger.js")).href
    );
    const runtimeRules = runtimeModule.SEMANTIC_WEALTH_RULES;
    validateSemanticRuleRows(runtimeRules, mappings.map((entry) => entry?.key), failures);
  } catch (error) {
    failures.push(`Cannot read semantic wealth source rows: ${errorMessage(error)}.`);
  }
}

export function assertWf08050SemanticRuleRows(rules) {
  const failures = [];
  validateSemanticRuleRows(rules, SEMANTIC_RULE_KEYS, failures);
  throwContractFailures(failures);
}

function validateSemanticRuleRows(rules, expectedKeys, failures) {
  if (!Array.isArray(rules)) {
    failures.push("Compiled semantic wealth rules are unavailable.");
    return;
  }
  validateExactMapping(
    rules.map((entry) => entry?.key),
    expectedKeys,
    "compiled semantic row",
    failures,
  );
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(rules)).digest("hex")}`;
  if (digest !== SEMANTIC_RULES_DIGEST) {
    failures.push(`Semantic wealth rows drifted; expected ${SEMANTIC_RULES_DIGEST}, observed ${digest}.`);
  }
}

async function collectVitestTests(repoRoot, evidenceEntriesToCollect, failures) {
  const files = [...new Set(evidenceEntriesToCollect.map((entry) => entry.file))];
  const existingFiles = [];
  const failureCountBeforeAccess = failures.length;
  for (const file of files) {
    if (!nonEmpty(file)) {
      failures.push("Test evidence requires an exact suite file.");
      continue;
    }
    try {
      await access(path.join(repoRoot, file));
      existingFiles.push(file);
    } catch (error) {
      failures.push(`Cannot read test suite ${file}: ${errorMessage(error)}.`);
    }
  }
  if (failures.length > failureCountBeforeAccess) return [];
  if (existingFiles.length === 0) return [];

  try {
    const vitestPath = path.join(repoRoot, "node_modules/vitest/vitest.mjs");
    const output = execFileSync(process.execPath, [vitestPath, "list", ...existingFiles], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    failures.push(`Cannot collect executable Vitest suites: ${errorMessage(error)}.`);
    return [];
  }
}

function validateTestEvidence(evidence, collectedTests, failures) {
  if (!nonEmpty(evidence.file) || !nonEmpty(evidence.title)) {
    failures.push("Test evidence requires a file and exact title.");
    return;
  }
  const filePrefix = `${evidence.file.replaceAll("\\", "/")} > `;
  const titleSuffix = ` > ${evidence.title}`;
  if (!collectedTests.some((line) => line.startsWith(filePrefix) && line.endsWith(titleSuffix))) {
    failures.push(`Missing test title ${evidence.file} > ${evidence.title}.`);
  }
}

async function validateCaseEvidence(repoRoot, evidence, cache, failures) {
  if (!nonEmpty(evidence.file) || !nonEmpty(evidence.exportName) || !nonEmpty(evidence.id)) {
    failures.push("Case evidence requires a file, export name, and exact case id.");
    return;
  }
  const exportKey = `${evidence.file}:${evidence.exportName}`;
  let ids = cache.get(exportKey);
  if (!ids) {
    try {
      const module = await import(pathToFileURL(path.join(repoRoot, evidence.file)).href);
      const cases = module[evidence.exportName];
      if (!Array.isArray(cases)) throw new TypeError(`${evidence.exportName} is not an exported case array`);
      const exportedIds = cases.map((entry) => entry?.id);
      const duplicateIds = duplicates(exportedIds);
      if (duplicateIds.length > 0) {
        failures.push(`Duplicate ids in ${exportKey}: ${duplicateIds.join(", ")}.`);
      }
      ids = new Set(exportedIds);
      cache.set(exportKey, ids);
    } catch (error) {
      failures.push(`Cannot load exported case suite ${exportKey}: ${errorMessage(error)}.`);
      return;
    }
  }
  if (!ids.has(evidence.id)) failures.push(`Missing exported case id ${exportKey}:${evidence.id}.`);
}

async function runGeneratedArtifactChecks(repoRoot, failures) {
  const signal = AbortSignal.timeout(GENERATED_ARTIFACT_CHECK_TIMEOUT_MS);
  const checks = [
    {
      label: "generated Character Wealth",
      run: () =>
        execFileAsync(
          process.execPath,
          [path.join(repoRoot, "tools/starting-equipment/generate-character-wealth.mjs"), "--check"],
          {
            cwd: repoRoot,
            encoding: "utf8",
            signal,
          },
        ),
    },
    {
      label: "generated scripts",
      run: () => assertGeneratedScriptsCurrent({ repoRoot, signal }),
    },
  ];
  failures.push(...(await collectWf08050GeneratedArtifactFailures(checks)));
}

export async function collectWf08050GeneratedArtifactFailures(checks) {
  const results = await Promise.all(
    checks.map(async ({ label, run }) => {
      try {
        await run();
        return null;
      } catch (error) {
        return `${label} check failed: ${errorMessage(error)}.`;
      }
    }),
  );
  return results.filter(Boolean);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function isStaticText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].map(String).sort();
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function throwContractFailures(failures) {
  if (failures.length > 0) {
    throw new Error(`WF-080-50 release contract failed:\n- ${failures.join("\n- ")}`);
  }
}

async function main() {
  const result = await validateWf08050ReleaseContract();
  process.stdout.write(
    `WF-080-50 release contract is current: ${result.numericRowCount} numeric rows, ${result.semanticRowCount} semantic rows, ${result.factCount} facts, ${result.evidenceCount} evidence bindings.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
