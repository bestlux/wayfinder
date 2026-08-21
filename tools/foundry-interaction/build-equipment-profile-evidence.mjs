#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qualifyEquipmentEvidenceRuns } from "./equipment-profile-results.mjs";

async function main() {
  const [firstPath, secondPath, outputPath] = process.argv.slice(2);
  if (!firstPath || !secondPath || !outputPath || process.argv.length !== 5) {
    throw new Error("Usage: npm run profile:equipment:evidence -- <run-1.json> <run-2.json> <output.json>");
  }
  const { resolvedOutput } = resolveEvidencePaths(firstPath, secondPath, outputPath);
  const sourceArtifacts = await Promise.all(
    [firstPath, secondPath].map(async (filePath) => {
      const resolved = path.resolve(filePath);
      const body = await readFile(resolved);
      return { path: resolved, body, sha256: createHash("sha256").update(body).digest("hex") };
    }),
  );
  const results = sourceArtifacts.map((artifact) => JSON.parse(artifact.body.toString("utf8")));
  const qualified = qualifyEquipmentEvidenceRuns(results);
  if (!qualified.ok) throw new Error(qualified.failures.join(" "));
  qualified.evidence.sourceArtifacts = sourceArtifacts.map(({ path: artifactPath, sha256 }) => ({
    path: artifactPath,
    sha256,
  }));
  await writeFile(resolvedOutput, `${JSON.stringify(qualified.evidence, null, 2)}\n`);
  console.log(`Equipment profile evidence: ${resolvedOutput}`);
}

export function resolveEvidencePaths(firstPath, secondPath, outputPath) {
  const resolvedFirst = path.resolve(firstPath);
  const resolvedSecond = path.resolve(secondPath);
  const resolvedOutput = path.resolve(outputPath);
  if (resolvedFirst === resolvedSecond) throw new Error("Equipment evidence requires two distinct result artifact paths.");
  if (resolvedOutput === resolvedFirst || resolvedOutput === resolvedSecond) {
    throw new Error("Equipment evidence output must not overwrite either source artifact.");
  }
  return { resolvedFirst, resolvedSecond, resolvedOutput };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
