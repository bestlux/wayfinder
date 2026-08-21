import { createHash } from "node:crypto";

import {
  validateWf51FocusedCaseDefinition,
  validateWf51OverlayRowDefinition,
  wf51FocusedCases,
  wf51ReleaseOverlayRows,
} from "./wf51-release-overlay-cases.mjs";
import { expectedWf51MatrixExecutionIds } from "./wf51-release-coordinator-contract.mjs";

export function qualifyWf51ReleaseOverlay(result) {
  const focused = qualifyWf51FocusedOverlay(result);
  const failures = [...focused.failures];
  qualifyAggregate(result?.overlay, result?.candidate, failures);
  return { ok: failures.length === 0, failures };
}

export function qualifyWf51FocusedOverlay(result) {
  const failures = [];
  if (result?.schemaVersion !== 1) failures.push("WF-080-51 overlay evidence schema is not version 1.");
  if (result?.status !== "complete" || result?.error !== null) failures.push("WF-080-51 focused execution did not complete.");
  for (const key of ["foundryVersion", "pf2eVersion", "moduleVersion", "worldId"]) {
    if (!nonEmpty(result?.runtime?.[key])) failures.push(`WF-080-51 evidence is missing runtime.${key}.`);
  }
  if (result?.users?.gm?.isGM !== true || result?.users?.player?.isGM !== false) {
    failures.push("WF-080-51 evidence lacks exact GM and non-GM roles.");
  }
  if (!nonEmpty(result?.users?.gm?.id) || result?.users?.gm?.id === result?.users?.player?.id) {
    failures.push("WF-080-51 GM and player identities are missing or not distinct.");
  }
  qualifyCandidate(result?.candidate, failures);

  const cases = result?.cases ?? [];
  if (
    cases.length !== wf51FocusedCases.length ||
    JSON.stringify(cases.map((entry) => entry.id)) !== JSON.stringify(wf51FocusedCases.map((entry) => entry.id))
  ) {
    failures.push("WF-080-51 focused cases are incomplete, duplicated, or reordered.");
  }
  const observedCases = new Map(cases.map((entry) => [entry.id, entry]));
  for (const definition of wf51FocusedCases) {
    failures.push(...validateWf51FocusedCaseDefinition(definition));
    const observed = observedCases.get(definition.id);
    if (!observed) continue;
    if (observed.status !== "pass") failures.push(`${definition.id}: browser result did not pass.`);
    if (observed.definitionFingerprint !== definition.definitionFingerprint) {
      failures.push(`${definition.id}: definition fingerprint differs from the executed fixture.`);
    }
  }
  qualifyStartBoundary(observedCases.get("higher-level-start-boundary")?.evidence, failures);
  qualifyLevel5PermanentRecipe(observedCases.get("level-5-permanent-recipe")?.evidence, failures);
  qualifyForeignHandoffs(observedCases.get("foreign-economic-handoffs")?.evidence, failures);
  qualifyDrift(observedCases.get("material-drift-zero-write")?.evidence, failures);
  qualifyTrust(observedCases.get("abp-and-spell-trust")?.evidence, result?.users, failures);
  qualifyGrants(observedCases.get("planned-grant-routes")?.evidence, failures);
  if (!freshCoordinatorEvidence(result?.coordinator, result?.candidate)) {
    failures.push("WF-080-51 focused evidence is not owned by a fresh coordinator or prior child cleanup failed.");
  }
  qualifyCleanup(result?.cleanup, failures);
  return { ok: failures.length === 0, failures };
}

function freshCoordinatorEvidence(coordinator, candidate) {
  if (!nonEmpty(coordinator?.runId)) return false;
  const focusedChild =
    /^[0-9a-f]{64}$/u.test(coordinator?.manifestSha256 ?? "") &&
    Number.isInteger(coordinator?.priorChildCount) &&
    coordinator.priorChildCount >= 1 &&
    coordinator?.priorActorCleanup?.allMissing === true &&
    coordinator.priorActorCleanup.actorIdsChecked >= 1;
  if (focusedChild) return true;
  const expectedChildren = [
    "matrix-baseline",
    "matrix-incremental",
    "matrix-free-archetype",
    "matrix-ancestry-paragon",
    "matrix-gradual-boosts",
    "matrix-apply-safety",
    "acquisition",
    "wave3",
    "wave4",
    "experience",
    "focused",
  ];
  return (
    coordinator?.candidateSha === candidate?.gitSha &&
    coordinator?.servedScriptManifestSha256 === candidate?.servedScriptManifestSha256 &&
    JSON.stringify(coordinator?.children?.map((entry) => entry.id) ?? []) === JSON.stringify(expectedChildren) &&
    coordinator.children.every(
      (entry) =>
        entry.exitCode === 0 &&
        entry.candidateSha === candidate?.gitSha &&
        /^[0-9a-f]{64}$/u.test(entry.resultSha256 ?? "") &&
        entry.candidateDrift !== true,
    ) &&
    JSON.stringify(coordinator?.matrixExecutionIds) === JSON.stringify(expectedWf51MatrixExecutionIds()) &&
    coordinator?.matrixUniqueScenarioCount === 54
  );
}

function qualifyCandidate(candidate, failures) {
  if (!/^[0-9a-f]{40}$/u.test(candidate?.gitSha ?? "")) failures.push("Candidate git SHA is missing or malformed.");
  if (!Array.isArray(candidate?.dirtyPaths) || candidate.dirtyPaths.length !== 0) {
    failures.push("Candidate worktree was not clean at live execution.");
  }
  if (!/^[0-9a-f]{64}$/u.test(candidate?.servedScriptManifestSha256 ?? "")) {
    failures.push("Candidate served-script manifest digest is missing.");
  }
  const local = new Map((candidate?.localModuleFiles ?? []).map((entry) => [entry.path, entry]));
  const served = candidate?.servedModuleFiles ?? [];
  if (
    local.size === 0 ||
    served.length === 0 ||
    local.size !== served.length ||
    local.size !== (candidate?.localModuleFiles ?? []).length ||
    new Set(served.map((entry) => entry.path)).size !== served.length
  ) {
    failures.push("Candidate local/served module file manifests are incomplete.");
  }
  for (const entry of served) {
    const expected = local.get(entry.path);
    if (!expected || expected.sha256 !== entry.sha256 || expected.bytes !== entry.bytes) {
      failures.push(`Served module bytes differ from the candidate for ${entry.path ?? "<unknown>"}.`);
    }
  }
  const expectedServedDigest = sha256(
    canonicalJson(
      served
        .filter((entry) => entry.path?.endsWith(".js"))
        .sort((left, right) => left.path.localeCompare(right.path)),
    ),
  );
  if (candidate?.servedScriptManifestSha256 !== expectedServedDigest) {
    failures.push("Candidate served-script manifest digest does not match the observed served files.");
  }
}

function qualifyStartBoundary(evidence, failures) {
  if (
    evidence?.request?.facts?.kind !== "higher-level-start" ||
    evidence?.approval?.kind !== "higher-level-start" ||
    evidence?.approval?.authorIsGm !== true ||
    evidence?.approvedAdmission?.kind !== "eligible-empty" ||
    evidence?.progressionAdmission?.kind !== "blocked" ||
    evidence.progressionAdmission.code !== "prior-character-outcome"
  ) {
    failures.push("Higher-level start did not distinguish approved start context from level-1 progression.");
  }
  if (evidence?.unauthorizedApproval?.denied !== true || evidence?.unauthorizedApproval?.unchanged !== true) {
    failures.push("Non-GM higher-level approval did not fail with zero writes.");
  }
}

function qualifyLevel5PermanentRecipe(evidence, failures) {
  const allowanceLevels = (evidence?.recipe?.allowances ?? []).map((entry) => entry.itemLevel).sort((a, b) => a - b);
  if (
    evidence?.recipe?.kind !== "permanent-items" ||
    evidence.recipe.currencyCopper !== 5_000 ||
    JSON.stringify(allowanceLevels) !== JSON.stringify([1, 1, 2, 3, 3, 4]) ||
    evidence?.recipeSelection?.selectedRecipe !== "permanent-items" ||
    evidence?.higherLevelStartEvidence?.kind !== "gm-confirmation" ||
    evidence?.approval?.kind !== "higher-level-start" ||
    evidence.approval.authorIsGm !== true
  ) {
    failures.push("Level-5 permanent recipe did not prove the standard [1,1,2,3,3,4] allowances and 50 gp.");
  }
}

function qualifyForeignHandoffs(evidence, failures) {
  for (const [key, code] of [
    ["item", "foreign-physical-items"],
    ["currency", "nonzero-currency"],
  ]) {
    const handoff = evidence?.[key];
    if (
      handoff?.admission?.kind !== "handoff" ||
      !handoff.admission.handoff?.reasons?.some((reason) => reason.code === code) ||
      !nonEmpty(handoff?.acknowledgedByUserId) ||
      handoff?.execution?.itemsCompleted !== true ||
      handoff?.execution?.currencyCompleted !== true ||
      handoff?.execution?.writeAttempts?.length !== 0 ||
      handoff.unchanged !== true
    ) {
      failures.push(`Foreign ${key} did not produce the exact zero-write PF2E-sheet handoff.`);
    }
  }
}

function qualifyDrift(evidence, failures) {
  if (
    JSON.stringify(evidence?.reasons) !== JSON.stringify(["policy", "price", "baseline"]) ||
    !/policy differs/i.test(evidence?.failures?.policy ?? "") ||
    !/price drifted/i.test(evidence?.failures?.price ?? "") ||
    !/wealth changed/i.test(evidence?.failures?.baseline ?? "") ||
    evidence?.writeAttempts !== 0 ||
    evidence?.unchanged !== true
  ) {
    failures.push("Material policy, price, and baseline drift did not fail before every write.");
  }
}

function qualifyTrust(evidence, users, failures) {
  if (
    evidence?.abp?.world?.mode !== "ABPRulesAsWritten" ||
    evidence.abp.world.enabled !== true ||
    evidence.abp.world.actorOverrideDisabled !== false ||
    evidence?.abp?.actorOverride?.mode !== "ABPRulesAsWritten" ||
    evidence.abp.actorOverride.enabled !== false ||
    evidence.abp.actorOverride.actorOverrideDisabled !== true
  ) {
    failures.push("PF2E ABP world mode and actor disable override were not both proven.");
  }
  if (
    evidence?.spellAttestation?.trust !== "player-attestation" ||
    evidence.spellAttestation.authorUserId !== users?.player?.id ||
    evidence?.reviewedByUserId !== users?.gm?.id ||
    evidence?.reviewedByIsGm !== true ||
    evidence?.equipmentApproval?.authorUserId !== users?.gm?.id ||
    evidence.equipmentApproval.authorIsGm !== true ||
    evidence.spellAttestation.authorUserId === evidence.equipmentApproval.authorUserId ||
    evidence?.apply?.kind !== "applied" ||
    evidence.apply.draftCleared !== true ||
    evidence.apply.persistedAttestationCount !== 1 ||
    evidence?.playerReload?.draftCleared !== true ||
    evidence.playerReload.persistedAttestationCount !== 1 ||
    !evidence?.reviewLine?.includes("player's word") ||
    evidence?.gmReceiptDom?.visible !== true ||
    evidence.gmReceiptDom.basisLabel !== "GM said yes, per the player" ||
    !evidence.gmReceiptDom.disclaimer?.includes("player's word") ||
    evidence?.playerReceiptDom?.visible !== true ||
    evidence.playerReceiptDom.basisLabel !== "GM said yes, per the player" ||
    !evidence.playerReceiptDom.disclaimer?.includes("player's word")
  ) {
    failures.push("Spell attestation is not visibly distinct from trusted GM equipment approval.");
  }
}

function qualifyGrants(evidence, failures) {
  const routes = new Map((evidence?.routes ?? []).map((entry) => [entry.routeId, entry]));
  const expected = [
    ["alchemist-formula-book", "supported", "pf2e-native"],
    ["giant-instinct-titan-mauler", "supported", "wayfinder-acquisition"],
    ["investigator-alchemical-sciences-formula-book", "supported", "pf2e-native"],
    ["ancient-elf-alchemist-formula-book", "rejected", null],
  ];
  for (const [routeId, status, materializer] of expected) {
    const route = routes.get(routeId);
    if (!route || route.status !== status || (materializer !== null && route.materializer !== materializer)) {
      failures.push(`Planned physical-grant route ${routeId} is missing or drifted.`);
    }
  }
  const titan = routes.get("giant-instinct-titan-mauler");
  const materialization = evidence?.titanMaterialization;
  const investigator = evidence?.investigatorMaterialization;
  const investigatorGrant = investigator?.grant;
  if (
    investigator?.executor?.isGM !== false ||
    investigator?.executor?.id !== evidence?.roles?.player?.id ||
    investigator?.disposition !== "retain-all" ||
    investigator?.handoff !== false ||
    investigator?.draftCleared !== true ||
    investigator?.forcedFailureCheckpoint !== "phase:class-grant-reconcile-final:after" ||
    investigator?.formulaBookCount !== 1 ||
    investigator?.methodologyCount !== 1 ||
    investigator?.formulaBookIdsAfterFailure?.length !== 1 ||
    JSON.stringify(investigator.formulaBookIdsAfterFailure) !== JSON.stringify(investigator.formulaBookIdsAfterRetry) ||
    investigator?.grantedById !== investigator?.methodologyId ||
    investigator?.acquisitionStampCount !== 0 ||
    investigator?.acquisitionItemWriteCount !== 0 ||
    investigatorGrant?.status !== "resolved" ||
    investigatorGrant?.grant?.grantId !==
      "class-grant:investigator-formula-book:class-branch-methodology-level-1" ||
    investigatorGrant?.observedItemIds?.length !== 1 ||
    investigatorGrant.observedItemIds[0] !== investigator?.formulaBookIdsAfterRetry?.[0] ||
    investigator?.manifest?.entries?.length !== 1 ||
    investigator.manifest.entries[0]?.sourceUuid !== "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx" ||
    investigator.manifest.entries[0]?.observedItems?.length !== 1 ||
    investigator.manifest.entries[0].observedItems[0]?.actualItemId !== investigator?.formulaBookIdsAfterRetry?.[0] ||
    investigator?.spentCopper !== 0 ||
    investigator?.remainingCopper !== investigator?.budgetCopper ||
    investigator?.observedCopper !== investigator?.targetCopper ||
    investigator?.manifest?.appliedBy?.userId !== investigator?.executor?.id
  ) {
    failures.push("Investigator Alchemical Sciences did not materially grant one free, unstamped Formula Book on retry.");
  }
  const titanReload = evidence?.titanReload;
  if (
    titan?.resaleRule !== "zero-until-rune-investment" ||
    evidence?.projectionEconomicWritesUnchanged !== true ||
    materialization?.disposition !== "purchase-ledger" ||
    materialization?.partialItemCount !== 1 ||
    materialization?.itemCount !== 1 ||
    materialization?.acquisitionStampCount !== 1 ||
    materialization?.spentCopper !== 0 ||
    materialization?.remainingCopper !== materialization?.budgetCopper ||
    materialization?.observedCopper !== materialization?.budgetCopper ||
    materialization?.identityPlan?.entries?.length !== 1 ||
    materialization?.manifest?.entries?.length !== 1 ||
    materialization?.lifecycleKind !== "applied" ||
    materialization?.draftCleared !== true ||
    materialization?.manifestCorrupt !== false ||
    titanReload?.draftCleared !== true ||
    titanReload?.manifestCorrupt !== false ||
    titanReload?.manifest?.fingerprint !== materialization?.manifest?.fingerprint ||
    titanReload?.observedCurrencyCopper !== materialization?.observedCopper ||
    JSON.stringify(titanReload?.itemIds ?? []) !== JSON.stringify(materialization?.itemIds ?? [])
  ) {
    failures.push("Titan Mauler did not materialize exactly once with zero budget charge and no handoff.");
  }
}

function qualifyAggregate(overlay, candidate, failures) {
  if (
    !Array.isArray(overlay) ||
    overlay.length !== wf51ReleaseOverlayRows.length ||
    JSON.stringify(overlay.map((entry) => entry.number)) !== JSON.stringify(wf51ReleaseOverlayRows.map((entry) => entry.number))
  ) {
    failures.push("WF-080-51 aggregate does not contain the exact ordered fifteen rows.");
    return;
  }
  for (const definition of wf51ReleaseOverlayRows) {
    failures.push(...validateWf51OverlayRowDefinition(definition));
    const entry = overlay.find((candidate) => candidate.number === definition.number);
    if (!entry) continue;
    if (entry.status !== "pass") failures.push(`Overlay row ${definition.number} (${definition.id}) is not proven.`);
    if (entry.definitionFingerprint !== definition.definitionFingerprint) {
      failures.push(`Overlay row ${definition.number} definition fingerprint drifted.`);
    }
    if (entry.id !== definition.id) failures.push(`Overlay row ${definition.number} id drifted.`);
    if (entry.candidateSha !== candidate?.gitSha || entry.servedScriptManifestSha256 !== candidate?.servedScriptManifestSha256) {
      failures.push(`Overlay row ${definition.number} is not bound to the exact candidate and served bytes.`);
    }
    if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length !== definition.evidenceRefs.length) {
      failures.push(`Overlay row ${definition.number} evidence references are incomplete.`);
    } else if (
      JSON.stringify(entry.evidenceRefs.map(({ route, caseId }) => ({ route, caseId }))) !==
      JSON.stringify(definition.evidenceRefs)
    ) {
      failures.push(`Overlay row ${definition.number} evidence route or case identity drifted.`);
    } else if (
      entry.evidenceRefs.some(
        (reference) =>
          reference.qualified !== true ||
          !nonEmpty(reference.evidenceId) ||
          !/^[0-9a-f]{64}$/u.test(reference.resultSha256 ?? "") ||
          reference.candidateSha !== candidate?.gitSha ||
          reference.servedScriptManifestSha256 !== candidate?.servedScriptManifestSha256,
      )
    ) {
      failures.push(`Overlay row ${definition.number} contains unqualified or unbound evidence.`);
    }
    if (JSON.stringify(entry.requiredEvidence) !== JSON.stringify(definition.requiredEvidence)) {
      failures.push(`Overlay row ${definition.number} required-evidence contract drifted.`);
    }
    for (const category of ["roles", "policy", "identities", "quantities", "containers", "currency", "failures", "manifests"]) {
      const value = entry.evidence?.[category];
      if (
        !value ||
        typeof value.applicable !== "boolean" ||
        !Array.isArray(value.values) ||
        (value.applicable === false && !nonEmpty(value.reason))
      ) {
        failures.push(`Overlay row ${definition.number} lacks explicit ${category} applicability.`);
      }
    }
    for (const category of definition.requiredEvidence) {
      const value = entry.evidence?.[category];
      if (value?.applicable !== true || !Array.isArray(value.values) || value.values.length === 0) {
        failures.push(`Overlay row ${definition.number} lacks required ${category} evidence.`);
      }
    }
    if (
      !Array.isArray(entry.cleanupProvenance) ||
      entry.cleanupProvenance.length !== definition.evidenceRefs.length ||
      entry.cleanupProvenance.some((cleanup) => !successfulCleanup(cleanup.route, cleanup.cleanup))
    ) {
      failures.push(`Overlay row ${definition.number} lacks cleanup provenance.`);
    }
  }
}

function successfulCleanup(route, cleanup) {
  if (!cleanup || typeof cleanup !== "object") return false;
  if (route === "matrix") {
    return (
      cleanup.verified === true &&
      cleanup.actorIdsChecked === 55 &&
      Array.isArray(cleanup.restorationFailures) &&
      cleanup.restorationFailures.length === 0
    );
  }
  if (cleanup.actorsMissingAfterCleanup !== true) return false;
  const requiredTrueFields = {
    acquisition: ["exactFixturesMatched"],
    experience: ["actorCountRestored", "policyRestored", "packsRestored", "exactFixturesMatched"],
    wave3: ["fixtureJudgmentsRemoved", "policyRestored"],
    wave4: ["policyRestored", "packsRestored", "sourcesRestored"],
    focused: ["actorCountRestored", "policyRestored", "judgmentsRestored", "abpRestored"],
  }[route];
  if (!requiredTrueFields || requiredTrueFields.some((field) => cleanup[field] !== true)) return false;
  return route !== "experience" || (Array.isArray(cleanup.restorationFailures) && cleanup.restorationFailures.length === 0);
}

function qualifyCleanup(cleanup, failures) {
  const expectedActorCount = wf51FocusedCases.reduce((total, entry) => total + entry.actorCount, 0);
  if (
    cleanup?.attempted !== true ||
    cleanup?.actorsDeleted !== expectedActorCount ||
    cleanup?.actorsMissingAfterCleanup !== true ||
    cleanup?.actorCountRestored !== true ||
    cleanup?.policyRestored !== true ||
    cleanup?.judgmentsRestored !== true ||
    cleanup?.abpRestored !== true ||
    cleanup?.restorationFailures?.length !== 0
  ) {
    failures.push("WF-080-51 cleanup did not restore all exact actors and settings.");
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
