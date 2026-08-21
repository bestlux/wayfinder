import { describe, expect, it, vi } from "vitest";
import type { OptionContext, OptionRecord, PendingStep } from "../src/types.js";
import {
  createPickerRenderSession,
  derivePickerRenderProjection,
  derivePickerRenderSession,
  type PickerRenderInputs,
} from "../src/wayfinder/application/picker-render-session.js";
import type { PickStepPane, SpellChoiceStepPane } from "../src/wayfinder/view-models.js";

describe("picker render session", () => {
  it("re-derives search results and cross-filter counts from one prepared option snapshot", () => {
    const inputs = pickInputs();
    const basePane = pickBasePane(inputs);
    const session = createPickerRenderSession(inputs, basePane, "test.pack:wintertouched");

    const pane = derivePickerRenderSession(session, {
      search: "winter",
      filterState: { rank: [], rarity: ["common"], source: ["Player Core"] },
      openFilterKind: "source",
    });

    expect(pane.kind).toBe("pick-item");
    expect(pane.search).toBe("winter");
    expect(pane.options.map((entry) => entry.name)).toEqual(["Wintertouched"]);
    expect(pane.options[0]).toMatchObject({ selected: true, previewing: true });
    expect(pane.filterGroups).toEqual([
      {
        key: "rarity",
        label: "Rarity",
        summaryLabel: "Common",
        selectedCount: 1,
        isOpen: false,
        options: [
          { value: "common", label: "Common", count: 1, selected: true },
          { value: "rare", label: "Rare", count: 1, selected: false },
        ],
      },
      {
        key: "source",
        label: "Source",
        summaryLabel: "Player Core",
        selectedCount: 1,
        isOpen: true,
        options: [
          { value: "Lost Omens", label: "Lost Omens", count: 1, selected: false },
          { value: "Player Core", label: "Player Core", count: 1, selected: true },
        ],
      },
    ]);
  });

  it("keeps the prepared data immutable when later source objects change", () => {
    const inputs = pickInputs();
    const basePane = pickBasePane(inputs);
    const session = createPickerRenderSession(inputs, basePane, "test.pack:wintertouched");

    inputs.options[0]!.name = "Changed outside the session";
    inputs.options[0]!.traits.push("mutated");
    inputs.optionContext.classSlug = "mutated";
    inputs.step.title = "Mutated step";
    basePane.selectedValue = "test.pack:winterwise";

    const pane = derivePickerRenderSession(session, {
      search: "wintertouched",
      filterState: null,
      openFilterKind: null,
    });

    expect(session.step.title).toBe("Heritage");
    expect(session.optionContext.classSlug).toBe("wizard");
    expect(pane.options).toEqual([
      expect.objectContaining({
        name: "Wintertouched",
        traits: [],
        selected: true,
      }),
    ]);
  });

  it("reconstructs spell presentation for options absent from the original visible rows", () => {
    const step = spellStep();
    const options = [
      option("test.pack:false-vitality", "False Vitality", "common", "Player Core 2", 2),
      option("test.pack:falsify-heat", "Falsify Heat", "uncommon", "Player Core 2", 3),
      option("test.pack:detect-magic", "Detect Magic", "common", "Player Core", 0, ["cantrip"]),
    ];
    const inputs: PickerRenderInputs = {
      step,
      optionContext: context(),
      options,
      suppressedOptions: [],
      filterKinds: ["rank", "rarity", "source"],
      getPickerInfoState: () => null,
      matchesSearch: nameSearch,
    };
    const basePane: SpellChoiceStepPane = {
      kind: "spell-choice",
      templateKind: "spell-choice",
      stepId: step.id,
      slotId: step.slotId,
      level: step.level,
      modeLabel: "Spell choice",
      title: step.title,
      description: step.description,
      search: "false",
      activeFilterCount: 0,
      selectedValues: [],
      selectedLabel: null,
      selectedCount: 0,
      requiredCount: 2,
      remainingCount: 2,
      excessCount: 0,
      selectionState: "incomplete",
      resultCount: 1,
      contextNote: null,
      infoState: null,
      suppressionNotice: null,
      destinationLabel: "Wizard spellbook",
      sourceName: "Wizard Spellcasting",
      rarityAccess: {
        visible: true,
        available: true,
        granted: false,
        locked: false,
        state: "none",
        basisLabel: null,
        reason: null,
        authorName: null,
        attestedAt: null,
        descriptionId: "wayfinder-spell-attestation-note-actor-1-step-1",
      },
      filterGroups: [],
      selectedSpells: [],
      options: [
        {
          ...options[0]!,
          selected: false,
          previewing: true,
          sourceLabel: "Player Core 2",
          rankLabel: "Rank 2",
        },
      ],
      preview: null,
    };
    const session = createPickerRenderSession(inputs, basePane, "test.pack:false-vitality");

    const pane = derivePickerRenderSession(session, {
      search: "",
      filterState: null,
      openFilterKind: null,
    });

    expect(pane.kind).toBe("spell-choice");
    if (pane.kind !== "spell-choice") {
      throw new Error("Expected a spell-choice pane.");
    }
    expect(pane.options.map(({ name, rankLabel }) => ({ name, rankLabel }))).toEqual([
      { name: "False Vitality", rankLabel: "Rank 2" },
      { name: "Falsify Heat", rankLabel: "Rank 3" },
      { name: "Detect Magic", rankLabel: "Cantrip" },
    ]);
  });

  it("derives repeatedly without option, context, or preview preparation dependencies", () => {
    const inputs = pickInputs();
    const getPickerInfoState = vi.fn(inputs.getPickerInfoState);
    const session = createPickerRenderSession(
      { ...inputs, getPickerInfoState },
      pickBasePane(inputs),
      "test.pack:wintertouched"
    );

    derivePickerRenderSession(session, { search: "winter", filterState: null, openFilterKind: null });
    derivePickerRenderSession(session, { search: "wise", filterState: null, openFilterKind: null });

    expect(getPickerInfoState).toHaveBeenCalledTimes(2);
    expect(session.options).toHaveLength(3);
    expect(session.basePane.preview).toEqual({ title: "Prepared once", value: "test.pack:wintertouched" });
  });

  it("keeps blocked projections empty without discarding the prepared catalogue", () => {
    const inputs = pickInputs();
    inputs.getPickerInfoState = () => ({
      tone: "blocked",
      eyebrow: "Prerequisite",
      title: "Choose an ancestry",
      message: "Resolve the prerequisite first.",
    });

    const projection = derivePickerRenderProjection(inputs, {
      search: "winter",
      filterState: null,
      openFilterKind: null,
    });

    expect(projection.visibleOptions).toEqual([]);
    expect(inputs.options).toHaveLength(3);
    expect(projection.infoState?.tone).toBe("blocked");
  });

  it("reports prepared fail-closed suppressions and explains a matching name search", () => {
    const inputs = pickInputs();
    inputs.suppressedOptions.push({
      uuid: "Compendium.test.pack.Item.hidden-choice",
      name: "Hidden Choice",
      reason: "unvalidated-granted-choice",
    });
    const session = createPickerRenderSession(inputs, pickBasePane(inputs), "test.pack:wintertouched");

    inputs.suppressedOptions[0]!.name = "Changed outside the session";
    const pane = derivePickerRenderSession(session, {
      search: "hidden choice",
      filterState: null,
      openFilterKind: null,
    });

    expect(pane.suppressionNotice).toEqual({
      count: 1,
      message: "1 option hidden because Wayfinder cannot yet validate a choice it grants.",
    });
    expect(pane.options).toEqual([]);
    expect(pane.infoState).toMatchObject({
      eyebrow: "Not guided yet",
      title: "That choice is hidden",
      message: "1 matching option is hidden because Wayfinder cannot yet validate a choice it grants.",
    });
  });

  it("reports ambiguous heritage ownership without describing it as a granted choice", () => {
    const inputs = pickInputs();
    inputs.options = [];
    inputs.suppressedOptions = [
      {
        uuid: "Compendium.test.pack.Item.unclear",
        name: "Unclear Heritage",
        reason: "ambiguous-heritage-ownership",
      },
    ];
    inputs.getPickerInfoState = () => ({
      tone: "empty",
      eyebrow: "Nothing to pick from",
      title: "No options",
      message: "No options in enabled sources.",
    });

    const projection = derivePickerRenderProjection(inputs, {
      search: "",
      filterState: null,
      openFilterKind: null,
    });

    expect(projection.suppressionNotice?.message).toBe(
      "1 heritage hidden because Wayfinder cannot determine which ancestry it belongs to."
    );
    expect(projection.infoState?.eyebrow).toBe("Not guided yet");
  });

  it("explains eligibility uncertainty without describing a granted choice", () => {
    const inputs = pickInputs();
    inputs.suppressedOptions = [
      {
        uuid: "Compendium.test.pack.Item.wizard-dedication",
        name: "Wizard Dedication",
        reason: "unvalidated-eligibility",
      },
    ];

    const projection = derivePickerRenderProjection(inputs, {
      search: "wizard dedication",
      filterState: null,
      openFilterKind: null,
    });

    expect(projection.visibleOptions).toEqual([]);
    expect(projection.infoState?.message).toBe(
      "1 matching option is hidden because Wayfinder cannot yet validate whether it is eligible."
    );
  });
});

function pickInputs(): PickerRenderInputs {
  return {
    step: pickStep(),
    optionContext: context(),
    options: [
      option("test.pack:wintertouched", "Wintertouched", "common", "Player Core"),
      option("test.pack:winterwise", "Winterwise", "rare", "Player Core"),
      option("test.pack:winterbound", "Winterbound", "common", "Lost Omens"),
    ],
    suppressedOptions: [],
    filterKinds: ["rarity", "source"],
    getPickerInfoState: () => null,
    matchesSearch: nameSearch,
  };
}

function pickBasePane(inputs: PickerRenderInputs): PickStepPane {
  const first = inputs.options[0]!;
  return {
    kind: "pick-item",
    templateKind: "pick-item",
    stepId: inputs.step.id,
    slotId: inputs.step.slotId,
    level: inputs.step.level,
    modeLabel: "Choice",
    title: inputs.step.title,
    description: inputs.step.description,
    search: "",
    activeFilterCount: 0,
    selectedValue: first.value,
    selectedLabel: first.name,
    resultCount: inputs.options.length,
    contextNote: null,
    infoState: null,
    suppressionNotice: null,
    filterGroups: [],
    options: inputs.options.map((entry) => ({
      ...entry,
      selected: entry.value === first.value,
      previewing: entry.value === first.value,
      sourceLabel: entry.source ?? "Unknown Source",
    })),
    preview: { title: "Prepared once", value: first.value } as PickStepPane["preview"],
  };
}

function pickStep(): PendingStep {
  return {
    id: "heritage-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "heritage",
    title: "Heritage",
    description: "Choose a heritage.",
    required: true,
    slotId: "heritage-level-1",
    filters: { itemType: "heritage" },
  };
}

function spellStep(): PendingStep {
  return {
    id: "spell-choice-wizard-rank-2-level-5",
    level: 5,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Wizard spells",
    description: "Choose spells.",
    required: true,
    slotId: "spell-choice-wizard-rank-2-level-5",
    filters: { itemType: "spell" },
    spellChoice: {
      slotId: "spell-choice-wizard-rank-2-level-5",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "wizard-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "prepared",
        key: "wizard-arcane-prepared",
        label: "Wizard spellbook",
        entryName: "Wizard Spellcasting",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 2,
      minRank: 0,
      maxRank: 3,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function context(): OptionContext {
  return {
    ancestrySlug: null,
    ancestryTraits: [],
    heritageTraits: [],
    classSlug: "wizard",
    classHasSpellcasting: true,
    hasDedicationFeat: false,
  };
}

function option(
  value: string,
  name: string,
  rarity: string,
  source: string,
  level = 1,
  traits: string[] = []
): OptionRecord {
  const documentId = value.split(":")[1] ?? name;
  return {
    value,
    packId: "test.pack",
    documentId,
    uuid: `Compendium.test.pack.Item.${documentId}`,
    img: `${documentId}.webp`,
    itemType: "feat",
    featType: null,
    name,
    level,
    slug: documentId,
    traits,
    rarity,
    source,
    label: name,
  };
}

function nameSearch(entry: OptionRecord, search: string): boolean {
  return entry.name.toLowerCase().includes(search.trim().toLowerCase());
}
