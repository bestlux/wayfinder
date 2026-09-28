import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("Foundry smoke class coverage", () => {
  it("requires the smoke matrix to cover every PF2E class pack class", async () => {
    const pf2eRoot = makeClassPackFixture([
      { name: "Bard", slug: "bard", spellcasting: 1 },
      { name: "Fighter", slug: "fighter", spellcasting: 0 },
      { name: "Witch", slug: "witch", spellcasting: 1 },
    ]);

    try {
      const { auditClassCoverage } = (await import("../tools/foundry-smoke/class-coverage-core.mjs")) as {
        auditClassCoverage: (args: { pf2eRoot: string; smokeCases: Array<{ classSlug: string }> }) => {
          missingClassSlugs: string[];
        };
      };

      const result = auditClassCoverage({
        pf2eRoot,
        smokeCases: [{ classSlug: "fighter" }],
      });

      expect(result.missingClassSlugs).toContain("bard");
      expect(result.missingClassSlugs).toContain("witch");
      expect(result.missingClassSlugs).not.toContain("fighter");
    } finally {
      rmSync(pf2eRoot, { force: true, recursive: true });
    }
  });

  it("keeps the committed smoke matrix aligned to every expected PF2E class pack class", async () => {
    const { auditClassCoverage } = (await import("../tools/foundry-smoke/class-coverage-core.mjs")) as {
      auditClassCoverage: (args: {
        classRows: Array<{ slug: string; spellcasting: boolean }>;
        smokeCases: Array<{ classSlug: string; expectedStepIds?: string[]; spellChoiceMode?: string }>;
      }) => {
        missingClassSlugs: string[];
        spellcastingCasesMissingSpellSteps: string[];
      };
    };
    const { expectedPf2eClassSlugs, smokeCases } = (await import("../tools/foundry-smoke/class-cases.mjs")) as {
      expectedPf2eClassSlugs: string[];
      smokeCases: Array<{ classSlug: string; expectedStepIds?: string[]; spellChoiceMode?: string }>;
    };

    const result = auditClassCoverage({
      classRows: expectedPf2eClassSlugs.map((slug) => ({
        slug,
        spellcasting: expectedSpellcastingClassSlugs.has(slug),
      })),
      smokeCases,
    });

    // Variant cases (for example the Samsaran config-feat fighter) may share a
    // class slug; coverage is about unique classes, not case count.
    expect(Array.from(new Set(smokeCases.map((entry) => entry.classSlug))).sort()).toEqual(expectedPf2eClassSlugs);
    expect(result.missingClassSlugs).toEqual([]);
    expect(result.spellcastingCasesMissingSpellSteps).toEqual([]);
  });

  it("requires all four Dragon traditions through level 4 with matching spell destinations", async () => {
    const { smokeCases } = await import("../tools/foundry-smoke/class-cases.mjs");
    const choiceSlotId = "class-choice-dragon-eidolon-eidolonTradition-level-1";
    for (const tradition of ["arcane", "divine", "occult", "primal"]) {
      const smokeCase = smokeCases.find((entry) => entry.id === `summoner-dragon-${tradition}-l1-l4-apply-rerun`);
      expect(smokeCase?.targetLevel).toBe(4);
      expect(smokeCase?.preferredSelections["class-branch-eidolon-level-1"]).toEqual(["Dragon Eidolon"]);
      expect(smokeCase?.preferredSelections[choiceSlotId]).toEqual([
        tradition.charAt(0).toUpperCase() + tradition.slice(1),
      ]);
      expect(smokeCase?.expectedStepIds).toContain(choiceSlotId);
      expect(smokeCase?.expectedStepIds).toContain("spell-choice-summoner-repertoire-rank-2-level-4");
      expect(smokeCase?.expectedSpellcastingEntries?.[`summoner-${tradition}-spontaneous`]).toMatchObject({
        tradition,
        prepared: "spontaneous",
        ability: "cha",
      });
    }
  });

  it("fails spell filling when the picker offers the wrong tradition", async () => {
    const slotId = "spell-choice-summoner-cantrips-level-1";
    const step = {
      kind: "spell-choice",
      slotId,
      spellChoice: { count: 1, destination: { tradition: "arcane" } },
    };
    const modules = {
      inspectActor: () => ({ skillRanks: {} }),
      buildOptionContext: () => ({}),
      getSpellRarityCeilingSetting: () => "common",
      withRestrictedSpellRarityAccess: () => step,
      evaluateSpellRarityAttestation: () => ({ granted: false }),
      getPickerBlockedState: () => null,
      getOptionsForStep: () => [{ name: "Electric Arc", uuid: "electric-arc" }],
    };
    await expect(
      smokeAssertions().fillStep(
        {},
        { spellRarityAttestations: {}, selections: {} },
        step,
        [step],
        { expectedPickerOptions: { [slotId]: { present: ["Divine Lance"], absent: ["Electric Arc"] } } },
        modules,
        { classifications: [], warnings: [] }
      )
    ).rejects.toThrow("picker legality expectation failed");
    await expect(
      smokeAssertions().fillStep(
        {},
        { spellRarityAttestations: {}, selections: {} },
        step,
        [step],
        { expectedPickerOptions: { [slotId]: { tradition: "divine" } } },
        modules,
        { classifications: [], warnings: [] }
      )
    ).rejects.toThrow("spell tradition is arcane, expected divine");
  });

  it("compares compound persisted rule selections by value and rejects a wrong tradition", () => {
    const validate = smokeAssertions().validateActorExpectations;
    const expected = {
      expectedItemRuleSelections: {
        "Dragon Eidolon (Divine)": { eidolonTradition: { skill: "religion", tradition: "divine" } },
      },
    };
    const actor = {
      items: [
        {
          name: "Dragon Eidolon (Divine)",
          ruleSelections: { eidolonTradition: { tradition: "divine", skill: "religion" } },
        },
      ],
    };
    const correctFailures: string[] = [];
    validate(actor, expected, correctFailures);
    expect(correctFailures).toEqual([]);

    actor.items[0].ruleSelections.eidolonTradition.tradition = "arcane";
    const wrongFailures: string[] = [];
    validate(actor, expected, wrongFailures);
    expect(wrongFailures).toHaveLength(1);
    expect(wrongFailures[0]).toContain("rule selection eidolonTradition");
  });
});

function smokeAssertions() {
  const context = {} as {
    fillStep: (...args: unknown[]) => Promise<void>;
    validateActorExpectations: (actor: unknown, definition: unknown, failures: string[]) => void;
  };
  runInNewContext(readFileSync(path.resolve("tools/foundry-smoke/browser-suite.js"), "utf8"), context);
  return context;
}

const expectedSpellcastingClassSlugs = new Set([
  "animist",
  "bard",
  "cleric",
  "druid",
  "magus",
  "oracle",
  "psychic",
  "sorcerer",
  "summoner",
  "witch",
  "wizard",
]);

function makeClassPackFixture(classes: Array<{ name: string; slug: string; spellcasting: number }>): string {
  const root = mkdtempSync(path.join(tmpdir(), "wayfinder-pf2e-packs-"));
  const classDir = path.join(root, "classes");
  mkdirSync(classDir);

  for (const entry of classes) {
    writeFileSync(
      path.join(classDir, `${entry.slug}.json`),
      `${JSON.stringify({
        name: entry.name,
        system: {
          publication: { title: "Test" },
          slug: entry.slug,
          spellcasting: entry.spellcasting,
        },
      })}\n`
    );
  }

  return root;
}
