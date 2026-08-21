import { describe, expect, it } from "vitest";
import { normalizeAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import {
  assertPreparedAcquisitionIdentityPlanMatches,
  derivePlannedContainerId,
  isPreparedAcquisitionIdentityPlan,
  mintAcquisitionIdentitySeed,
  mintAcquisitionLineId,
  prepareAcquisitionIdentityPlan,
} from "../src/wayfinder/domain/acquisition-identity";
import { evaluateAcquisitionLedger } from "../src/wayfinder/domain/acquisition-ledger";
import { createPreparedClassGrantPlan } from "../src/wayfinder/domain/class-grant-reconciliation";
import { acquisitionFixture, acquisitionLine, acquisitionPrice } from "./fixtures/acquisition-fixture";

describe("acquisition identity", () => {
  it("mints independent draft, batch, manifest, and line identities", () => {
    const values = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ];
    const seed = mintAcquisitionIdentitySeed(() => values.shift()!);

    expect(seed).toEqual({
      draftId: "wf-draft-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      batchId: "wf-batch-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      manifestId: "wf-manifest-cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(new Set(Object.values(seed)).size).toBe(3);
    expect(mintAcquisitionLineId(() => "dddddddd-dddd-4ddd-8ddd-dddddddddddd")).toBe(
      "wf-line-dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    );
  });

  it("derives stable container identities without reusing policy or batch identity", async () => {
    const first = await derivePlannedContainerId({
      batchId: "batch-1",
      parentEntryId: "entry-1",
      expansionPath: "kit/backpack",
    });
    const second = await derivePlannedContainerId({
      batchId: "batch-1",
      parentEntryId: "entry-1",
      expansionPath: "kit/backpack",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^wf-planned-container-sha256-[0-9a-f]{64}$/u);
    expect(first).not.toBe("batch-1");
    expect(first).not.toBe("policy-diagnostic-1");
  });

  it("derives a stable nine-item Adventurer's Pack graph without materializing the logical kit", async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      expansionPath: index === 0 ? "mca3x" : `mca3x/child-${index}`,
      parentPath: index === 0 ? null : "mca3x",
      sourceUuid: `Compendium.pf2e.equipment-srd.Item.child-${index}`,
      documentFingerprint: `child-fingerprint-${index}`,
      name: index === 0 ? "Backpack" : `Child ${index}`,
      itemType: index === 0 ? ("backpack" as const) : ("equipment" as const),
      quantity: index + 1,
      size: "medium" as const,
    }));
    const line = acquisitionLine({
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB",
      stackingIntent: "separate",
      kitExpansion: {
        version: 1,
        profile: "adventurers-pack-v1",
        requestedQuantity: 1,
        items,
      },
    });
    const fixture = acquisitionFixture({ lines: [line] });
    const plan = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...fixture });
    const reopened = await prepareAcquisitionIdentityPlan({
      actorId: "actor-1",
      ...acquisitionFixture({ lines: [structuredClone(line)] }),
    });

    expect(plan.fingerprint).toBe(reopened.fingerprint);
    expect(plan.entries[0]?.sourceUuid).toBe(line.sourceUuid);
    expect(plan.entries[0]?.plannedItems).toHaveLength(9);
    expect(plan.entries[0]?.plannedItems.some((item) => item.sourceUuid === line.sourceUuid)).toBe(false);
    const root = plan.entries[0]?.plannedItems[0];
    expect(root?.ownedContainerId).toMatch(/^wf-planned-container-sha256-/u);
    expect(
      plan.entries[0]?.plannedItems.slice(1).every((item) => item.plannedContainerId === root?.ownedContainerId)
    ).toBe(true);
  });

  it("keeps canonical entries stable across line ordering and save/reopen", async () => {
    const lines = [
      acquisitionLine({ lineId: "line-b", requestedQuantity: 2 }),
      acquisitionLine({ lineId: "line-a", requestedQuantity: 1 }),
    ];
    const fixture = acquisitionFixture({ lines });
    const original = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...fixture });

    const reorderedFixture = acquisitionFixture({ lines: [...lines].reverse() });
    const reordered = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...reorderedFixture });
    const reopenedDraft = normalizeAcquisitionDraft(structuredClone(fixture.draft));
    expect(reopenedDraft).not.toBeNull();
    const reopenedClassGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: reopenedDraft!.draftId,
      batchId: reopenedDraft!.batchId,
      targetLevel: reopenedDraft!.targetLevel,
      grants: reopenedDraft!.plannedClassGrants,
    });
    const reopenedLedger = evaluateAcquisitionLedger(reopenedDraft!, reopenedClassGrantPlan);
    expect(reopenedLedger).toEqual(fixture.ledger);
    const reopened = await prepareAcquisitionIdentityPlan({
      actorId: "actor-1",
      draft: reopenedDraft!,
      ledger: reopenedLedger,
      classGrantPlan: reopenedClassGrantPlan,
    });

    expect(isPreparedAcquisitionIdentityPlan(original)).toBe(true);
    expect(original.fingerprint).toBe(reordered.fingerprint);
    expect(original.fingerprint).toBe(reopened.fingerprint);
    expect(original.entries).toHaveLength(1);
    expect(original.entries[0]).toMatchObject({ lineIds: ["line-a", "line-b"], quantity: 3 });
  });

  it("changes entry identity for deliberate separation and material funding changes", async () => {
    const aggregateFixture = acquisitionFixture({ lines: [acquisitionLine()] });
    const aggregate = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...aggregateFixture });
    const separateFixture = acquisitionFixture({
      lines: [acquisitionLine({ stackingIntent: "separate" })],
    });
    const separate = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...separateFixture });
    const allowanceFixture = acquisitionFixture({
      lines: [
        acquisitionLine({
          funding: { lane: "allowance", assignment: { mode: "automatic" } },
        }),
      ],
    });
    const allowance = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...allowanceFixture });

    expect(aggregate.entries[0]?.entryId).not.toBe(separate.entries[0]?.entryId);
    expect(aggregate.entries[0]?.entryId).not.toBe(allowance.entries[0]?.entryId);
  });

  it("recomputes price.per rounding after aggregate quantities combine", async () => {
    const fixture = acquisitionFixture({
      lines: [
        acquisitionLine({
          lineId: "line-a",
          price: acquisitionPrice({ basePrice: { kind: "priced", value: { cp: 1 } }, pricePer: 3 }),
        }),
        acquisitionLine({
          lineId: "line-b",
          price: acquisitionPrice({
            basePrice: { kind: "priced", value: { cp: 1 } },
            pricePer: 3,
            requestedQuantity: 2,
          }),
        }),
      ],
    });
    const plan = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...fixture });

    expect(fixture.ledger.lines.map((line) => line.totalChargedCopper)).toEqual([0, 1]);
    expect(plan.entries[0]?.price).toMatchObject({ requestedQuantity: 3, materializedQuantity: 3, linePriceCopper: 1 });
  });

  it("binds the reviewed completion disposition and handoff acknowledgment", async () => {
    const fixture = acquisitionFixture();
    const plan = await prepareAcquisitionIdentityPlan({ actorId: "actor-1", ...fixture });
    const changed = {
      ...structuredClone(fixture.draft),
      disposition: {
        kind: "handoff" as const,
        handoff: {
          version: 1 as const,
          kind: "pf2e-sheet" as const,
          baselineFingerprint: fixture.draft.baseline!.fingerprint,
          reasons: [{ code: "nonzero-currency" as const, copper: 1 }],
        },
        acknowledgedByUserId: "owner-1",
        acknowledgedAt: "2026-08-19T12:00:00.000Z",
      },
    };

    expect(() => assertPreparedAcquisitionIdentityPlanMatches({ plan, actorId: "actor-1", draft: changed })).toThrow(
      /reviewed disposition/i
    );
  });
});
