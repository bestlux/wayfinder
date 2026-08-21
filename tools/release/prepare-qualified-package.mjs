#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertGeneratedScriptsCurrent } from "./check-generated-scripts.mjs";
import {
  bindGeneratedScripts,
  bindPackageOutput,
  bindPolicyArtifacts,
  bindWf51Evidence,
  captureExactCandidate,
  qualifiedEvidenceDocument,
} from "./qualified-package-evidence.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(usage());
  if (!options.wf51) throw new Error("Qualified packaging requires --wf51 <coordinator-artifact-directory>.");
  if (!options.ref) throw new Error("Qualified packaging requires --ref <exact-candidate-ref>.");

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const moduleJson = JSON.parse(await readFile(path.join(repoRoot, "module.json"), "utf8"));
  const version = options.version || packageJson.version;
  const tag = options.tag || `v${version}`;
  const originRepository = deriveRepository(await gitOutput(["remote", "get-url", "origin"]));
  if (options.repo && options.repo !== originRepository) {
    throw new Error(`Qualified package repository must match origin exactly: ${originRepository}.`);
  }
  const repository = originRepository;
  const outputRoot = options.out || "dist/qualified-release";
  if (packageJson.version !== moduleJson.version || version !== packageJson.version) {
    throw new Error("Qualified package version must match package.json and module.json exactly.");
  }

  const candidate = await captureExactCandidate({ repoRoot, ref: options.ref });
  await assertGeneratedScriptsCurrent({ repoRoot });
  await execFileAsync(
    process.execPath,
    [path.join(repoRoot, "tools/starting-equipment/generate-character-wealth.mjs"), "--check"],
    { cwd: repoRoot },
  );
  const [wf51, policies, generatedScripts] = await Promise.all([
    bindWf51Evidence({ repoRoot, artifactRoot: options.wf51, expectedGitSha: candidate.gitSha }),
    bindPolicyArtifacts(repoRoot),
    bindGeneratedScripts(repoRoot),
  ]);

  await execFileAsync(
    process.execPath,
    [
      path.join(repoRoot, "tools/release/prepare-package.mjs"),
      "--version",
      version,
      "--tag",
      tag,
      "--repo",
      repository,
      "--out",
      outputRoot,
    ],
    { cwd: repoRoot },
  );
  const afterPackage = await captureExactCandidate({ repoRoot, ref: options.ref });
  if (JSON.stringify(afterPackage) !== JSON.stringify(candidate)) {
    throw new Error("Exact candidate or ref identity changed during qualified packaging.");
  }
  const packageEvidence = await bindPackageOutput({
    repoRoot,
    outputRoot,
    repo: repository,
    tag,
    version,
    candidateGitSha: candidate.gitSha,
  });
  const evidence = qualifiedEvidenceDocument({ candidate, wf51, policies, generatedScripts, packageEvidence });
  const evidencePath = path.resolve(repoRoot, outputRoot, "package-evidence.json");
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  await captureExactCandidate({ repoRoot, ref: options.ref });
  console.log(`Created ${path.relative(repoRoot, evidencePath)} (candidate ${candidate.gitSha})`);
}

function parseArgs(argv) {
  const options = { help: false, out: "", ref: "", repo: "", tag: "", version: "", wf51: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") options.help = true;
    else if (["--out", "--ref", "--repo", "--tag", "--version", "--wf51"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function deriveRepository(remote) {
  const match = /github\.com[/:](?<repo>[^\s]+?)(?:\.git)?$/u.exec(remote.trim());
  if (!match?.groups?.repo) throw new Error("Could not derive GitHub owner/repo; pass --repo <owner/repo>.");
  return match.groups.repo.replace(/\.git$/u, "");
}

async function gitOutput(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot });
  return stdout.trim();
}

function usage() {
  return `Usage: node tools/release/prepare-qualified-package.mjs --wf51 <artifact-dir> --ref <ref> [options]

Builds the ordinary release package and writes fail-closed WF-080-52 package-evidence.json for one clean exact candidate.

Options:
  --wf51 <path>      Fresh qualified WF-080-51 coordinator artifact directory (required).
  --ref <ref>        Existing git ref that resolves exactly to HEAD (required).
  --version <x.y.z>  Exact package/module version. Defaults to package.json.
  --tag <tag>        Intended release tag. Defaults to v<version>.
  --repo <owner/repo> GitHub repository. Defaults to origin.
  --out <path>       Output under dist/. Defaults to dist/qualified-release.
  --help             Show this help text.
`;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
