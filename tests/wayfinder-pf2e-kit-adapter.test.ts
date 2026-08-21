import { describe, expect, it, vi } from "vitest";
import { ADVENTURERS_PACK_UUID, prepareAdventurersPackExpansion } from "../src/wayfinder/application/pf2e-kit-adapter";

const CHILDREN = [
  ["mca3x", null, "Compendium.pf2e.equipment-srd.Item.3lgwjrFEsQVKzhh7", 1, "Backpack", "backpack"],
  ["mca3x/02xhi", "mca3x", "Compendium.pf2e.equipment-srd.Item.fyYnQf1NAx9fWFaS", 1, "Rope", "equipment"],
  ["mca3x/30xet", "mca3x", "Compendium.pf2e.equipment-srd.Item.VnPh324pKwd2ZB66", 1, "Waterskin", "equipment"],
  ["mca3x/afbn4", "mca3x", "Compendium.pf2e.equipment-srd.Item.xShIDyydOMkGvGNb", 10, "Chalk", "equipment"],
  ["mca3x/fabyb", "mca3x", "Compendium.pf2e.equipment-srd.Item.UlIxxLm71UdRgCFE", 1, "Flint and Steel", "equipment"],
  ["mca3x/jtagt", "mca3x", "Compendium.pf2e.equipment-srd.Item.L9ZV076913otGtiB", 2, "Rations", "equipment"],
  ["mca3x/lems2", "mca3x", "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS", 5, "Torch", "equipment"],
  ["mca3x/lpl11", "mca3x", "Compendium.pf2e.equipment-srd.Item.fagzYdmfYyMQ6J77", 1, "Bedroll", "equipment"],
  ["mca3x/z9tim", "mca3x", "Compendium.pf2e.equipment-srd.Item.81aHsD27HFGnq1Nt", 1, "Soap", "equipment"],
] as const;

describe("PF2E kit adapter", () => {
  it("captures a random-ID-free exact Adventurer's Pack graph and treats Small as Medium", async () => {
    const createGrantedItems = vi.fn(async ({ size }: { size: string }) =>
      CHILDREN.map(([, , sourceUuid, quantity, name, type], index) => ({
        id: `random-${index}`,
        name,
        type,
        system: { quantity, size },
        _stats: { compendiumSource: sourceUuid },
        toObject: () => source(sourceUuid, name, type),
      }))
    );
    const expansion = await prepareAdventurersPackExpansion({
      sourceUuid: ADVENTURERS_PACK_UUID,
      kitDocument: kitDocument(createGrantedItems),
      targetSize: "small",
      fetchDocumentByUuid: async (uuid) => childDocument(uuid),
    });

    expect(createGrantedItems).toHaveBeenCalledWith({ size: "med" });
    expect(expansion.snapshot).toMatchObject({ profile: "adventurers-pack-v1", requestedQuantity: 1 });
    expect(expansion.snapshot.items).toHaveLength(9);
    expect(expansion.snapshot.items[0]).toMatchObject({
      expansionPath: "mca3x",
      parentPath: null,
      quantity: 1,
      size: "medium",
    });
    expect(expansion.snapshot.items[1]).toMatchObject({
      expansionPath: "mca3x/02xhi",
      parentPath: "mca3x",
      quantity: 1,
      size: "medium",
    });
    expect(JSON.stringify(expansion.snapshot)).not.toContain("random-");
    expect(expansion.sources.size).toBe(9);
  });

  it("fail-closes before materialization when PF2E changes a child quantity or path", async () => {
    const granted = CHILDREN.map(([, , sourceUuid, quantity, name, type]) => ({
      name,
      type,
      system: { quantity: sourceUuid.endsWith("xShIDyydOMkGvGNb") ? 9 : quantity, size: "med" },
      _stats: { compendiumSource: sourceUuid },
    }));
    await expect(
      prepareAdventurersPackExpansion({
        sourceUuid: ADVENTURERS_PACK_UUID,
        kitDocument: kitDocument(vi.fn(async () => granted)),
        targetSize: "medium",
        fetchDocumentByUuid: async (uuid) => childDocument(uuid),
      })
    ).rejects.toThrow(/child .* changed/i);

    const drifted = kitDocument(vi.fn(async () => granted));
    (drifted.system.items.mca3x as { items: Record<string, unknown> }).items.extra = {};
    await expect(
      prepareAdventurersPackExpansion({
        sourceUuid: ADVENTURERS_PACK_UUID,
        kitDocument: drifted,
        targetSize: "medium",
        fetchDocumentByUuid: async (uuid) => childDocument(uuid),
      })
    ).rejects.toThrow(/stable item paths changed/i);
  });
});

function kitDocument(createGrantedItems: ReturnType<typeof vi.fn>) {
  const items: Record<string, unknown> = {};
  for (const [path] of CHILDREN) {
    const [root, child] = path.split("/");
    const rootEntry = (items[root!] ??= { items: {} }) as { items: Record<string, unknown> };
    if (child) rootEntry.items[child] = {};
  }
  return { type: "kit", system: { slug: "adventurers-pack", items }, createGrantedItems };
}

function childDocument(uuid: string) {
  const child = CHILDREN.find((entry) => entry[2] === uuid);
  return child ? { toObject: () => source(uuid, child[4], child[5]) } : null;
}

function source(uuid: string, name: string, type: string) {
  return { name, type, system: { quantity: 1 }, _stats: { compendiumSource: uuid } };
}
