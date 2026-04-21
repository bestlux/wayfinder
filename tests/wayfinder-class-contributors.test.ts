import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { baseContributor } from "../src/wayfinder/classes/base-contributor";
import { clericContributor } from "../src/wayfinder/classes/cleric-contributor";
import type { BuildClassContributionArgs } from "../src/wayfinder/classes/types";
import { wizardContributor } from "../src/wayfinder/classes/wizard-contributor";

describe("wayfinder class contributors", () => {
  it.each([
    [baseContributor, "base"],
    [wizardContributor, "wizard"],
    [clericContributor, "cleric"],
  ])("keeps %s as a narrow wrapper with a stable slug", async (contributor, expectedSlug) => {
    const buildClassBranchSteps = vi.fn(async () => []);
    const buildClassGrantedItemSteps = vi.fn(async () => []);
    const buildClassChoiceSteps = vi.fn(async () => []);
    const buildSpellChoiceSteps = vi.fn(async () => []);

    const args: BuildClassContributionArgs = {
      draft: createEmptyDraft(1),
      currentLevel: 1,
      targetLevel: 1,
      effectiveClassDocument: null,
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      deps: {
        buildClassBranchSteps,
        buildClassGrantedItemSteps,
        buildClassChoiceSteps,
        buildSpellChoiceSteps,
      },
    };

    expect(contributor.slug).toBe(expectedSlug);
    await expect(contributor.buildPlanSteps(args)).resolves.toEqual([]);
    expect(buildClassBranchSteps).not.toHaveBeenCalled();
    expect(buildClassGrantedItemSteps).not.toHaveBeenCalled();
    expect(buildClassChoiceSteps).not.toHaveBeenCalled();
    expect(buildSpellChoiceSteps).not.toHaveBeenCalled();
  });
});
