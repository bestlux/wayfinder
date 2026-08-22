import { describe, expect, it } from "vitest";
import {
  deriveRailLevelDisclosures,
  emptyRailLevelDisclosureState,
  setRailLevelExpansionOverride,
} from "../src/wayfinder/application/rail-level-disclosure-state";
import type { StepNavRow } from "../src/wayfinder/view-models";

describe("rail level disclosure state", () => {
  it("groups rows by level and derives complete inactive levels as collapsed", () => {
    const result = deriveRailLevelDisclosures(
      [row(1, { complete: true }), row(1, { complete: true }), row(2, { active: true })],
      emptyRailLevelDisclosureState()
    );

    expect(result.groups).toEqual([
      expect.objectContaining({ level: 1, completedCount: 2, stepCount: 2, expanded: false }),
      expect.objectContaining({ level: 2, completedCount: 0, stepCount: 1, active: true, expanded: true }),
    ]);
    expect(result.groups[0]?.steps.map((step) => step.id)).toEqual(["step-1-0", "step-1-1"]);
  });

  it("keeps active and incomplete levels expanded while honoring inactive manual overrides", () => {
    let state = setRailLevelExpansionOverride(emptyRailLevelDisclosureState(), 1, true);
    state = setRailLevelExpansionOverride(state, 2, false);
    state = setRailLevelExpansionOverride(state, 3, false);

    const result = deriveRailLevelDisclosures(
      [row(1, { complete: true }), row(2), row(3, { complete: true, active: true })],
      state
    );

    expect(result.groups.map((group) => [group.level, group.expanded])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
  });

  it("clears an override once when a level transitions into invalidation", () => {
    const first = deriveRailLevelDisclosures(
      [row(2, { complete: true })],
      setRailLevelExpansionOverride(emptyRailLevelDisclosureState(), 2, false)
    );
    expect(first.groups[0]?.expanded).toBe(false);

    const invalidated = deriveRailLevelDisclosures([row(2, { invalidated: true })], first.state);
    expect(invalidated.groups[0]).toMatchObject({ invalidated: true, expanded: true });
    expect(invalidated.state.expansionOverrides.has(2)).toBe(false);

    const manuallyCollapsed = setRailLevelExpansionOverride(invalidated.state, 2, false);
    const stillInvalidated = deriveRailLevelDisclosures([row(2, { invalidated: true })], manuallyCollapsed);
    expect(stillInvalidated.groups[0]).toMatchObject({ invalidated: true, expanded: false });
    expect(stillInvalidated.state.expansionOverrides.get(2)).toBe(false);
  });

  it("drops overrides and invalidation history for levels removed by a target change", () => {
    const state = {
      expansionOverrides: new Map([
        [1, true],
        [5, false],
      ]),
      invalidatedLevels: new Set([5]),
    };

    const result = deriveRailLevelDisclosures([row(1, { complete: true })], state);

    expect([...result.state.expansionOverrides]).toEqual([[1, true]]);
    expect([...result.state.invalidatedLevels]).toEqual([]);
  });
});

let sequence = 0;

function row(level: number, overrides: Partial<StepNavRow> = {}): StepNavRow {
  const index = sequence++;
  return {
    id: `step-${level}-${index % 2}`,
    index: index + 1,
    level,
    title: `Level ${level} step`,
    active: false,
    complete: false,
    invalidated: false,
    modeLabel: "Choice",
    status: "Pending",
    firstInLevel: false,
    ...overrides,
  };
}
