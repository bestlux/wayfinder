class Wf43CleanupAuthorityUnavailableError extends Error {}

export async function cleanupWf43ExperienceWithRecovery(pages, payload, recoverPage) {
  return withWf43AuthorityRecovery(
    pages,
    "__cleanupWayfinderWf43Experience",
    (page) =>
      page.evaluate(
        (cleanupPayload) => globalThis.__cleanupWayfinderWf43Experience(cleanupPayload),
        payload,
      ),
    recoverPage,
  );
}

export async function restoreWf43WorldSettingsWithRecovery(pages, payload, recoverPage) {
  return withWf43AuthorityRecovery(
    pages,
    null,
    (page) =>
      page.evaluate(
        async ({ expectedWorldId, moduleId, packsSetting, policySetting, snapshots }) => {
          const foundryGame = globalThis.game;
          if (String(foundryGame.world?.id ?? "") !== String(expectedWorldId ?? "")) {
            throw new Error("WF-080-43 settings recovery reached the wrong world.");
          }
          if (!foundryGame.user?.isGM) {
            throw new Error("WF-080-43 settings recovery requires a current GM.");
          }
          const failures = [];
          try {
            await foundryGame.settings.set(moduleId, policySetting, structuredClone(snapshots.policy));
          } catch (error) {
            failures.push(`equipment policy recovery failed: ${String(error)}`);
          }
          try {
            await foundryGame.settings.set("pf2e", packsSetting, structuredClone(snapshots.packs));
          } catch (error) {
            failures.push(`PF2E pack recovery failed: ${String(error)}`);
          }
          const canonical = (value) => {
            if (Array.isArray(value)) return value.map(canonical);
            if (!value || typeof value !== "object") return value;
            return Object.fromEntries(
              Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonical(entry)]),
            );
          };
          const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
          const policyRestored = same(foundryGame.settings.get(moduleId, policySetting), snapshots.policy);
          const packsRestored = same(foundryGame.settings.get("pf2e", packsSetting), snapshots.packs);
          if (!policyRestored) failures.push("equipment policy recovery did not converge exactly.");
          if (!packsRestored) failures.push("PF2E pack recovery did not converge exactly.");
          return { policyRestored, packsRestored, failures };
        },
        payload,
      ),
    recoverPage,
  );
}

export async function recoverWf43FailedSetupWithRecovery(pages, payload, recoverPage) {
  return withWf43AuthorityRecovery(
    pages,
    null,
    (page) =>
      page.evaluate(
        async ({ allowDestructive, expectedFixtures, expectedWorldId, moduleId, packsSetting, policySetting, runId, snapshots }) => {
          const foundryGame = globalThis.game;
          if (!allowDestructive || String(foundryGame.world?.id ?? "") !== String(expectedWorldId ?? "")) {
            throw new Error("WF-080-43 failed-setup recovery requires destructive opt-in in the exact world.");
          }
          if (!foundryGame.user?.isGM) {
            throw new Error("WF-080-43 failed-setup recovery requires a current GM.");
          }
          const failures = [];
          let actorsDeleted = 0;
          let exactFixturesMatched = true;
          for (const expected of expectedFixtures) {
            const actors = Array.from(foundryGame.actors?.values?.() ?? foundryGame.actors ?? []);
            const matches = actors.filter((actor) => actor.name === expected.fixtureName);
            if (matches.length > 1) {
              exactFixturesMatched = false;
              failures.push(`${expected.locale} failed-setup recovery found duplicate exact fixture names.`);
              continue;
            }
            const actor = matches[0];
            if (!actor) continue;
            const profileMarker = actor.getFlag(moduleId, "equipmentProfileFixture");
            const experienceMarker = actor.getFlag(moduleId, "smokeWf43Experience");
            const profileMatched = profileMarker?.profileId === expected.profileId && profileMarker?.runId === runId;
            const experienceMatched =
              experienceMarker?.purpose === "wf08043-live-experience" &&
              experienceMarker?.runId === runId &&
              experienceMarker?.locale === expected.locale &&
              experienceMarker?.definitionFingerprint === expected.definitionFingerprint &&
              experienceMarker?.fixtureName === expected.fixtureName &&
              experienceMarker?.profileId === expected.profileId;
            if ((profileMarker && !profileMatched) || (experienceMarker && !experienceMatched)) {
              exactFixturesMatched = false;
              failures.push(`${expected.locale} failed-setup recovery refused changed fixture provenance.`);
              continue;
            }
            try {
              for (const app of Object.values(actor.apps ?? {})) await app.close?.({ animate: false });
              await actor.delete();
              actorsDeleted += 1;
            } catch (error) {
              exactFixturesMatched = false;
              failures.push(`${expected.locale} failed-setup actor cleanup failed: ${String(error)}`);
            }
          }
          try {
            await foundryGame.settings.set(moduleId, policySetting, structuredClone(snapshots.policy));
          } catch (error) {
            failures.push(`equipment policy failed-setup recovery failed: ${String(error)}`);
          }
          try {
            await foundryGame.settings.set("pf2e", packsSetting, structuredClone(snapshots.packs));
          } catch (error) {
            failures.push(`PF2E packs failed-setup recovery failed: ${String(error)}`);
          }
          const canonical = (value) => {
            if (Array.isArray(value)) return value.map(canonical);
            if (!value || typeof value !== "object") return value;
            return Object.fromEntries(
              Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonical(entry)]),
            );
          };
          const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
          const actorsMissingAfterCleanup = expectedFixtures.every(
            (expected) =>
              !Array.from(foundryGame.actors?.values?.() ?? foundryGame.actors ?? []).some(
                (actor) => actor.name === expected.fixtureName,
              ),
          );
          const actorCountRestored = foundryGame.actors.size === snapshots.actorCount;
          const policyRestored = same(foundryGame.settings.get(moduleId, policySetting), snapshots.policy);
          const packsRestored = same(foundryGame.settings.get("pf2e", packsSetting), snapshots.packs);
          const languageRestored =
            same(foundryGame.settings.get("core", "language"), snapshots.language) &&
            String(foundryGame.i18n?.lang ?? "") === String(snapshots.language);
          if (!actorsMissingAfterCleanup) failures.push("Failed-setup fixture actors remain after recovery.");
          if (!actorCountRestored) failures.push("Failed-setup recovery did not restore the exact actor count.");
          if (!policyRestored) failures.push("Failed-setup recovery did not restore equipment policy exactly.");
          if (!packsRestored) failures.push("Failed-setup recovery did not restore PF2E packs exactly.");
          if (!languageRestored) failures.push("Failed-setup recovery did not preserve the GM client language.");
          return {
            attempted: true,
            setupCompleted: false,
            actorsDeleted,
            actorsMissingAfterCleanup,
            actorCountRestored,
            exactFixturesMatched,
            policyRestored,
            packsRestored,
            languageRestored,
            restorationFailures: failures,
          };
        },
        payload,
      ),
    recoverPage,
  );
}

export async function createWf43RecoveryPage({ browser, failedContext, login, load }) {
  await failedContext.close();
  const context = await browser.newContext({ viewport: { height: 1080, width: 1920 } });
  try {
    const page = await context.newPage();
    await login(page);
    await load(page);
    return { context, page };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function withWf43AuthorityRecovery(pages, requiredGlobal, execute, recoverPage) {
  const page = await findWf43Authority(pages, requiredGlobal);
  if (page) return execute(page);
  let recoveryPage;
  try {
    recoveryPage = await recoverPage();
  } catch (recoveryError) {
    throw new AggregateError(
      [new Wf43CleanupAuthorityUnavailableError("No ready GM WF-080-43 recovery authority remained available."), recoveryError],
      "WF-080-43 recovery authority was unavailable and recovery login failed.",
      { cause: recoveryError },
    );
  }
  const recovered = await findWf43Authority([recoveryPage], requiredGlobal);
  if (!recovered) {
    throw new Wf43CleanupAuthorityUnavailableError("The fresh WF-080-43 recovery page was not a ready GM authority.");
  }
  return execute(recovered);
}

async function findWf43Authority(pages, requiredGlobal) {
  for (const page of pages) {
    if (!page) continue;
    try {
      const available = await page.evaluate(
        (globalName) =>
          globalThis.game?.ready === true &&
          globalThis.game?.user?.isGM === true &&
          Boolean(globalThis.game?.actors) &&
          (!globalName || typeof globalThis[globalName] === "function"),
        requiredGlobal,
      );
      if (available) return page;
    } catch {
      // A navigated, closed, or otherwise unavailable page is not cleanup authority.
    }
  }
  return null;
}
