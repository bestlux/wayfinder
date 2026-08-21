import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createWf51ReleaseOverlayArtifactDirectory(repoRoot, override, evidenceId) {
  const directory = override
    ? path.resolve(override)
    : path.join(repoRoot, ".wayfinder-smoke", `wf51-release-overlay-${evidenceId}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeWf51ReleaseOverlayArtifacts(directory, result, qualification) {
  const resultBytes = `${JSON.stringify({ ...result, qualification }, null, 2)}\n`;
  const summary = summaryMarkdown(result, qualification);
  const completion = {
    schemaVersion: 1,
    evidenceId: result.evidenceId,
    qualified: qualification.ok,
    candidateSha: result.candidate?.gitSha ?? null,
    servedScriptManifestSha256: result.candidate?.servedScriptManifestSha256 ?? null,
    resultSha256: sha256(resultBytes),
    summarySha256: sha256(summary),
  };
  await writeFile(path.join(directory, ".wf51-release-overlay.lock"), `${result.evidenceId}\n`, { flag: "wx" });
  const files = [
    ["wf51-release-overlay-results.json", resultBytes],
    ["wf51-release-overlay-summary.md", summary],
    ["wf51-release-overlay-completion.json", `${JSON.stringify(completion, null, 2)}\n`],
  ];
  for (const [name, contents] of files) {
    const temporary = path.join(directory, `.${name}.tmp`);
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path.join(directory, name));
  }
  return completion;
}

function summaryMarkdown(result, qualification) {
  const lines = [
    "# WF-080-51 focused live release overlay",
    "",
    `- Result: ${qualification.ok ? "PASS" : "FAIL"}`,
    `- Status: ${result.status}`,
    `- Stage: ${result.stage ?? "unknown"}`,
    `- Candidate: ${result.candidate?.gitSha ?? "unavailable"}`,
    `- Served scripts: ${result.candidate?.servedScriptManifestSha256 ?? "unavailable"}`,
    `- Foundry: ${result.runtime?.foundryVersion ?? "unavailable"}`,
    `- PF2E: ${result.runtime?.pf2eVersion ?? "unavailable"}`,
    `- World: ${result.runtime?.worldId ?? "unavailable"}`,
    "",
    "## Focused cases",
    "",
    ...(result.cases ?? []).map((entry) => `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}`),
    "",
    "## Fifteen-row aggregate",
    "",
    ...(result.overlay ?? []).map(
      (entry) => `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.number}. ${entry.id}`,
    ),
  ];
  if (result.error) lines.push("", "## Run error", "", `- ${result.error.name}: ${result.error.message}`);
  if (qualification.failures.length > 0) {
    lines.push("", "## Qualification failures", "", ...qualification.failures.map((failure) => `- ${failure}`));
  }
  return `${lines.join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
