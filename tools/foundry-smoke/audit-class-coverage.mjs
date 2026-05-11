#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { auditClassCoverage } from "./class-coverage-core.mjs";
import { smokeCases } from "./class-cases.mjs";

const defaultPf2eRoot = "D:/Source/pf2e/packs/pf2e";

function usage() {
  return `Usage: node tools/foundry-smoke/audit-class-coverage.mjs [options]

Options:
  --pf2e-root <path>  PF2E pack root containing classes/. Defaults to PF2E_PACK_ROOT or ${defaultPf2eRoot}.
  --help             Show this help text.
`;
}

function parseArgs(argv) {
  const options = {
    help: false,
    pf2eRoot: process.env.PF2E_PACK_ROOT ?? defaultPf2eRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--pf2e-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --pf2e-root");
      }
      options.pf2eRoot = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const classDir = path.join(options.pf2eRoot, "classes");
  if (!existsSync(classDir)) {
    throw new Error(`PF2E class pack directory was not found: ${classDir}`);
  }

  const result = auditClassCoverage({
    pf2eRoot: options.pf2eRoot,
    smokeCases,
  });

  console.log(`PF2E classes audited: ${result.classRows.length}`);
  console.log(`Smoke cases covered: ${result.coveredClassSlugs.length}`);

  if (result.missingClassSlugs.length > 0) {
    console.error(`Missing smoke cases: ${result.missingClassSlugs.join(", ")}`);
  }
  if (result.spellcastingCasesMissingSpellSteps.length > 0) {
    console.error(`Spellcasting cases missing spell steps: ${result.spellcastingCasesMissingSpellSteps.join(", ")}`);
  }

  if (result.missingClassSlugs.length > 0 || result.spellcastingCasesMissingSpellSteps.length > 0) {
    process.exitCode = 1;
  }
}

main();
