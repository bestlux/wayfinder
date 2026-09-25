import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { classArchetypeExpansionCases } from "../tools/foundry-smoke/class-archetype-expansion-cases.mjs";
import { validateWf51CoordinatorDefinitions } from "../tools/foundry-smoke/wf51-release-coordinator-contract.mjs";

const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");

function loadAssertions() {
  const context = {} as {
    validateActorExpectations: (actor: unknown, definition: unknown, failures: string[]) => void;
    fillSkillTraining: (...args: unknown[]) => Promise<void>;
  };
  runInNewContext(browserSuite, context);
  return context;
}

describe("class-archetype expansion smoke evidence", () => {
  it("rejects a focus spell whose actor has no focus pool", () => {
    const failures: string[] = [];
    loadAssertions().validateActorExpectations({ items: [], focusPool: 0 }, { expectedFocusPool: 1 }, failures);
    expect(failures).toEqual(["Actor focus pool is 0, expected 1."]);
  });

  it("requires the selected terrain to survive on the actual Trackless Journey item", () => {
    const validate = loadAssertions().validateActorExpectations;
    const failures: string[] = [];
    validate(
      { items: [{ name: "Trackless Journey", tracklessJourneyTerrain: "natural" }] },
      { expectedTracklessJourneyTerrain: "urban" },
      failures
    );
    expect(failures).toEqual(["Trackless Journey terrain is natural, expected urban."]);
    const correct: string[] = [];
    validate(
      { items: [{ name: "Trackless Journey", tracklessJourneyTerrain: "urban" }], focusPool: 1 },
      { expectedTracklessJourneyTerrain: "urban", expectedFocusPool: 1 },
      correct
    );
    expect(correct).toEqual([]);
  });

  it("rejects ordinary Barbarian skill allowance on a Bloodrager before filling the draft", async () => {
    await expect(
      loadAssertions().fillSkillTraining(
        {},
        {},
        { slotId: "skills", training: { fixedSkills: ["athletics", "medicine"], additionalCount: 3 } },
        { expectedTraining: { skills: { fixedSkills: ["athletics", "medicine"], additionalCount: 2 } } },
        {}
      )
    ).rejects.toThrow("additional skill count 3 did not match 2");
  });

  it("rejects retained Nature training on a Vindicator before filling the draft", async () => {
    await expect(
      loadAssertions().fillSkillTraining(
        {},
        {},
        { slotId: "skills", training: { fixedSkills: ["nature", "survival"], additionalCount: 4 } },
        { expectedTraining: { skills: { fixedSkills: ["religion", "survival"], additionalCount: 4 } } },
        {}
      )
    ).rejects.toThrow("fixed skills nature, survival did not match religion, survival");
  });

  it("checks the pinned initial-level allowance during an incremental fixture", async () => {
    await expect(
      loadAssertions().fillSkillTraining(
        {},
        {},
        { slotId: "skills", training: { fixedSkills: ["religion", "survival"], additionalCount: 6 } },
        {
          targetLevel: 1,
          expectedTraining: {
            skills: { fixedSkills: ["religion", "survival"], additionalCountByTargetLevel: { 1: 5, 5: 6 } },
          },
        },
        {}
      )
    ).rejects.toThrow("additional skill count 6 did not match 5");
  });

  it("keeps supplemental qualification outside the unchanged equipment release matrix", () => {
    expect(validateWf51CoordinatorDefinitions()).toEqual([]);
    expect(new Set(classArchetypeExpansionCases.map((entry) => entry.id)).size).toBe(
      classArchetypeExpansionCases.length
    );
  });
});
