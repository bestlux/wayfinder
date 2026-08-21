import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const cleanupScriptPath = path.join(repoRoot, "tools", "foundry-smoke", "acquisition-cleanup-browser.js");
const skillSelectionPolicyPath = path.join(repoRoot, "tools", "foundry-smoke", "skill-selection-policy.js");
const browserSuitePath = path.join(repoRoot, "tools", "foundry-smoke", "browser-suite.js");

class AcquisitionCleanupAuthorityUnavailableError extends Error {}

export async function loadAcquisitionBrowserSuite(page) {
  await loadAcquisitionCleanup(page);
  await page.addScriptTag({ path: skillSelectionPolicyPath });
  await page.addScriptTag({ path: browserSuitePath });
}

export async function loadAcquisitionCleanup(page) {
  await page.addScriptTag({ path: cleanupScriptPath });
}

export async function reloadAcquisitionBrowserSuite(page) {
  await page.addInitScript({ path: cleanupScriptPath });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForFoundryReady(page);
  await loadAcquisitionBrowserSuite(page);
}

export async function cleanupAcquisitionFixtures(pages, payload) {
  let lastProbeError = null;
  for (const page of pages) {
    if (!page) continue;
    try {
      const available = await page.evaluate(
        () =>
          globalThis.game?.ready === true &&
          globalThis.game?.user?.isGM === true &&
          Boolean(globalThis.game?.actors) &&
          typeof globalThis.__cleanupWayfinderAcquisitionTracer === "function",
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
  throw new AcquisitionCleanupAuthorityUnavailableError(
    "No ready GM acquisition cleanup authority remained available.",
    lastProbeError ? { cause: lastProbeError } : undefined,
  );
}

export async function cleanupAcquisitionFixturesWithRecovery(pages, payload, recoverPage) {
  try {
    return await cleanupAcquisitionFixtures(pages, payload);
  } catch (initialError) {
    if (!(initialError instanceof AcquisitionCleanupAuthorityUnavailableError)) throw initialError;
    let recoveryPage;
    try {
      recoveryPage = await recoverPage();
    } catch (recoveryError) {
      throw new AggregateError(
        [initialError, recoveryError],
        "Acquisition tracer cleanup authority was unavailable and recovery login failed.",
        { cause: recoveryError },
      );
    }
    try {
      return await cleanupAcquisitionFixtures([recoveryPage], payload);
    } catch (recoveryCleanupError) {
      throw new AggregateError(
        [initialError, recoveryCleanupError],
        "Acquisition tracer cleanup failed before and after recovery login.",
        { cause: recoveryCleanupError },
      );
    }
  }
}

export async function createAcquisitionRecoveryPage({
  blockingErrors = [],
  browser,
  failedContext,
  login,
  prepare = async () => undefined,
}) {
  if (blockingErrors.length > 0) {
    throw new AggregateError(
      blockingErrors,
      "Acquisition cleanup recovery refused to open another GM session before prior GM contexts closed.",
      { cause: blockingErrors.at(-1) },
    );
  }
  await failedContext.close();
  const context = await browser.newContext({ viewport: { height: 1000, width: 1440 } });
  try {
    const page = await context.newPage();
    await login(page);
    await loadAcquisitionCleanup(page);
    await prepare(page);
    return { context, page };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function waitForFoundryReady(page) {
  await page.waitForFunction(() => globalThis.game?.ready === true, null, {
    timeout: 60000,
  });
}
