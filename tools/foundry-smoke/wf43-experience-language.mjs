const LANGUAGE_EVIDENCE_LIMIT = 160;

export async function snapshotFoundryClientLanguages(targets, moduleId) {
  const snapshots = [];
  for (const target of targets) {
    const evidence = await inspectFoundryClientLanguage(target.page, target.role, moduleId);
    snapshots.push({ role: target.role, setting: evidence.setting, locale: evidence.locale });
  }
  return snapshots;
}

export async function switchFoundryClientLanguages(targets, language, { moduleId, reload }) {
  const preflight = [];
  for (const target of targets) {
    preflight.push(await inspectFoundryClientLanguage(target.page, target.role, moduleId, language));
  }
  const unavailable = preflight.find(
    (entry) =>
      entry.supported !== true ||
      entry.moduleActive !== true ||
      entry.moduleLanguageDeclared !== true ||
      !entry.moduleLanguagePath,
  );
  if (unavailable) {
    throw languageError(
      `WF-080-43 ${unavailable.role} client cannot switch to ${language}: supported=${unavailable.supported}, moduleActive=${unavailable.moduleActive}, moduleDeclared=${unavailable.moduleLanguageDeclared}.`,
      preflight,
    );
  }

  try {
    for (const target of targets) await setClientLanguage(target, language);
    for (const target of targets) await reload(target.page);
  } catch (error) {
    throw languageError(`WF-080-43 ${language} client switch failed: ${errorMessage(error)}`, preflight);
  }

  const observed = [];
  for (const target of targets) {
    observed.push(await inspectFoundryClientLanguage(target.page, target.role, moduleId, language));
  }
  const mismatch = observed.find(
    (entry) => entry.setting !== String(language) || entry.locale !== String(language),
  );
  if (mismatch) {
    throw languageError(
      `WF-080-43 ${mismatch.role} locale switch expected ${language}, got ${mismatch.setting}/${mismatch.locale}.`,
      observed,
    );
  }
  return observed;
}

export async function restoreFoundryClientLanguages(targets, snapshots, { moduleId, reload }) {
  const failures = [];
  const evidence = [];
  const snapshotsByRole = new Map(snapshots.map((snapshot) => [snapshot.role, snapshot]));
  for (const target of targets) {
    const snapshot = snapshotsByRole.get(target.role);
    if (!snapshot) {
      failures.push(`${target.role} client language snapshot is missing.`);
      continue;
    }
    try {
      await setClientLanguage(target, snapshot.setting);
    } catch (error) {
      failures.push(`${target.role} client language setting restoration failed: ${errorMessage(error)}`);
    }
  }
  for (const target of targets) {
    if (!snapshotsByRole.has(target.role)) continue;
    try {
      await reload(target.page);
    } catch (error) {
      failures.push(`${target.role} client language reload failed: ${errorMessage(error)}`);
    }
  }
  for (const target of targets) {
    const snapshot = snapshotsByRole.get(target.role);
    if (!snapshot) continue;
    try {
      const observed = await inspectFoundryClientLanguage(target.page, target.role, moduleId, snapshot.setting);
      evidence.push(observed);
      if (observed.setting !== snapshot.setting || observed.locale !== snapshot.locale) {
        failures.push(
          `${target.role} client language restoration expected ${snapshot.setting}/${snapshot.locale}, got ${observed.setting}/${observed.locale}.`,
        );
      }
    } catch (error) {
      failures.push(`${target.role} client language verification failed: ${errorMessage(error)}`);
    }
  }
  return { evidence, failures, restored: failures.length === 0 && evidence.length === targets.length };
}

export async function inspectFoundryClientLanguage(page, role, moduleId, requestedLanguage) {
  return page.evaluate(
    ({ boundedModuleId, boundedRequestedLanguage, boundedRole, evidenceLimit }) => {
      const foundryGame = globalThis.game;
      const language = String(boundedRequestedLanguage ?? foundryGame.settings.get("core", "language"));
      const module = foundryGame.modules.get(boundedModuleId);
      const declarations = Array.from(module?.languages ?? []);
      const declaration = declarations.find((entry) => String(entry?.lang ?? "") === language);
      const bounded = (value) => String(value ?? "").slice(0, evidenceLimit);
      return {
        role: bounded(boundedRole),
        requestedLanguage: bounded(language),
        setting: bounded(foundryGame.settings.get("core", "language")),
        locale: bounded(foundryGame.i18n?.lang),
        supported: Object.prototype.hasOwnProperty.call(globalThis.CONFIG?.supportedLanguages ?? {}, language),
        moduleId: bounded(boundedModuleId),
        moduleActive: module?.active === true,
        moduleLanguageDeclared: Boolean(declaration),
        moduleLanguagePath: bounded(declaration?.path),
      };
    },
    {
      boundedModuleId: moduleId,
      boundedRequestedLanguage: requestedLanguage,
      boundedRole: role,
      evidenceLimit: LANGUAGE_EVIDENCE_LIMIT,
    },
  );
}

async function setClientLanguage(target, language) {
  const current = await target.page.evaluate(() => String(globalThis.game.settings.get("core", "language")));
  if (current === String(language)) return;
  try {
    await target.page.evaluate((value) => globalThis.game.settings.set("core", "language", value), language);
  } catch (error) {
    if (!String(error).includes("Execution context was destroyed")) throw error;
  }
}

function languageError(message, evidence) {
  const error = new Error(message);
  error.languageEvidence = evidence;
  return error;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
