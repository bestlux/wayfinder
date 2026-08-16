import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellTemplate = readFileSync(resolve("templates/wayfinder-app.hbs"), "utf8");
const paneSources = [
  "src/wayfinder/app-shell.ts",
  "src/wayfinder/panes/boost-pane.ts",
  "src/wayfinder/panes/class-choice-pane.ts",
  "src/wayfinder/panes/language-choice-pane.ts",
  "src/wayfinder/panes/pick-pane.ts",
  "src/wayfinder/panes/singleton-choice-pane.ts",
  "src/wayfinder/panes/skill-pane.ts",
  "src/wayfinder/panes/spell-pane.ts",
  "src/wayfinder/view-models.ts",
].map((path) => readFileSync(resolve(path), "utf8"));

const templateKinds = [
  "manual",
  "boost",
  "skill-increase",
  "skill-training",
  "singleton-choice",
  "language-choice",
  "class-choice",
  "spell-choice",
  "pick-item",
] as const;

describe("wayfinder pane template discriminant", () => {
  it("dispatches every current pane through one templateKind field", () => {
    for (const kind of templateKinds) {
      expect(shellTemplate).toContain(`(eq activePane.templateKind "${kind}")`);
    }

    expect(shellTemplate).not.toMatch(/activePane\.is[A-Z]/);
  });

  it("does not rebuild the former isX Boolean matrix in pane view models", () => {
    const combinedSources = paneSources.join("\n");

    expect(combinedSources).not.toMatch(
      /\b(?:isPickItem|isManual|isBoost|isSkillIncrease|isSkillTraining|isSingletonChoice|isLanguageChoice|isClassChoice|isSpellChoice):/
    );
    for (const kind of templateKinds) {
      expect(combinedSources).toContain(`templateKind: "${kind}"`);
    }
  });
});
