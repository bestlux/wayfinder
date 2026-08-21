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
  const runtime = result.runtime ?? {};
  const users = result.users ?? {};
  const cleanup = result.cleanup ?? {};
  const locales = result.locales ?? [];
  const lines = [
    "# WF-080-43 live experience qualifier",
    "",
    `- Result: ${qualification.ok ? "PASS" : "FAIL"}`,
    `- Stage: ${formatStage(result.stage)}`,
    `- Completed samples: ${result.samples?.length ?? 0}`,
    `- Keyboard entry diagnostics: ${result.keyboardEntries?.length ?? 0}`,
    `- Forced-failure focus diagnostics: ${result.failureFocusEntries?.length ?? 0}`,
    `- Tab traversal failure diagnostics: ${result.tabTraversalFailures?.length ?? 0}`,
    `- Per-client language switch diagnostics: ${result.languageSwitches?.length ?? 0}`,
    `- Foundry: ${runtime.foundryVersion ?? "unavailable"}`,
    `- PF2E: ${runtime.pf2eVersion ?? "unavailable"}`,
    `- Module: ${runtime.moduleVersion ?? "unavailable"}`,
    `- World: ${runtime.worldId ?? "unavailable"}`,
    `- Viewport: ${result.viewport.width}x${result.viewport.height}`,
    `- App widths: ${result.appWidths.join(", ")}`,
    `- GM: ${formatUser(users.gm)}`,
    `- Player: ${formatUser(users.player)}`,
    "",
    "## Locales",
    "",
    ...(locales.length > 0 ? locales : [{ id: "none", status: "fail", states: [] }]).map(
      (entry) =>
        `- ${entry.status === "pass" ? "PASS" : "FAIL"} ${entry.id}: ${entry.states.length} states, ${entry.states.reduce((sum, state) => sum + state.widths.length, 0)} width samples`,
    ),
    "",
    "## Cleanup",
    "",
    `- Cleanup attempted: ${cleanup.attempted ?? false}`,
    `- Setup completed: ${cleanup.setupCompleted ?? false}`,
    `- Exact actors deleted: ${cleanup.actorsDeleted ?? 0}`,
    `- Actor count restored: ${cleanup.actorCountRestored ?? false}`,
    `- Equipment policy restored: ${cleanup.policyRestored ?? false}`,
    `- PF2E pack setting restored: ${cleanup.packsRestored ?? false}`,
    `- Language restored: ${cleanup.languageRestored ?? false}`,
  ];
  if (result.error) {
    lines.push("", "## Run error", "", `- ${result.error.name}: ${result.error.message}`);
  }
  if (cleanup.restorationFailures?.length > 0) {
    lines.push("", "## Restoration failures", "", ...cleanup.restorationFailures.map((failure) => `- ${failure}`));
  }
  if (qualification.failures.length > 0) {
    lines.push("", "## Failures", "", ...qualification.failures.map((failure) => `- ${failure}`));
  }
  await writeFile(path.join(directory, "wf43-experience-summary.md"), `${lines.join("\n")}\n`);
}

function formatStage(stage) {
  if (!stage) return "unknown";
  return [stage.id, stage.locale, stage.state, stage.width, stage.action].filter((value) => value !== undefined).join("/");
}

function formatUser(user) {
  return user ? `${user.name} (${user.id})` : "unavailable";
}
