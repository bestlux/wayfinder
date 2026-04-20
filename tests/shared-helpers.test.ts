import { describe, expect, it } from "vitest";
import { cloneData } from "../src/shared/cloning";
import { extractDocumentSlug, slugifyName } from "../src/shared/slug";
import { itemMatchesSourceId, sourceIdOf } from "../src/shared/source-id";
import { isSanctificationChoiceSlotId, isWizardArcaneSchoolSlotId, SLOT_IDS } from "../src/wayfinder/slot-ids";

describe("shared helper modules", () => {
  it("clones nested data without preserving references", () => {
    const original = { outer: { value: 1 }, list: ["a"] };
    const cloned = cloneData(original);

    cloned.outer.value = 2;
    cloned.list.push("b");

    expect(original).toEqual({ outer: { value: 1 }, list: ["a"] });
  });

  it("normalizes slugs from documents and names", () => {
    expect(slugifyName("School of Unified Magical Theory")).toBe("school-of-unified-magical-theory");
    expect(extractDocumentSlug({ slug: "  Battle-Oracle  " })).toBe("battle-oracle");
    expect(
      extractDocumentSlug({
        system: { slug: "  School Of Battle Magic  " },
        name: "Ignored Name",
      })
    ).toBe("school-of-battle-magic");
    expect(
      extractDocumentSlug({
        system: { ancestry: { slug: " Human " } },
        name: "Ignored Name",
      })
    ).toBe("human");
    expect(extractDocumentSlug({ name: "Battle Oracle" })).toBe("battle-oracle");
  });

  it("reads source ids from the known PF2E storage locations", () => {
    expect(sourceIdOf({ sourceId: "Compendium.test.pack.Item.foo" })).toBe("Compendium.test.pack.Item.foo");
    expect(sourceIdOf({ flags: { core: { sourceId: "Compendium.test.pack.Item.bar" } } })).toBe(
      "Compendium.test.pack.Item.bar"
    );
    expect(sourceIdOf({ _stats: { compendiumSource: "Compendium.test.pack.Item.baz" } })).toBe(
      "Compendium.test.pack.Item.baz"
    );
    expect(
      itemMatchesSourceId(
        { _stats: { compendiumSource: "Compendium.test.pack.Item.baz" } },
        "Compendium.test.pack.Item.baz"
      )
    ).toBe(true);
  });

  it("centralizes high-value slot id checks", () => {
    expect(SLOT_IDS.wizardArcaneSchool).toBe("class-branch-arcane-school-level-1");
    expect(isWizardArcaneSchoolSlotId("class-branch-arcane-school-level-3")).toBe(true);
    expect(isSanctificationChoiceSlotId("class-choice-champion-sanctification-level-1")).toBe(true);
    expect(isSanctificationChoiceSlotId("class-choice-champion-deity-level-1")).toBe(false);
  });
});
