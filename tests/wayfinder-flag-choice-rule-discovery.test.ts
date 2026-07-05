import { describe, expect, it } from "vitest";
import { classifyEmbeddedChoices } from "../src/pack/embedded-choice-policy";
import { discoverFlagChoiceMeta } from "../src/wayfinder/flag-choice/rule-discovery";

describe("wayfinder flag-choice rule discovery", () => {
  it("discovers standalone filtered choices from the named pack fixtures", () => {
    const multifarious = discoverFlagChoiceMeta({
      sourceItemType: "feat",
      sourceDocument: multifariousMuse(),
      sourceSelection: sourceSelection("a898miJnjgD93ZsX", "Multifarious Muse"),
      extractSlug,
      requireResolvedActorPlaceholders: true,
    });
    expect(multifarious).toHaveLength(1);
    expect(multifarious[0]).toMatchObject({
      sourceRuleIndex: 0,
      flag: "muse",
      itemType: "feat",
      selectionValue: "uuid",
      filters: {
        itemType: "feat",
        packIds: ["pf2e.classfeatures", "pf2e.feats-srd"],
        predicate: ["item:tag:bard-muse"],
      },
    });

    const bardDedication = discoverFlagChoiceMeta({
      sourceItemType: "feat",
      sourceDocument: bardDedicationFeat(),
      sourceSelection: sourceSelection("dIH771mt4PcVTyAs", "Bard Dedication"),
      extractSlug,
      requireResolvedActorPlaceholders: true,
    });
    expect(bardDedication).toHaveLength(1);
    expect(bardDedication[0]).toMatchObject({
      sourceRuleIndex: 0,
      flag: "dedicationMuse",
      itemType: "feat",
      selectionValue: "slug",
      filters: {
        itemType: "feat",
        packIds: ["pf2e.classfeatures", "pf2e.feats-srd"],
        predicate: ["item:tag:bard-muse", { not: "item:tag:class-archetype" }],
      },
    });

    const celestialMagic = discoverFlagChoiceMeta({
      sourceItemType: "feat",
      sourceDocument: celestialMagicFeat(),
      sourceSelection: sourceSelection("esKk5XrnlqRayDPG", "Celestial Magic", "ancestry"),
      extractSlug,
      requireResolvedActorPlaceholders: true,
    });
    expect(celestialMagic).toHaveLength(1);
    expect(celestialMagic[0]).toMatchObject({
      sourceRuleIndex: 0,
      flag: "spell",
      itemType: "spell",
      selectionValue: "slug",
      filters: {
        itemType: "spell",
        packIds: ["pf2e.spells-srd"],
      },
    });
  });

  it("resolves actor ancestry placeholders and refuses unresolved placeholders at plan time", () => {
    const unresolved = discoverFlagChoiceMeta({
      sourceItemType: "feat",
      sourceDocument: adoptedAncestry(),
      sourceSelection: sourceSelection("ihN8gkHSdPG9Trte", "Adopted Ancestry", "general"),
      extractSlug,
      requireResolvedActorPlaceholders: true,
    });
    expect(unresolved).toEqual([]);

    const resolved = discoverFlagChoiceMeta({
      sourceItemType: "feat",
      sourceDocument: adoptedAncestry(),
      sourceSelection: sourceSelection("ihN8gkHSdPG9Trte", "Adopted Ancestry", "general"),
      extractSlug,
      actorContext: { ancestrySlug: "human" },
      requireResolvedActorPlaceholders: true,
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      sourceRuleIndex: 0,
      flag: "ancestry",
      selectionValue: "slug",
      dependsOn: "ancestry",
      filters: {
        itemType: "ancestry",
        packIds: ["pf2e.ancestries"],
        predicate: [{ not: "item:slug:human" }],
      },
    });
  });

  it("marks standalone filtered rules covered in embedded-choice policy when placeholders resolve", () => {
    const result = classifyEmbeddedChoices(adoptedAncestry() as any, "pf2e.feats-srd", {
      sourceItemType: "feat",
      optionContext: { ancestrySlug: "human", classSlug: null },
      requireResolvedActorPlaceholders: true,
    });

    expect(result.covered).toEqual([0]);
    expect(result.uncovered).toEqual([]);
    expect(result.rules).toEqual([{ ruleIndex: 0, coveredBy: ["flag-choice"] }]);
  });
});

function sourceSelection(documentId: string, name: string, featType = "class") {
  return {
    slotId: "class-feat-level-2",
    packId: "pf2e.feats-srd",
    documentId,
    uuid: "Compendium.pf2e.feats-srd.Item." + documentId,
    itemType: "feat",
    featType,
    name,
    level: 2,
  };
}

function extractSlug(document: unknown): string | null {
  const typed = document as { name?: unknown; system?: { slug?: unknown } } | null;
  if (typeof typed?.system?.slug === "string" && typed.system.slug.length > 0) {
    return typed.system.slug;
  }
  return typeof typed?.name === "string"
    ? typed.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : null;
}

function featEntry(id: string, name: string, category: string, level: number, rules: unknown[]) {
  return {
    _id: id,
    name,
    type: "feat",
    system: {
      slug: null,
      category,
      featType: { value: category },
      level: { value: level },
      rules,
    },
  };
}

function multifariousMuse() {
  return featEntry("a898miJnjgD93ZsX", "Multifarious Muse", "class", 2, [
    {
      choices: {
        filter: ["item:tag:bard-muse"],
      },
      flag: "muse",
      key: "ChoiceSet",
      prompt: "PF2E.SpecificRule.Bard.Muse.Prompt",
    },
    {
      adjustName: false,
      choices: {
        filter: ["item:level:1", "item:category:class", "item:trait:bard"],
        itemType: "feat",
      },
      flag: "feat",
      key: "ChoiceSet",
      prompt: "PF2E.SpecificRule.Prompt.Feat",
    },
    {
      key: "GrantItem",
      uuid: "{item|flags.system.rulesSelections.feat}",
    },
    {
      key: "RollOption",
      option: "feature:{item|flags.system.rulesSelections.muse}",
    },
  ]);
}

function bardDedicationFeat() {
  return featEntry("dIH771mt4PcVTyAs", "Bard Dedication", "class", 2, [
    {
      choices: {
        filter: ["item:tag:bard-muse", { not: "item:tag:class-archetype" }],
        slugsAsValues: true,
      },
      flag: "dedicationMuse",
      key: "ChoiceSet",
      prompt: "PF2E.SpecificRule.Bard.Muse.Prompt",
    },
    {
      key: "RollOption",
      option: "feature:{item|flags.system.rulesSelections.dedicationMuse}",
    },
    {
      key: "ActiveEffectLike",
      mode: "upgrade",
      path: "system.skills.performance.rank",
      value: 1,
    },
    {
      key: "ActiveEffectLike",
      mode: "upgrade",
      path: "system.skills.occultism.rank",
      value: 1,
    },
  ]);
}

function adoptedAncestry() {
  return featEntry("ihN8gkHSdPG9Trte", "Adopted Ancestry", "general", 1, [
    {
      choices: {
        filter: [{ not: "item:slug:{actor|system.details.ancestry.trait}" }],
        itemType: "ancestry",
        slugsAsValues: true,
      },
      flag: "ancestry",
      key: "ChoiceSet",
      prompt: "PF2E.SpecificRule.AdoptedAncestry.Prompt",
    },
    {
      key: "ActiveEffectLike",
      mode: "override",
      path: "system.details.ancestry.adopted",
      value: "{item|flags.system.rulesSelections.ancestry}",
    },
    {
      key: "ActiveEffectLike",
      mode: "add",
      path: "system.details.ancestry.countsAs",
      value: "{item|flags.system.rulesSelections.ancestry}",
    },
  ]);
}

function celestialMagicFeat() {
  return featEntry("esKk5XrnlqRayDPG", "Celestial Magic", "ancestry", 9, [
    {
      adjustName: false,
      choices: {
        filter: [
          {
            or: [
              "item:slug:clear-mind",
              "item:slug:sure-footing",
              "item:slug:share-life",
              "item:slug:revealing-light",
              "item:slug:humanoid-form",
              "item:slug:everlight",
            ],
          },
        ],
        itemType: "spell",
        slugsAsValues: true,
      },
      flag: "spell",
      key: "ChoiceSet",
      prompt: "PF2E.SpecificRule.Prompt.Spell",
    },
  ]);
}
