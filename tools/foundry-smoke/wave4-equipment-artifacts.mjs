import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createWave4EquipmentArtifactDirectory(repoRoot, override, evidenceId) {
  const directory = override ? path.resolve(override) : path.join(repoRoot, ".wayfinder-smoke", `wave4-equipment-${evidenceId}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeWave4EquipmentArtifacts(directory, result, qualification) {
  await writeFile(path.join(directory, "wave4-equipment-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Wave 4 equipment live gate",
    "",
    `- Result: ${qualification.ok ? "PASS" : "FAIL"}`,
    `- Foundry: ${result.runtime.foundryVersion}`,
    `- PF2E: ${result.runtime.pf2eVersion}`,
    `- Module: ${result.runtime.moduleVersion}`,
    `- World: ${result.runtime.worldId}`,
    `- GM: ${result.users.gm.name} (${result.users.gm.id})`,
    `- Player: ${result.users.player.name} (${result.users.player.id})`,
    `- Non-GM settings denial: ${result.zeroWrite.unchanged ? "zero-write" : "changed state"}`,
    "",
    "## Cases",
    "",
    ...result.cases.map((entry) => `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}`),
  ];
  if (qualification.failures.length > 0) lines.push("", "## Failures", "", ...qualification.failures.map((failure) => `- ${failure}`));
  await writeFile(path.join(directory, "wave4-equipment-summary.md"), `${lines.join("\n")}\n`);
}
