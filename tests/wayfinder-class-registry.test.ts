import { describe, expect, it } from "vitest";
import { baseContributor } from "../src/wayfinder/classes/base-contributor";
import { clericContributor } from "../src/wayfinder/classes/cleric-contributor";
import { getClassContributor } from "../src/wayfinder/classes/registry";
import { wizardContributor } from "../src/wayfinder/classes/wizard-contributor";

describe("wayfinder class registry", () => {
  it("returns known contributor objects and falls back to the base contributor", () => {
    expect(getClassContributor("wizard")).toBe(wizardContributor);
    expect(getClassContributor("cleric")).toBe(clericContributor);
    expect(getClassContributor("inventor")).toBe(baseContributor);
    expect(getClassContributor(null)).toBe(baseContributor);
  });
});
