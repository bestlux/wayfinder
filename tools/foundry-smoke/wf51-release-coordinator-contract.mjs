import { isDeepStrictEqual } from "node:util";

import { physicalGrantRouteById } from "../../scripts/wayfinder/domain/physical-grant-route-registry.js";
import { acquisitionSmokeCases } from "./acquisition-cases.mjs";
import { applySafetySmokeCases, gradualBoostsSmokeCases, smokeCases } from "./class-cases.mjs";
import { campaignFeatSmokeCases } from "./campaign-feat-cases.mjs";
import { freeArchetypeSmokeCases } from "./free-archetype-cases.mjs";
import { wave3EquipmentCases } from "./wave3-equipment-cases.mjs";
import { wave4EquipmentCases } from "./wave4-equipment-cases.mjs";
import { wf43ExperienceCases } from "./wf43-experience-cases.mjs";

export const WF51_CORE_BASELINE_CASE_IDS = Object.freeze([
  "alchemist-l1-l5-apply-rerun",
  "animist-l1-l5-apply-rerun",
  "barbarian-l1-l5-apply-rerun",
  "bard-l1-l5-apply-rerun",
  "bard-multifarious-muse-l1-l5-apply-rerun",
  "champion-l1-l5-apply-rerun",
  "cleric-l1-l5-apply-rerun",
  "cleric-battle-creed-l1-l5-apply-rerun",
  "cleric-battle-creed-skill-fallback-l1-l5-apply-rerun",
  "cleric-battle-creed-toughness-fallback-l1-l5-apply-rerun",
  "cleric-battle-creed-shielded-fortune-l1-l5-apply-rerun",
  "commander-l1-l5-apply-rerun",
  "druid-l1-l5-apply-rerun",
  "exemplar-l1-l5-apply-rerun",
  "fighter-l1-l5-apply-rerun",
  "fighter-samsaran-weapon-memory-l1-l5-apply-rerun",
  "guardian-l1-l5-apply-rerun",
  "gunslinger-l1-l5-apply-rerun",
  "gunslinger-spellshot-l1-l5-apply-rerun",
  "inventor-l1-l5-apply-rerun",
  "investigator-l1-l5-apply-rerun",
  "investigator-palatine-detective-l1-l5-apply-rerun",
  "kineticist-l1-l5-apply-rerun",
  "magus-l1-l5-apply-rerun",
  "monk-l1-l5-apply-rerun",
  "oracle-l1-l5-apply-rerun",
  "psychic-l1-l5-apply-rerun",
  "ranger-l1-l5-apply-rerun",
  "rogue-l1-l5-apply-rerun",
  "sorcerer-l1-l5-apply-rerun",
  "summoner-l1-l5-apply-rerun",
  "swashbuckler-l1-l5-apply-rerun",
  "thaumaturge-l1-l5-apply-rerun",
  "witch-l1-l5-apply-rerun",
  "wizard-l1-l5-apply-rerun",
  "fighter-depth-l1-l10-apply-rerun",
  "wizard-depth-l1-l10-apply-rerun",
  "bard-depth-l1-l10-apply-rerun",
  "magus-depth-l1-l10-apply-rerun",
  "investigator-depth-l1-l10-apply-rerun",
  "fighter-depth-l1-l20-apply-rerun",
]);

export const WF51_INCREMENTAL_CASE_IDS = Object.freeze([
  "fighter-l1-l5-apply-rerun",
  "cleric-l1-l5-apply-rerun",
  "sorcerer-l1-l5-apply-rerun",
  "kineticist-l1-l5-apply-rerun",
  "cleric-battle-creed-l1-l5-apply-rerun",
  "gunslinger-spellshot-l1-l5-apply-rerun",
  "investigator-palatine-detective-l1-l5-apply-rerun",
]);

export const WF51_CHILD_CASE_IDS = Object.freeze({
  acquisition: Object.freeze(acquisitionSmokeCases.map((entry) => entry.id)),
  experience: Object.freeze(wf43ExperienceCases.map((entry) => entry.id)),
  wave3: Object.freeze(wave3EquipmentCases.map((entry) => entry.id)),
  wave4: Object.freeze(wave4EquipmentCases.map((entry) => entry.id)),
});

export function validateWf51CoordinatorDefinitions() {
  const failures = [];
  const currentSmokeIds = new Set(smokeCases.map((entry) => entry.id));
  for (const id of [...WF51_CORE_BASELINE_CASE_IDS, ...WF51_INCREMENTAL_CASE_IDS]) {
    if (!currentSmokeIds.has(id)) failures.push(`WF-080-51 core matrix case is unavailable: ${id}.`);
  }
  if (WF51_CORE_BASELINE_CASE_IDS.length !== 41) failures.push("WF-080-51 core baseline is not exactly 41 cases.");
  if (WF51_INCREMENTAL_CASE_IDS.length !== 7) failures.push("WF-080-51 incremental lane is not exactly seven cases.");
  if (freeArchetypeSmokeCases.length !== 3) failures.push("WF-080-51 Free Archetype lane is not exactly three cases.");
  if (campaignFeatSmokeCases.length !== 1) failures.push("WF-080-51 Ancestry Paragon lane is not exactly one case.");
  if (gradualBoostsSmokeCases.length !== 1) failures.push("WF-080-51 Gradual Boosts lane is not exactly one case.");
  if (applySafetySmokeCases.length !== 1) failures.push("WF-080-51 Apply safety lane is not exactly one case.");
  const executions = expectedWf51MatrixExecutionIds();
  if (executions.length !== 55 || new Set(executions.map(scenarioIdentity)).size !== 54) {
    failures.push("WF-080-51 core matrix is not exactly 55 executions / 54 unique scenarios.");
  }
  return failures;
}

export function expectedWf51MatrixExecutionIds() {
  return [
    ...WF51_CORE_BASELINE_CASE_IDS,
    "fighter-l1-l5-apply-rerun",
    ...WF51_INCREMENTAL_CASE_IDS.map((id) => `${id}-incremental-existing`),
    ...freeArchetypeSmokeCases.map((entry) => entry.id),
    ...campaignFeatSmokeCases.map((entry) => entry.id),
    ...gradualBoostsSmokeCases.map((entry) => entry.id),
    ...applySafetySmokeCases.map((entry) => entry.id),
  ];
}

export function qualifyFreshWf51Child(route, result, expectedCaseIds = WF51_CHILD_CASE_IDS[route]) {
  const failures = [];
  if (!result || typeof result !== "object") return [`${route}: child result is not an object.`];
  const collection = route === "experience" ? result.locales : result.cases;
  const observedIds = Array.isArray(collection) ? collection.map((entry) => entry?.id) : [];
  if (!Array.isArray(expectedCaseIds) || JSON.stringify(observedIds) !== JSON.stringify(expectedCaseIds)) {
    failures.push(`${route}: child cases are incomplete, duplicated, or reordered.`);
  }
  if (!Array.isArray(collection) || collection.some((entry) => entry?.status !== "pass")) {
    failures.push(`${route}: every exact child case must pass.`);
  }
  if (route === "acquisition" && result.qualification?.passed !== true) {
    failures.push("acquisition: tracer qualification did not pass.");
  }
  if (route === "experience" && result.error) {
    failures.push("experience: live experience qualification did not pass.");
  }
  const expectedCleanupActors = { acquisition: 10, experience: 2, wave3: 5, wave4: 2 }[route];
  failures.push(...cleanupFailures(route, result.cleanup, expectedCleanupActors));
  return failures;
}

export function qualifyFreshWf51Matrix(children) {
  const failures = [];
  const cases = children.flatMap((entry) => entry.result?.cases ?? []);
  const observedIds = cases.map((entry) => entry.id);
  const expectedIds = expectedWf51MatrixExecutionIds();
  if (JSON.stringify(observedIds) !== JSON.stringify(expectedIds)) {
    failures.push("matrix: child executions do not match the exact ordered 55-case registry.");
  }
  if (cases.some((entry) => entry?.status !== "pass")) failures.push("matrix: every child execution must pass.");
  if (cases.length !== 55 || new Set(cases.map((entry) => scenarioIdentity(entry.id))).size !== 54) {
    failures.push("matrix: live evidence is not exactly 55 executions / 54 unique scenarios.");
  }
  for (const child of children) {
    if (child.exitCode !== 0 || child.result?.qualification?.passed !== true) {
      failures.push(`matrix: ${child.id} did not exit and qualify cleanly.`);
    }
    for (const state of [child.result?.freeArchetypeVariant, child.result?.gradualBoostsVariant]) {
      if (state?.changed === true && state?.restored !== state?.original) {
        failures.push(`matrix: ${child.id} did not restore a PF2E variant setting.`);
      }
    }
    const campaign = child.result?.campaignFeatSections;
    if (campaign?.changed === true && JSON.stringify(campaign.restored) !== JSON.stringify(campaign.original)) {
      failures.push(`matrix: ${child.id} did not restore PF2E campaign feat sections.`);
    }
    const equipment = child.result?.defaultReviewedEquipment;
    if (
      equipment?.mode !== "retain-all" ||
      equipment.changed !== true ||
      equipment.policyRestored !== true ||
      equipment.judgmentsRestored !== true ||
      !Array.isArray(equipment.restorationFailures) ||
      equipment.restorationFailures.length > 0
    ) {
      failures.push(`matrix: ${child.id} did not prove exact default equipment policy restoration.`);
    }
  }
  failures.push(...matrixManifestFailures(children));
  failures.push(...formulaBookMaterializationFailures(cases));
  return failures;
}

export function buildFreshMatrixResult(evidenceId, children, cleanup) {
  const cases = children.flatMap((entry) => entry.result.cases);
  return {
    evidenceId,
    qualification: { passed: qualifyFreshWf51Matrix(children).length === 0 },
    executions: cases.map((entry) => ({ id: entry.id, scenarioId: scenarioIdentity(entry.id), status: entry.status })),
    cases,
    childArtifacts: children.map(({ id, resultSha256, exitCode }) => ({ id, resultSha256, exitCode })),
    cleanup,
  };
}

export function collectWf51ActorIds(results) {
  const ids = new Set();
  const visit = (value, key = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, key);
      return;
    }
    for (const [entryKey, entry] of Object.entries(value)) {
      if ((entryKey === "actorId" || (entryKey === "id" && key === "actor")) && typeof entry === "string" && entry) {
        ids.add(entry);
      }
      visit(entry, entryKey);
    }
  };
  for (const result of results) visit(result);
  return [...ids].sort();
}

function formulaBookMaterializationFailures(cases) {
  const alchemist = cases.find((entry) => entry?.id === "alchemist-l1-l5-apply-rerun");
  const formulaBooks = (alchemist?.actor?.items ?? []).filter(
    (item) =>
      item?.sourceId === "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx" &&
      item?.type === "equipment" &&
      item?.acquisition == null,
  );
  return formulaBooks.length === 1
    ? []
    : ["matrix: Alchemist did not materially own exactly one PF2E-native unstamped Formula Book (Blank)."];
}

function matrixManifestFailures(children) {
  const failures = [];
  const definitions = new Map(smokeCases.map((entry) => [entry.id, entry]));
  for (const child of children) {
    for (const entry of child.result?.cases ?? []) {
      const definition = definitions.get(entry?.id);
      if (definition?.expectedOutcome?.kind === "registered-physical-grant-rejection") {
        failures.push(...matrixExpectedRejectionFailures(entry, definition.expectedOutcome));
        continue;
      }
      const actor = entry?.actor;
      const evidence = entry?.evidence?.acquisition;
      const manifest = evidence?.manifest;
      const durableManifest = actor?.moduleStateAfterApply?.completedAcquisitionManifest;
      if (
        child.result?.defaultReviewedEquipment?.mode !== "retain-all" ||
        actor?.moduleDraftAfterApply !== null ||
        actor?.moduleStateAfterApply?.completedAcquisitionManifestCorrupt !== false ||
        !manifest ||
        manifest.disposition !== "retain-all" ||
        manifest.actorId !== actor?.id ||
        manifest.appliedBy?.userId !== child.result?.user?.id ||
        typeof manifest.appliedBy?.userName !== "string" ||
        manifest.appliedBy.userName.length === 0 ||
        manifest.environment?.foundryVersion !== child.result?.foundryVersion ||
        manifest.environment?.pf2eVersion !== child.result?.pf2eVersion ||
        manifest.environment?.moduleVersion !== child.result?.moduleVersion ||
        !isDeepStrictEqual(manifest, durableManifest)
      ) {
        failures.push(`matrix: ${entry?.id ?? "unknown"} lacks an exact durable retain-all acquisition manifest.`);
        continue;
      }
      if (String(entry.id).endsWith("-incremental-existing")) {
        const retry = evidence.retry;
        if (
          retry?.kind !== "second-acquisition-prevention" ||
          typeof retry.initialManifestId !== "string" ||
          retry.initialManifestId.length === 0 ||
          retry.finalManifestId !== retry.initialManifestId ||
          retry.secondAcquisitionPrevented !== true ||
          manifest.targetLevel !== 1
        ) {
          failures.push(`matrix: ${entry.id} did not prove the level-1 manifest prevented a second acquisition.`);
        }
      } else if (manifest.targetLevel !== actor?.levelAfterApply) {
        failures.push(`matrix: ${entry.id} manifest target level differs from the applied character level.`);
      }
    }
  }
  return failures;
}

function matrixExpectedRejectionFailures(entry, expected) {
  const evidence = entry?.evidence?.expectedRejection;
  const blockers = evidence?.registryBlockers;
  const registryRoute = evidence?.registryRoute;
  const expectedRoutes = expected?.activeRoutes;
  const registryRoutes = evidence?.registryRoutes;
  const primaryExpected = Array.isArray(expectedRoutes) ? expectedRoutes[0] : null;
  const matchedBlocker = Array.isArray(blockers) ? blockers[0] : null;
  const actorBefore = evidence?.actorBefore;
  const actorAfter = evidence?.actorAfter;
  const valid =
    evidence?.kind === "registered-physical-grant-rejection" &&
    isDeepStrictEqual(evidence?.expectedOutcome, expected) &&
    Array.isArray(expectedRoutes) &&
    expectedRoutes.length > 0 &&
    Array.isArray(blockers) &&
    blockers.length === expectedRoutes.length &&
    Array.isArray(registryRoutes) &&
    registryRoutes.length === expectedRoutes.length &&
    isDeepStrictEqual(registryRoute, registryRoutes[0]) &&
    expected.routeId === primaryExpected?.routeId &&
    expected.classification === primaryExpected?.classification &&
    expected.preReview === primaryExpected?.preReview &&
    expected.reasonCode === primaryExpected?.reasonCode &&
    expected.sourceUuid === primaryExpected?.sourceUuid &&
    expected.sourceSlotId === primaryExpected?.sourceSlotId &&
    expectedRoutes.every((expectedRoute, index) => {
      const blocker = blockers[index];
      const route = registryRoutes[index];
      const executableRoute = physicalGrantRouteById(expectedRoute.routeId);
      return (
        blocker?.code === "unsupported-physical-grant" &&
        blocker?.routeId === expectedRoute.routeId &&
        blocker?.reasonCode === expectedRoute.reasonCode &&
        blocker?.sourceSlotId === expectedRoute.sourceSlotId &&
        blocker?.sourceUuid === expectedRoute.sourceUuid &&
        typeof blocker?.message === "string" &&
        blocker.message.length > 0 &&
        route?.routeId === expectedRoute.routeId &&
        isDeepStrictEqual(route, executableRoute) &&
        route?.classification === expectedRoute.classification &&
        executableRoute?.classification === "unsupported-handoff" &&
        route?.blocker?.preReview === expectedRoute.preReview &&
        route?.blocker?.reasonCode === expectedRoute.reasonCode &&
        route?.activationVariants?.some((variant) =>
          variant.some((requirement) => requirement?.sourceUuid === expectedRoute.sourceUuid)
        )
      );
    }) &&
    evidence?.rejection?.errorName === "StartingEquipmentPhysicalGrantCoverageError" &&
    evidence?.rejection?.isTypedProductRejection === true &&
    isDeepStrictEqual(evidence.rejection.blocker, matchedBlocker) &&
    evidence.rejection.message === matchedBlocker?.message &&
    evidence.confirmationMessage === null &&
    actorBefore &&
    isDeepStrictEqual(actorBefore, actorAfter) &&
    isDeepStrictEqual(actorAfter, withoutDerivedActorEvidence(entry?.actor)) &&
    /^[0-9a-f]{64}$/u.test(evidence?.actorSourceFingerprintBefore ?? "") &&
    evidence.actorSourceFingerprintBefore === evidence.actorSourceFingerprintAfter &&
    (actorAfter?.moduleStateAfterApply?.completedAcquisitionManifest ?? null) === null &&
    entry?.evidence?.acquisition?.manifest === null;
  return valid
    ? []
    : [`matrix: ${entry?.id ?? "unknown"} did not prove its exact registered pre-review zero-write rejection.`];
}

function withoutDerivedActorEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = { ...value };
  delete snapshot.sourceGroups;
  delete snapshot.sourceIdentityConflicts;
  return snapshot;
}

function cleanupFailures(route, cleanup, expectedCount) {
  if (!cleanup || typeof cleanup !== "object") return [`${route}: cleanup evidence is missing.`];
  const failures = [];
  if (cleanup.actorsMissingAfterCleanup !== true) failures.push(`${route}: fixture actors remain after cleanup.`);
  if (!Number.isInteger(cleanup.actorsDeleted) || cleanup.actorsDeleted !== expectedCount) {
    failures.push(`${route}: cleanup actor count differs from the exact case count.`);
  }
  const requiredTrueFields = {
    acquisition: ["exactFixturesMatched"],
    experience: ["actorCountRestored", "policyRestored", "packsRestored", "exactFixturesMatched"],
    wave3: ["fixtureJudgmentsRemoved", "policyRestored"],
    wave4: ["policyRestored", "packsRestored", "sourcesRestored"],
  }[route] ?? [];
  for (const field of requiredTrueFields) {
    if (cleanup[field] !== true) failures.push(`${route}: required cleanup field ${field} is missing or false.`);
  }
  if (route === "experience") {
    if (!Array.isArray(cleanup.restorationFailures) || cleanup.restorationFailures.length > 0) {
      failures.push(`${route}: cleanup restoration failures are missing or nonempty.`);
    }
  }
  return failures;
}

function scenarioIdentity(id) {
  return id;
}
