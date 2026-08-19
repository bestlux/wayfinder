import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import {
  captureActorEconomicBaseline,
  evaluateActorEconomicAdmission,
  executeWithActorEconomicBaselineRevalidation,
} from "../src/wayfinder/application/economic-baseline-service";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";

describe("economic baseline actor service", () => {
  it("captures physical identity, quantity, container, and source while excluding currency documents", () => {
    const actor = actorFixture([
      itemFixture({ id: "backpack", type: "backpack", quantity: 1 }),
      itemFixture({
        id: "rope",
        type: "equipment",
        quantity: 2,
        containerId: "backpack",
        sourceId: "Compendium.pf2e.equipment-srd.Item.rope",
        acquisition: {
          version: 1,
          draftId: "draft-1",
          batchId: "batch-1",
          manifestId: "manifest-1",
          lineId: "line-1",
          entryId: "entry-1",
          plannedItemId: "planned-item-1",
          plannedContainerId: null,
          plannedGrantId: null,
          stackingIntent: "aggregate",
        },
      }),
      itemFixture({ id: "gold", type: "treasure", quantity: 12, currency: true }),
      { id: "feat", type: "feat", isOfType: (type: string) => type === "feat" },
    ]);

    const baseline = captureActorEconomicBaseline(actor, { capturedAt: "2026-08-18T20:00:00.000Z" });
    expect(baseline.currencyCopper).toBe(1200);
    expect(baseline.physicalItems).toEqual([
      expect.objectContaining({ itemId: "backpack", quantity: 1, containerId: null }),
      expect.objectContaining({
        itemId: "rope",
        quantity: 2,
        containerId: "backpack",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.rope",
        acquisitionIdentity: expect.objectContaining({ entryId: "entry-1" }),
      }),
    ]);
  });

  it("fails closed on missing currency, malformed quantity, or unusable item classification", () => {
    expect(() => captureActorEconomicBaseline({ id: "actor-1", items: [] })).toThrow(/currency/u);
    expect(() =>
      captureActorEconomicBaseline(actorFixture([itemFixture({ id: "bad", type: "equipment", quantity: -1 })]))
    ).toThrow(/quantity/u);
    expect(() =>
      captureActorEconomicBaseline(actorFixture([{ id: "unknown", type: "equipment", quantity: 1 }]))
    ).toThrow(/classification/u);

    const normalizedNegative = itemFixture({ id: "bad-raw", type: "equipment", quantity: 1 });
    normalizedNegative._source.system.quantity = -1;
    expect(() => captureActorEconomicBaseline(actorFixture([normalizedNegative]))).toThrow(/quantity/u);

    const currencyMismatch = actorFixture([itemFixture({ id: "gold", type: "treasure", quantity: 1, currency: true })]);
    currencyMismatch.inventory.currency.copperValue = 200;
    expect(() => captureActorEconomicBaseline(currencyMismatch)).toThrow(/disagree/u);
  });

  it("fails closed on dangling or cyclic container links", () => {
    expect(() =>
      captureActorEconomicBaseline(
        actorFixture([itemFixture({ id: "rope", type: "equipment", quantity: 1, containerId: "missing" })])
      )
    ).toThrow(/dangling/u);

    expect(() =>
      captureActorEconomicBaseline(
        actorFixture([
          itemFixture({ id: "bag-a", type: "backpack", quantity: 1, containerId: "bag-b" }),
          itemFixture({ id: "bag-b", type: "backpack", quantity: 1, containerId: "bag-a" }),
        ])
      )
    ).toThrow(/cyclic/u);
  });

  it("captures PF2E physical subitems and binds them to their parent identity", () => {
    const parent = itemFixture({ id: "shield", type: "armor", quantity: 1 });
    const child = itemFixture({
      id: "reinforcing-rune",
      type: "equipment",
      quantity: 1,
      sourceId: "Compendium.pf2e.equipment-srd.Item.reinforcing-rune",
    });
    (parent as typeof parent & { subitems: { contents: [typeof child] } }).subitems = { contents: [child] };

    const baseline = captureActorEconomicBaseline(actorFixture([parent]), {
      capturedAt: "2026-08-18T20:00:00.000Z",
    });
    expect(baseline.physicalItems).toEqual([
      expect.objectContaining({ itemId: "reinforcing-rune", containerId: "shield" }),
      expect.objectContaining({ itemId: "shield", containerId: null }),
    ]);
  });

  it("admits an exact native class grant only through live authoritative reconciliation", () => {
    const u = CLASS_GRANT_PROFILE_UUIDS;
    const book = itemFixture({
      id: "book",
      type: "equipment",
      quantity: 1,
      sourceId: u.formulaBookItem,
    });
    (book.flags as Record<string, unknown>).pf2e = { grantedBy: { id: "formula" } };
    const actor = actorFixture([
      book,
      actorFeat("formula", u.formulaBookFeature, "alchemy"),
      {
        ...actorFeat("alchemy", u.alchemyFeature, null),
        system: { quantity: 1, location: "class" },
      },
      {
        ...actorFeat("class", u.alchemistClass, null),
        type: "class",
        flags: { [MODULE_ID]: { slotId: "class-level-1" } },
      },
    ]);
    const grant = createPlannedClassGrant({
      grantId: "class-grant:alchemist-formula-book:class-level-1",
      profileId: "alchemist-formula-book",
      origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
      granterSourceUuid: u.formulaBookFeature,
      expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
    });
    const result = evaluateActorEconomicAdmission({
      actor,
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      higherLevelStartEvidence: { kind: "not-required" },
      history: {
        previousCharacterAppliedAt: null,
        previousTargetLevel: null,
        completedAcquisitionManifestId: null,
        completedAcquisitionManifestCorrupt: false,
      },
      preparedClassGrantPlan: createPreparedClassGrantPlan({
        actorId: "actor-1",
        draftId: "draft-1",
        batchId: "batch-1",
        targetLevel: 1,
        grants: [grant],
      }),
      classGrantPhase: "final",
    });
    expect(result).toMatchObject({ kind: "eligible-empty" });
  });

  it("authenticates Investigator formula-book admission through the exact methodology slot", () => {
    const u = CLASS_GRANT_PROFILE_UUIDS;
    const book = itemFixture({ id: "book", type: "equipment", quantity: 1, sourceId: u.formulaBookItem });
    (book.flags as Record<string, unknown>).pf2e = { grantedBy: { id: "science" } };
    const science = actorFeat("science", u.alchemicalSciences, "methodology");
    science.flags[MODULE_ID] = { slotId: "class-branch-methodology-level-1" };
    const actor = actorFixture([
      book,
      science,
      { ...actorFeat("methodology", u.methodologyFeature, null), system: { quantity: 1, location: "class" } },
      { ...actorFeat("class", u.investigatorClass, null), type: "class" },
    ]);
    const grant = createPlannedClassGrant({
      grantId: "class-grant:investigator-formula-book:class-branch-methodology-level-1",
      profileId: "investigator-alchemical-sciences-formula-book",
      origin: {
        sourceSlotId: "class-branch-methodology-level-1",
        sourceUuid: u.alchemicalSciences,
      },
      granterSourceUuid: u.alchemicalSciences,
      expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [u.alchemicalSciences, u.methodologyFeature, u.investigatorClass],
    });
    const plan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const admission = () =>
      evaluateActorEconomicAdmission({
        actor,
        draftId: "draft-1",
        batchId: "batch-1",
        targetLevel: 1,
        higherLevelStartEvidence: { kind: "not-required" },
        history: {
          previousCharacterAppliedAt: null,
          previousTargetLevel: null,
          completedAcquisitionManifestId: null,
          completedAcquisitionManifestCorrupt: false,
        },
        preparedClassGrantPlan: plan,
        classGrantPhase: "final",
      });

    expect(admission()).toMatchObject({ kind: "eligible-empty" });
    science.flags[MODULE_ID] = { slotId: "wrong-methodology-slot" };
    expect(admission()).toMatchObject({
      kind: "handoff",
      handoff: { reasons: expect.arrayContaining([expect.objectContaining({ code: "unresolved-class-grant" })]) },
    });
  });

  it("re-captures immediately before write and leaves the write untouched on drift", async () => {
    const actor = actorFixture([]);
    const reviewed = captureActorEconomicBaseline(actor, { capturedAt: "2026-08-18T20:00:00.000Z" });
    actor.items.contents.push(itemFixture({ id: "gold", type: "treasure", quantity: 1, currency: true }));
    actor.inventory.currency.copperValue = 100;
    const write = vi.fn();

    const result = await executeWithActorEconomicBaselineRevalidation({ actor, reviewed, write });
    expect(result).toMatchObject({ ok: false, differences: [{ code: "currency" }] });
    expect(write).not.toHaveBeenCalled();
  });
});

function actorFixture(items: any[]) {
  const currencyCopper = items.reduce(
    (total, item) => total + (typeof item.assetValue?.copperValue === "number" ? item.assetValue.copperValue : 0),
    0
  );
  return {
    id: "actor-1",
    inventory: { currency: { copperValue: currencyCopper } },
    items: { contents: items },
  };
}

function itemFixture(options: {
  id: string;
  type: string;
  quantity: number;
  containerId?: string;
  sourceId?: string;
  acquisition?: unknown;
  currency?: boolean;
}) {
  return {
    id: options.id,
    type: options.type,
    quantity: options.quantity,
    isCurrency: options.currency ?? false,
    assetValue: options.currency ? { copperValue: options.quantity * 100 } : undefined,
    isOfType: (type: string) => type === "physical" || (type === "treasure" && options.type === "treasure"),
    system: { quantity: options.quantity, containerId: options.containerId ?? null },
    _source: {
      system: {
        quantity: options.quantity,
        containerId: options.containerId ?? null,
        price: options.currency ? { value: { gp: 1 }, per: 1 } : undefined,
      },
    },
    flags: {
      core: { sourceId: options.sourceId },
      [MODULE_ID]: { acquisition: options.acquisition },
    },
  };
}

function actorFeat(id: string, sourceId: string, grantedById: string | null) {
  return {
    id,
    type: "feat",
    quantity: 1,
    sourceId,
    isOfType: (type: string) => type === "feat",
    system: { quantity: 1 },
    flags: { pf2e: grantedById ? { grantedBy: { id: grantedById } } : {} },
  };
}
