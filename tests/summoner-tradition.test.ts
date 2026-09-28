import { describe, expect, it } from "vitest";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import { matchesFilters } from "../src/pack/filter-policy";
import { getPickerBlockedState } from "../src/pack/picker-state";
import type { OptionContext, SelectionRef } from "../src/types";
import type { ClassFeatureSelectionSource } from "../src/wayfinder/class-choice/rule-discovery";
import { resolveSummonerSpellTradition } from "../src/wayfinder/spell-choice/summoner-tradition";
import type { SpellChoiceDocumentLike } from "../src/wayfinder/spell-choice/types";
import { buildSpellChoiceSteps } from "../src/wayfinder/spell-choice-service";
import { pf2e841AngelEidolonEntry, pf2e841DragonEidolonEntry } from "./fixtures/pf2e-841-eidolons";

const SLOT = "class-choice-dragon-eidolon-eidolonTradition-level-1";
const traditions = ["arcane", "divine", "occult", "primal"] as const;
const skill = { arcane: "arcana", divine: "religion", occult: "occultism", primal: "nature" };
const extractSlug = (doc: SpellChoiceDocumentLike | null) => String(doc?.system?.slug ?? "");
const dragon = () => {
  const doc = pf2e841DragonEidolonEntry();
  (doc.system as Record<string, unknown>).description = {
    value: "<p><strong>Tradition</strong> choose arcane, divine, occult, or primal</p>",
  };
  return doc;
};

function source(document = dragon(), existingRulesSelections?: Record<string, unknown>): ClassFeatureSelectionSource {
  const selection: SelectionRef = {
    slotId: "class-branch-eidolon-level-1",
    packId: "pf2e.classfeatures",
    documentId: String(document._id),
    uuid: `Compendium.pf2e.classfeatures.Item.${document._id}`,
    name: String(document.name),
    itemType: "feat",
    featType: "classfeature",
    level: 1,
  };
  return { level: 1, selection, document, existingRulesSelections };
}

describe("Summoner eidolon tradition", () => {
  it.each(traditions)("plans %s cantrips and leveled spells after draft save/reopen", async (tradition) => {
    const draft = createEmptyDraft(4);
    draft.classChoices[SLOT] = tradition;
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(draft)), 4);
    const resolved = resolveSummonerSpellTradition({ draft: reopened, sources: [source()], extractSlug });
    expect(resolved).toBe(tradition);
    const steps = await buildSpellChoiceSteps({
      draft: reopened,
      currentLevel: 1,
      targetLevel: 4,
      effectiveClassDocument: { system: { slug: "summoner" } },
      effectiveDeityDocument: null,
      effectiveSchoolDocument: null,
      effectiveClassFeatureDocuments: [dragon()],
      summonerTradition: resolved,
      extractSlug,
      readExistingSpellChoiceSelections: () => [],
    });
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect(step.spellChoice).toMatchObject({
        dependsOn: "class-branch",
        requiresCurriculum: false,
        destination: { key: `summoner-${tradition}-spontaneous`, tradition },
      });
      expect(getPickerBlockedState(step, { classSlug: "summoner" } as OptionContext)).toBeNull();
      for (const candidate of traditions) {
        const spell = {
          _id: candidate,
          name: candidate,
          type: "spell",
          system: {
            level: { value: step.spellChoice!.minRank },
            traits: { value: step.spellChoice!.cantrip ? ["cantrip"] : [], traditions: [candidate], rarity: "common" },
          },
        };
        expect(matchesFilters(spell, "pf2e.spells-srd", step, {} as OptionContext, new Set())).toBe(
          candidate === tradition
        );
      }
    }
  });

  it.each(traditions)("reads owned structured and legacy scalar %s choices", (tradition) => {
    for (const value of [tradition, { skill: skill[tradition], tradition }]) {
      expect(
        resolveSummonerSpellTradition({
          draft: createEmptyDraft(4),
          sources: [source(dragon(), { eidolonTradition: value })],
          extractSlug,
        })
      ).toBe(tradition);
    }
  });

  it("prioritizes the draft over the matching owned choice but rejects invalid draft values", () => {
    const draft = createEmptyDraft(4);
    const sources = [source(dragon(), { eidolonTradition: { skill: "arcana", tradition: "arcane" } })];
    draft.classChoices[SLOT] = "primal";
    expect(resolveSummonerSpellTradition({ draft, sources, extractSlug })).toBe("primal");
    draft.classChoices[SLOT] = "invalid";
    expect(resolveSummonerSpellTradition({ draft, sources, extractSlug })).toBeNull();
  });

  it("does not invent arcane when the choice is absent, malformed, or belongs to another source", async () => {
    const draft = createEmptyDraft(4);
    draft.classChoices["class-choice-old-dragon-eidolonTradition-level-1"] = "arcane";
    for (const sources of [
      [],
      [source()],
      [source(dragon(), { eidolonTradition: { skill: "nature", tradition: "arcane" } })],
    ]) {
      const resolved = resolveSummonerSpellTradition({ draft, sources, extractSlug });
      expect(resolved).toBeNull();
      expect(
        await buildSpellChoiceSteps({
          draft,
          currentLevel: 1,
          targetLevel: 4,
          effectiveClassDocument: { system: { slug: "summoner" } },
          effectiveDeityDocument: null,
          effectiveSchoolDocument: null,
          summonerTradition: resolved,
          extractSlug,
          readExistingSpellChoiceSelections: () => [],
        })
      ).toEqual([]);
    }
  });

  it("resolves the drafted fixed eidolon before an older owned Dragon and ignores its stale choice", () => {
    const draft = createEmptyDraft(4);
    draft.classChoices[SLOT] = "primal";
    expect(
      resolveSummonerSpellTradition({
        draft,
        sources: [source(pf2e841AngelEidolonEntry()), source(dragon(), { eidolonTradition: "arcane" })],
        extractSlug,
      })
    ).toBe("divine");
  });
});
