import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { DraftState, PendingStep, SelectionRef } from "../src/types";
import { projectPlannedClassGrants } from "../src/wayfinder/application/class-grant-projection-service";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import {
  assertPreparedClassGrantPlanMatches,
  normalizePlannedClassGrant,
  type ObservedClassGrantItem,
  type PlannedClassGrantV1,
  reconcilePlannedClassGrants,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { findUnsupportedPhysicalGrantRoutes } from "../src/wayfinder/domain/physical-grant-coverage";
import {
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
  type ThaumaturgeFixedImplement,
  type ThaumaturgeImplementOrigin,
  CLASS_GRANT_PROFILE_UUIDS as UUID,
} from "../src/wayfinder/domain/physical-grant-route-registry";

interface SourceDocument {
  _id: string;
  name: string;
  type: string;
  sourceId?: string;
  system: {
    rules?: Record<string, unknown>[];
    items?: Record<string, { uuid: string; level: number }>;
    [key: string]: unknown;
  };
}

const fixture = JSON.parse(readFileSync(resolve("tests/fixtures/pf2e-thaumaturge-implements-8.5.1.json"), "utf8")) as {
  documents: Record<string, SourceDocument>;
};
const FIRST = THAUMATURGE_IMPLEMENT_ORIGINS[0];
const SECOND = THAUMATURGE_IMPLEMENT_ORIGINS[1];
const AMULET = THAUMATURGE_FIXED_IMPLEMENTS[0];
const BELL = THAUMATURGE_FIXED_IMPLEMENTS[1];
const CASES = THAUMATURGE_IMPLEMENT_ORIGINS.flatMap((origin) =>
  THAUMATURGE_FIXED_IMPLEMENTS.map((implement) => ({ implement, origin }))
);

describe("Thaumaturge fixed implement equipment authority", () => {
  it.each(CASES)("projects canonical $implement.name from the $origin.key implement", async ({ implement, origin }) => {
    const draft = thaumaturgeDraft(origin.level);
    if (origin.key === "second") {
      setImplement(draft, FIRST, implement.slug === "amulet" ? BELL : AMULET);
    }
    setImplement(draft, origin, implement);

    const result = await project(draft);
    expect(result.blockers).toEqual([]);
    expect(result.grants).toHaveLength(origin.key === "first" ? 1 : 2);
    expect(result.preparedPlan).not.toBeNull();
    expect(result.grants).toContainEqual({
      version: 1,
      profileId: `thaumaturge-${implement.slug}-implement-${origin.key}`,
      grantId: `class-grant:thaumaturge-${implement.slug}-implement:${origin.slotId}`,
      origin: { sourceSlotId: origin.slotId, sourceUuid: featureUuid(implement.featureId) },
      granterSourceUuid: featureUuid(implement.featureId),
      expected: { sourceUuid: equipmentUuid(implement.itemId), quantity: 1, itemType: "equipment" },
      nativeGrantChainSourceUuids: [featureUuid(implement.featureId), origin.selectorUuid, UUID.thaumaturgeClass],
      fundingLane: "class-grant",
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
    });
  });

  it("preserves both distinct level-five implements and their grant plan through save/reopen", async () => {
    const draft = twoImplementDraft();
    const original = await project(draft);
    draft.acquisition = {
      ...createAcquisitionDraft({
        draftId: "draft-47",
        batchId: "batch-47",
        manifestId: "manifest-47",
        targetLevel: 5,
        recipe: { kind: "permanent-items" },
      }),
      plannedClassGrants: [...original.grants],
    };
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(draft)), 1);
    expect(reopened.acquisitionCorrupt).toBe(false);
    expect(reopened.branchSelections).toEqual(draft.branchSelections);
    expect(reopened.acquisition?.plannedClassGrants).toEqual(original.grants);

    const prepared = await project(reopened);
    expect(prepared.blockers).toEqual([]);
    expect(prepared.preparedPlan?.fingerprint).toBe(original.preparedPlan?.fingerprint);
    expect(() =>
      assertPreparedClassGrantPlanMatches({
        plan: prepared.preparedPlan!,
        actorId: "actor-47",
        draftId: "draft-47",
        batchId: "batch-47",
        targetLevel: 5,
        persistedGrants: reopened.acquisition!.plannedClassGrants,
      })
    ).not.toThrow();
  });

  it("authenticates the complete native graph across acquisition phases and retry", async () => {
    const draft = twoImplementDraft();
    const result = await project(draft);
    const actorItems = nativeGraph(result.grants);
    actorItems.push(observed("foreign-amulet", equipmentUuid(AMULET.itemId), "equipment"));
    for (const phase of ["before-acquisition", "after-acquisition", "final"] as const) {
      const reconciled = reconcile(result.grants, actorItems, phase);
      expect(reconciled.entries).toEqual(
        result.grants.map((grant) => ({
          grantId: grant.grantId,
          status: "resolved",
          itemIds: [`${grant.profileId}-item`],
        }))
      );
      expect(reconciled.ignoredItemIds).not.toContain("foreign-amulet");
      expect(reconciled.unresolvedGrantIds).toEqual([]);
      expect(reconciled.ambiguousGrantIds).toEqual([]);
    }

    const retryItems = actorItems.filter((item) => item.itemId !== "foreign-amulet");
    const retrySnapshot = structuredClone(retryItems);
    const retried = await project(draft, documents(), retryItems, []);
    expect(retried.blockers).toEqual([]);
    expect(retried.preparedPlan?.fingerprint).toBe(result.preparedPlan?.fingerprint);
    expect(reconcile(retried.grants, retryItems, "final")).toEqual(reconcile(result.grants, retryItems, "final"));
    expect(retryItems).toEqual(retrySnapshot);
    expect(retryItems.filter((item) => item.itemType === "equipment")).toHaveLength(2);
  });

  it("rejects an unowned lookalike, wrong ancestry, wrong origin, or doubled physical quantity", async () => {
    const result = await project(singleImplementDraft());
    const grant = result.grants[0]!;
    const graph = nativeGraph([grant]);
    for (const actorItems of [
      [observed("unowned", grant.expected.sourceUuid, "equipment")],
      graph.map((item) => (item.itemId === "class" ? { ...item, sourceUuid: UUID.alchemistClass } : item)),
      graph.map((item) =>
        item.sourceUuid === grant.origin.sourceUuid ? { ...item, wayfinderSlotId: SECOND.slotId } : item
      ),
      graph.map((item) => (item.itemType === "equipment" ? { ...item, quantity: 2 } : item)),
    ]) {
      expect(reconcile([grant], actorItems, "before-acquisition").entries[0]?.status).toBe("pending");
      for (const phase of ["after-acquisition", "final"] as const) {
        expect(reconcile([grant], actorItems, phase)).toMatchObject({
          entries: [{ status: "unresolved", itemIds: [] }],
          ignoredItemIds: [],
          unresolvedGrantIds: [grant.grantId],
        });
      }
      expect(await project(singleImplementDraft(), documents(), actorItems)).toMatchObject({
        grants: [],
        preparedPlan: null,
        blockers: [{ code: "source-drift" }],
      });
    }
  });

  it("rejects duplicate authoritative physical grants rather than arbitrarily claiming one", async () => {
    const { grants } = await project(singleImplementDraft());
    const graph = nativeGraph(grants);
    const duplicate = { ...graph.find((item) => item.itemType === "equipment")!, itemId: "duplicate" };
    expect(reconcile(grants, [...graph, duplicate], "final")).toMatchObject({
      entries: [{ status: "ambiguous" }],
      ignoredItemIds: [],
      ambiguousGrantIds: [grants[0]!.grantId],
    });
    expect(await project(singleImplementDraft(), documents(), [...graph, duplicate])).toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "source-drift" }],
    });
    const lookalike = observed("foreign", grants[0]!.expected.sourceUuid, "equipment");
    expect(await project(singleImplementDraft(), documents(), [...graph, lookalike])).toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "source-drift" }],
    });
  });

  it.each(CASES)("rejects altered persisted $implement.name/$origin.key authority", async ({ implement, origin }) => {
    const draft = thaumaturgeDraft(origin.level);
    if (origin.key === "second") setImplement(draft, FIRST, implement.slug === "amulet" ? BELL : AMULET);
    setImplement(draft, origin, implement);
    const { grants } = await project(draft);
    const grant = grants.find((entry) => entry.profileId === `thaumaturge-${implement.slug}-implement-${origin.key}`)!;
    expect(normalizePlannedClassGrant(JSON.parse(JSON.stringify(grant)))).toEqual(grant);
    for (const raw of [
      { ...grant, origin: { ...grant.origin, sourceSlotId: origin.key === "first" ? SECOND.slotId : FIRST.slotId } },
      { ...grant, origin: { ...grant.origin, sourceUuid: UUID.thaumaturgeClass } },
      { ...grant, expected: { ...grant.expected, sourceUuid: equipmentUuid("foreign") } },
      { ...grant, granterSourceUuid: featureUuid("foreign") },
      { ...grant, nativeGrantChainSourceUuids: [grant.granterSourceUuid, UUID.thaumaturgeClass] },
      { ...grant, nativeGrantChainSourceUuids: [grant.granterSourceUuid, SECOND.selectorUuid, UUID.alchemistClass] },
    ])
      expect(normalizePlannedClassGrant(raw)).toBeNull();
  });

  it.each([
    UUID.thaumaturgeClass,
    FIRST.selectorUuid,
    featureUuid(AMULET.featureId),
    equipmentUuid(AMULET.itemId),
  ])("blocks missing canonical source %s", async (uuid) => {
    const source = documents();
    source.delete(uuid);
    expect(await project(singleImplementDraft(), source)).toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "source-missing" }],
    });
  });

  it.each([
    [
      "selector query",
      FIRST.selectorUuid,
      (doc: SourceDocument) => {
        rule(doc, "ChoiceSet").choices = { filter: ["item:tag:other"] };
      },
    ],
    [
      "selector item type",
      FIRST.selectorUuid,
      (doc: SourceDocument) => {
        rule(doc, "ChoiceSet").choices = { filter: ["item:tag:thaumaturge-implement"], itemType: "weapon" };
      },
    ],
    [
      "selector grant",
      FIRST.selectorUuid,
      (doc: SourceDocument) => {
        rule(doc, "GrantItem").uuid = equipmentUuid(AMULET.itemId);
      },
    ],
    [
      "physical target",
      featureUuid(AMULET.featureId),
      (doc: SourceDocument) => {
        rule(doc, "GrantItem").uuid = equipmentUuid("different");
      },
    ],
    [
      "conditional physical grant",
      featureUuid(AMULET.featureId),
      (doc: SourceDocument) => {
        rule(doc, "GrantItem").predicate = ["unexpected"];
      },
    ],
    [
      "additional rule",
      featureUuid(AMULET.featureId),
      (doc: SourceDocument) => {
        doc.system.rules!.push({ key: "GrantItem", uuid: equipmentUuid("extra") });
      },
    ],
    [
      "item type",
      equipmentUuid(AMULET.itemId),
      (doc: SourceDocument) => {
        doc.type = "weapon";
      },
    ],
    [
      "quantity",
      equipmentUuid(AMULET.itemId),
      (doc: SourceDocument) => {
        doc.system.quantity = 2;
      },
    ],
    [
      "price",
      equipmentUuid(AMULET.itemId),
      (doc: SourceDocument) => {
        doc.system.price = { value: { gp: 1 } };
      },
    ],
    [
      "terminal extra rule",
      equipmentUuid(AMULET.itemId),
      (doc: SourceDocument) => {
        doc.system.rules!.push({ key: "GrantItem", uuid: equipmentUuid("extra") });
      },
    ],
    [
      "class selector level",
      UUID.thaumaturgeClass,
      (doc: SourceDocument) => {
        Object.values(doc.system.items!).find((entry) => entry.uuid.endsWith("First Implement and Esoterica"))!.level =
          2;
      },
    ],
    [
      "source identity",
      equipmentUuid(AMULET.itemId),
      (doc: SourceDocument) => {
        doc.sourceId = equipmentUuid("foreign");
      },
    ],
  ] as const)("blocks installed source drift: %s", async (_label, uuid, mutate) => {
    const source = documents();
    mutate(source.get(uuid)!);
    expect(await project(singleImplementDraft(), source)).toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "source-drift" }],
    });
  });

  it.each([
    ["third implement", "class-branch-third-implement-level-15", "branchSelections", UUID.thaumaturgeClass],
    ["dedication", "class-branch-thaumaturge-dedication-level-2", "branchSelections", UUID.thaumaturgeClass],
    ["foreign class", FIRST.slotId, "branchSelections", UUID.alchemistClass],
    ["foreign selection channel", FIRST.slotId, "selections", UUID.thaumaturgeClass],
  ] as const)("does not promote fixed implements from %s", async (_label, slotId, channel, rootUuid) => {
    const draft = thaumaturgeDraft(15);
    draft.selections["class-level-1"].uuid = rootUuid;
    draft[channel][slotId] = implementSelection(slotId, AMULET);
    const active = [{ slotId: "class-level-1" }, { slotId }] as PendingStep[];
    expect(findUnsupportedPhysicalGrantRoutes(draft, active)).toMatchObject([
      { code: "unsupported-physical-grant", sourceSlotId: slotId },
    ]);
    const fetchDocumentByUuid = vi.fn(async () => null);
    const result = await projectPlannedClassGrants({
      ...subject(draft),
      draft,
      activeSteps: active,
      observedActorItems: [],
      fetchDocumentByUuid,
    });
    expect(result.preparedPlan).toBeNull();
    expect(result.grants).toEqual([]);
    expect(fetchDocumentByUuid).not.toHaveBeenCalled();
  });

  it("blocks duplicate first/second selections because PF2E reuses same-source grants", async () => {
    const draft = thaumaturgeDraft(5);
    setImplement(draft, FIRST, AMULET);
    setImplement(draft, SECOND, AMULET);
    const result = await project(draft);
    expect(result.grants).toEqual([]);
    expect(result.preparedPlan).toBeNull();
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ code: "unsupported-physical-grant" });
  });

  it("retargets to level one without letting an inactive stale second selection block the first", async () => {
    const draft = thaumaturgeDraft(5);
    setImplement(draft, FIRST, AMULET);
    setImplement(draft, SECOND, AMULET);
    draft.targetLevel = 1;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(draft)), 1);
    const activeSteps = [{ slotId: "class-level-1" }, { slotId: FIRST.slotId }] as PendingStep[];

    const result = await project(reopened, documents(), [], activeSteps);
    expect(result.blockers).toEqual([]);
    expect(result.preparedPlan).not.toBeNull();
    expect(result.grants).toMatchObject([{ profileId: "thaumaturge-amulet-implement-first" }]);
    expect(result.grants).toHaveLength(1);
  });

  it("fails closed for a newly discovered Censer even if its source looks like a fixed implement", async () => {
    const draft = singleImplementDraft();
    draft.branchSelections[FIRST.slotId] = {
      ...draft.branchSelections[FIRST.slotId],
      name: "Censer",
      uuid: featureUuid("CenserCanary0001"),
    };
    const source = documents();
    source.set(featureUuid("CenserCanary0001"), {
      ...structuredClone(source.get(featureUuid(AMULET.featureId))!),
      _id: "CenserCanary0001",
      name: "Censer",
    });
    expect(await project(draft, source)).toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "unsupported-physical-grant", routeId: "thaumaturge-unreviewed-implement" }],
    });
  });
});

function documents(): Map<string, SourceDocument> {
  return new Map(Object.entries(structuredClone(fixture.documents)));
}

function thaumaturgeDraft(level = 1): DraftState {
  const draft = createEmptyDraft(level);
  draft.selections["class-level-1"] = {
    slotId: "class-level-1",
    packId: "pf2e.classes",
    documentId: "Y5GsHqzCzJlKka6x",
    uuid: UUID.thaumaturgeClass,
    itemType: "class",
    featType: null,
    name: "Thaumaturge",
    level: 1,
  };
  return draft;
}

function singleImplementDraft(): DraftState {
  const draft = thaumaturgeDraft();
  setImplement(draft, FIRST, AMULET);
  return draft;
}

function twoImplementDraft(): DraftState {
  const draft = thaumaturgeDraft(5);
  setImplement(draft, FIRST, AMULET);
  setImplement(draft, SECOND, BELL);
  return draft;
}

function setImplement(
  draft: DraftState,
  origin: ThaumaturgeImplementOrigin,
  implement: ThaumaturgeFixedImplement
): void {
  draft.branchSelections[origin.slotId] = { ...implementSelection(origin.slotId, implement), level: origin.level };
}

function implementSelection(slotId: string, implement: ThaumaturgeFixedImplement): SelectionRef {
  return {
    slotId,
    packId: "pf2e.classfeatures",
    documentId: implement.featureId,
    uuid: featureUuid(implement.featureId),
    itemType: "feat",
    featType: "classfeature",
    name: implement.name,
    level: 1,
  };
}

function subject(draft: DraftState) {
  return { actorId: "actor-47", draftId: "draft-47", batchId: "batch-47", targetLevel: draft.targetLevel };
}

async function project(
  draft: DraftState,
  source = documents(),
  observedActorItems: ObservedClassGrantItem[] = [],
  activeSteps = [
    { slotId: "class-level-1" },
    ...Object.values(draft.branchSelections).map((selection) => ({ slotId: selection.slotId })),
  ] as PendingStep[]
) {
  return projectPlannedClassGrants({
    ...subject(draft),
    draft,
    activeSteps,
    observedActorItems,
    fetchDocumentByUuid: async (uuid) => source.get(uuid) ?? null,
  });
}

function observed(
  itemId: string,
  sourceUuid: string,
  itemType: string,
  grantedByItemId: string | null = null,
  locationItemId: string | null = null,
  wayfinderSlotId: string | null = null
): ObservedClassGrantItem {
  return {
    itemId,
    sourceUuid,
    itemType,
    quantity: 1,
    grantedByItemId,
    locationItemId,
    wayfinderSlotId,
    acquisitionIdentity: null,
  };
}

function nativeGraph(grants: readonly PlannedClassGrantV1[]): ObservedClassGrantItem[] {
  return [
    observed("class", UUID.thaumaturgeClass, "class", null, null, "class-level-1"),
    ...grants.flatMap((grant) => [
      observed(`${grant.profileId}-item`, grant.expected.sourceUuid, "equipment", `${grant.profileId}-feature`),
      observed(
        `${grant.profileId}-feature`,
        grant.granterSourceUuid,
        "feat",
        `${grant.profileId}-selector`,
        null,
        grant.origin.sourceSlotId
      ),
      observed(`${grant.profileId}-selector`, grant.nativeGrantChainSourceUuids[1]!, "feat", null, "class"),
    ]),
  ];
}

function reconcile(
  plan: readonly PlannedClassGrantV1[],
  actorItems: readonly ObservedClassGrantItem[],
  phase: "before-acquisition" | "after-acquisition" | "final"
) {
  return reconcilePlannedClassGrants({ plan, actorItems, phase, draftId: "draft-47", batchId: "batch-47" });
}

function rule(document: SourceDocument, key: string): Record<string, unknown> {
  return document.system.rules!.find((entry) => entry.key === key)!;
}

function featureUuid(id: string): string {
  return `Compendium.pf2e.classfeatures.Item.${id}`;
}
function equipmentUuid(id: string): string {
  return `Compendium.pf2e.equipment-srd.Item.${id}`;
}
