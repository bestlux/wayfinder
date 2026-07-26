import { describe, expect, it } from "vitest";
import type { PendingStep } from "../src/types";
import {
  canGrantRestrictedSpellRarityAccess,
  grantsRestrictedSpellRarityAccess,
} from "../src/wayfinder/spell-choice/rarity-access";

describe("spell rarity access", () => {
  it("only relaxes the common-rarity restriction after explicit access is granted", () => {
    const restricted = spellChoiceStep(true);

    expect(canGrantRestrictedSpellRarityAccess(restricted)).toBe(true);
    expect(grantsRestrictedSpellRarityAccess(restricted, false)).toBe(restricted);

    const granted = grantsRestrictedSpellRarityAccess(restricted, true);
    expect(granted).not.toBe(restricted);
    expect(granted.kind === "spell-choice" && granted.spellChoice.restrictToCommon).toBe(false);
    expect(granted.filters).toEqual(restricted.filters);
    expect(
      granted.kind === "spell-choice" && {
        tradition: granted.spellChoice.destination.tradition,
        cantrip: granted.spellChoice.cantrip,
        minRank: granted.spellChoice.minRank,
        maxRank: granted.spellChoice.maxRank,
      }
    ).toEqual({
      tradition: "occult",
      cantrip: true,
      minRank: 0,
      maxRank: 0,
    });
  });

  it("does not rewrite a step that already permits its defined spell pool", () => {
    const unrestricted = spellChoiceStep(false);

    expect(grantsRestrictedSpellRarityAccess(unrestricted, true)).toBe(unrestricted);
  });

  it("does not offer an override for a fixed spell allowlist", () => {
    const fixed = spellChoiceStep(true);
    if (fixed.kind !== "spell-choice") {
      throw new Error("Expected spell-choice step");
    }
    fixed.spellChoice.allowedSpellSlugs = ["shield"];

    expect(canGrantRestrictedSpellRarityAccess(fixed)).toBe(false);
    expect(grantsRestrictedSpellRarityAccess(fixed, true)).toBe(fixed);
  });
});

function spellChoiceStep(restrictToCommon: boolean): PendingStep {
  return {
    id: "spell-choice-witch-cantrips-level-1",
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Witch cantrips",
    description: "",
    required: true,
    slotId: "spell-choice-witch-cantrips-level-1",
    filters: {
      itemType: "spell",
      packIds: ["pf2e.spells-srd"],
    },
    spellChoice: {
      slotId: "spell-choice-witch-cantrips-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "witch-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.witch-spellcasting",
      sourceName: "Witch Spellcasting",
      classSlug: "witch",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "witch-occult-prepared",
        label: "Witch familiar",
        entryName: "Witch Spellcasting",
        tradition: "occult",
        ability: "int",
        prepared: "prepared",
      },
      count: 5,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon,
    },
  };
}
