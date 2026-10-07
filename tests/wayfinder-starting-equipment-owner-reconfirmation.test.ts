import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import { buildDraftPatch, createEmptyDraft, normalizeDraft, normalizeState } from "../src/draft-service";
import type { AppliedSpellRarityAttestation, DraftState } from "../src/types";
import { EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE } from "../src/wayfinder/application/equipment-catalogue-record-source";
import {
  createOwnerStartAttestation,
  requiresEquipmentStartConfirmation,
  resolveEquipmentPolicyForActor,
} from "../src/wayfinder/application/equipment-policy-service";
import {
  executeStartingEquipmentCommand,
  type StartingEquipmentCommandContext,
} from "../src/wayfinder/application/starting-equipment-command-service";
import { createAcquisitionCurrencyConvergenceWitness } from "../src/wayfinder/domain/acquisition-currency-convergence";
import {
  acquisitionPolicyMaterialMatches,
  createAcquisitionDraft,
  createAcquisitionPolicySnapshot,
} from "../src/wayfinder/domain/acquisition-draft";
import {
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  type EquipmentHigherLevelStartClaim,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentWorldPolicyV1,
} from "../src/wayfinder/domain/equipment-policy";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import {
  buildStartingEquipmentPane,
  type StartingEquipmentCatalogueProjection,
} from "../src/wayfinder/panes/starting-equipment-pane";
import { acquisitionLine } from "./fixtures/acquisition-fixture";

const ORIGINAL_AT = "2026-10-05T19:00:00.000Z";
const NOW = "2026-10-07T20:00:00.000Z";
const FIRST_OWNER = { id: "owner-1", name: "First Owner", isGM: false };
const SECOND_OWNER = { id: "owner-2", name: "Second Owner", isGM: false };
const GM = { id: "gm-1", name: "GM", isGM: true };
const ACTIVATE = {
  type: "activate-policy",
  startKind: "new-campaign",
  reason: "Confirming my current ownership.",
} as const;
type CommandDependencies = NonNullable<Parameters<typeof executeStartingEquipmentCommand>[2]>;

describe("starting-equipment confirmation by a different current owner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers current-owner confirmation instead of a disabled outfitter for another owner's attestation", () => {
    const fixture = reviewedFixture();
    fixture.game.user = SECOND_OWNER;

    const pane = paneFor(fixture, SECOND_OWNER, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: true,
      canRequest: false,
      canChooseRecipe: false,
      authorityMessage: "wayfinder-pf2e.StartingEquipment.Authority.OwnerConfirmationRequired",
    });
    expect(pane.initialized).toBe(true);
    expect(pane.setup.selectedRecipe).toBe("permanent-items");
  });

  it("uses the current GM-confirmation policy for a foreign-owner gateway while locking the existing recipe", async () => {
    const fixture = reviewedFixture();
    fixture.game.user = SECOND_OWNER;
    fixture.worldPolicy = { ...DEFAULT_EQUIPMENT_WORLD_POLICY };

    const pane = paneFor(fixture, SECOND_OWNER, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: false,
      canRequest: true,
      canChooseRecipe: false,
    });
    const requested = await executeStartingEquipmentCommand(
      { type: "request-higher-level-start", startKind: "new-campaign", reason: "Current GM approval required." },
      commandContext(fixture),
      { mintRequestId: () => "new-owner-request" }
    );
    expect(requested.acquisition).toEqual(fixture.draft.acquisition);
    expect(requested.policyRequests).toMatchObject([
      {
        requestId: "new-owner-request",
        requesterUserId: SECOND_OWNER.id,
        facts: { actorId: "actor-1", draftId: "draft-1", targetLevel: 5 },
      },
    ]);
  });

  it("offers the original author a GM request when the world changes from owner to GM confirmation", () => {
    const fixture = reviewedFixture();
    fixture.worldPolicy = { ...DEFAULT_EQUIPMENT_WORLD_POLICY };
    expect(() => resolveReviewedPolicy(fixture)).toThrow(/trusted GM confirmation/i);

    const pane = paneFor(fixture, FIRST_OWNER, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: false,
      canRequest: true,
      canChooseRecipe: false,
    });
  });

  it("offers owner confirmation when a previously GM-confirmed build changes to the owner-authority mode", () => {
    const fixture = reviewedFixture(5, true);
    fixture.game.user = SECOND_OWNER;
    expect(() => resolveReviewedPolicy(fixture)).not.toThrow();
    fixture.worldPolicy = { ...DEFAULT_EQUIPMENT_WORLD_POLICY, higherLevelStartAuthority: "actor-owner-attestation" };
    expect(() => resolveReviewedPolicy(fixture)).toThrow(/current actor-owner attestation/i);

    const pane = paneFor(fixture, SECOND_OWNER, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: true,
      canRequest: false,
      canChooseRecipe: false,
    });
  });

  it("offers a fresh GM request when the stored judgment's author is no longer a GM", () => {
    const fixture = reviewedFixture(5, true);
    fixture.game.user = SECOND_OWNER;
    expect(() => resolveReviewedPolicy(fixture)).not.toThrow();
    fixture.game.users.set(GM.id, { ...GM, isGM: false });
    expect(() => resolveReviewedPolicy(fixture)).toThrow(/GM|judgment/i);

    const pane = paneFor(fixture, SECOND_OWNER, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: false,
      canRequest: true,
      canChooseRecipe: false,
    });
  });

  it("keeps source-only policy drift separate from missing starting authority", () => {
    const fixture = reviewedFixture();
    fixture.worldPolicy = { ...fixture.worldPolicy, allowedEquipmentPackFamilies: ["battlezoo"] };
    const acquisition = fixture.draft.acquisition!;
    const currentPolicy = resolveReviewedPolicy(fixture);
    expect(
      acquisitionPolicyMaterialMatches(
        acquisition.policySnapshot!,
        createAcquisitionPolicySnapshot(currentPolicy, acquisition.recipe, acquisition.recipeSelection)
      )
    ).toBe(false);
    expect(
      requiresEquipmentStartConfirmation({
        actor: fixture.actor,
        acquisition,
        worldPolicy: fixture.worldPolicy,
        judgments: fixture.judgments,
      })
    ).toBe(false);

    const pane = paneFor(fixture, FIRST_OWNER, "error");

    expect(pane.setup.awaitingAuthority).toBe(false);
    expect(pane.catalogue.searchDisabled).toBe(true);
  });

  it.each([
    "lost ownership",
    "deleted original author",
  ] as const)("offers a GM confirmation when an attestation has a $0", (reason) => {
    const fixture = reviewedFixture();
    fixture.game.user = GM;
    if (reason === "lost ownership") fixture.currentOwners.delete(FIRST_OWNER.id);
    else fixture.game.users.delete(FIRST_OWNER.id);
    expect(() => resolveReviewedPolicy(fixture)).toThrow(/current actor-owner attestation/i);

    const pane = paneFor(fixture, GM, "error");

    expect(pane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: true,
      canRequest: false,
      canChooseRecipe: false,
    });
  });

  it.each([
    { label: "the original owner", user: FIRST_OWNER, targetLevel: 5, gmConfirmed: false },
    { label: "a GM viewing another current owner's attestation", user: GM, targetLevel: 5, gmConfirmed: false },
    { label: "a level-1 owner", user: SECOND_OWNER, targetLevel: 1, gmConfirmed: false },
    { label: "another owner with a valid GM confirmation", user: SECOND_OWNER, targetLevel: 5, gmConfirmed: true },
  ])("keeps the normal workspace available to $label", ({ user, targetLevel, gmConfirmed }) => {
    const fixture = reviewedFixture(targetLevel, gmConfirmed);
    fixture.game.user = user;

    const pane = paneFor(fixture, user);

    expect(pane.setup.awaitingAuthority).toBe(false);
    expect(pane.catalogue.searchDisabled).toBe(false);
    expect(pane.review.canReviewPurchases).toBe(true);
  });

  it("leaves the existing pane contract unchanged when the caller has no current-user identity", () => {
    const fixture = reviewedFixture();
    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      fixture.draft,
      { state: "complete", complete: true, status: "Reviewed", issue: null },
      catalogue("ready"),
      (key) => key,
      { worldPolicy: fixture.worldPolicy, judgments: fixture.judgments, isGm: false }
    );

    expect(pane.setup.awaitingAuthority).toBe(false);
  });

  it("reconfirms through the real owner-policy resolver without replacing build, equipment, or acquisition identity", async () => {
    const fixture = reviewedFixture();
    fixture.game.user = SECOND_OWNER;
    const before = structuredClone(fixture.draft);
    const prior = before.acquisition!;
    const oldClaim = prior.policySnapshot!.material.higherLevelStartEvidence;
    expect(oldClaim.kind).toBe("actor-owner-attestation");
    expect(() =>
      resolveEquipmentPolicyForActor({
        actor: fixture.actor,
        draftId: prior.draftId,
        targetLevel: 5,
        selectedRecipe: "permanent-items",
        higherLevelStartClaim: oldClaim as EquipmentHigherLevelStartClaim,
      })
    ).toThrow(/current actor-owner attestation/i);
    const createClaim = vi.fn(createOwnerStartAttestation);
    const mintIdentity = vi.fn<NonNullable<CommandDependencies["mintIdentity"]>>(() => {
      throw new Error("Owner reconfirmation must not mint an acquisition identity.");
    });

    const result = await executeStartingEquipmentCommand(ACTIVATE, commandContext(fixture), {
      createOwnerStartAttestation: createClaim,
      mintIdentity,
    });

    expect(createClaim).toHaveBeenCalledOnce();
    expect(mintIdentity).not.toHaveBeenCalled();
    expect(fixture.draft).toEqual(before);
    expect(result.acquisition).toMatchObject({
      draftId: prior.draftId,
      batchId: prior.batchId,
      manifestId: prior.manifestId,
      policySnapshot: {
        material: {
          higherLevelStartEvidence: { kind: "actor-owner-attestation", authorUserId: SECOND_OWNER.id, recordedAt: NOW },
        },
      },
      disposition: { kind: "unreviewed", invalidatedFrom: "purchase-ledger", reasons: ["policy"] },
    });
    for (const key of ["baseline", "recipe", "recipeSelection", "lines", "plannedClassGrants"] as const) {
      expect(result.acquisition[key]).toEqual(prior[key]);
    }
    fixture.draft.acquisition = result.acquisition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(fixture.draft))), 1);
    expect(reopened.acquisition).toEqual(result.acquisition);
    expect(reopened.selections).toEqual(before.selections);
    expect(reopened.classChoices).toEqual(before.classChoices);
    expect(reopened.boosts).toEqual(before.boosts);
    const evidence = reopened.acquisition!.policySnapshot!.material.higherLevelStartEvidence;
    if (evidence.kind !== "actor-owner-attestation") throw new Error("Expected current owner evidence.");
    const current = resolveEquipmentPolicyForActor({
      actor: fixture.actor,
      draftId: prior.draftId,
      targetLevel: 5,
      selectedRecipe: "permanent-items",
      higherLevelStartClaim: evidence,
    });
    expect(
      acquisitionPolicyMaterialMatches(
        reopened.acquisition!.policySnapshot!,
        createAcquisitionPolicySnapshot(current, reopened.acquisition!.recipe, reopened.acquisition!.recipeSelection)
      )
    ).toBe(true);
    const pane = paneFor({ ...fixture, draft: reopened }, SECOND_OWNER);
    expect(pane.setup.awaitingAuthority).toBe(false);
    expect(pane.catalogue.searchDisabled).toBe(false);
    expect(pane.review).toMatchObject({ settled: false, canReviewPurchases: true });
  });

  it("invalidates a coin-only review for the new owner without losing its acquisition or economic baseline", async () => {
    const fixture = reviewedFixture();
    const empty = { ...fixture.draft.acquisition!, lines: [], plannedClassGrants: [] };
    fixture.draft.acquisition = reviewRetainAll(empty, evaluateAcquisitionLedger(empty), {
      userId: FIRST_OWNER.id,
      reviewedAt: ORIGINAL_AT,
    });
    fixture.game.user = SECOND_OWNER;
    const prior = structuredClone(fixture.draft.acquisition);

    const result = await executeStartingEquipmentCommand(ACTIVATE, commandContext(fixture));

    expect(result.acquisition).toMatchObject({
      draftId: prior.draftId,
      batchId: prior.batchId,
      manifestId: prior.manifestId,
      baseline: prior.baseline,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: "retain-all", reasons: ["policy"] },
    });
    fixture.draft.acquisition = result.acquisition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(fixture.draft))), 1);
    const pane = paneFor({ ...fixture, draft: reopened }, SECOND_OWNER);
    expect(pane.setup.awaitingAuthority).toBe(false);
    expect(pane.review).toMatchObject({ canRetainAll: true, canReviewPurchases: false, settled: false });
  });

  it.each(recoveryCases())("requires $label recovery to finish before a foreign owner can change authority", async ({
    apply,
  }) => {
    const fixture = reviewedFixture();
    fixture.game.user = SECOND_OWNER;
    apply(fixture.draft);
    const before = structuredClone(fixture.draft);
    const createClaim = vi.fn(createOwnerStartAttestation);
    const saveJudgment = vi.fn<NonNullable<CommandDependencies["saveJudgment"]>>(async () => {
      throw new Error("Recovery must be rejected before an authority write.");
    });
    const mintRequestId = vi.fn(() => "forbidden-new-owner-request");
    const dependencies = { createOwnerStartAttestation: createClaim, saveJudgment, mintRequestId };

    const ownerPane = paneFor(fixture, SECOND_OWNER, "error");
    expect(ownerPane.setup).toMatchObject({
      awaitingAuthority: true,
      canActivate: false,
      canRequest: false,
      authorityMessage: "wayfinder-pf2e.StartingEquipment.Authority.ApplyRecoveryPending",
    });
    await expect(executeStartingEquipmentCommand(ACTIVATE, commandContext(fixture), dependencies)).rejects.toThrow(
      /recovery/i
    );
    fixture.worldPolicy = { ...DEFAULT_EQUIPMENT_WORLD_POLICY };
    const gmPane = paneFor(fixture, SECOND_OWNER, "error");
    expect(gmPane.setup).toMatchObject({ awaitingAuthority: true, canActivate: false, canRequest: false });
    await expect(executeStartingEquipmentCommand(ACTIVATE, commandContext(fixture), dependencies)).rejects.toThrow(
      /recovery/i
    );
    await expect(
      executeStartingEquipmentCommand(
        { type: "request-higher-level-start", startKind: "new-campaign", reason: "Must finish recovery first." },
        commandContext(fixture),
        dependencies
      )
    ).rejects.toThrow(/recovery/i);
    expect(fixture.draft).toEqual(before);
    expect(createClaim).not.toHaveBeenCalled();
    expect(saveJudgment).not.toHaveBeenCalled();
    expect(mintRequestId).not.toHaveBeenCalled();
  });
});

function reviewedFixture(targetLevel = 5, gmConfirmed = false) {
  const currentOwners = new Set([FIRST_OWNER.id, SECOND_OWNER.id]);
  const fixture = {
    worldPolicy: {
      ...DEFAULT_EQUIPMENT_WORLD_POLICY,
      higherLevelStartAuthority: "actor-owner-attestation",
    } as EquipmentWorldPolicyV1,
    judgments: [] as EquipmentPolicyJudgmentRecord[],
    currentOwners,
    actor: {
      id: "actor-1",
      type: "character",
      isOwner: true,
      flags: {},
      testUserPermission: (user: { id: string }, _level: number) => currentOwners.has(user.id),
    },
    draft: createEmptyDraft(targetLevel),
    game: {
      user: FIRST_OWNER,
      users: new Map([FIRST_OWNER, SECOND_OWNER, GM].map((user) => [user.id, user])),
      system: { id: "pf2e", version: "8.5.1" },
      packs: [
        {
          collection: "pf2e.equipment-srd",
          documentName: "Item",
          metadata: { label: "Equipment", packageName: "pf2e" },
          index: [],
        },
      ],
      pf2e: {},
      settings: { get: (_module: string, _key: string): unknown => null },
    },
  };
  fixture.game.settings.get = (module, key) => {
    if (module === MODULE_ID && key === SETTINGS.equipmentPolicy) return fixture.worldPolicy;
    if (module === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments)
      return { version: 1, judgments: fixture.judgments };
    if (module === "pf2e" && key === "compendiumBrowserPacks")
      return { equipment: { "pf2e.equipment-srd": { load: true } } };
    if (module === "pf2e" && key === "compendiumBrowserSources") return { sources: { "player-core": { load: true } } };
    return null;
  };
  vi.stubGlobal("game", fixture.game);
  vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } });
  let claim: EquipmentHigherLevelStartClaim | null = null;
  if (targetLevel > 1 && gmConfirmed) {
    fixture.worldPolicy = { ...DEFAULT_EQUIPMENT_WORLD_POLICY };
    const facts = {
      kind: "higher-level-start",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel,
      startKind: "new-campaign",
    } as const;
    const request = createEquipmentPolicyRequest({
      requestId: "gm-start",
      facts,
      requesterUserId: FIRST_OWNER.id,
      requesterName: FIRST_OWNER.name,
      requestedAt: ORIGINAL_AT,
      reason: "Starting build.",
    });
    fixture.judgments = [
      {
        id: "gm-start",
        kind: "higher-level-start",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel,
        factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
        authorUserId: GM.id,
        authorName: GM.name,
        recordedAt: ORIGINAL_AT,
        reason: "Approved build.",
        request,
        revocation: null,
      },
    ];
    claim = { kind: "gm-confirmation", judgmentId: "gm-start", startKind: "new-campaign" };
  } else if (targetLevel > 1) {
    claim = createOwnerStartAttestation({
      actor: fixture.actor,
      draftId: "draft-1",
      targetLevel,
      startKind: "new-campaign",
      reason: "Starting build.",
      recordedAt: ORIGINAL_AT,
      user: FIRST_OWNER,
    });
  }
  const recipeSelection = {
    version: 1 as const,
    selectedRecipe: "permanent-items" as const,
    selectedAt: ORIGINAL_AT,
    selector: { kind: "user" as const, userId: FIRST_OWNER.id, userName: FIRST_OWNER.name },
    authority:
      targetLevel === 1
        ? { mode: "level-one-choice" as const }
        : { mode: "owner-delegated" as const, worldPolicy: structuredClone(fixture.worldPolicy) },
  };
  const policy = resolveEquipmentPolicyForActor({
    actor: fixture.actor,
    draftId: "draft-1",
    targetLevel,
    selectedRecipe: "permanent-items",
    higherLevelStartClaim: claim,
  });
  const native = createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: { sourceSlotId: "class-level-1", sourceUuid: CLASS_GRANT_PROFILE_UUIDS.alchemistClass },
    granterSourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookFeature,
    expected: { sourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [
      CLASS_GRANT_PROFILE_UUIDS.formulaBookFeature,
      CLASS_GRANT_PROFILE_UUIDS.alchemyFeature,
      CLASS_GRANT_PROFILE_UUIDS.alchemistClass,
    ],
  });
  const acquisition = {
    ...createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel,
      recipe: { kind: "permanent-items" },
      recipeSelection,
    }),
    policySnapshot: createAcquisitionPolicySnapshot(policy, { kind: "permanent-items" }, recipeSelection),
    baseline: createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: ORIGINAL_AT,
      currencyCopper: 0,
      physicalItems: [],
    }),
    plannedClassGrants: [native],
    lines: [
      acquisitionLine({ lineId: "currency-line", itemLevel: 0, requestedQuantity: 2, stackingIntent: "separate" }),
      acquisitionLine({
        lineId: "native-line",
        sourceUuid: native.expected.sourceUuid,
        itemLevel: 0,
        funding: { lane: "class-grant", grant: { plannedGrantId: native.grantId } },
        stackingIntent: "separate",
      }),
    ],
  };
  const plan = createPreparedClassGrantPlan({
    actorId: "actor-1",
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel,
    grants: acquisition.plannedClassGrants,
  });
  const ledger = evaluateAcquisitionLedger(acquisition, plan);
  if (!ledger.valid)
    throw new Error(`Owner-reconfirmation fixture has an invalid ledger: ${JSON.stringify(ledger.blockers)}`);
  fixture.draft.acquisition = reviewPurchaseLedger(acquisition, ledger, {
    userId: FIRST_OWNER.id,
    reviewedAt: ORIGINAL_AT,
  });
  fixture.draft.selections["ancestry-level-1"] = {
    slotId: "ancestry-level-1",
    packId: "pf2e.ancestries",
    documentId: "dwarf",
    uuid: "Compendium.pf2e.ancestries.Item.dwarf",
    itemType: "ancestry",
    featType: null,
    name: "Dwarf",
    level: 1,
  };
  fixture.draft.classChoices["class-choice-level-1"] = "existing-choice";
  fixture.draft.boosts.class.keyAbility = "str";
  return fixture;
}

function resolveReviewedPolicy(fixture: ReturnType<typeof reviewedFixture>) {
  const acquisition = fixture.draft.acquisition!;
  const evidence = acquisition.policySnapshot!.material.higherLevelStartEvidence;
  const claim =
    evidence.kind === "not-required"
      ? null
      : evidence.kind === "gm-confirmation"
        ? { kind: "gm-confirmation" as const, judgmentId: evidence.judgment.id, startKind: evidence.startKind }
        : evidence;
  return resolveEquipmentPolicyForActor({
    actor: fixture.actor,
    draftId: acquisition.draftId,
    targetLevel: acquisition.targetLevel,
    selectedRecipe: "permanent-items",
    higherLevelStartClaim: claim,
  });
}

function paneFor(
  fixture: ReturnType<typeof reviewedFixture>,
  user: typeof FIRST_OWNER,
  state: StartingEquipmentCatalogueProjection["state"] = "ready"
) {
  return buildStartingEquipmentPane(
    createStartingEquipmentStep(fixture.draft.targetLevel),
    fixture.draft,
    { state: "complete", complete: true, status: "Reviewed", issue: null },
    catalogue(state),
    (key) => key,
    {
      worldPolicy: fixture.worldPolicy,
      judgments: fixture.judgments,
      isGm: user.isGM,
      currentUserId: user.id,
      startAuthorityNeedsConfirmation: requiresEquipmentStartConfirmation({
        actor: fixture.actor,
        acquisition: fixture.draft.acquisition,
        worldPolicy: fixture.worldPolicy,
        judgments: fixture.judgments,
      }),
    }
  );
}

function catalogue(state: StartingEquipmentCatalogueProjection["state"]): StartingEquipmentCatalogueProjection {
  return {
    state,
    message: state === "error" ? "A current actor-owner attestation is required." : "Ready",
    query: "",
    matchedRecordCount: 0,
    recordSource: EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE,
    filters: [],
    activeFilters: {},
    previewSourceUuid: null,
    titanMauler: { required: false, selectedSourceUuid: null },
  };
}

function commandContext(fixture: ReturnType<typeof reviewedFixture>): StartingEquipmentCommandContext {
  return {
    actor: fixture.actor,
    draft: fixture.draft,
    moduleState: normalizeState(null),
    steps: [createStartingEquipmentStep(fixture.draft.targetLevel)],
    userId: fixture.game.user.id,
    user: fixture.game.user,
    now: () => NOW,
  };
}

function recoveryCases(): { label: string; apply: (draft: DraftState) => void }[] {
  return [
    {
      label: "Apply-attempt",
      apply: (draft) => {
        draft.applyAttemptStepIds = ["starting-equipment-level-5"];
      },
    },
    {
      label: "completed-step",
      apply: (draft) => {
        draft.applyCompletedStepIds = ["class-level-1"];
      },
    },
    {
      label: "actor-update",
      apply: (draft) => {
        draft.applyRecoveryActorUpdate = { "system.details.level.value": 5 };
      },
    },
    {
      label: "spell-attestation",
      apply: (draft) => {
        draft.applySpellRarityAttestations = [spellEvidence()];
      },
    },
    {
      label: "class-grant journal",
      apply: (draft) => {
        draft.acquisition = {
          ...draft.acquisition!,
          classGrantReconciliations: [
            {
              version: 1,
              draftId: "draft-1",
              batchId: "batch-1",
              phase: "before-acquisition",
              entries: [{ grantId: draft.acquisition!.plannedClassGrants[0]!.grantId, status: "pending", itemIds: [] }],
              ignoredItemIds: [],
              unresolvedGrantIds: [],
              ambiguousGrantIds: [],
            },
          ],
        };
      },
    },
    {
      label: "currency-witness",
      apply: (draft) => {
        const acquisition = draft.acquisition!;
        const disposition = acquisition.disposition;
        if (disposition.kind !== "purchase-ledger") throw new Error("Expected reviewed fixture.");
        draft.acquisition = {
          ...acquisition,
          currencyConvergenceWitness: createAcquisitionCurrencyConvergenceWitness({
            actorId: "actor-1",
            draftId: acquisition.draftId,
            batchId: acquisition.batchId,
            manifestId: acquisition.manifestId,
            ledgerDigest: "reviewed-ledger",
            baselineFingerprint: acquisition.baseline!.fingerprint,
            preCopper: 0,
            targetCopper: disposition.review.remainingCopper,
            observedCopper: disposition.review.remainingCopper,
            verifiedAt: NOW,
          }),
        };
      },
    },
  ];
}

function spellEvidence(): AppliedSpellRarityAttestation {
  return {
    version: 1,
    kind: "spell-rarity-access",
    trust: "player-attestation",
    status: "attested",
    subject: {
      actorId: "actor-1",
      slotId: "spell-choice-wizard-level-1",
      stepId: "spell-choice-wizard-level-1",
      targetLevel: 1,
      stepLevel: 1,
      destinationKey: "wizard-spellbook",
      stepRarityCeiling: "common",
      worldRarityCeiling: "common",
    },
    claimedBasis: "rules-access",
    reason: "Wizard access.",
    authorUserId: FIRST_OWNER.id,
    authorName: FIRST_OWNER.name,
    attestedAt: ORIGINAL_AT,
    subjectLabel: "Wizard spells",
    selectedSpells: [
      {
        slotId: "spell-choice-wizard-level-1",
        packId: "pf2e.spells-srd",
        documentId: "forbidding-ward",
        uuid: "Compendium.pf2e.spells-srd.Item.forbidding-ward",
        itemType: "spell",
        featType: null,
        name: "Forbidding Ward",
        level: 1,
      },
    ],
  };
}
