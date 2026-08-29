import { describe, expect, it, vi } from "vitest";
import { EquipmentSourceHealthError } from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import {
  StartingEquipmentCommandBlockedError,
  StartingEquipmentPhysicalGrantCoverageError,
} from "../src/wayfinder/application/starting-equipment-command-error";
import {
  localizeStartingEquipmentError,
  reportUnexpectedStartingEquipmentError,
} from "../src/wayfinder/application/starting-equipment-failure";
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

  it("preserves direct and wrapped physical-grant blockers", () => {
    const message = "This selected physical grant needs a PF2E-native handoff before equipment review.";
    const blocker = new StartingEquipmentPhysicalGrantCoverageError([
      {
        code: "unsupported-physical-grant",
        routeId: "test-route",
        reasonCode: "unprofiled-native-grant",
        sourceSlotId: "ancestry-feat-level-1",
        sourceUuid: "Compendium.pf2e.feats-srd.Item.test",
        message,
      },
    ]);

    for (const error of [blocker, new Error("command failed", { cause: blocker })]) {
      expect(
        localizeStartingEquipmentError(
          localizeAcquisitionEnglish,
          error,
          "wayfinder-pf2e.StartingEquipment.Errors.Update"
        )
      ).toBe(message);
    }
  });

  it("preserves expected command blockers while unknown failures remain private and diagnosable", () => {
    const expected = new StartingEquipmentCommandBlockedError("The actor already has foreign equipment.");
    const unexpected = new TypeError("internal catalogue detail");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(
        localizeStartingEquipmentError(
          localizeAcquisitionEnglish,
          new Error("wrapped", { cause: expected }),
          "wayfinder-pf2e.StartingEquipment.Errors.Update"
        )
      ).toBe("The actor already has foreign equipment.");
      reportUnexpectedStartingEquipmentError(expected, {
        operation: "initialize",
        stepId: "starting-equipment-level-1",
      });
      expect(consoleError).not.toHaveBeenCalled();

      expect(
        localizeStartingEquipmentError(
          localizeAcquisitionEnglish,
          unexpected,
          "wayfinder-pf2e.StartingEquipment.Errors.Update"
        )
      ).toBe("Wayfinder could not update starting equipment. Check the current step and try again.");
      reportUnexpectedStartingEquipmentError(unexpected, {
        operation: "initialize",
        stepId: "starting-equipment-level-1",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "PF2E Wayfinder starting-equipment command failed",
        { operation: "initialize", stepId: "starting-equipment-level-1" },
        unexpected
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
