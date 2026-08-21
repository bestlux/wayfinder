import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const skillSelectionPolicyPath = path.join(repoRoot, "tools", "foundry-smoke", "skill-selection-policy.js");
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");

export async function loadAcquisitionBrowserSuite(page) {
  await page.addScriptTag({ path: skillSelectionPolicyPath });
  await page.addScriptTag({ path: browserSuitePath });
}

export async function reloadAcquisitionBrowserSuite(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForFoundryReady(page);
  await loadAcquisitionBrowserSuite(page);
}

export async function createAcquisitionDurabilityPage(context, foundryUrl) {
  const page = await context.newPage();
  try {
    await page.goto(foundryUrl, { waitUntil: "domcontentloaded" });
    await waitForFoundryReady(page);
    await reloadAcquisitionBrowserSuite(page);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

export async function cleanupAcquisitionFixtures(pages, payload) {
  let lastProbeError = null;
  for (const page of pages) {
    if (!page) continue;
    try {
      const available = await page.evaluate(
        () => typeof globalThis.__cleanupWayfinderAcquisitionTracer === "function",
      );
      if (!available) continue;
    } catch (error) {
      lastProbeError = error;
      continue;
    }
    return page.evaluate(
      (cleanupPayload) => globalThis.__cleanupWayfinderAcquisitionTracer(cleanupPayload),
      payload,
    );
  }
  throw lastProbeError ?? new Error("No cleanup-capable acquisition tracer page remained available.");
}

async function waitForFoundryReady(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, {
    timeout: 60000,
  });
}
