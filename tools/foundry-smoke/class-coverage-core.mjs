import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function auditClassCoverage({ classRows: providedClassRows, pf2eRoot, smokeCases }) {
  const classRows = Array.isArray(providedClassRows) ? providedClassRows : readClassPackRows(pf2eRoot);
  const casesBySlug = new Map(smokeCases.map((entry) => [entry.classSlug, entry]));
  const coveredSlugs = new Set(smokeCases.map((entry) => entry.classSlug).filter(Boolean));
  const missingClassSlugs = classRows
    .map((entry) => entry.slug)
    .filter((slug) => !coveredSlugs.has(slug))
    .sort();
  const spellcastingCasesMissingSpellSteps = classRows
    .filter((entry) => entry.spellcasting)
    .filter((entry) => {
      const smokeCase = casesBySlug.get(entry.slug);
      if (smokeCase?.spellChoiceMode === "pf2e-granted") {
        return false;
      }

      return (
        !Array.isArray(smokeCase?.expectedStepIds) ||
        !smokeCase.expectedStepIds.some((id) => id.startsWith("spell-choice-"))
      );
    })
    .map((entry) => entry.slug)
    .sort();

  return {
    classRows,
    coveredClassSlugs: Array.from(coveredSlugs).sort(),
    missingClassSlugs,
    spellcastingCasesMissingSpellSteps,
  };
}

export function readClassPackRows(pf2eRoot) {
  const classDir = path.join(pf2eRoot, "classes");
  return readdirSync(classDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const classDocument = JSON.parse(readFileSync(path.join(classDir, fileName), "utf8"));
      const slug = String(classDocument?.system?.slug ?? path.basename(fileName, ".json"));
      return {
        slug,
        name: String(classDocument?.name ?? slug),
        source: String(classDocument?.system?.publication?.title ?? ""),
        spellcasting: Number(classDocument?.system?.spellcasting ?? 0) > 0,
      };
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
}
