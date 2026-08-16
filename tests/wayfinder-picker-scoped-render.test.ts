import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/wayfinder/app-shell.ts"), "utf8");

describe("wayfinder scoped picker search rendering", () => {
  it("schedules search without requesting a full application render", () => {
    const handler = sourceBetween("#onSearchInput =", "#onScrollableScroll =");

    expect(handler).toContain("this.#searchByStepId.set(stepId, input.value);");
    expect(handler).toContain("this.#pickerSearchScheduler.schedule(stepId, input.value);");
    expect(handler).not.toContain("this.render(false)");
  });

  it("prepares picker projections before any full plan or actor work", () => {
    const prepare = sourceBetween("async _prepareContext", "_replaceHTML(");
    const partialBranch = prepare.indexOf("const pickerRequest = pickerSearchRequest(options);");
    const actorInspection = prepare.indexOf("const snapshot = inspectActor(this.actor);");
    const planBuild = prepare.indexOf("this._buildRenderPlan(snapshot, draft)");

    expect(partialBranch).toBeGreaterThanOrEqual(0);
    expect(actorInspection).toBeGreaterThan(partialBranch);
    expect(planBuild).toBeGreaterThan(actorInspection);
    expect(prepare).toContain("derivePickerRenderSession(session");
  });

  it("renders both search-dependent parts together and fails closed before replacement", () => {
    expect(appSource).toContain("const PICKER_SEARCH_PARTS = [PICKER_COUNT_PART, PICKER_RESULTS_PART] as const;");
    expect(appSource).toContain("parts: [...PICKER_SEARCH_PARTS]");

    const replace = sourceBetween("_replaceHTML(", "async _onRender(");
    expect(replace).toContain("!this.#canCommitPickerSearch(pickerRequest)");
    expect(replace).toContain("!hasPickerPartTargets(content, pickerRequest.stepId)");
    expect(replace).toContain("options.wayfinderSkippedReplacement = true;");
    expect(replace).toContain("super._replaceHTML(result, content, options);");
  });

  it("binds only replaced result actions and disposes queued search work on close", () => {
    const onRender = sourceBetween("async _onRender(", "_canDetach()");
    expect(onRender).toContain(`data-application-part="\${PICKER_RESULTS_PART}"`);
    expect(onRender).toContain("bindWayfinderInteractions(");

    const finalizer = sourceBetween("#finalizeClosedState()", "#onActionClick =");
    expect(finalizer).toContain("this.#pickerSearchScheduler.dispose();");
  });
});

function sourceBetween(start: string, end: string): string {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return appSource.slice(startIndex, endIndex);
}
