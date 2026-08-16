import {
  characterWealthDataSha256,
  digest,
  extractCharacterWealthJournal,
} from "../starting-equipment/character-wealth-extractor.mjs";
import { assertGeneratedCharacterWealthIntegrity } from "../starting-equipment/generate-character-wealth.mjs";

export function compareCharacterWealthCompatibility(installedJournal, expectedPolicy) {
  assertGeneratedCharacterWealthIntegrity(expectedPolicy);
  const base = {
    expectedArtifactDigest: expectedPolicy.artifactDigest,
    expectedDataDigest: expectedPolicy.dataDigest,
  };
  if (installedJournal === null || installedJournal === undefined) {
    return {
      status: "unavailable",
      differenceKind: null,
      ...base,
      installedSourceDigest: null,
      installedTableDigest: null,
      installedDataDigest: null,
      diagnostics: ["The installed PF2E GM Screen journal was unavailable."],
    };
  }

  let installed;
  try {
    installed = extractCharacterWealthJournal(installedJournal);
  } catch (error) {
    return {
      status: "diff",
      differenceKind: "structural",
      ...base,
      installedSourceDigest: null,
      installedTableDigest: null,
      installedDataDigest: null,
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }

  const installedDataDigest = digest(characterWealthDataSha256(installed.rows));
  const installedSourceDigest = digest(installed.sourceContentSha256);
  const installedTableDigest = digest(installed.tableContentSha256);
  if (installedDataDigest === expectedPolicy.dataDigest) {
    return {
      status: "match",
      differenceKind: null,
      ...base,
      installedSourceDigest,
      installedTableDigest,
      installedDataDigest,
      diagnostics: [],
    };
  }

  return {
    status: "diff",
    differenceKind: "semantic",
    ...base,
    installedSourceDigest,
    installedTableDigest,
    installedDataDigest,
    diagnostics: describeSemanticDifferences(installed.rows, expectedPolicy.rows),
  };
}

function describeSemanticDifferences(installedRows, expectedRows) {
  const diagnostics = [];
  for (let level = 1; level <= 20; level += 1) {
    const installed = installedRows[level - 1];
    const expected = expectedRows[level - 1];
    if (JSON.stringify(installed) !== JSON.stringify(expected)) {
      diagnostics.push(`Installed Character Wealth level ${level} differs from the generated policy.`);
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push("Installed Character Wealth semantics differ from the generated policy.");
  }
  return diagnostics;
}
