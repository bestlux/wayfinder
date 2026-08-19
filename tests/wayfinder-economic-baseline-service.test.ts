import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../src/constants";
import {
  captureActorEconomicBaseline,
  executeWithActorEconomicBaselineRevalidation,
} from "../src/wayfinder/application/economic-baseline-service";

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
          draftId: "draft-1",
          batchId: "batch-1",
          lineId: "line-1",
          entryId: "entry-1",
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
