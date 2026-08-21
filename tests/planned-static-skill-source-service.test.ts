import { describe, expect, it } from "vitest";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  listPlannedStaticSkillSources,
  synchronizeRetainedClassArchetypeChoice,
} from "../src/wayfinder/application/planned-static-skill-source-service";
import { createClassArchetypeStep } from "../src/wayfinder/domain/step-types";

const DOCTRINE_UUID = "Compendium.pf2e.classfeatures.Item.tyrBwBTzo5t9Zho7";
const BATTLE_CREED_UUID = "Compendium.pf2e.classfeatures.Item.49CkgA3kj7Im6gZ5";
const DEDICATION_UUID = "Compendium.pf2e.feats-srd.Item.K7YK5ESDoreohCe8";
const SLOT_ID = "class-archetype-doctrine-level-1";

describe("planned static skill source service", () => {
  it("reconstructs a completed retained profile when actor provenance and the active plan agree", () => {
    const draft = createEmptyDraft(5);
    const steps = [battleHarbingerTrainingStep()];

    synchronizeRetainedClassArchetypeChoice(draft, steps, retainedBattleCreedActorItems());

    expect(draft.classArchetypeChoices).toEqual({ [SLOT_ID]: "battle-creed" });
    expect(listPlannedStaticSkillSources(draft, steps)).toContainEqual({
      selection: expect.objectContaining({ uuid: BATTLE_CREED_UUID, slotId: SLOT_ID }),
      requiredBeforeSkillPhase: false,
    });
  });

  it("imports a canonical PF2E grant chain that predates Wayfinder flags", () => {
    const draft = createEmptyDraft(5);
    const items = retainedBattleCreedActorItems().map((item) => ({
      ...item,
      flags: Object.fromEntries(Object.entries(item.flags ?? {}).filter(([key]) => key !== MODULE_ID)),
    }));

    synchronizeRetainedClassArchetypeChoice(draft, [battleHarbingerTrainingStep()], items);

    expect(draft.classArchetypeChoices).toEqual({ [SLOT_ID]: "battle-creed" });
  });

  it.each([
    {
      value: "way-of-the-spellshot",
      classSlug: "gunslinger",
      selectorFlag: "way",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.LDqVxLKrwEqSegiu",
      profileUuid: "Compendium.pf2e.classfeatures.Item.OmgtSDV1FubDUqWR",
      slotId: "class-archetype-gunslingers-way-level-1",
    },
    {
      value: "palatine-detective",
      classSlug: "investigator",
      selectorFlag: "methodology",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.uhHg9BXBiHpL5ndS",
      profileUuid: "Compendium.pf2e.classfeatures.Item.ppGGpc3Iv2NpAhys",
      slotId: "class-archetype-methodology-level-1",
    },
  ])("reconstructs retained $value history from profile-backed plan steps", (profile) => {
    const draft = createEmptyDraft(5);
    const steps = [profileSpellChoiceStep(profile.profileUuid, profile.classSlug)];

    synchronizeRetainedClassArchetypeChoice(draft, steps, retainedProfileActorItems(profile));

    expect(draft.classArchetypeChoices).toEqual({ [profile.slotId]: profile.value });
  });

  it("prefers current PF2E selector state over a stale legacy alias", () => {
    const draft = createEmptyDraft(5);
    const items = retainedBattleCreedActorItems().map((item) =>
      item.id === "doctrine-1"
        ? {
            ...item,
            flags: {
              ...item.flags,
              system: { rulesSelections: { doctrine: "Compendium.pf2e.classfeatures.Item.stale" } },
            },
          }
        : item
    );

    synchronizeRetainedClassArchetypeChoice(draft, [battleHarbingerTrainingStep()], items);

    expect(draft.classArchetypeChoices).toEqual({ [SLOT_ID]: "battle-creed" });
  });

  it("treats an explicitly cleared PF2E selector as authoritative over a stale legacy route", () => {
    const draft = createEmptyDraft(5);
    const items = retainedBattleCreedActorItems().map((item) =>
      item.id === "doctrine-1"
        ? {
            ...item,
            flags: {
              ...item.flags,
              pf2e: { rulesSelections: { doctrine: null } },
              system: { rulesSelections: { doctrine: BATTLE_CREED_UUID } },
            },
          }
        : item
    );

    expect(() => synchronizeRetainedClassArchetypeChoice(draft, [battleHarbingerTrainingStep()], items)).toThrow(
      /ambiguous or contradictory/i
    );
    expect(draft.classArchetypeChoices).toEqual({});
  });

  it("keeps an explicit Standard decision authoritative over retained actor history", () => {
    const draft = createEmptyDraft(5);
    const step = doctrineArchetypeStep();
    draft.classArchetypeChoices[step.slotId] = "standard";

    synchronizeRetainedClassArchetypeChoice(
      draft,
      [step, battleHarbingerTrainingStep()],
      retainedBattleCreedActorItems()
    );

    expect(draft.classArchetypeChoices).toEqual({ [SLOT_ID]: "standard" });
    expect(listPlannedStaticSkillSources(draft, [step])).not.toContainEqual(
      expect.objectContaining({ selection: expect.objectContaining({ uuid: BATTLE_CREED_UUID }) })
    );
  });

  it.each([
    {
      label: "orphaned profile item",
      items: retainedBattleCreedActorItems().filter((item) => item.id !== "doctrine-1"),
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "cross-class selector chain",
      items: retainedBattleCreedActorItems().map((item) =>
        item.id === "class-1" ? { ...item, system: { slug: "gunslinger" } } : item
      ),
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "mismatched recorded Wayfinder slot",
      items: retainedBattleCreedActorItems().map((item) =>
        item.id === "battle-creed-1"
          ? { ...item, flags: { ...item.flags, [MODULE_ID]: { slotId: "class-archetype-wrong-level-1" } } }
          : item
      ),
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "duplicate valid profile document",
      items: [
        ...retainedBattleCreedActorItems(),
        {
          ...retainedBattleCreedActorItems().find((item) => item.id === "battle-creed-1")!,
          id: "battle-creed-2",
        },
      ],
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "duplicate profile document with a contradictory Wayfinder slot",
      items: [
        ...retainedBattleCreedActorItems(),
        {
          ...retainedBattleCreedActorItems().find((item) => item.id === "battle-creed-1")!,
          id: "battle-creed-wrong-slot",
          flags: {
            core: { sourceId: BATTLE_CREED_UUID },
            pf2e: { grantedBy: { id: "doctrine-1" } },
            [MODULE_ID]: { slotId: "class-archetype-wrong-level-1" },
          },
        },
      ],
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "reversed duplicate valid profile document",
      items: [
        {
          ...retainedBattleCreedActorItems().find((item) => item.id === "battle-creed-1")!,
          id: "battle-creed-2",
        },
        ...retainedBattleCreedActorItems(),
      ],
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "contradictory duplicate selector",
      items: [
        ...retainedBattleCreedActorItems(),
        {
          ...retainedBattleCreedActorItems().find((item) => item.id === "doctrine-1")!,
          id: "doctrine-2",
          flags: {
            core: { sourceId: DOCTRINE_UUID },
            pf2e: { rulesSelections: { doctrine: "Compendium.pf2e.classfeatures.Item.stale" } },
          },
        },
      ],
      steps: [battleHarbingerTrainingStep()],
    },
    {
      label: "contradictory selector reverse grant link",
      items: retainedBattleCreedActorItems().map((item) =>
        item.id === "doctrine-1"
          ? {
              ...item,
              flags: {
                ...item.flags,
                pf2e: {
                  ...item.flags?.pf2e,
                  itemGrants: { doctrine: { id: "other-profile", onDelete: "detach" } },
                },
              },
            }
          : item
      ),
      steps: [battleHarbingerTrainingStep()],
    },
  ])("rejects a $label when the active plan depends on the retained route", ({ items, steps }) => {
    const draft = createEmptyDraft(5);

    expect(() => synchronizeRetainedClassArchetypeChoice(draft, steps, items)).toThrow(/ambiguous or contradictory/i);

    expect(draft.classArchetypeChoices).toEqual({});
    expect(listPlannedStaticSkillSources(draft, steps)).not.toContainEqual(
      expect.objectContaining({ selection: expect.objectContaining({ uuid: BATTLE_CREED_UUID }) })
    );
  });

  it("ignores retained history when the active plan does not reference its route", () => {
    const draft = createEmptyDraft(5);
    const steps = [unrelatedTrainingStep()];

    synchronizeRetainedClassArchetypeChoice(draft, steps, retainedBattleCreedActorItems());

    expect(draft.classArchetypeChoices).toEqual({});
    expect(listPlannedStaticSkillSources(draft, steps)).not.toContainEqual(
      expect.objectContaining({ selection: expect.objectContaining({ uuid: BATTLE_CREED_UUID }) })
    );
  });
});

function retainedBattleCreedActorItems() {
  return [
    { id: "class-1", type: "class", name: "Cleric", system: { slug: "cleric" } },
    {
      id: "doctrine-1",
      type: "feat",
      name: "Doctrine",
      flags: {
        core: { sourceId: DOCTRINE_UUID },
        pf2e: { rulesSelections: { doctrine: BATTLE_CREED_UUID } },
        [MODULE_ID]: { slotId: SLOT_ID },
      },
      system: { slug: "doctrine" },
    },
    {
      id: "battle-creed-1",
      type: "feat",
      name: "Battle Creed",
      flags: {
        core: { sourceId: BATTLE_CREED_UUID },
        pf2e: { grantedBy: { id: "doctrine-1" } },
        [MODULE_ID]: { slotId: SLOT_ID },
      },
      system: { slug: "battle-creed" },
    },
  ];
}

function doctrineArchetypeStep(): PendingStep {
  return createClassArchetypeStep(1, {
    slotId: SLOT_ID,
    standardValue: "standard",
    sourceName: "Doctrine",
    selector: {
      slotId: SLOT_ID,
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "tyrBwBTzo5t9Zho7",
      selectorUuid: DOCTRINE_UUID,
      selectorName: "Doctrine",
      selectorRuleIndex: 0,
      flag: "doctrine",
      optionTag: "cleric-doctrine",
      classSlug: "cleric",
      dependsOn: "class",
    },
    options: [
      { value: "standard", label: "Standard", img: null, detail: null },
      { value: "battle-creed", label: "Battle Creed", img: null, detail: null },
    ],
  });
}

function battleHarbingerTrainingStep(): PendingStep {
  return trainingStep(DEDICATION_UUID, "Battle Harbinger Dedication");
}

function unrelatedTrainingStep(): PendingStep {
  return trainingStep("Compendium.pf2e.feats-srd.Item.unrelated", "Unrelated Dedication");
}

function trainingStep(sourceUuid: string, sourceLabel: string): PendingStep {
  const slotId = "skill-training-battle-harbinger-dedication-level-2";
  return {
    id: slotId,
    level: 2,
    kind: "skill-training",
    slotKind: "skill-training",
    title: `${sourceLabel} training`,
    description: "",
    required: true,
    slotId,
    training: {
      classSlug: "cleric",
      className: "Cleric",
      fixedSkills: [],
      fixedLores: [],
      choiceRules: [
        {
          key: "feat:battle-harbinger-dedication:skill",
          flag: "skill",
          prompt: "Choose a skill",
          sourceLabel,
          options: [{ slug: "athletics", label: "Athletics" }],
          persistence: {
            sourceItemType: "feat",
            sourcePackId: "pf2e.feats-srd",
            sourceDocumentId: sourceUuid.split(".").at(-1) ?? "unknown",
            sourceUuid,
            sourceRuleIndex: 0,
          },
        },
      ],
      loreChoices: [],
      additionalCount: 0,
    },
  };
}

function retainedProfileActorItems(profile: {
  classSlug: string;
  selectorFlag: string;
  selectorUuid: string;
  profileUuid: string;
}) {
  return [
    { id: "class-1", type: "class", name: profile.classSlug, system: { slug: profile.classSlug } },
    {
      id: "selector-1",
      type: "feat",
      name: "Selector",
      flags: {
        core: { sourceId: profile.selectorUuid },
        pf2e: { rulesSelections: { [profile.selectorFlag]: profile.profileUuid } },
      },
    },
    {
      id: "profile-1",
      type: "feat",
      name: "Profile",
      flags: {
        core: { sourceId: profile.profileUuid },
        pf2e: { grantedBy: { id: "selector-1" } },
      },
    },
  ];
}

function profileSpellChoiceStep(sourceUuid: string, classSlug: string): PendingStep {
  const slotId = `spell-choice-${classSlug}-profile-level-2`;
  return {
    id: slotId,
    level: 2,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Profile spell",
    description: "",
    required: true,
    slotId,
    filters: { itemType: "spell" },
    spellChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: sourceUuid.split(".").at(-1) ?? "unknown",
      sourceUuid,
      sourceName: "Profile",
      classSlug,
      dependsOn: "class-branch",
      destination: {
        type: "innate",
        key: `${classSlug}-profile-spells`,
        label: "Profile spells",
        entryName: "Profile Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "innate",
      },
      count: 1,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}
