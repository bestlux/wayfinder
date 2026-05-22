#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function usage() {
  return [
    "Usage: node tools/release/extract-release-notes.mjs --version <version> --out <path>",
    "",
    "Options:",
    "  --version <version>  Release version to extract from CHANGELOG.md.",
    "  --out <path>         Output markdown path.",
    "  --help               Show this help text.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    out: "",
    version: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (!["--out", "--version"].includes(arg)) {
      throw new Error("Unknown argument: " + arg);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for " + arg);
    }

    if (arg === "--out") options.out = value;
    if (arg === "--version") options.version = value;
    index += 1;
  }

  return options;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function extractReleaseNotes(changelog, version) {
  const headingPattern = new RegExp("^##\\s+(?:\\[?v?" + escapeRegExp(version) + "\\]?)(?:\\s+-\\s+.*)?$", "imu");
  const headingMatch = headingPattern.exec(changelog);

  if (!headingMatch) {
    throw new Error("CHANGELOG.md is missing a section for version " + version + ".");
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const remaining = changelog.slice(sectionStart);
  const nextHeadingMatch = /^##\s+/imu.exec(remaining);
  const section = remaining.slice(0, nextHeadingMatch?.index ?? remaining.length).trim();

  if (!section) {
    throw new Error("CHANGELOG.md section for version " + version + " is empty.");
  }

  return "## Wayfinder " + version + "\n\n" + section + "\n";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  if (!options.version) throw new Error("--version is required.");
  if (!options.out) throw new Error("--out is required.");

  const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const notes = extractReleaseNotes(changelog, options.version);
  const outputPath = path.resolve(repoRoot, options.out);
  const relative = path.relative(repoRoot, outputPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Output path must be inside the repository: " + options.out);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, notes);
  console.log("Created " + relative.replaceAll(path.sep, "/"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
