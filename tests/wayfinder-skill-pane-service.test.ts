import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SkillTrainingDraft } from "../src/types";
import { buildSkillPane, projectSkillRanks } from "../src/wayfinder/application/build-skill-pane-service";

describe("wayfinder skill pane service", () => {
  it("projects fixed skills and prior draft choices before the active slot", async () => {
    const draft = createEmptyDraft(5);
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft(
      {
        arcana: "arcana",
      },
      ["stealth"]
    );
    draft.skillTrainings["skill-training-wizard-level-7"] = trainingDraft({}, ["society"]);
    draft.skillIncreases["skill-increase-level-2"] = "arcana";
    draft.skillIncreases["skill-increase-level-6"] = "nature";

    const projected = await projectSkillRanks(draft, "skill-increase-level-4", {
      baseSkillRanks: {
        acrobatics: 1,
      },
      resolveDocument: async (itemType) => {
        if (itemType === "background") {
          return { system: { trainedSkills: { value: ["athletics"] } } };
        }
        if (itemType === "class") {
          return { system: { trainedSkills: { value: ["occultism"] } } };
        }
        return null;
      },
    });

    expect(projected).toMatchObject({
      acrobatics: 1,
      athletics: 1,
      occultism: 1,
      arcana: 1,
    });
    expect(projected.stealth).toBeUndefined();
    expect(projected.society).toBeUndefined();
    expect(projected.nature).toBeUndefined();
  });

  it("builds a skill-training pane with reserved skills removed from additional choices", async () => {
    const draft = createEmptyDraft(1);
    draft.skillTrainings["skill-training-wizard-level-1"] = trainingDraft({ arcana: "arcana" }, ["stealth"]);
    const step: PendingStep = {
      id: "skill-training-wizard-level-1",
      level: 1,
      kind: "skill-training",
      slotKind: "skill-training",
      title: "Wizard training",
      description: "",
      required: true,
      slotId: "skill-training-wizard-level-1",
      training: {
        classSlug: "wizard",
        className: "Wizard",
        fixedSkills: ["occultism"],
        choiceRules: [
          {
            ruleIndex: 0,
            flag: "arcana",
            prompt: "Choose a school skill",
            options: [
              { slug: "arcana", label: "Arcana" },
              { slug: "nature", label: "Nature" },
            ],
          },
        ],
        additionalCount: 1,
      },
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana" },
        nature: { label: "Nature" },
        occultism: { label: "Occultism" },
        stealth: { label: "Stealth" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => true,
    });

    expect(pane?.kind).toBe("skill-training");
    if (!pane || pane.kind !== "skill-training") {
      throw new Error("Expected a skill-training pane");
    }
    expect(pane.completed).toBe(true);
    expect(pane.fixedSkills).toEqual(["Occultism"]);
    expect(pane.choiceSections[0]?.selectedLabel).toBe("Arcana");
    expect(pane.additionalSkills.map((entry) => entry.slug)).toEqual(["nature", "stealth"]);
  });

  it("builds a skill-increase pane with localized labels and level cap handling", async () => {
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";
    const step: PendingStep = {
      id: "skill-increase-level-3",
      level: 3,
      kind: "skill-increase",
      slotKind: "skill-increase",
      title: "Skill increase",
      description: "",
      required: true,
      slotId: "skill-increase-level-3",
    };

    const pane = await buildSkillPane(step, draft, {
      baseSkillRanks: {},
      resolveDocument: async () => null,
      configSkills: {
        arcana: { label: "Arcana" },
        athletics: { label: "Athletics" },
      },
      localize: (value) => value,
      isTrainingStepComplete: () => false,
    });

    expect(pane?.kind).toBe("skill-increase");
    if (!pane || pane.kind !== "skill-increase") {
      throw new Error("Expected a skill-increase pane");
    }

    const arcana = pane.skills.find((entry) => entry.slug === "arcana");
    const athletics = pane.skills.find((entry) => entry.slug === "athletics");
    expect(pane.selectedLabel).toBe("Arcana → Trained");
    expect(arcana?.selected).toBe(true);
    expect(athletics?.disabled).toBe(false);
  });
});

function trainingDraft(ruleChoices: Record<string, string>, additional: string[]): SkillTrainingDraft {
  return {
    ruleChoices,
    additional,
  };
}
