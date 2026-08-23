import { describe, expect, it, vi } from "vitest";
import {
  createEquipmentCatalogueRecordSource,
  EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE,
} from "../src/wayfinder/application/equipment-catalogue-record-source";
import type { StartingEquipmentCatalogueRecord } from "../src/wayfinder/view-models";

function record(sourceUuid: string, name = sourceUuid): StartingEquipmentCatalogueRecord {
  return {
    sourceUuid,
    name,
    itemType: "equipment",
    level: 0,
    rarity: "common",
    sourceLabel: "Player Core",
    priceCopper: 10,
    priceLabel: "1 sp",
    bulkLabel: "L",
    handsLabel: null,
    traits: [],
    available: true,
    unavailableReason: null,
    exceptionRequestable: false,
    titanMaulerEligible: false,
  };
}

describe("equipment catalogue record source", () => {
  it("preserves an arbitrary order without materializing until the requested index", () => {
    const ordered = [record("source-c"), record("source-a"), record("source-b")];
    const materialize = vi.fn((index: number) => ordered[index]!);
    const source = createEquipmentCatalogueRecordSource(
      ordered.map((entry) => entry.sourceUuid),
      materialize
    );

    expect(source.sourceUuids).toEqual(["source-c", "source-a", "source-b"]);
    expect(materialize).not.toHaveBeenCalled();
    expect(source.recordAt(1)).toBe(ordered[1]);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledWith(1);
  });

  it("represents an empty result without consulting a materializer", () => {
    expect(EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE.sourceUuids).toEqual([]);
    expect(() => EMPTY_EQUIPMENT_CATALOGUE_RECORD_SOURCE.recordAt(0)).toThrow(RangeError);
  });

  it("fails closed on duplicate order identities and materializer drift", () => {
    expect(() => createEquipmentCatalogueRecordSource(["same", "same"], () => record("same"))).toThrow(/unique/i);
    const drifted = createEquipmentCatalogueRecordSource(["expected"], () => record("other"));
    expect(() => drifted.recordAt(0)).toThrow(/drifted/i);
  });
});
