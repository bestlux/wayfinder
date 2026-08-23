import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProgressionPlan } from "../src/types";
import { resolveStartingEquipmentRenderPlan } from "../src/wayfinder/application/starting-equipment-ui-adapter";

const appShell = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");

describe("starting equipment search isolation", () => {
  it("uses the measured equipment debounce without changing ordinary picker timing", () => {
    expect(appShell).toContain("const PICKER_SEARCH_DELAY_MS = 40;");
    expect(appShell).toMatch(
      /#pickerSearchScheduler = new PickerSearchScheduler\(\{\s*delayMs: PICKER_SEARCH_DELAY_MS,/
    );
    expect(appShell).toContain("#equipmentSearchScheduler = createEquipmentSearchScheduler({");
  });

  it("schedules an equipment-only render without rebuilding the character plan from the input handler", () => {
    const start = appShell.indexOf("  #onEquipmentSearchInput = ");
    const end = appShell.indexOf("#renderPickerSearch", start);
    const handler = appShell.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain("scheduleEquipmentSearchInput(input, this.#equipmentSearchScheduler");
    expect(handler).toContain("parts: [...startingEquipmentPartsForIntent(equipmentRequest.intent)]");
    expect(handler).toContain("wayfinderEquipmentUpdate: true");
    expect(handler).toContain("wayfinderEquipmentRequest: equipmentRequest");
    expect(handler).not.toContain("#buildPlan(");
  });

  it("prepares scoped equipment projections before actor inspection or full-plan work", () => {
    const start = appShell.indexOf("async _prepareContext");
    const end = appShell.indexOf("_replaceHTML(", start);
    const prepare = appShell.slice(start, end);
    const equipmentBranch = prepare.indexOf("const equipmentRequest = startingEquipmentRenderRequest(options);");
    const actorInspection = prepare.indexOf("const snapshot = inspectActor(this.actor);");

    expect(equipmentBranch).toBeGreaterThan(-1);
    expect(actorInspection).toBeGreaterThan(equipmentBranch);
    const scopedEquipmentPrepare = prepare.slice(equipmentBranch, actorInspection);
    expect(scopedEquipmentPrepare).toContain("this.#projectStartingEquipmentCatalogue");
    expect(scopedEquipmentPrepare).toMatch(
      /this\.#projectStartingEquipmentCatalogue\(session\.step,\s*\{\s*offset: equipmentRequest\.offset,\s*limit: equipmentRequest\.limit,\s*\}\)/
    );
    expect(scopedEquipmentPrepare).toContain('wayfinderRenderScope: "equipment"');
    expect(scopedEquipmentPrepare).not.toContain("this._buildRenderPlan");
    expect(scopedEquipmentPrepare).not.toContain("buildWayfinderContext");
  });

  it("keeps equipment evaluation, readiness, and pane assembly outside the actor foundation", () => {
    const start = appShell.indexOf("const resolveFoundation =");
    const end = appShell.indexOf("const actorItemsById", start);
    const prepare = appShell.slice(start, end);

    expect(prepare).toMatch(/step\.kind === "starting-equipment"\s*\? \[\]/);
    expect(prepare).toContain('if (step.kind === "starting-equipment")');
    expect(prepare).toContain("withPhysicalGrantCoverageReadiness(");
    expect(prepare).toContain("...buildActorRenderFoundationLanguageSettings(");
    expect(prepare).toContain("await this.#buildActivePane(");
    expect(prepare.indexOf("withPhysicalGrantCoverageReadiness(")).toBeLessThan(
      prepare.indexOf("await this.#buildActivePane(")
    );
  });

  it("rewindows equipment through passive animation-frame scroll and row/list resize observation", () => {
    expect(appShell).toContain('scrollable.matches("[data-wayfinder-equipment-virtual-list]")');
    expect(appShell).toContain("requestAnimationFrame(() => {");
    expect(appShell).toContain("new ResizeObserver((entries) => {");
    expect(appShell).toContain("#captureEquipmentResultAnchor(scrollable)");
    expect(appShell).toContain("#restoreEquipmentResultAnchor(list, measurements)");
    expect(appShell).toContain('this.#equipmentScheduledRenderIntent = "window"');
    expect(appShell).toContain("request.criteriaRevision === this.#equipmentCriteriaRevision(request.stepId)");
    expect(appShell).toContain("if (!this.#isCurrentEquipmentResultList(scrollable)) return;");
    expect(appShell).toContain("const pendingViewport = startingEquipmentResultWindowForViewport({");
    expect(appShell).toContain("this.#requestEquipmentResultWindow(list, pending);");
    expect(appShell).toContain("#recoverEquipmentResultWindowAfterFailure(request.stepId)");
    expect(appShell).toContain("wayfinderEquipmentRecoveryEdgeFocus: recoveryEdgeFocus");
    expect(appShell).toContain("wayfinderEquipmentRecoveryFocusStepId: recoveryFocusStepId");
    expect(appShell).toContain("#restoreEquipmentWindowEdgeFocus(root, queuedEquipmentWindow !== null)");
    expect(appShell).toContain("#restoreEquipmentListFocus(root, queuedEquipmentWindow !== null)");
    expect(appShell).toMatch(
      /if \(preserveForQueuedWindow\) \{\s*root\s*\.querySelector<HTMLElement>\("\[data-equipment-focus-sentinel\]"\)\?\.focus\(\{ preventScroll: true \}\);\s*return;/
    );
    expect(appShell).toMatch(
      /this\.#applyEquipmentResultSpacerGeometry\(list, measurements\);\s*this\.#restoreEquipmentResultAnchor\(list, measurements\);\s*measurements\.lastScrollTopPx = list\.scrollTop;/
    );
  });

  it("keeps the equipment search control outside all replaceable application parts", () => {
    const pane = readFileSync(resolve("templates/wayfinder/starting-equipment-pane.hbs"), "utf8");
    const catalogue = readFileSync(resolve("templates/wayfinder/starting-equipment-catalogue.hbs"), "utf8");

    expect(pane).toContain("data-wayfinder-equipment-search");
    expect(catalogue).not.toContain("data-wayfinder-equipment-search");
    expect(catalogue).toContain('data-application-part="equipment-catalogue"');
  });

  it("fails closed before replacing stale or mismatched equipment parts", () => {
    const start = appShell.indexOf("_replaceHTML(");
    const end = appShell.indexOf("async _onRender(", start);
    const replace = appShell.slice(start, end);

    expect(replace).toContain("!this.#canCommitStartingEquipmentRender(equipmentRequest)");
    expect(replace).toContain("!hasStartingEquipmentPartTargets(");
    expect(replace).toContain("options.wayfinderSkippedReplacement = true;");
    expect(replace).toContain("startingEquipmentViewRevision !== this.#equipmentSearchScheduler.viewRevision");
  });

  it("keeps structural, review, retain, setup, handoff, and removal commands on full fallback renders", () => {
    const dispatchStart = appShell.indexOf("async #dispatchAction");
    const dispatchEnd = appShell.indexOf("#onSearchInput =", dispatchStart);
    const dispatch = appShell.slice(dispatchStart, dispatchEnd);

    expect(dispatch).toContain('this.#renderStartingEquipmentPartial(action.stepId, "preview")');
    const recipeStart = dispatch.indexOf('case "select-equipment-recipe"');
    const recipeEnd = dispatch.indexOf("break;", recipeStart);
    expect(dispatch.slice(recipeStart, recipeEnd)).toContain('"recipe"');
    for (const action of [
      "initialize-starting-equipment",
      "activate-equipment-policy",
      "request-equipment-start",
      "approve-equipment-policy-request",
      "decline-equipment-policy-request",
      "request-equipment-item-exception",
      "approve-equipment-item-exception",
      "revoke-equipment-policy-judgment",
      "remove-equipment-line",
      "review-equipment-purchases",
      "retain-all-equipment",
      "acknowledge-equipment-handoff",
    ]) {
      const caseStart = dispatch.indexOf(`case "${action}"`);
      const caseEnd = dispatch.indexOf("break;", caseStart);
      expect(caseStart, action).toBeGreaterThan(-1);
      expect(dispatch.slice(caseStart, caseEnd), action).not.toContain("#renderStartingEquipmentPartial");
    }
  });

  it("renders only the selected preview in the scoped detail part", () => {
    const detail = readFileSync(resolve("templates/wayfinder/starting-equipment-detail.hbs"), "utf8");

    expect(detail).toContain("activePane.catalogue.preview.sourceUuid");
    expect(detail).not.toContain("#each activePane.catalogue.items");
    // No `hidden` attribute: unselected previews must not be rendered at all. `aria-hidden` on
    // decorative icons is unrelated and allowed.
    expect(detail.replace(/aria-hidden/gu, "")).not.toContain("hidden");
  });

  it("treats activation of the already selected preview as a focus-preserving no-op", () => {
    const dispatchStart = appShell.indexOf("async #dispatchAction");
    const dispatchEnd = appShell.indexOf("#onSearchInput =", dispatchStart);
    const dispatch = appShell.slice(dispatchStart, dispatchEnd);
    const previewStart = dispatch.indexOf('case "preview-equipment-item"');
    const previewEnd = dispatch.indexOf("\n        break;", previewStart);
    const preview = dispatch.slice(previewStart, previewEnd);

    expect(preview).toContain("this.#equipmentPreviewByStepId.get(action.stepId) === action.sourceUuid");
    expect(preview).toContain("this.#pendingEquipmentFocusIds = null");
    expect(preview.indexOf("break")).toBeLessThan(preview.indexOf("#renderStartingEquipmentPartial"));
  });

  it("restores focus to the surviving cart row when an added item merges into a stack", () => {
    const start = appShell.indexOf("  async #addStartingEquipmentItem(");
    const end = appShell.indexOf("  async #chooseTitanMaulerEquipment", start);
    const add = appShell.slice(start, end);

    expect(add).toContain("findCurrencyCartAggregationTargets(");
    expect(add).toContain("equipmentLineFocusId(focusLineId)");
  });

  it("retains an existing equipment error for view-only partial actions", () => {
    const clickStart = appShell.indexOf("#onActionClick =");
    const clickEnd = appShell.indexOf("#dispatchAction", clickStart);
    const click = appShell.slice(clickStart, clickEnd);
    const helperStart = appShell.indexOf("function isStartingEquipmentViewOnlyAction");
    const helperEnd = appShell.indexOf("function parseGoldToCopper", helperStart);
    const helper = appShell.slice(helperStart, helperEnd);

    expect(click).toContain("if (!isStartingEquipmentViewOnlyAction(action))");
    expect(helper).toContain('action.type === "preview-equipment-item"');
    expect(helper).toContain('action.type === "toggle-equipment-filter"');
    expect(helper).toContain('action.type === "toggle-equipment-filter-panel"');
    expect(helper).toContain('action.type === "clear-equipment-filters"');
  });

  it("keeps disclosure and source search as bounded catalogue-only view state", () => {
    const panelStart = appShell.indexOf("  #toggleStartingEquipmentFilterPanel(");
    const panelEnd = appShell.indexOf("#restoreEquipmentSourceSearchFocus", panelStart);
    const panel = appShell.slice(panelStart, panelEnd);
    const sourceStart = appShell.indexOf("  #onEquipmentSourceSearchInput =");
    const sourceEnd = appShell.indexOf("#renderStartingEquipmentSearch", sourceStart);
    const source = appShell.slice(sourceStart, sourceEnd);

    expect(panel).toContain('#equipmentScheduledRenderIntent = "facet"');
    expect(panel).toContain("#equipmentSearchScheduler.schedule");
    expect(panel).not.toContain("#draftDidChange");
    expect(source).toContain("#equipmentSourceSearchByStepId.set(stepId, input.value)");
    expect(source).toContain("#pendingEquipmentSourceSearchFocus");
    expect(source).not.toContain("#buildPlan(");
  });

  it("suppresses handoff and Titan state while setup awaits authority", () => {
    const state = readFileSync(resolve("templates/wayfinder/starting-equipment-state.hbs"), "utf8");
    const guard = state.indexOf("#unless activePane.setup.awaitingAuthority");

    expect(guard).toBeGreaterThan(-1);
    expect(state.indexOf("activePane.handoff.active")).toBeGreaterThan(guard);
    expect(state.indexOf("activePane.titanMauler.required")).toBeGreaterThan(guard);
  });

  it("reuses the cached render plan for equipment search and cart renders", async () => {
    const cachedPlan = { targetLevel: 1, steps: [] } as ProgressionPlan;
    const buildPlan = vi.fn(async () => ({ targetLevel: 1, steps: [] }) as ProgressionPlan);

    await expect(
      resolveStartingEquipmentRenderPlan({
        equipmentOnlyUpdate: true,
        targetLevel: 1,
        cachedPlan,
        buildPlan,
      })
    ).resolves.toBe(cachedPlan);
    expect(buildPlan).not.toHaveBeenCalled();
    expect(appShell).toContain("this.render({ wayfinderEquipmentUpdate: true })");
  });
});
