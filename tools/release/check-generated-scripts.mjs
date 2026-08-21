#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export async function assertGeneratedScriptsCurrent({ repoRoot = defaultRepoRoot, signal } = {}) {
  const generatedRoot = path.join(repoRoot, "dist");
  await mkdir(generatedRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(generatedRoot, "generated-scripts-check-"));
  const candidateRoot = path.join(temporaryRoot, "scripts");

  try {
    const compilerPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
    await execFileAsync(
      process.execPath,
      [compilerPath, "-p", path.join(repoRoot, "tsconfig.json"), "--outDir", candidateRoot, "--pretty", "false"],
      { cwd: repoRoot, signal },
    );

    const differences = await compareGeneratedScriptDirectories({
      checkedInRoot: path.join(repoRoot, "scripts"),
      candidateRoot,
      repoRoot,
    });
    if (differences.length > 0) {
      const shown = differences.slice(0, 20).map((difference) => `- ${difference}`).join("\n");
      const remainder = differences.length > 20 ? `\n- ...and ${differences.length - 20} more` : "";
      throw new Error(
        `Generated scripts are stale. Run npm run build and commit the resulting scripts/ changes.\n${shown}${remainder}`,
      );
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

export async function compareGeneratedScriptDirectories({ checkedInRoot, candidateRoot, repoRoot }) {
  const checkedInFiles = await listGeneratedFiles(checkedInRoot);
  const candidateFiles = await listGeneratedFiles(candidateRoot);
  const checkedInSet = new Set(checkedInFiles);
  const candidateSet = new Set(candidateFiles);
  const differences = [];

  for (const relativePath of checkedInFiles) {
    if (!candidateSet.has(relativePath)) differences.push(`unexpected checked-in output ${relativePath}`);
  }
  for (const relativePath of candidateFiles) {
    if (!checkedInSet.has(relativePath)) differences.push(`missing checked-in output ${relativePath}`);
  }
  for (const relativePath of checkedInFiles.filter((entry) => candidateSet.has(entry))) {
    const checkedInPath = path.join(checkedInRoot, relativePath);
    const candidatePath = path.join(candidateRoot, relativePath);
    const [checkedIn, candidate] = await Promise.all([
      comparableGeneratedFile(checkedInPath, repoRoot),
      comparableGeneratedFile(candidatePath, repoRoot),
    ]);
    if (checkedIn !== candidate) differences.push(`changed output ${relativePath}`);
  }

  return differences.sort((left, right) => left.localeCompare(right));
}

async function listGeneratedFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listGeneratedFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath).replaceAll(path.sep, "/"));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function comparableGeneratedFile(filePath, repoRoot) {
  const content = await readFile(filePath, "utf8");
  if (!filePath.endsWith(".map")) return content;

  const sourceMap = JSON.parse(content);
  if (!Array.isArray(sourceMap.sources)) return content;
  return JSON.stringify({
    ...sourceMap,
    sources: sourceMap.sources.map((source) =>
      path.relative(repoRoot, path.resolve(path.dirname(filePath), source)).replaceAll(path.sep, "/"),
    ),
  });
}

async function main() {
  await assertGeneratedScriptsCurrent();
  console.log("Generated scripts are current.");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
