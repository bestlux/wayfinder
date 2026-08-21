import { describe, expect, it } from "vitest";
import { EquipmentSourceHealthError } from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import { localizeStartingEquipmentError } from "../src/wayfinder/application/starting-equipment-failure";
import { localizeAcquisitionEnglish } from "./fixtures/acquisition-localization-fixture";

describe("starting equipment failure presentation", () => {
  it("keeps typed localized source diagnostics through a wrapped Apply failure", () => {
    const sourceFailure = new EquipmentSourceHealthError([
      {
        code: "equipment-pack-missing",
        packId: "battlezoo-bestiary-pf2e.equipment",
        sourceIdentity: null,
        message: "unlocalized diagnostic",
      },
    ]);
    const applyFailure = new Error("Apply failed", { cause: new Error("write failed", { cause: sourceFailure }) });

    expect(
      localizeStartingEquipmentError(
        localizeAcquisitionEnglish,
        applyFailure,
        "wayfinder-pf2e.StartingEquipment.Apply.Failed"
      )
    ).toBe(
      "Enabled equipment pack battlezoo-bestiary-pf2e.equipment is not installed or is unavailable to the current user."
    );
  });

  it("uses the localized operation fallback when no typed detail is available", () => {
    expect(
      localizeStartingEquipmentError(
        localizeAcquisitionEnglish,
        new TypeError("internal detail"),
        "wayfinder-pf2e.StartingEquipment.Errors.Add"
      )
    ).toBe("Wayfinder could not add this equipment item. Check the equipment policy and try again.");
  });
});
