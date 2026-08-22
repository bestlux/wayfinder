import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const skillSelectionPolicyPath = path.join(repoRoot, "tools", "foundry-smoke", "skill-selection-policy.js");
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");

export async function loadWayfinderBrowserSuite(
  page,
  { beforeSuitePaths = [], afterSuitePaths = [] } = {},
) {
  for (const scriptPath of beforeSuitePaths) await page.addScriptTag({ path: scriptPath });
  await page.addScriptTag({ path: skillSelectionPolicyPath });
  await page.addScriptTag({ path: browserSuitePath });
  for (const scriptPath of afterSuitePaths) await page.addScriptTag({ path: scriptPath });
}

export async function reloadWayfinderBrowserSuite(
  page,
  { beforeSuitePaths = [], afterSuitePaths = [], initScriptPaths = [] } = {},
) {
  for (const scriptPath of initScriptPaths) await page.addInitScript({ path: scriptPath });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForFoundryReady(page);
  await loadWayfinderBrowserSuite(page, { beforeSuitePaths, afterSuitePaths });
}

export async function waitForFoundryReady(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, {
    timeout: 60_000,
  });
}
