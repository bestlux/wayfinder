import { describe, expect, it, vi } from "vitest";
import { applyLanguageChoiceDraft } from "../src/actor-updater/language-choice-application";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";

describe("actor-updater language-choice application", () => {
  it("writes drafted source languages to the actor", async () => {
    const update = vi.fn(async () => ({}));
    const draft = createEmptyDraft(1);
    draft.languageChoices["language-choice-level-1"] = ["draconic", "dwarven"];

    await applyLanguageChoiceDraft({ update }, draft, [
      {
        id: "language-choice-level-1",
        level: 1,
        kind: "language-choice",
        slotKind: "language-choice",
        title: "Bonus languages",
        description: "",
        required: true,
        slotId: "language-choice-level-1",
        languageChoice: {
          slotId: "language-choice-level-1",
          sourceItemType: "ancestry",
          sourceName: "Human",
          grantedLanguages: ["common"],
          count: 2,
          options: [],
        },
      } satisfies PendingStep,
    ]);

    expect(update).toHaveBeenCalledWith({
      "system.details.languages.value": ["draconic", "dwarven"],
    });
  });
});
