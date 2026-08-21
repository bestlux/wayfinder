import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createWf43ExperienceArtifactDirectory(repoRoot, override, evidenceId) {
  const directory = override
    ? path.resolve(override)
    : path.join(repoRoot, ".wayfinder-smoke", `wf43-experience-${evidenceId}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeWf43ExperienceArtifacts(directory, result, qualification) {
  await writeFile(path.join(directory, "wf43-experience-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# WF-080-43 live experience qualifier",
    "",
    `- Result: ${qualification.ok ? "PASS" : "FAIL"}`,
    `- Foundry: ${result.runtime.foundryVersion}`,
    `- PF2E: ${result.runtime.pf2eVersion}`,
    `- Module: ${result.runtime.moduleVersion}`,
    `- World: ${result.runtime.worldId}`,
    `- Viewport: ${result.viewport.width}x${result.viewport.height}`,
    `- App widths: ${result.appWidths.join(", ")}`,
    `- GM: ${result.users.gm.name} (${result.users.gm.id})`,
    `- Player: ${result.users.player.name} (${result.users.player.id})`,
    "",
    "## Locales",
    "",
    ...result.locales.map(
      (entry) =>
        `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${entry.states.length} states, ${entry.states.reduce((sum, state) => sum + state.widths.length, 0)} width samples`,
    ),
    "",
    "## Cleanup",
    "",
    `- Exact actors deleted: ${result.cleanup.actorsDeleted}`,
    `- Actor count restored: ${result.cleanup.actorCountRestored}`,
    `- Equipment policy restored: ${result.cleanup.policyRestored}`,
    `- PF2E pack setting restored: ${result.cleanup.packsRestored}`,
    `- Language restored: ${result.cleanup.languageRestored}`,
  ];
  if (qualification.failures.length > 0) {
    lines.push("", "## Failures", "", ...qualification.failures.map((failure) => `- ${failure}`));
  }
  await writeFile(path.join(directory, "wf43-experience-summary.md"), `${lines.join("\n")}\n`);
}
