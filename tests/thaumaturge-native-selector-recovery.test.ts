import { describe, expect, it } from "vitest";

import { MODULE_ID } from "../src/constants";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { DraftState, SelectionRef } from "../src/types";
import { findThaumaturgeNativeSelectorRecovery } from "../src/wayfinder/application/thaumaturge-native-selector-recovery";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import {
  createPlannedClassGrant,
  type ObservedClassGrantItem,
  type PlannedClassGrantV1,
  reconcilePlannedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  type ClassGrantProfileId,
  supportedPhysicalGrantRoute,
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
} from "../src/wayfinder/domain/physical-grant-route-registry";

const FIRST = THAUMATURGE_IMPLEMENT_ORIGINS[0];
const SECOND = THAUMATURGE_IMPLEMENT_ORIGINS[1];
const AMULET = THAUMATURGE_FIXED_IMPLEMENTS[0];
const WAND = THAUMATURGE_FIXED_IMPLEMENTS[7];
const CLASS_ID = "cccccccccccccccc";
const FEATURE_ID = "ffffffffffffffff";
const PHYSICAL_ID = "pppppppppppppppp";
const MISSING_SELECTOR_ID = "MissingParent001";

interface RecoveryFixture {
  draft: DraftState;
  grant: PlannedClassGrantV1;
  actorItems: ObservedClassGrantItem[];
}

describe("Thaumaturge native selector recovery proof", () => {
  it.each([
    "attempt",
    "completed",
  ] as const)("proves only the original missing selector from a frozen %s", (journal) => {
    const fixture = recoveryFixture();
    if (journal === "completed") {
      fixture.draft.applyAttemptStepIds = [];
      fixture.draft.applyCompletedStepIds = [SECOND.slotId];
    }
    const snapshot = structuredClone(fixture);

    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual({
      selectorItemId: MISSING_SELECTOR_ID,
      selectorSourceUuid: SECOND.selectorUuid,
      featureItemId: FEATURE_ID,
      physicalItemId: PHYSICAL_ID,
      originSlotId: SECOND.slotId,
    });
    expect(fixture).toEqual(snapshot);
  });

  it("retains the proof after the recovery journal and canonical grant descriptions are saved and reopened", () => {
    const fixture = recoveryFixture();
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(fixture.draft)), 1);

    expect(reopened.acquisitionCorrupt).toBe(false);
    expect(reopened.acquisition?.plannedClassGrants).toEqual(fixture.draft.acquisition?.plannedClassGrants);
    expect(findThaumaturgeNativeSelectorRecovery({ ...fixture, draft: reopened })).toEqual(
      findThaumaturgeNativeSelectorRecovery(fixture)
    );
  });

  it("accepts a unique canonical class root without Wayfinder flags, matching ordinary native grant authority", () => {
    const fixture = recoveryFixture();
    const expected = findThaumaturgeNativeSelectorRecovery(fixture);
    replaceItem(fixture, 0, { wayfinderSlotId: null, wayfinderImportedBy: null });

    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(expected);
    fixture.actorItems.push(ownedSelector());
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(expected);
    expect(reconcile(fixture, "final").entries).toEqual([
      { grantId: fixture.grant.grantId, status: "resolved", itemIds: [PHYSICAL_ID] },
    ]);
  });

  it("does not count a proven partial graph as a reconciled physical grant in any phase", () => {
    const fixture = recoveryFixture();
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).not.toBeNull();
    for (const phase of ["before-acquisition", "after-acquisition", "final"] as const) {
      expect(reconcile(fixture, phase)).toMatchObject({
        entries: [
          { grantId: fixture.grant.grantId, status: phase === "before-acquisition" ? "pending" : "unresolved" },
        ],
        ignoredItemIds: [],
        unresolvedGrantIds: phase === "before-acquisition" ? [] : [fixture.grant.grantId],
        ambiguousGrantIds: [],
      });
    }
  });

  it.each([
    ["reciprocal link still pending", {}],
    ["reciprocal link complete", { implement: FEATURE_ID }],
  ] as const)("resumes the exact owned selector with its %s", (_label, itemGrants) => {
    const fixture = recoveryFixture();
    const missingParentProof = findThaumaturgeNativeSelectorRecovery(fixture);
    fixture.actorItems.push(ownedSelector({ itemGrants }));
    const snapshot = structuredClone(fixture);

    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(missingParentProof);
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(missingParentProof);
    expect(fixture).toEqual(snapshot);
    expect(reconcile(fixture, "final")).toMatchObject({
      entries: [{ grantId: fixture.grant.grantId, status: "resolved", itemIds: [PHYSICAL_ID] }],
      unresolvedGrantIds: [],
    });
  });

  it("keeps the original retry identity if selector creation succeeds before restoration persistence fails", () => {
    const fixture = recoveryFixture();
    const originalProof = findThaumaturgeNativeSelectorRecovery(fixture);
    fixture.actorItems.push(ownedSelector({ itemGrants: {} }));
    fixture.draft = normalizeDraft(JSON.parse(JSON.stringify(fixture.draft)), 1);
    const retrySnapshot = structuredClone(fixture);

    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(originalProof);
    expect(fixture).toEqual(retrySnapshot);
    fixture.actorItems[3] = ownedSelector({ itemGrants: { implement: FEATURE_ID } });
    const restoredSnapshot = structuredClone(fixture);
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(originalProof);
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toEqual(originalProof);
    expect(fixture).toEqual(restoredSnapshot);
    expect(fixture.actorItems.filter((item) => item.sourceUuid === SECOND.selectorUuid)).toHaveLength(1);
    expect(fixture.actorItems.filter((item) => item.sourceUuid === fixture.grant.expected.sourceUuid)).toHaveLength(1);
  });

  it("leaves an unowned complete native graph to ordinary reconciliation instead of recovering its selector", () => {
    const fixture = recoveryFixture();
    fixture.actorItems.push(observed(MISSING_SELECTOR_ID, SECOND.selectorUuid, "feat", { locationItemId: CLASS_ID }));
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toBeNull();
    for (const phase of ["before-acquisition", "after-acquisition", "final"] as const) {
      expect(reconcile(fixture, phase)).toMatchObject({
        entries: [{ grantId: fixture.grant.grantId, status: "resolved", itemIds: [PHYSICAL_ID] }],
        unresolvedGrantIds: [],
        ambiguousGrantIds: [],
      });
    }
  });

  it.each([
    ["type", { itemType: "equipment" }],
    ["source", { sourceUuid: FIRST.selectorUuid }],
    ["quantity", { quantity: 2 }],
    ["slot", { wayfinderSlotId: FIRST.slotId }],
    ["missing import", { wayfinderImportedBy: null }],
    ["foreign import", { wayfinderImportedBy: "another-module" }],
    ["missing root location", { locationItemId: null }],
    ["foreign root location", { locationItemId: "foreign-root" }],
    ["granted-by parent", { grantedByItemId: FEATURE_ID }],
    ["unknown additional grant", { itemGrants: { implement: FEATURE_ID, unexpected: "foreign-feature" } }],
    ["unknown reciprocal key", { itemGrants: { unexpected: FEATURE_ID } }],
    ["foreign reciprocal grant", { itemGrants: { implement: "foreign-feature" } }],
  ] satisfies readonly [
    string,
    Partial<ObservedClassGrantItem>,
  ][])("rejects an existing selector with altered %s", (_label, overrides) => {
    const fixture = recoveryFixture();
    fixture.actorItems.push(ownedSelector(overrides));
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toBeNull();
  });

  it("rejects an otherwise owned selector if another actor item has the same selector source", () => {
    const fixture = recoveryFixture();
    fixture.actorItems.push(ownedSelector(), ownedSelector({ itemId: "another-selector" }));
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toBeNull();
  });

  it.each([
    ["the exact physical ID", PHYSICAL_ID, "Compendium.pf2e.equipment-srd.Item.foreign"],
    ["the physical source on another ID", "baseline-foreign", equipmentUuid(WAND.itemId)],
  ] as const)("rejects baseline ownership of %s", (_label, itemId, sourceUuid) => {
    const fixture = recoveryFixture();
    fixture.draft.acquisition = {
      ...fixture.draft.acquisition!,
      baseline: createEconomicBaseline({
        actorId: "actor-47",
        capturedAt: "2026-10-14T20:00:00.000Z",
        currencyCopper: 0,
        physicalItems: [
          { itemId, sourceUuid, type: "equipment", quantity: 1, containerId: null, acquisitionIdentity: null },
        ],
      }),
    };
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toBeNull();
  });

  const rejectedEvidence: readonly [string, (fixture: RecoveryFixture) => void][] = [
    [
      "duplicate physical source",
      (fixture) => fixture.actorItems.push({ ...fixture.actorItems[2]!, itemId: "other-physical" }),
    ],
    [
      "duplicate feature source",
      (fixture) => fixture.actorItems.push({ ...fixture.actorItems[1]!, itemId: "other-feature" }),
    ],
    ["duplicate class", (fixture) => fixture.actorItems.push({ ...fixture.actorItems[0]!, itemId: "other-class" })],
    [
      "foreign second class",
      (fixture) => fixture.actorItems.push(observed("other-class", CLASS_GRANT_PROFILE_UUIDS.alchemistClass, "class")),
    ],
    [
      "missing physical item",
      (fixture) => {
        fixture.actorItems.splice(2, 1);
      },
    ],
    [
      "missing feature",
      (fixture) => {
        fixture.actorItems.splice(1, 1);
      },
    ],
    [
      "missing class",
      (fixture) => {
        fixture.actorItems.splice(0, 1);
      },
    ],
    ["wrong physical quantity", (fixture) => replaceItem(fixture, 2, { quantity: 2 })],
    ["wrong feature quantity", (fixture) => replaceItem(fixture, 1, { quantity: 2 })],
    ["wrong physical source", (fixture) => replaceItem(fixture, 2, { sourceUuid: equipmentUuid(AMULET.itemId) })],
    ["wrong feature source", (fixture) => replaceItem(fixture, 1, { sourceUuid: featureUuid(AMULET.featureId) })],
    [
      "wrong observed class source",
      (fixture) => replaceItem(fixture, 0, { sourceUuid: CLASS_GRANT_PROFILE_UUIDS.alchemistClass }),
    ],
    ["wrong physical type", (fixture) => replaceItem(fixture, 2, { itemType: "weapon" })],
    ["wrong feature type", (fixture) => replaceItem(fixture, 1, { itemType: "equipment" })],
    ["wrong class type", (fixture) => replaceItem(fixture, 0, { itemType: "feat" })],
    ["foreign feature import", (fixture) => replaceItem(fixture, 1, { wayfinderImportedBy: "another-module" })],
    ["absent feature import", (fixture) => replaceItem(fixture, 1, { wayfinderImportedBy: null })],
    ["wrong feature slot", (fixture) => replaceItem(fixture, 1, { wayfinderSlotId: FIRST.slotId })],
    ["feature owned by another class item", (fixture) => replaceItem(fixture, 1, { locationItemId: CLASS_ID })],
    ["missing reciprocal grant", (fixture) => replaceItem(fixture, 1, { itemGrants: {} })],
    ["wrong reciprocal grant key", (fixture) => replaceItem(fixture, 1, { itemGrants: { implement: PHYSICAL_ID } })],
    [
      "wrong reciprocal grant ID",
      (fixture) => replaceItem(fixture, 1, { itemGrants: { wandImplement: "other-physical" } }),
    ],
    ["missing original selector ID", (fixture) => replaceItem(fixture, 1, { grantedByItemId: null })],
    ["malformed original selector ID", (fixture) => replaceItem(fixture, 1, { grantedByItemId: "too-short" })],
    ["wrong physical parent", (fixture) => replaceItem(fixture, 2, { grantedByItemId: "foreign-feature" })],
    ["missing physical parent", (fixture) => replaceItem(fixture, 2, { grantedByItemId: null })],
    [
      "acquisition-stamped physical item",
      (fixture) =>
        replaceItem(fixture, 2, {
          acquisitionIdentity: {
            version: 1,
            draftId: "draft-47",
            batchId: "batch-47",
            manifestId: "manifest-47",
            lineId: "foreign-line",
            entryId: "foreign-entry",
            plannedItemId: PHYSICAL_ID,
            plannedContainerId: null,
            plannedGrantId: fixture.grant.grantId,
            stackingIntent: "separate",
          },
        }),
    ],
    [
      "occupied original selector ID",
      (fixture) => fixture.actorItems.push(observed(MISSING_SELECTOR_ID, featureUuid("foreign"), "feat")),
    ],
    [
      "selector source already present under another ID",
      (fixture) => fixture.actorItems.push(observed("other-selector", SECOND.selectorUuid, "feat")),
    ],
    [
      "unknown descendant claims the original selector",
      (fixture) =>
        fixture.actorItems.push(
          observed("foreign-child", featureUuid("foreign"), "feat", {
            grantedByItemId: MISSING_SELECTOR_ID,
          })
        ),
    ],
    [
      "unknown located item claims the original selector",
      (fixture) =>
        fixture.actorItems.push(
          observed("foreign-child", featureUuid("foreign"), "feat", {
            locationItemId: MISSING_SELECTOR_ID,
          })
        ),
    ],
    [
      "foreign reciprocal claim on the original selector",
      (fixture) =>
        fixture.actorItems.push(
          observed("foreign-parent", featureUuid("foreign"), "feat", {
            itemGrants: { unexpected: MISSING_SELECTOR_ID },
          })
        ),
    ],
    [
      "absent recovery journal",
      (fixture) => {
        fixture.draft.applyAttemptStepIds = [];
      },
    ],
    [
      "only another origin is frozen",
      (fixture) => {
        fixture.draft.applyAttemptStepIds = [FIRST.slotId];
      },
    ],
    [
      "empty actor-update journal",
      (fixture) => {
        fixture.draft.applyRecoveryActorUpdate = {};
      },
    ],
    [
      "nested actor-update journal",
      (fixture) => {
        fixture.draft.applyRecoveryActorUpdate = { system: { details: { level: { value: 5 } } } };
      },
    ],
    [
      "serialized actor-update journal before normalization",
      (fixture) => {
        fixture.draft.applyRecoveryActorUpdate = {
          schemaVersion: 1,
          entries: [{ path: "system.details.level.value", value: 5 }],
        };
      },
    ],
    [
      "mixed foreign actor-update journal",
      (fixture) => {
        fixture.draft.applyRecoveryActorUpdate = {
          "system.details.level.value": 5,
          "flags.foreign": true,
        };
      },
    ],
    [
      "no acquisition",
      (fixture) => {
        fixture.draft.acquisition = null;
      },
    ],
    [
      "no economic baseline",
      (fixture) => {
        fixture.draft.acquisition = { ...fixture.draft.acquisition!, baseline: null };
      },
    ],
    [
      "acquisition target mismatch",
      (fixture) => {
        fixture.draft.acquisition = { ...fixture.draft.acquisition!, targetLevel: 1 };
      },
    ],
    [
      "target below the second origin",
      (fixture) => {
        fixture.draft.targetLevel = 1;
        fixture.draft.acquisition = { ...fixture.draft.acquisition!, targetLevel: 1 };
      },
    ],
    [
      "missing persisted grant",
      (fixture) => {
        fixture.draft.acquisition = {
          ...fixture.draft.acquisition!,
          plannedClassGrants: [implementGrant("thaumaturge-amulet-implement-first")],
        };
      },
    ],
    [
      "duplicated persisted grant",
      (fixture) => {
        fixture.draft.acquisition = {
          ...fixture.draft.acquisition!,
          plannedClassGrants: [...fixture.draft.acquisition!.plannedClassGrants, structuredClone(fixture.grant)],
        };
      },
    ],
    [
      "mismatched persisted grant",
      (fixture) => {
        fixture.draft.acquisition = {
          ...fixture.draft.acquisition!,
          plannedClassGrants: [
            fixture.draft.acquisition!.plannedClassGrants[0]!,
            { ...fixture.grant, origin: { ...fixture.grant.origin, sourceSlotId: FIRST.slotId } },
          ],
        };
      },
    ],
    [
      "non-Thaumaturge requested authority",
      (fixture) => {
        fixture.grant = implementGrant("alchemist-formula-book");
      },
    ],
    [
      "invalid requested authority",
      (fixture) => {
        fixture.grant = {
          ...fixture.grant,
          expected: { ...fixture.grant.expected, sourceUuid: equipmentUuid(AMULET.itemId) },
        };
      },
    ],
    [
      "foreign root class selection",
      (fixture) => {
        fixture.draft.selections["class-level-1"].uuid = CLASS_GRANT_PROFILE_UUIDS.alchemistClass;
      },
    ],
    [
      "wrong root class selection slot",
      (fixture) => {
        fixture.draft.selections["class-level-1"].slotId = "class-level-5";
      },
    ],
    [
      "wrong root class selection type",
      (fixture) => {
        fixture.draft.selections["class-level-1"].itemType = "feat";
      },
    ],
    [
      "missing root class selection",
      (fixture) => {
        delete fixture.draft.selections["class-level-1"];
      },
    ],
    [
      "wrong branch selection",
      (fixture) => {
        fixture.draft.branchSelections[SECOND.slotId].uuid = featureUuid(AMULET.featureId);
      },
    ],
    [
      "wrong branch selection slot",
      (fixture) => {
        fixture.draft.branchSelections[SECOND.slotId].slotId = FIRST.slotId;
      },
    ],
    [
      "wrong branch item type",
      (fixture) => {
        fixture.draft.branchSelections[SECOND.slotId].itemType = "equipment";
      },
    ],
    [
      "wrong branch feat type",
      (fixture) => {
        fixture.draft.branchSelections[SECOND.slotId].featType = "class";
      },
    ],
    [
      "missing branch selection",
      (fixture) => {
        delete fixture.draft.branchSelections[SECOND.slotId];
      },
    ],
  ];

  it.each(rejectedEvidence)("rejects %s", (_label, mutate) => {
    const fixture = recoveryFixture();
    mutate(fixture);
    expect(findThaumaturgeNativeSelectorRecovery(fixture)).toBeNull();
  });
});

function recoveryFixture(): RecoveryFixture {
  const grant = implementGrant("thaumaturge-wand-implement-second");
  const draft = createEmptyDraft(5);
  draft.applyAttemptStepIds = [SECOND.slotId];
  draft.applyRecoveryActorUpdate = { "system.details.level.value": 5 };
  draft.selections["class-level-1"] = selection(
    "class-level-1",
    CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass,
    "class",
    1
  );
  draft.branchSelections[FIRST.slotId] = selection(FIRST.slotId, featureUuid(AMULET.featureId), "feat", 1);
  draft.branchSelections[SECOND.slotId] = selection(SECOND.slotId, featureUuid(WAND.featureId), "feat", 5);
  draft.acquisition = {
    ...createAcquisitionDraft({
      draftId: "draft-47",
      batchId: "batch-47",
      manifestId: "manifest-47",
      targetLevel: 5,
      recipe: { kind: "permanent-items" },
    }),
    plannedClassGrants: [implementGrant("thaumaturge-amulet-implement-first"), grant],
    baseline: createEconomicBaseline({
      actorId: "actor-47",
      capturedAt: "2026-10-14T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    }),
  };
  return {
    draft,
    grant,
    actorItems: [
      observed(CLASS_ID, CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass, "class", {
        wayfinderSlotId: "class-level-1",
        wayfinderImportedBy: MODULE_ID,
      }),
      observed(FEATURE_ID, grant.granterSourceUuid, "feat", {
        grantedByItemId: MISSING_SELECTOR_ID,
        wayfinderSlotId: SECOND.slotId,
        wayfinderImportedBy: MODULE_ID,
        itemGrants: { wandImplement: PHYSICAL_ID },
      }),
      observed(PHYSICAL_ID, grant.expected.sourceUuid, "equipment", { grantedByItemId: FEATURE_ID }),
    ],
  };
}

function implementGrant(profileId: ClassGrantProfileId): PlannedClassGrantV1 {
  const { grant } = supportedPhysicalGrantRoute(profileId);
  return createPlannedClassGrant({
    profileId,
    grantId: grant.grantId!,
    origin: { sourceSlotId: grant.originSourceSlotId, sourceUuid: grant.originSourceUuid },
    granterSourceUuid: grant.granterSourceUuid,
    expected: { sourceUuid: grant.expectedSourceUuid!, quantity: 1, itemType: "equipment" },
    nativeGrantChainSourceUuids: grant.nativeGrantChainSourceUuids,
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
  });
}

function observed(
  itemId: string,
  sourceUuid: string,
  itemType: string,
  overrides: Partial<ObservedClassGrantItem> = {}
): ObservedClassGrantItem {
  return {
    itemId,
    sourceUuid,
    itemType,
    quantity: 1,
    grantedByItemId: null,
    locationItemId: null,
    wayfinderSlotId: null,
    acquisitionIdentity: null,
    ...overrides,
  };
}

function ownedSelector(overrides: Partial<ObservedClassGrantItem> = {}): ObservedClassGrantItem {
  return observed(MISSING_SELECTOR_ID, SECOND.selectorUuid, "feat", {
    wayfinderSlotId: SECOND.slotId,
    wayfinderImportedBy: MODULE_ID,
    locationItemId: CLASS_ID,
    itemGrants: { implement: FEATURE_ID },
    ...overrides,
  });
}

function replaceItem(fixture: RecoveryFixture, index: number, update: Partial<ObservedClassGrantItem>): void {
  fixture.actorItems[index] = { ...fixture.actorItems[index]!, ...update };
}

function selection(slotId: string, uuid: string, itemType: "class" | "feat", level: number): SelectionRef {
  return {
    slotId,
    uuid,
    packId: itemType === "class" ? "pf2e.classes" : "pf2e.classfeatures",
    documentId: uuid.split(".").at(-1)!,
    itemType,
    featType: itemType === "feat" ? "classfeature" : null,
    name: itemType === "class" ? "Thaumaturge" : "Implement",
    level,
  };
}

function reconcile(fixture: RecoveryFixture, phase: "before-acquisition" | "after-acquisition" | "final") {
  return reconcilePlannedClassGrants({
    plan: [fixture.grant],
    actorItems: fixture.actorItems,
    phase,
    draftId: "draft-47",
    batchId: "batch-47",
  });
}

function featureUuid(id: string): string {
  return `Compendium.pf2e.classfeatures.Item.${id}`;
}

function equipmentUuid(id: string): string {
  return `Compendium.pf2e.equipment-srd.Item.${id}`;
}
