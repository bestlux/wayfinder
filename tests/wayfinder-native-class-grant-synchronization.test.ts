import { describe, expect, it, vi } from "vitest";

import { buildDraftPatch, createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { DraftState, PendingStep } from "../src/types";
import type { NativeClassGrantLineRequest } from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import { synchronizeNativeClassGrantAuthority } from "../src/wayfinder/application/native-class-grant-synchronization-service";
import { createAcquisitionCurrencyConvergenceWitness } from "../src/wayfinder/domain/acquisition-currency-convergence";
import {
  evaluateAcquisitionCompletion,
  evaluateAcquisitionLedger,
  reviewPurchaseLedger,
  reviewRetainAll,
} from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import {
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  type PlannedClassGrantV1,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  supportedPhysicalGrantRoute,
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
  type ThaumaturgeFixedImplement,
  type ThaumaturgeImplementOrigin,
} from "../src/wayfinder/domain/physical-grant-route-registry";
import { acquisitionFixture, acquisitionLine, acquisitionPrice } from "./fixtures/acquisition-fixture";

const FIRST = THAUMATURGE_IMPLEMENT_ORIGINS[0];
const SECOND = THAUMATURGE_IMPLEMENT_ORIGINS[1];
const AMULET = THAUMATURGE_FIXED_IMPLEMENTS[0];
const BELL = THAUMATURGE_FIXED_IMPLEMENTS[1];
const CHALICE = THAUMATURGE_FIXED_IMPLEMENTS[2];
const ACTOR = { id: "actor-1" };
const REVIEWER = { userId: "owner-1", reviewedAt: "2026-10-14T20:00:00.000Z" };

describe("native class-grant authority after implement changes", () => {
  it.each([
    "retain-all",
    "purchase-ledger",
  ] as const)("replaces a reviewed Amulet with Bell and makes %s reviewable again", async (disposition) => {
    const oldGrant = implementGrant(AMULET);
    const newGrant = implementGrant(BELL);
    const draft = reviewedDraft([oldGrant], disposition);
    selectImplement(draft, FIRST, BELL);
    const original = structuredClone(draft);
    const prior = draft.acquisition!;
    const deps = dependencies([newGrant]);

    const result = await synchronizeNativeClassGrantAuthority(context(draft), deps);

    expect(result).toMatchObject({ changed: true, reason: "build-changed" });
    const refreshed = result.acquisition!;
    expect(refreshed.plannedClassGrants).toEqual([newGrant]);
    expect(refreshed.lines.filter((line) => line.funding.lane === "class-grant")).toEqual([nativeLine(newGrant)]);
    expect(refreshed.lines.some((line) => line.sourceUuid === oldGrant.expected.sourceUuid)).toBe(false);
    expect(refreshed.lines.filter((line) => line.funding.lane !== "class-grant")).toEqual(
      prior.lines.filter((line) => line.funding.lane !== "class-grant")
    );
    expect(refreshed).toMatchObject({
      draftId: prior.draftId,
      batchId: prior.batchId,
      manifestId: prior.manifestId,
      recipe: prior.recipe,
      recipeSelection: prior.recipeSelection,
      baseline: prior.baseline,
      policySnapshot: prior.policySnapshot,
      disposition: { kind: "unreviewed", invalidatedFrom: disposition, reasons: ["document"] },
    });
    expect(draft).toEqual(original);
    expect(deps.prepareClassGrantPlan).toHaveBeenCalledOnce();
    expect(deps.prepareNativeGrantLines).toHaveBeenCalledOnce();
    expect(deps.prepareNativeGrantLines.mock.calls[0]?.[0].acquisition.plannedClassGrants).toEqual([newGrant]);

    const freshPlan = preparedPlan(refreshed, [newGrant]);
    const ledger = evaluateAcquisitionLedger(refreshed, freshPlan);
    expect(ledger.blockers).toEqual([]);
    expect(evaluateAcquisitionCompletion(refreshed, ledger).complete).toBe(false);
    const reviewed =
      disposition === "retain-all"
        ? reviewRetainAll(refreshed, ledger, REVIEWER)
        : reviewPurchaseLedger(refreshed, ledger, REVIEWER);
    expect(evaluateAcquisitionCompletion(reviewed, evaluateAcquisitionLedger(reviewed, freshPlan)).complete).toBe(true);
  });

  it("preserves only current implement authority and the invalidated review through save/reopen", async () => {
    const draft = reviewedDraft([implementGrant(AMULET)]);
    selectImplement(draft, FIRST, BELL);
    const current = implementGrant(BELL);
    const result = await synchronizeNativeClassGrantAuthority(context(draft), dependencies([current]));
    draft.acquisition = result.acquisition;

    const reopened = normalizeDraft(JSON.parse(JSON.stringify(buildDraftPatch(draft))), 1);

    expect(reopened.acquisitionCorrupt).toBe(false);
    expect(reopened.branchSelections[FIRST.slotId]).toEqual(draft.branchSelections[FIRST.slotId]);
    expect(reopened.acquisition?.plannedClassGrants).toEqual([current]);
    expect(reopened.acquisition?.lines).toEqual([nativeLine(current)]);
    expect(reopened.acquisition?.disposition.kind).toBe("unreviewed");
    const deps = dependencies([current]);
    const unchanged = await synchronizeNativeClassGrantAuthority(context(reopened), deps);
    expect(unchanged).toEqual({ acquisition: reopened.acquisition, changed: false, reason: null });
    expect(deps.prepareClassGrantPlan).not.toHaveBeenCalled();
    expect(deps.prepareNativeGrantLines).not.toHaveBeenCalled();
  });

  it("replaces the second implement at level five while preserving the first grant and its line identity", async () => {
    const first = implementGrant(AMULET);
    const priorSecond = implementGrant(BELL, SECOND);
    const nextSecond = implementGrant(CHALICE, SECOND);
    const draft = reviewedDraft([first, priorSecond]);
    selectImplement(draft, SECOND, CHALICE);
    const priorFirstLine = draft.acquisition!.lines.find((line) => line.sourceUuid === first.expected.sourceUuid)!;
    const deps = dependencies([first, nextSecond]);
    deps.prepareNativeGrantLines.mockImplementation(async (request) =>
      request.classGrantPlan.grants.map((grant) => ({
        ...nativeLine(grant),
        lineId: `newly-prepared:${grant.grantId}`,
        documentFingerprint: "fresh-source-fingerprint",
      }))
    );

    const result = await synchronizeNativeClassGrantAuthority(context(draft), deps);

    expect(result.acquisition?.plannedClassGrants).toEqual([first, nextSecond]);
    expect(result.acquisition?.lines).toEqual([
      { ...priorFirstLine, documentFingerprint: "fresh-source-fingerprint" },
      {
        ...nativeLine(nextSecond),
        lineId: `newly-prepared:${nextSecond.grantId}`,
        documentFingerprint: "fresh-source-fingerprint",
      },
    ]);
    expect(result.acquisition?.lines).not.toContainEqual(nativeLine(priorSecond));
    expect(result.acquisition?.disposition.kind).toBe("unreviewed");
  });

  it("removes obsolete implement authority after changing class without discarding purchased items", async () => {
    const oldGrant = implementGrant(AMULET);
    const draft = reviewedDraft([oldGrant], "purchase-ledger");
    delete draft.selections["class-level-1"];
    delete draft.branchSelections[FIRST.slotId];
    const purchase = draft.acquisition!.lines.find((line) => line.funding.lane === "currency")!;

    const result = await synchronizeNativeClassGrantAuthority(context(draft), dependencies([]));

    expect(result).toMatchObject({ changed: true, reason: "build-changed" });
    expect(result.acquisition?.plannedClassGrants).toEqual([]);
    expect(result.acquisition?.lines).toEqual([purchase]);
    expect(result.acquisition?.disposition.kind).toBe("unreviewed");
  });

  it("leaves exact current authority and its reviewed disposition untouched", async () => {
    const grant = implementGrant(AMULET);
    const draft = reviewedDraft([grant]);
    const deps = dependencies([grant]);

    const result = await synchronizeNativeClassGrantAuthority(context(draft), deps);

    expect(result).toEqual({ acquisition: draft.acquisition, changed: false, reason: null });
    expect(result.acquisition).toBe(draft.acquisition);
    expect(deps.prepareClassGrantPlan).not.toHaveBeenCalled();
    expect(deps.prepareNativeGrantLines).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "duplicate",
    "wrong-source",
  ] as const)("repairs %s native line coverage even when the selected grant is current", async (coverage) => {
    const grant = implementGrant(AMULET);
    const draft = reviewedDraft([grant]);
    const originalLine = draft.acquisition!.lines[0]!;
    const lines =
      coverage === "missing"
        ? []
        : coverage === "duplicate"
          ? [originalLine, { ...originalLine, lineId: "duplicate-native-line" }]
          : [{ ...originalLine, sourceUuid: implementGrant(BELL).expected.sourceUuid }];
    draft.acquisition = { ...draft.acquisition!, lines };

    const result = await synchronizeNativeClassGrantAuthority(context(draft), dependencies([grant]));

    expect(result).toMatchObject({ changed: true, reason: "build-changed" });
    expect(result.acquisition?.plannedClassGrants).toEqual([grant]);
    expect(result.acquisition?.lines).toEqual([nativeLine(grant)]);
    expect(result.acquisition?.disposition.kind).toBe("unreviewed");
  });

  it.each([
    "uninitialized",
    "corrupt",
  ] as const)("does not invent acquisition authority for an %s draft", async (state) => {
    const draft = reviewedDraft([implementGrant(AMULET)]);
    selectImplement(draft, FIRST, BELL);
    if (state === "uninitialized") draft.acquisition = null;
    if (state === "corrupt") draft.acquisitionCorrupt = true;
    const deps = dependencies([implementGrant(BELL)]);

    expect(await synchronizeNativeClassGrantAuthority(context(draft), deps)).toEqual({
      acquisition: draft.acquisition,
      changed: false,
      reason: null,
    });
    expect(deps.prepareClassGrantPlan).not.toHaveBeenCalled();
    expect(deps.prepareNativeGrantLines).not.toHaveBeenCalled();
  });

  it.each([
    "apply-attempt",
    "actor-recovery",
    "grant-journal",
    "currency-witness",
  ] as const)("preserves %s recovery identity and avoids fresh projection", async (recovery) => {
    const draft = reviewedDraft([implementGrant(AMULET)]);
    selectImplement(draft, FIRST, BELL);
    if (recovery === "apply-attempt") draft.applyAttemptStepIds = ["starting-equipment-level-5"];
    if (recovery === "actor-recovery") draft.applyRecoveryActorUpdate = { "system.details.level.value": 5 };
    if (recovery === "grant-journal") {
      draft.acquisition = {
        ...draft.acquisition!,
        classGrantReconciliations: [
          {
            version: 1,
            draftId: "draft-1",
            batchId: "batch-1",
            phase: "before-acquisition",
            entries: [],
            ignoredItemIds: [],
            unresolvedGrantIds: [],
            ambiguousGrantIds: [],
          },
        ],
      };
    }
    if (recovery === "currency-witness") {
      draft.acquisition = {
        ...draft.acquisition!,
        currencyConvergenceWitness: createAcquisitionCurrencyConvergenceWitness({
          actorId: "actor-1",
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          ledgerDigest: "ledger-digest",
          baselineFingerprint: draft.acquisition!.baseline!.fingerprint,
          preCopper: 0,
          targetCopper: 1_000,
          observedCopper: 1_000,
          verifiedAt: REVIEWER.reviewedAt,
        }),
      };
    }
    const before = structuredClone(draft);
    const deps = dependencies([implementGrant(BELL)]);

    const result = await synchronizeNativeClassGrantAuthority(context(draft), deps);

    expect(result).toEqual({ acquisition: draft.acquisition, changed: false, reason: null });
    expect(result.acquisition).toBe(draft.acquisition);
    expect(draft).toEqual(before);
    expect(deps.prepareClassGrantPlan).not.toHaveBeenCalled();
    expect(deps.prepareNativeGrantLines).not.toHaveBeenCalled();
  });

  it.each([
    "projection",
    "native-lines",
  ] as const)("clears stale authority and review if current %s cannot be verified", async (failure) => {
    const oldGrant = implementGrant(AMULET);
    const draft = reviewedDraft([oldGrant], "purchase-ledger");
    selectImplement(draft, FIRST, BELL);
    const purchase = draft.acquisition!.lines.find((line) => line.funding.lane === "currency")!;
    const deps = dependencies([implementGrant(BELL)]);
    if (failure === "projection") deps.prepareClassGrantPlan.mockRejectedValue(new Error("Current source drift"));
    if (failure === "native-lines") deps.prepareNativeGrantLines.mockRejectedValue(new Error("Native source missing"));

    const result = await synchronizeNativeClassGrantAuthority(context(draft), deps);

    expect(result).toMatchObject({ changed: true, reason: "verification-failed" });
    expect(result.acquisition?.plannedClassGrants).toEqual([]);
    expect(result.acquisition?.lines).toEqual([purchase]);
    expect(result.acquisition?.disposition.kind).toBe("unreviewed");
    const ledger = evaluateAcquisitionLedger(result.acquisition!, preparedPlan(result.acquisition!, []));
    expect(evaluateAcquisitionCompletion(result.acquisition!, ledger).complete).toBe(false);
    expect(result.acquisition?.draftId).toBe(draft.acquisition?.draftId);
    expect(result.acquisition?.batchId).toBe(draft.acquisition?.batchId);
    expect(result.acquisition?.manifestId).toBe(draft.acquisition?.manifestId);
  });
});

function context(draft: DraftState) {
  return {
    actor: ACTOR,
    draft,
    steps: [
      { slotId: "class-level-1" },
      ...Object.values(draft.branchSelections).map((selection) => ({ slotId: selection.slotId })),
    ] as PendingStep[],
  };
}

function dependencies(grants: readonly PlannedClassGrantV1[]) {
  return {
    prepareClassGrantPlan: vi.fn(async (_actor: unknown, draft: DraftState) =>
      preparedPlan(draft.acquisition!, grants)
    ),
    prepareNativeGrantLines: vi.fn(async (request: NativeClassGrantLineRequest) =>
      request.classGrantPlan.grants.map(nativeLine)
    ),
  };
}

function preparedPlan(acquisition: AcquisitionDraftState, grants: readonly PlannedClassGrantV1[]) {
  return createPreparedClassGrantPlan({
    actorId: ACTOR.id,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    grants,
  });
}

function reviewedDraft(
  grants: readonly PlannedClassGrantV1[],
  disposition: "retain-all" | "purchase-ledger" = "retain-all"
): DraftState {
  const lines = grants.map(nativeLine);
  if (disposition === "purchase-ledger") lines.push(acquisitionLine({ lineId: "purchased-rope" }));
  const fixture = acquisitionFixture({ lines, plannedClassGrants: grants, disposition: "unreviewed" });
  const draft = createEmptyDraft(5);
  draft.selections["class-level-1"] = {
    slotId: "class-level-1",
    packId: "pf2e.classes",
    documentId: "Y5GsHqzCzJlKka6x",
    uuid: CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass,
    itemType: "class",
    featType: null,
    name: "Thaumaturge",
    level: 1,
  };
  for (const grant of grants) {
    const origin = THAUMATURGE_IMPLEMENT_ORIGINS.find((entry) => entry.slotId === grant.origin.sourceSlotId)!;
    const implement = THAUMATURGE_FIXED_IMPLEMENTS.find((entry) => grant.origin.sourceUuid.endsWith(entry.featureId))!;
    selectImplement(draft, origin, implement);
  }
  draft.acquisition =
    disposition === "retain-all"
      ? reviewRetainAll(fixture.draft, fixture.ledger, REVIEWER)
      : reviewPurchaseLedger(fixture.draft, fixture.ledger, REVIEWER);
  return draft;
}

function selectImplement(
  draft: DraftState,
  origin: ThaumaturgeImplementOrigin,
  implement: ThaumaturgeFixedImplement
): void {
  draft.branchSelections[origin.slotId] = {
    slotId: origin.slotId,
    packId: "pf2e.classfeatures",
    documentId: implement.featureId,
    uuid: `Compendium.pf2e.classfeatures.Item.${implement.featureId}`,
    itemType: "feat",
    featType: "classfeature",
    name: implement.name,
    level: origin.level,
  };
}

function implementGrant(
  implement: ThaumaturgeFixedImplement,
  origin: ThaumaturgeImplementOrigin = FIRST
): PlannedClassGrantV1 {
  const profileId = `thaumaturge-${implement.slug}-implement-${origin.key}` as const;
  const route = supportedPhysicalGrantRoute(profileId)!;
  return createPlannedClassGrant({
    profileId,
    grantId: route.grant.grantId!,
    origin: { sourceSlotId: origin.slotId, sourceUuid: route.grant.originSourceUuid },
    granterSourceUuid: route.grant.granterSourceUuid,
    expected: { sourceUuid: route.grant.expectedSourceUuid!, quantity: 1, itemType: "equipment" },
    nativeGrantChainSourceUuids: route.grant.nativeGrantChainSourceUuids,
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
  });
}

function nativeLine(grant: PlannedClassGrantV1): AcquisitionLineDraft {
  return acquisitionLine({
    lineId: `native:${grant.grantId}`,
    sourceUuid: grant.expected.sourceUuid,
    documentFingerprint: `native-document:${grant.profileId}`,
    priceFingerprint: `native-price:${grant.profileId}`,
    itemLevel: 0,
    funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
    stackingIntent: "separate",
    price: acquisitionPrice({ basePrice: { kind: "priced", value: {} }, sizeSensitive: false }),
  });
}
