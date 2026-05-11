import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

    expect(smokeCases.map((entry) => entry.classSlug).sort()).toEqual(expectedPf2eClassSlugs);
    expect(result.missingClassSlugs).toEqual([]);
    expect(result.spellcastingCasesMissingSpellSteps).toEqual([]);
  });
});

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
