import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  equipmentAllowanceFocusId,
  equipmentFilterFocusId,
  equipmentItemFocusId,
  equipmentLineControlFocusId,
  equipmentLineFocusId,
  STARTING_EQUIPMENT_REVIEW_FOCUS_ID,
  STARTING_EQUIPMENT_SEARCH_FOCUS_ID,
  STARTING_EQUIPMENT_STATUS_FOCUS_ID,
} from "../src/wayfinder/application/equipment-accessibility";

describe("starting equipment accessibility", () => {
  it("derives stable item, allowance, line, filter, review, and failure focus identities", () => {
    const sourceUuid = "Compendium.pf2e.equipment-srd.Item.item";
    expect(equipmentItemFocusId(sourceUuid, "coin")).toBe(`starting-equipment-item:${sourceUuid}:coin`);
    expect(equipmentAllowanceFocusId(sourceUuid, "level-3-1")).toBe(
      `starting-equipment-item:${sourceUuid}:allowance:level-3-1`
    );
    expect(equipmentLineFocusId("line-1")).toBe("starting-equipment-line:line-1");
    expect(equipmentLineControlFocusId("line-1", "decrease")).toBe("starting-equipment-line:line-1:decrease");
    expect(equipmentLineControlFocusId("line-1", "quantity")).toBe("starting-equipment-line:line-1:quantity");
    expect(equipmentFilterFocusId("source", "Player Core")).toBe("starting-equipment-filter:source:Player Core");
    expect(STARTING_EQUIPMENT_REVIEW_FOCUS_ID).toBe("starting-equipment-review");
    expect(STARTING_EQUIPMENT_SEARCH_FOCUS_ID).toBe("starting-equipment-search");
    expect(STARTING_EQUIPMENT_STATUS_FOCUS_ID).toBe("starting-equipment-status");
  });

  it("renders polite atomic status updates and an assertive focusable failure destination", () => {
    const shell = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
    const pane = equipmentTemplateCorpus();

    expect(shell).toContain('role="{{#if statusNoteIsError}}alert{{else}}status{{/if}}"');
    expect(shell).toContain('aria-live="{{#if statusNoteIsError}}assertive{{else}}polite{{/if}}"');
    expect(shell).toContain('data-wayfinder-focus-id="starting-equipment-status"');
    expect(shell).toContain('aria-atomic="true"');
    expect(pane).toContain(
      'class="equipment-result-count" role="status" aria-live="{{#if equipmentRequest.announceWindow}}polite{{else}}off{{/if}}" aria-atomic="true"'
    );
    expect(pane).toContain('class="sr-only" role="status" aria-live="polite" aria-atomic="true"');
    expect(pane).toContain('role="group" aria-label="{{localize');
  });

  it("keeps setup transitions focus-addressable and Apply preflight inside the failure boundary", () => {
    const pane = equipmentTemplateCorpus();
    const shellSource = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
    for (const focusId of [
      "starting-equipment-start",
      "starting-equipment-recipe:",
      "starting-equipment-activate:",
      "starting-equipment-request:",
      "starting-equipment-acknowledge-handoff",
      "starting-equipment-confirm-kit",
    ]) {
      expect(pane).toContain(`data-wayfinder-focus-id="${focusId}`);
    }

    const applyStart = shellSource.indexOf("async #applyDraft()");
    const apply = shellSource.slice(
      applyStart,
      shellSource.indexOf("\n  #createAcquisitionExecutionSession", applyStart)
    );
    expect(apply.indexOf("try {")).toBeGreaterThanOrEqual(0);
    expect(apply.indexOf("try {")).toBeLessThan(apply.indexOf("const snapshot = inspectActor"));
    expect(apply).toContain("this.#setStartingEquipmentFailure(failureMessage)");
  });

  it("gives the browse search a stable relocation identity", () => {
    const pane = readFileSync(resolve("templates/wayfinder/starting-equipment-pane.hbs"), "utf8");
    expect(pane).toContain('data-wayfinder-equipment-search data-wayfinder-focus-id="starting-equipment-search"');
  });

  it("gives direct cart quantity entry an accessible label and stable focus identity", () => {
    const cart = readFileSync(resolve("templates/wayfinder/starting-equipment-cart.hbs"), "utf8");
    expect(cart).toContain('type="number" inputmode="numeric"');
    expect(cart).toContain('aria-label="{{quantityAriaLabel}}" data-wayfinder-equipment-quantity');
    expect(cart).toContain('data-wayfinder-focus-id="{{quantityFocusId}}"');
  });

  it("restores active equipment errors after both full and status-part renders", () => {
    const shellSource = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");
    const equipmentBranch = shellSource.slice(
      shellSource.indexOf('if (context.wayfinderRenderScope === "equipment")'),
      shellSource.indexOf(
        "this.#pickerRenderSession",
        shellSource.indexOf('if (context.wayfinderRenderScope === "equipment")')
      )
    );
    expect(equipmentBranch).toContain("renderedParts.includes(EQUIPMENT_STATUS_PART)");
    expect(equipmentBranch).toContain("this.#restoreStartingEquipmentErrorFocus(root, pendingStatusFocus)");
    expect(equipmentBranch.indexOf("this.#restoreStartingEquipmentErrorFocus")).toBeLessThan(
      equipmentBranch.indexOf("return;")
    );

    const fullBranch = shellSource.slice(
      shellSource.indexOf("const pendingStepFocusId"),
      shellSource.indexOf("_tearDown(options", shellSource.indexOf("const pendingStepFocusId"))
    );
    expect(fullBranch).toContain("this.#restoreStartingEquipmentErrorFocus(");
    expect(fullBranch).toContain("pendingControlFocusId === STARTING_EQUIPMENT_STATUS_FOCUS_ID");
  });
});

function equipmentTemplateCorpus(): string {
  return [
    "starting-equipment-pane",
    "starting-equipment-policy",
    "starting-equipment-status",
    "starting-equipment-state",
    "starting-equipment-catalogue",
    "starting-equipment-detail",
    "starting-equipment-cart",
  ]
    .map((name) => readFileSync(resolve(`templates/wayfinder/${name}.hbs`), "utf8"))
    .join("\n");
}
