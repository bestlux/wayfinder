import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createWave3EquipmentArtifactDirectory(repoRoot, override, evidenceId) {
  const directory = override
    ? path.resolve(override)
    : path.join(repoRoot, "artifacts", "foundry-smoke", `wave3-equipment-${evidenceId}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeWave3EquipmentArtifacts(directory, result, qualification) {
  await writeFile(path.join(directory, "wave3-equipment-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Wave 3 equipment live gate",
    "",
    `- Result: ${qualification.ok ? "PASS" : "FAIL"}`,
    `- Foundry: ${result.runtime.foundryVersion}`,
    `- PF2E: ${result.runtime.pf2eVersion}`,
    `- Module: ${result.runtime.moduleVersion}`,
    `- World: ${result.runtime.worldId}`,
    `- GM: ${result.users.gm.name} (${result.users.gm.id})`,
    `- Player: ${result.users.player.name} (${result.users.player.id})`,
    `- Zero-write authority denial: ${result.zeroWrite.unchanged ? "proved" : "failed"}`,
    "",
    "## Cases",
    "",
    ...result.cases.map((entry) => `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}`),
  ];
  if (qualification.failures.length > 0) {
    lines.push("", "## Failures", "", ...qualification.failures.map((failure) => `- ${failure}`));
  }
  await writeFile(path.join(directory, "wave3-equipment-summary.md"), `${lines.join("\n")}\n`);
}
