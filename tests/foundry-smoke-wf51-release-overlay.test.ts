import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectWf51ActorIds,
  expectedWf51MatrixExecutionIds,
  qualifyFreshWf51Child,
  qualifyFreshWf51Matrix,
  validateWf51CoordinatorDefinitions,
  WF51_CHILD_CASE_IDS,
} from "../tools/foundry-smoke/wf51-release-coordinator-contract.mjs";
import { buildWf51AggregateRecords } from "../tools/foundry-smoke/wf51-release-overlay-aggregate.mjs";
import { createWf51ReleaseOverlayArtifactDirectory } from "../tools/foundry-smoke/wf51-release-overlay-artifacts.mjs";
import {
  validateWf51FocusedCaseDefinition,
  validateWf51OverlayRowDefinition,
  wf51FocusedCases,
  wf51ReleaseOverlayRows,
} from "../tools/foundry-smoke/wf51-release-overlay-cases.mjs";
import { qualifyWf51ReleaseOverlay } from "../tools/foundry-smoke/wf51-release-overlay-evidence.mjs";

const coordinator = readFileSync(resolve("tools/foundry-smoke/run-wf51-release-coordinator.mjs"), "utf8");
const focusedRunner = readFileSync(resolve("tools/foundry-smoke/run-wf51-release-overlay.mjs"), "utf8");
const browserSuite = readFileSync(resolve("tools/foundry-smoke/wf51-release-overlay-browser-suite.js"), "utf8");
const coreRunner = readFileSync(resolve("tools/foundry-smoke/run-foundry-smoke.mjs"), "utf8");
const coreBrowserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");
const classCases = readFileSync(resolve("tools/foundry-smoke/class-cases.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

describe("WF-080-51 focused live release overlay", () => {
  it("pins seven focused cases and all fifteen plan rows in exact order", () => {
    expect(wf51FocusedCases.map((entry: any) => entry.id)).toEqual([
      "higher-level-start-boundary",
      "level-5-permanent-recipe",
      "foreign-economic-handoffs",
      "material-drift-zero-write",
      "abp-and-spell-trust",
      "planned-grant-routes",
      "draft-replacement-semantics",
    ]);
    expect(wf51ReleaseOverlayRows.map((entry: any) => entry.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(wf51ReleaseOverlayRows.map((entry: any) => entry.id)).toEqual([
      "level-1-owner-purchase",
      "small-caster-pack-containers",
      "level-1-retain-all-durability",
      "level-5-permanent-recipe",
      "level-5-lump-sum-boundary",
      "higher-level-start-boundary",
      "custom-amount-and-exception",
      "supplemental-source-isolation",
      "foreign-economic-handoffs",
      "material-drift-zero-write",
      "failure-retry-boundaries",
      "abp-world-and-actor-override",
      "spell-attestation-distinct-trust",
      "planned-physical-grant-routes",
      "localized-keyboard-fixed-width",
    ]);
    expect(wf51FocusedCases.every((entry: any) => validateWf51FocusedCaseDefinition(entry).length === 0)).toBe(true);
    expect(wf51ReleaseOverlayRows.every((entry: any) => validateWf51OverlayRowDefinition(entry).length === 0)).toBe(
      true
    );
    expect((wf51ReleaseOverlayRows[3] as any).evidenceRefs).toEqual([
      { route: "focused", caseId: "level-5-permanent-recipe" },
    ]);
    expect((wf51ReleaseOverlayRows[13] as any).evidenceRefs).toEqual(
      expect.arrayContaining([{ route: "matrix", caseId: "alchemist-l1-l5-apply-rerun" }])
    );
    expect(wf51FocusedCases[0]).toMatchObject({ actorCount: 2, targetLevel: 5, existingImportLevel: 7 });
  });

  it("owns fresh child runs, guarded two-role browser phases, served hashes, and failure-proof cleanup", () => {
    expect(coordinator).toContain("run-foundry-smoke.mjs");
    expect(coordinator).toContain("run-acquisition-tracer.mjs");
    expect(coordinator).toContain("run-wave3-equipment-smoke.mjs");
    expect(coordinator).toContain("run-wave4-equipment-smoke.mjs");
    expect(coordinator).toContain("run-wf43-experience-smoke.mjs");
    expect(coordinator).toContain("resultSha256");
    expect(coordinator).toContain("captureCleanCandidate(path.dirname(spec.outDir))");
    expect(coordinator).toContain("repoRelativePath");
    expect(coordinator).not.toContain("--source");
    expect(focusedRunner).toContain("__runWf51PlayerInitial");
    expect(focusedRunner).toContain("__runWf51GmPhase");
    expect(focusedRunner).toContain("__runWf51PlayerVerification");
    expect(focusedRunner).toContain("__cleanupWf51ReleaseOverlay");
    expect(focusedRunner).toContain("--coordinator-manifest");
    expect(focusedRunner).toContain("captureCandidate(path.dirname(path.resolve(cli.coordinatorManifest)))");
    expect(focusedRunner).toContain("repoRelativePath");
    expect(focusedRunner).toContain("finally");
    expect(focusedRunner).toContain("writeWf51ReleaseOverlayArtifacts");
    expect(browserSuite).toContain('game.settings.set("pf2e", abpSetting');
    expect(browserSuite).toContain('"flags.pf2e.disableABP": true');
    expect(browserSuite).toContain("__collectWf51ServedModuleFiles");
    expect(browserSuite).toContain("crypto.subtle.digest");
    expect(browserSuite).toContain(".wayfinder-attestation-receipt");
    expect(browserSuite).toContain("getBoundingClientRect");
    expect(browserSuite).toContain('data-wayfinder-action="import-existing-history"');
    expect(browserSuite).toContain("EXISTING_IMPORT_SOURCES");
    expect(browserSuite).toContain("snapshotEconomic(modules, existingImportActor)");
    expect(browserSuite).toContain('actor.getFlag("pf2e", "wf51OverlaySentinel")');
    expect(browserSuite).toContain("unrelated actor flags drifted");
    expect(focusedRunner).toContain("listJavaScriptFiles");
    expect(focusedRunner).toContain("candidate.localModuleFiles.map");
    expect(packageJson.scripts["smoke:foundry:equipment-release-overlay"]).toContain(
      "run-wf51-release-coordinator.mjs"
    );
    expect(coordinator).toContain("--default-reviewed-equipment");
    expect(coreRunner).toContain("defaultReviewedEquipment");
    expect(coreBrowserSuite).toContain("createCoreAcquisitionExecution");
    expect(coreBrowserSuite).toContain("prepareCurrentClassGrantPlan");
    expect(coreBrowserSuite).toContain("executeAcquisitionItems");
    expect(coreBrowserSuite).toContain("persistCurrencyConvergenceWitness");
    expect(coreBrowserSuite).toContain("completedAcquisitionManifest");
    expect(classCases).toMatch(
      /className: "Swashbuckler"[\s\S]*"class-branch-swashbucklers-style-level-1": \["Fencer"\][\s\S]*expectedSkillRanks: \{ deception: 1 \}/u
    );
  });

  it("qualifies exact start, handoff, drift, ABP, spell-trust, grant, candidate, and cleanup evidence", () => {
    const result = passingResult();
    expect(qualifyWf51ReleaseOverlay(result)).toEqual({ ok: true, failures: [] });

    result.cases[0].evidence.progressionAdmission.code = "higher-level-start-context-missing";
    result.cases[0].evidence.existingImport.reload.ui.equipment.steps = 1;
    result.cases[1].evidence.recipe.allowances.push({ itemLevel: 5 });
    result.cases[2].evidence.currency.execution.writeAttempts.push("currency-add");
    result.cases[3].evidence.writeAttempts = 1;
    result.cases[4].evidence.spellAttestation.authorUserId = "gm-1";
    result.cases[5].evidence.routes[1].resaleRule = "normal";
    result.cases[5].evidence.investigatorMaterialization.formulaBookCount = 2;
    result.cases[5].evidence.titanReload.draftCleared = false;
    result.cases[6].evidence.reload.ui.selections["ancestry-level-1"] =
      "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX";
    result.cases[6].evidence.reload.unrelatedFlags = "lost-unrelated-flags";
    const qualification = qualifyWf51ReleaseOverlay(result);
    expect(qualification.ok).toBe(false);
    expect(qualification.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/level-1 progression/i),
        expect.stringMatching(/Starting Equipment remained visible/i),
        expect.stringMatching(/standard/i),
        expect.stringMatching(/foreign currency/i),
        expect.stringMatching(/before every write/i),
        expect.stringMatching(/distinct/i),
        expect.stringMatching(/Titan Mauler/i),
        expect.stringMatching(/Investigator/i),
        expect.stringMatching(/draft deletion or replacement/i),
        expect.stringMatching(/unrelated flags/i),
      ])
    );
  });

  it("rejects reordered cases, stale bytes, wrong routes, missing categories, and stale child cleanup", () => {
    const swappedHistorySlots = passingResult();
    const mappedEntries = swappedHistorySlots.cases[0].evidence.existingImport.ui.history.entries;
    const ancestryFeat = mappedEntries.find((entry: any) => entry.slotId === "ancestry-feat-level-1");
    const classFeat = mappedEntries.find((entry: any) => entry.slotId === "class-feat-level-1");
    [ancestryFeat.sourceUuid, classFeat.sourceUuid] = [classFeat.sourceUuid, ancestryFeat.sourceUuid];
    expect(qualifyWf51ReleaseOverlay(swappedHistorySlots).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/exact source-backed mappings/i)])
    );

    const reordered = passingResult();
    reordered.cases.reverse();
    expect(qualifyWf51ReleaseOverlay(reordered).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/reordered/i)])
    );

    const servedDrift = passingResult();
    servedDrift.candidate.servedModuleFiles[1].sha256 = "f".repeat(64);
    expect(qualifyWf51ReleaseOverlay(servedDrift).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/served module bytes/i)])
    );

    const missingRow = passingResult();
    missingRow.overlay[3].evidenceRefs[0].evidenceId = null;
    expect(qualifyWf51ReleaseOverlay(missingRow).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/row 4/i)])
    );

    const wrongRoute = passingResult();
    wrongRoute.overlay[0].evidenceRefs[0].caseId = "different-case";
    expect(qualifyWf51ReleaseOverlay(wrongRoute).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/route or case identity/i)])
    );

    const missingRequiredCategory = passingResult();
    missingRequiredCategory.overlay[1].evidence.containers = { applicable: false, values: [], reason: "none" };
    expect(qualifyWf51ReleaseOverlay(missingRequiredCategory).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/required containers/i)])
    );

    const relabelledChild = passingResult();
    relabelledChild.coordinator.children[0].candidateSha = "f".repeat(40);
    expect(qualifyWf51ReleaseOverlay(relabelledChild).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/fresh coordinator/i)])
    );

    const failedCleanup = passingResult();
    failedCleanup.overlay[4].cleanupProvenance[0].cleanup.policyRestored = false;
    expect(qualifyWf51ReleaseOverlay(failedCleanup).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/cleanup provenance/i)])
    );

    const missingCleanupField = passingResult();
    delete missingCleanupField.overlay[0].cleanupProvenance[0].cleanup.exactFixturesMatched;
    expect(qualifyWf51ReleaseOverlay(missingCleanupField).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/cleanup provenance/i)])
    );

    const relabelledRow = passingResult();
    relabelledRow.overlay[4].id = "different-row";
    expect(qualifyWf51ReleaseOverlay(relabelledRow).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/row 5 id drifted/i)])
    );

    const acquisition = childResult("acquisition", WF51_CHILD_CASE_IDS.acquisition);
    expect(qualifyFreshWf51Child("acquisition", acquisition)).toEqual([]);
    acquisition.cleanup.actorsMissingAfterCleanup = false;
    expect(qualifyFreshWf51Child("acquisition", acquisition)).toEqual(
      expect.arrayContaining([expect.stringMatching(/remain after cleanup/i)])
    );
    acquisition.cleanup.actorsMissingAfterCleanup = true;
    delete acquisition.cleanup.exactFixturesMatched;
    expect(qualifyFreshWf51Child("acquisition", acquisition)).toEqual(
      expect.arrayContaining([expect.stringMatching(/exactFixturesMatched/i)])
    );
  });

  it("pins and qualifies the genuine 55/54 child matrix including native Formula Book materialization", () => {
    expect(validateWf51CoordinatorDefinitions()).toEqual([]);
    expect(expectedWf51MatrixExecutionIds()).toHaveLength(55);
    expect(new Set(expectedWf51MatrixExecutionIds())).toHaveProperty("size", 54);
    const children = matrixChildren();
    expect(qualifyFreshWf51Matrix(children)).toEqual([]);

    children[0].result.cases[0].status = "fail";
    expect(qualifyFreshWf51Matrix(children)).toEqual(
      expect.arrayContaining([expect.stringMatching(/every child execution/i)])
    );

    const missingManifest = matrixChildren();
    missingManifest[0].result.cases[0].evidence.acquisition.manifest = null;
    expect(qualifyFreshWf51Matrix(missingManifest)).toEqual(
      expect.arrayContaining([expect.stringMatching(/durable retain-all acquisition manifest/i)])
    );

    const corruptManifest = matrixChildren();
    corruptManifest[0].result.cases[0].evidence.acquisition.manifestCorrupt = true;
    expect(qualifyFreshWf51Matrix(corruptManifest)).toEqual(
      expect.arrayContaining([expect.stringMatching(/durable retain-all acquisition manifest/i)])
    );

    const foreignManifest = matrixChildren();
    foreignManifest[0].result.cases[0].evidence.acquisition.manifest.actorId = "foreign-actor";
    expect(qualifyFreshWf51Matrix(foreignManifest)).toEqual(
      expect.arrayContaining([expect.stringMatching(/durable retain-all acquisition manifest/i)])
    );

    const replacedIncrementalManifest = matrixChildren();
    replacedIncrementalManifest[1].result.cases[1].evidence.acquisition.finalManifestId = "manifest-replaced";
    expect(qualifyFreshWf51Matrix(replacedIncrementalManifest)).toEqual(
      expect.arrayContaining([expect.stringMatching(/prevented a second acquisition/i)])
    );

    const missingRestoration = matrixChildren();
    delete missingRestoration[0].result.defaultReviewedEquipment.judgmentsRestored;
    expect(qualifyFreshWf51Matrix(missingRestoration)).toEqual(
      expect.arrayContaining([expect.stringMatching(/policy restoration/i)])
    );
  });

  it("keeps exact matrix actor cleanup separate from later child actor identities", () => {
    const matrixResults = Array.from({ length: 55 }, (_, index) => ({ actor: { id: `matrix-${index}` } }));
    const laterResults = [{ actorId: "acquisition-1" }, { nested: { actorId: "wave3-1" } }];
    expect(collectWf51ActorIds(matrixResults)).toHaveLength(55);
    expect(collectWf51ActorIds([...matrixResults, ...laterResults])).toHaveLength(57);
    expect(coordinator).toContain("actorIdsChecked: matrixActorIds.length");
  });

  it("requires a fresh ignored artifact directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf51-overlay-"));
    try {
      const directory = await createWf51ReleaseOverlayArtifactDirectory(root, "", "evidence-1");
      expect(directory).toBe(join(root, ".wayfinder-smoke", "wf51-release-overlay-evidence-1"));
      await expect(createWf51ReleaseOverlayArtifactDirectory(root, "", "evidence-1")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function passingResult(): any {
  const servedScript = { path: "scripts/wayfinder.js", bytes: 200, sha256: "c".repeat(64) };
  const transitiveScript = {
    path: "scripts/wayfinder/domain/acquisition-draft.js",
    bytes: 300,
    sha256: "d".repeat(64),
  };
  const candidate = {
    gitSha: "a".repeat(40),
    dirtyPaths: [],
    localModuleFiles: [
      { path: "module.json", bytes: 100, sha256: "b".repeat(64) },
      { path: "scripts/wayfinder.js", bytes: 200, sha256: "c".repeat(64) },
      transitiveScript,
    ],
    servedModuleFiles: [{ path: "module.json", bytes: 100, sha256: "b".repeat(64) }, servedScript, transitiveScript],
    servedScriptManifestSha256: sha256(canonicalJson([servedScript, transitiveScript])),
  };
  const cases = focusedCases();
  const cleanup = passingCleanup();
  const childSources = childEvidence().map((entry) => ({
    ...entry,
    candidateSha: candidate.gitSha,
    servedScriptManifestSha256: candidate.servedScriptManifestSha256,
  }));
  const overlay = buildWf51AggregateRecords({
    candidate,
    focusedCases: { evidenceId: "focused-1", cases, cleanup },
    childSources,
  });
  return {
    schemaVersion: 1,
    evidenceId: "focused-1",
    status: "complete",
    stage: "cleanup",
    error: null,
    runtime: { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.7.5", worldId: "testing-world" },
    users: {
      gm: { id: "gm-1", name: "smoke", isGM: true, role: 4 },
      player: { id: "player-1", name: "wf-smoke-player", isGM: false, role: 1 },
    },
    candidate,
    coordinator: passingCoordinator(candidate),
    cases,
    overlay,
    cleanup,
  };
}

function focusedCases(): any[] {
  const roles = {
    gm: { id: "gm-1", name: "smoke", isGM: true, role: 4 },
    player: { id: "player-1", name: "wf-smoke-player", isGM: false, role: 1 },
  };
  const evidence: Record<string, any> = {
    "higher-level-start-boundary": {
      roles,
      request: { facts: { kind: "higher-level-start" }, requestId: "request-1" },
      approval: { kind: "higher-level-start", authorUserId: "gm-1", authorIsGm: true },
      unauthorizedApproval: { denied: true, unchanged: true, message: "GM only" },
      approvedAdmission: { kind: "eligible-empty" },
      progressionAdmission: { kind: "blocked", code: "prior-character-outcome" },
      existingImport: existingImportEvidence(),
    },
    "level-5-permanent-recipe": {
      roles,
      recipe: {
        kind: "permanent-items",
        currencyCopper: 5_000,
        allowances: [1, 1, 2, 3, 3, 4].map((itemLevel, index) => ({ allowanceId: `allowance-${index}`, itemLevel })),
      },
      recipeSelection: { selectedRecipe: "permanent-items", selector: { kind: "user", userId: "player-1" } },
      subject: { actorId: "start-actor", draftId: "start-draft", batchId: "start-batch" },
      higherLevelStartEvidence: { kind: "gm-confirmation" },
      approval: { kind: "higher-level-start", authorUserId: "gm-1", authorIsGm: true },
    },
    "foreign-economic-handoffs": {
      roles,
      item: {
        subject: { actorId: "item-actor", draftId: "draft-item", batchId: "batch-item" },
        baseline: { currencyCopper: 0 },
        admission: { kind: "handoff", handoff: { reasons: [{ code: "foreign-physical-items", itemIds: ["item-1"] }] } },
        acknowledgedByUserId: "player-1",
        execution: { itemsCompleted: true, currencyCompleted: true, writeAttempts: [] },
        unchanged: true,
      },
      currency: {
        subject: { actorId: "currency-actor", draftId: "draft-currency", batchId: "batch-currency" },
        baseline: { currencyCopper: 25 },
        admission: { kind: "handoff", handoff: { reasons: [{ code: "nonzero-currency", copper: 25 }] } },
        acknowledgedByUserId: "player-1",
        execution: { itemsCompleted: true, currencyCompleted: true, writeAttempts: [] },
        unchanged: true,
      },
    },
    "material-drift-zero-write": {
      roles,
      reasons: ["policy", "price", "baseline"],
      failures: {
        policy: "Current starting-equipment policy differs from the reviewed authority.",
        price: "Acquisition price drifted for entry-1.",
        baseline: "Actor wealth changed during starting-equipment source preflight.",
      },
      writeAttempts: 0,
      unchanged: true,
      subject: { actorId: "drift-actor", draftId: "draft-drift", batchId: "batch-drift", lineId: "line-drift" },
    },
    "abp-and-spell-trust": {
      roles,
      abp: {
        world: { mode: "ABPRulesAsWritten", enabled: true, actorOverrideDisabled: false },
        actorOverride: { mode: "ABPRulesAsWritten", enabled: false, actorOverrideDisabled: true },
      },
      spellAttestation: {
        trust: "player-attestation",
        authorUserId: "player-1",
        authorName: "wf-smoke-player",
        selectedSpells: [{ name: "Forbidding Ward" }],
      },
      reviewedByUserId: "gm-1",
      reviewedByIsGm: true,
      equipmentApproval: { kind: "higher-level-start", authorUserId: "gm-1", authorIsGm: true },
      reviewLine: "Access note, the player's word and not a Wayfinder check",
      gmReceiptDom: {
        visible: true,
        basisLabel: "GM said yes, per the player",
        disclaimer: "These are the player's word, not a check Wayfinder ran.",
      },
      playerReceiptDom: {
        visible: true,
        basisLabel: "GM said yes, per the player",
        disclaimer: "These are the player's word, not a check Wayfinder ran.",
      },
      apply: { kind: "applied", draftCleared: true, persistedAttestationCount: 1 },
      playerReload: { draftCleared: true, persistedAttestationCount: 1 },
    },
    "planned-grant-routes": {
      roles,
      projectionEconomicWritesUnchanged: true,
      routes: [
        grant("alchemist-formula-book", "pf2e-native"),
        { ...grant("giant-instinct-titan-mauler", "wayfinder-acquisition"), resaleRule: "zero-until-rune-investment" },
        grant("investigator-alchemical-sciences-formula-book", "pf2e-native"),
        {
          routeId: "ancient-elf-alchemist-formula-book",
          status: "rejected",
          materializer: null,
        },
      ],
      titanMaterialization: {
        disposition: "purchase-ledger",
        partialItemCount: 1,
        itemCount: 1,
        itemIds: ["titan-item-1"],
        acquisitionStampCount: 1,
        budgetCopper: 1_500,
        spentCopper: 0,
        remainingCopper: 1_500,
        observedCopper: 1_500,
        identityPlan: { entries: [{ entryId: "entry-titan" }] },
        manifest: { fingerprint: "titan-manifest", entries: [{ entryId: "entry-titan" }] },
        lifecycleKind: "applied",
        draftCleared: true,
        manifestCorrupt: false,
      },
      investigatorMaterialization: {
        executor: roles.player,
        disposition: "retain-all",
        handoff: false,
        draftCleared: true,
        forcedFailureCheckpoint: "phase:class-grant-reconcile-final:after",
        formulaBookIdsAfterFailure: ["formula-book-1"],
        formulaBookIdsAfterRetry: ["formula-book-1"],
        formulaBookCount: 1,
        methodologyCount: 1,
        grantedById: "methodology-1",
        methodologyId: "methodology-1",
        acquisitionStampCount: 0,
        acquisitionItemWriteCount: 0,
        grant: {
          status: "resolved",
          grant: { grantId: "class-grant:investigator-formula-book:class-branch-methodology-level-1" },
          observedItemIds: ["formula-book-1"],
        },
        manifest: {
          appliedBy: { userId: "player-1" },
          entries: [
            {
              sourceUuid: "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx",
              observedItems: [{ actualItemId: "formula-book-1" }],
            },
          ],
        },
        spentCopper: 0,
        remainingCopper: 1_500,
        budgetCopper: 1_500,
        observedCopper: 1_500,
        targetCopper: 1_500,
      },
      titanReload: {
        draftCleared: true,
        manifestCorrupt: false,
        manifest: { fingerprint: "titan-manifest" },
        observedCurrencyCopper: 1_500,
        itemIds: ["titan-item-1"],
      },
    },
    "draft-replacement-semantics": draftReplacementEvidence(roles),
  };
  return wf51FocusedCases.map((definition: any) => ({
    id: definition.id,
    status: "pass",
    definitionFingerprint: definition.definitionFingerprint,
    evidence: evidence[definition.id],
  }));
}

function existingImportEvidence(): any {
  const sources = [
    ["ancestry-level-1", "Human", "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX"],
    ["heritage-level-1", "Wintertouched Human", "Compendium.pf2e.heritages.Item.KO33MNyY9VqNQmbZ"],
    ["background-level-1", "Acolyte", "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy"],
    ["class-level-1", "Fighter", "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4"],
    ["ancestry-feat-level-1", "Cooperative Nature", "Compendium.pf2e.feats-srd.Item.lwLcUHQMOqfaNND4"],
    ["class-feat-level-1", "Reactive Shield", "Compendium.pf2e.feats-srd.Item.w8Ycgeq2zfyshtoS"],
    ["general-feat-level-3", "Toughness", "Compendium.pf2e.feats-srd.Item.AmP0qu7c5dlBSath"],
    ["skill-feat-level-2", "Cat Fall", "Compendium.pf2e.feats-srd.Item.LQw0yIMDUJJkq1nD"],
  ];
  const selection = {
    "ancestry-level-1": {
      slotId: "ancestry-level-1",
      packId: "pf2e.ancestries",
      documentId: "IiG7DgeLWYrSNXuX",
      uuid: "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX",
      itemType: "ancestry",
      featType: null,
      level: null,
      name: "Human",
    },
  };
  const history = {
    version: 1,
    importedAt: "2026-08-21T17:00:00.000Z",
    actorLevel: 7,
    entries: [
      ...sources.map(([slotId, name, sourceUuid], index) => ({
        slotId,
        level: Number(slotId.match(/level-(\d+)$/u)?.[1] ?? 1),
        category: index < 4 ? "foundation" : "feat",
        label: name,
        value: name,
        status: "mapped",
        sourceUuid,
      })),
      ...["creation-source-boosts-level-1", "skill-increase-level-3", "embedded-choice-history-level-1"].map(
        (slotId) => ({
          slotId,
          level: 1,
          category: "other",
          label: slotId,
          value: "Review required",
          status: "review",
          sourceUuid: null,
        })
      ),
    ],
  };
  const cleanDraft = {
    acquisition: null,
    acquisitionCorrupt: false,
    policyRequestIds: [],
    applyAttemptStepIds: [],
    applyCompletedStepIds: [],
    applyRecoveryActorUpdate: {},
    selections: selection,
  };
  return {
    subject: { actorId: "existing-actor", actorLevel: 7 },
    expectedSources: sources.map(([historySlotId, name, uuid]) => ({ historySlotId, name, uuid })),
    before: {
      draft: {
        ...cleanDraft,
        acquisition: { draftId: "draft-existing", batchId: "batch-existing", targetLevel: 7, disposition: "blocked" },
        policyRequestIds: ["request-existing"],
      },
      economic: "economic-snapshot",
      items: "item-snapshot",
      manifest: null,
      unrelatedFlags: "preserved-import-flags",
    },
    after: {
      draft: cleanDraft,
      economic: "economic-snapshot",
      items: "item-snapshot",
      manifest: null,
      unrelatedFlags: "preserved-import-flags",
    },
    ui: {
      before: { steps: 1, pane: 0, catalogue: 0, cart: 0, initialize: 0 },
      after: { steps: 0, pane: 0, catalogue: 0, cart: 0, initialize: 0 },
      history,
      status: "Mapped 12 observable choices; 3 historical decisions need review.",
    },
    reload: {
      subject: { actorId: "existing-actor", actorLevel: 7 },
      draft: cleanDraft,
      economic: "economic-snapshot",
      items: "item-snapshot",
      manifest: null,
      history,
      unrelatedFlags: "preserved-import-flags",
      ui: {
        equipment: { steps: 0, pane: 0, catalogue: 0, cart: 0, initialize: 0 },
        historyVisible: true,
        historyText: "What this character already has 12 traced 3 need a look",
        apply: { present: true, enabled: false },
      },
    },
  };
}

function draftReplacementEvidence(roles: any): any {
  const background = "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy";
  const initial = { "background-level-1": background };
  const chosen = {
    "ancestry-level-1": "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX",
    "background-level-1": background,
  };
  const cleared = { "background-level-1": background };
  const replaced = {
    "ancestry-level-1": "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
    "background-level-1": background,
  };
  return {
    roles,
    subject: { actorId: "replacement-actor", targetLevel: 1 },
    before: {
      economic: "replacement-economic",
      items: "replacement-items",
      unrelatedFlags: "preserved-replacement-flags",
    },
    after: {
      economic: "replacement-economic",
      items: "replacement-items",
      unrelatedFlags: "preserved-replacement-flags",
    },
    ui: { initial, chosen, cleared, replaced, alerts: [], notifications: [] },
    reload: {
      subject: { actorId: "replacement-actor", targetLevel: 1 },
      economic: "replacement-economic",
      items: "replacement-items",
      unrelatedFlags: "preserved-replacement-flags",
      ui: { selections: replaced, alerts: [], notifications: [], usable: true },
    },
  };
}

function grant(routeId: string, materializer: string): any {
  return {
    routeId,
    status: "supported",
    materializer,
    resaleRule: "normal",
    quantity: 1,
    lineId: `line-${routeId}`,
  };
}

function childEvidence(): any[] {
  const acquisitionIds = [
    "equipment-l1-owner-common-purchase-retry",
    "equipment-l1-owner-retain-all",
    "equipment-l1-owner-common-purchase-currency-before-retry",
    "equipment-l1-owner-common-purchase-currency-after-retry",
    "equipment-l1-owner-common-purchase-final-before-retry",
    "equipment-l1-owner-common-purchase-final-after-ack",
    "equipment-l1-owner-dwarf-clan-dagger-native-retry",
    "equipment-l1-owner-sarangay-head-gem-native-retry",
  ];
  const wave3Ids = [
    "level-5-lump-sum",
    "level-5-extra-allowance",
    "level-5-custom-lump-sum",
    "configured-item-exception",
  ];
  const wave4Ids = ["adventurers-pack-retry", "supplemental-source-isolation"];
  return [
    source("acquisition", { cases: acquisitionIds.map(sourceCase), cleanup: passingCleanup() }),
    source("experience", { locales: [sourceCase("en"), sourceCase("cn")], cleanup: passingCleanup() }),
    source("matrix", {
      qualification: { passed: true },
      cases: [
        {
          ...sourceCase("alchemist-l1-l5-apply-rerun"),
          actor: {
            items: [
              {
                sourceId: "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx",
                type: "equipment",
                acquisition: null,
              },
            ],
          },
        },
      ],
      cleanup: { verified: true, actorIdsChecked: 55, restorationFailures: [] },
    }),
    source("wave3", { cases: wave3Ids.map(sourceCase), cleanup: passingCleanup() }),
    source("wave4", { cases: wave4Ids.map(sourceCase), cleanup: passingCleanup() }),
  ];
}

function source(route: string, result: any): any {
  return {
    route,
    evidenceId: `${route}-1`,
    qualified: true,
    resultSha256: route.charCodeAt(0).toString(16).padStart(64, "0"),
    result: { evidenceId: `${route}-1`, ...result },
  };
}

function sourceCase(id: string): any {
  return {
    id,
    status: "pass",
    executorRole: "non-gm-owner",
    policySnapshot: { fingerprint: `policy-${id}` },
    batchId: `batch-${id}`,
    lineId: `line-${id}`,
    entryId: `entry-${id}`,
    quantity: 1,
    containerId: `container-${id}`,
    currencyCopper: 0,
    failure: { message: `forced failure for ${id}` },
    manifest: { id: `manifest-${id}` },
  };
}

function passingCleanup(): any {
  return {
    attempted: true,
    actorsDeleted: 9,
    actorsMissingAfterCleanup: true,
    actorCountRestored: true,
    exactFixturesMatched: true,
    fixtureJudgmentsRemoved: true,
    policyRestored: true,
    packsRestored: true,
    sourcesRestored: true,
    judgmentsRestored: true,
    abpRestored: true,
    restorationFailures: [],
  };
}

function passingCoordinator(candidate: any): any {
  const ids = [
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
  return {
    runId: "coordinator-1",
    candidateSha: candidate.gitSha,
    servedScriptManifestSha256: candidate.servedScriptManifestSha256,
    children: ids.map((id) => ({
      id,
      exitCode: 0,
      candidateSha: candidate.gitSha,
      resultSha256: id.charCodeAt(0).toString(16).padStart(64, "0"),
      candidateDrift: false,
    })),
    matrixExecutionIds: expectedWf51MatrixExecutionIds(),
    matrixUniqueScenarioCount: 54,
  };
}

function childResult(route: string, ids: readonly string[]): any {
  const cleanup = {
    ...passingCleanup(),
    actorsDeleted: ids.length,
  };
  return {
    evidenceId: `${route}-child-1`,
    cases: ids.map(sourceCase),
    locales: route === "experience" ? ids.map(sourceCase) : undefined,
    qualification: route === "acquisition" ? { passed: true } : undefined,
    cleanup,
    error: null,
  };
}

function matrixChildren(): any[] {
  const ids = expectedWf51MatrixExecutionIds();
  const sizes = [41, 8, 3, 1, 1, 1];
  const names = [
    "matrix-baseline",
    "matrix-incremental",
    "matrix-free-archetype",
    "matrix-ancestry-paragon",
    "matrix-gradual-boosts",
    "matrix-apply-safety",
  ];
  let offset = 0;
  return sizes.map((size, index) => {
    const cases = ids.slice(offset, offset + size).map((id, caseIndex) => {
      const evidenceIndex = offset + caseIndex;
      const actorId = `matrix-actor-${evidenceIndex}`;
      const incremental = id.endsWith("-incremental-existing");
      const manifest = {
        id: `manifest-${evidenceIndex}`,
        actorId,
        appliedBy: { userId: "gm-1", userName: "smoke" },
        disposition: "retain-all",
        targetLevel: incremental ? 1 : 5,
        fingerprint: `fingerprint-${evidenceIndex}`,
        environment: { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.7.5" },
      };
      const itemEvidence =
        id === "alchemist-l1-l5-apply-rerun"
          ? {
              items: [
                {
                  sourceId: "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx",
                  type: "equipment",
                  acquisition: null,
                },
              ],
            }
          : { items: [] };
      return {
        ...sourceCase(id),
        actor: {
          id: actorId,
          levelAfterApply: 5,
          moduleStateAfterApply: { completedAcquisitionManifest: manifest },
          ...itemEvidence,
        },
        evidence: {
          acquisition: {
            mode: "retain-all",
            disposition: "retain-all",
            draftCleared: true,
            manifestCorrupt: false,
            manifest,
            initialManifestId: incremental ? manifest.id : null,
            finalManifestId: manifest.id,
            secondAcquisitionPrevented: incremental ? true : null,
          },
        },
      };
    });
    offset += size;
    return {
      id: names[index],
      exitCode: 0,
      resultSha256: String(index + 1).padStart(64, "0"),
      result: {
        cases,
        qualification: { passed: true },
        foundryVersion: "14.366",
        pf2eVersion: "8.4.1",
        moduleVersion: "0.7.5",
        user: { id: "gm-1", name: "smoke", role: 4, isGM: true },
        defaultReviewedEquipment: {
          mode: "retain-all",
          changed: true,
          policyRestored: true,
          judgmentsRestored: true,
          restorationFailures: [],
        },
      },
    };
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
