import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeCases } from "../tools/foundry-smoke/class-cases.mjs";

interface SkillSelectionPolicy {
  collectReservedRuleChoiceSkills: (choices: Record<string, unknown> | null) => string[];
  selectAdditionalSkills: (options: {
    availableSkills: Iterable<string>;
    fallbackSkills: Iterable<string>;
    preferredSkills: Iterable<string>;
    requiredCount: number;
    reservedSkills: Iterable<string>;
    usedSkills: Iterable<string>;
  }) => string[];
}

declare global {
  var __wayfinderSmokeSkillSelectionPolicy: SkillSelectionPolicy | undefined;
}

const runner = readFileSync(resolve("tools/foundry-smoke/run-foundry-smoke.mjs"), "utf8");
const browserSuite = readFileSync(resolve("tools/foundry-smoke/browser-suite.js"), "utf8");

describe("Foundry smoke skill-selection policy", () => {
  beforeAll(async () => {
    await import("../tools/foundry-smoke/skill-selection-policy.js");
  });

  it("reserves a later conditional rule choice from earlier generic training", () => {
    const policy = requiredPolicy();
    const smokeCase = (smokeCases as any[]).find(
      (entry) => entry.id === "cleric-battle-creed-skill-fallback-l1-l5-apply-rerun"
    );
    const reservedSkills = policy.collectReservedRuleChoiceSkills(smokeCase?.preferredRuleChoices ?? null);

    expect(smokeCase).toMatchObject({
      expectedItemRuleSelections: { "Battle Harbinger Dedication": { skill: "society" } },
      preseedSkillRanks: { acrobatics: 1, athletics: 1 },
    });
    expect(reservedSkills).toEqual(["society"]);
    expect(
      policy.selectAdditionalSkills({
        availableSkills: ["medicine", "diplomacy", "nature", "society", "survival"],
        fallbackSkills: ["acrobatics", "arcana", "survival"],
        preferredSkills: smokeCase.preferredSkills,
        requiredCount: 4,
        reservedSkills,
        usedSkills: ["religion"],
      })
    ).toEqual(["medicine", "diplomacy", "nature", "survival"]);
  });

  it("keeps ordinary training preference order when no later rule choice is reserved", () => {
    expect(
      requiredPolicy().selectAdditionalSkills({
        availableSkills: ["medicine", "diplomacy", "nature", "society", "survival"],
        fallbackSkills: ["survival"],
        preferredSkills: ["medicine", "diplomacy", "nature", "society", "survival"],
        requiredCount: 4,
        reservedSkills: [],
        usedSkills: ["religion"],
      })
    ).toEqual(["medicine", "diplomacy", "nature", "society"]);
  });

  it("loads the shared policy before the browser suite and consumes it at the fill boundary", () => {
    expect(runner.indexOf("page.addScriptTag({ path: skillSelectionPolicyPath })")).toBeGreaterThan(-1);
    expect(runner.indexOf("page.addScriptTag({ path: browserSuitePath })")).toBeGreaterThan(
      runner.indexOf("page.addScriptTag({ path: skillSelectionPolicyPath })")
    );
    expect(browserSuite).toContain("skillSelectionPolicy.collectReservedRuleChoiceSkills");
    expect(browserSuite).toContain("skillSelectionPolicy.selectAdditionalSkills");
  });
});

function requiredPolicy(): SkillSelectionPolicy {
  const policy = globalThis.__wayfinderSmokeSkillSelectionPolicy;
  if (!policy) throw new Error("Smoke skill-selection policy did not initialize.");
  return policy;
}
