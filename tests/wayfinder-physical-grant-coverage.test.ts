import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import {
  findUnsupportedPhysicalGrantRoutes,
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  type PhysicalGrantSelectionChannel,
  physicalGrantCoverageBlockers,
  physicalGrantCoverageIssues,
  physicalGrantCoverageVersionBlocker,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES,
  withPhysicalGrantCoverageReadiness,
} from "../src/wayfinder/domain/physical-grant-coverage";

describe("physical-grant coverage", () => {
  it("blocks every registered unsupported route from exact active draft selections", () => {
    expect(UNSUPPORTED_PHYSICAL_GRANT_ROUTES).toHaveLength(46);
    expect(new Set(UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS).size).toBe(46);

    for (const route of UNSUPPORTED_PHYSICAL_GRANT_ROUTES) {
      for (const activation of route.activationVariants) {
        const draft = createEmptyDraft(1);
        const steps: PendingStep[] = [];
        activation.forEach((requirement, index) => {
          const slotId = requirement.slotId ?? `coverage-selection-${index}`;
          const channel = requirement.channel ?? "selections";
          draft[channel][slotId] = selection(slotId, requirement.sourceUuid);
          steps.push({ slotId } as PendingStep);
        });

        expect(findUnsupportedPhysicalGrantRoutes(draft, steps)).toEqual([
          expect.objectContaining({
            code: "unsupported-physical-grant",
            routeId: route.routeId,
            reasonCode: route.blocker.reasonCode,
            sourceUuid: activation.at(-1)!.sourceUuid,
          }),
        ]);
      }
    }
  });

  it("ignores inactive and malformed persisted selections", () => {
    const draft = createEmptyDraft(1);
    draft.selections.orphaned = selection("orphaned-feat", "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF");
    draft.selections["wrong-map-key"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.1HsH8hE79MDsi8kK"
    );

    expect(
      findUnsupportedPhysicalGrantRoutes(draft, [
        { slotId: "wrong-map-key" } as PendingStep,
        { slotId: "ancestry-feat-level-1" } as PendingStep,
      ])
    ).toEqual([]);
  });

  it.each([
    ["alchemist-formula-book", "selections", "class-level-1", "Compendium.pf2e.classes.Item.XwfcJuskrhI9GIjX"],
    [
      "investigator-alchemical-sciences-formula-book",
      "branchSelections",
      "class-branch-methodology-level-1",
      "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX",
    ],
    [
      "giant-instinct-titan-mauler",
      "branchSelections",
      "class-branch-instinct-level-1",
      "Compendium.pf2e.classfeatures.Item.JuKD6k7nDwfO0Ckv",
    ],
    [
      "inventor-construct-innovation",
      "branchSelections",
      "class-branch-innovation-level-1",
      "Compendium.pf2e.classfeatures.Item.o70O2FysDd7BS9e0",
    ],
    ["dwarf-clan-dagger", "selections", "ancestry-level-1", "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6"],
    ["sarangay-head-gem", "selections", "ancestry-level-1", "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8"],
  ] as const)("does not block the supported %s profile", (_profileId, channel, slotId, sourceUuid) => {
    const draft = createEmptyDraft(1);
    draft[channel][slotId] = selection(slotId, sourceUuid);

    expect(findUnsupportedPhysicalGrantRoutes(draft, [{ slotId } as PendingStep])).toEqual([]);
  });

  it("reads nested active branch selections while blocking before their classChoices can materialize equipment", () => {
    const draft = createEmptyDraft(1);
    draft.branchSelections["class-branch-innovation-level-1"] = selection(
      "class-branch-innovation-level-1",
      "Compendium.pf2e.classfeatures.Item.fpwtpm8pdwO1I6MO"
    );
    draft.classChoices["class-choice-armor-innovation-armorInnovation-level-1"] =
      "Compendium.pf2e.equipment-srd.Item.N42lmp3Ft6EsSvzg";

    expect(
      findUnsupportedPhysicalGrantRoutes(draft, [
        { slotId: "class-branch-innovation-level-1" } as PendingStep,
        { slotId: "class-choice-armor-innovation-armorInnovation-level-1" } as PendingStep,
      ])
    ).toEqual([
      expect.objectContaining({
        routeId: "inventor-armor-innovation",
        sourceSlotId: "class-branch-innovation-level-1",
      }),
    ]);
  });

  it("blocks Weapon Innovation while leaving non-physical Construct Innovation available", () => {
    const weapon = createEmptyDraft(1);
    weapon.branchSelections["class-branch-innovation-level-1"] = selection(
      "class-branch-innovation-level-1",
      "Compendium.pf2e.classfeatures.Item.bok3P78CMchFibxC"
    );
    expect(
      findUnsupportedPhysicalGrantRoutes(weapon, [{ slotId: "class-branch-innovation-level-1" } as PendingStep])
    ).toEqual([expect.objectContaining({ routeId: "inventor-weapon-innovation" })]);

    const construct = createEmptyDraft(1);
    construct.branchSelections["class-branch-innovation-level-1"] = selection(
      "class-branch-innovation-level-1",
      "Compendium.pf2e.classfeatures.Item.o70O2FysDd7BS9e0"
    );
    expect(
      findUnsupportedPhysicalGrantRoutes(construct, [{ slotId: "class-branch-innovation-level-1" } as PendingStep])
    ).toEqual([]);
  });

  it("returns stable route ordering when more than one unsupported path is active", () => {
    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.1HsH8hE79MDsi8kK"
    );
    draft.selections["background-level-1"] = selection(
      "background-level-1",
      "Compendium.pf2e.backgrounds.Item.N0CRYmDCw8bgNxLl",
      "background"
    );

    expect(
      findUnsupportedPhysicalGrantRoutes(draft, [
        { slotId: "ancestry-feat-level-1" } as PendingStep,
        { slotId: "background-level-1" } as PendingStep,
      ]).map((blocker) => blocker.routeId)
    ).toEqual(["hunted-by-the-night-equipment", "orc-warmask"]);
    expect(UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS).toEqual([...UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS].sort());
  });

  it("requires every exact Ancient Elf descendant fact and never combines another Giant Instinct route", () => {
    const giantRoute = UNSUPPORTED_PHYSICAL_GRANT_ROUTES.find(
      (route) => route.routeId === "ancient-elf-giant-instinct-weapon"
    )!;
    const giantActivation = giantRoute.activationVariants[0]!;

    giantActivation.forEach((_omitted, omittedIndex) => {
      const draft = createEmptyDraft(1);
      const steps: PendingStep[] = [];
      giantActivation.forEach((requirement, index) => {
        if (index === omittedIndex) return;
        addRequirement(draft, steps, requirement.channel ?? "selections", requirement.slotId!, requirement.sourceUuid);
      });
      expect(findUnsupportedPhysicalGrantRoutes(draft, steps)).toEqual([]);
    });

    const normalBarbarian = createEmptyDraft(1);
    addRequirement(
      normalBarbarian,
      [],
      "selections",
      "heritage-level-1",
      "Compendium.pf2e.heritages.Item.Nd9hdX8rdYyRozw8"
    );
    addRequirement(
      normalBarbarian,
      [],
      "branchSelections",
      "class-branch-instinct-level-1",
      "Compendium.pf2e.classfeatures.Item.JuKD6k7nDwfO0Ckv"
    );
    expect(
      findUnsupportedPhysicalGrantRoutes(normalBarbarian, [
        { slotId: "heritage-level-1" } as PendingStep,
        { slotId: "class-branch-instinct-level-1" } as PendingStep,
      ])
    ).toEqual([]);
  });

  it("rejects Ancient Elf chain facts from the wrong persisted channel or slot", () => {
    const wrongChannel = createEmptyDraft(1);
    const wrongChannelSteps: PendingStep[] = [];
    addRequirement(
      wrongChannel,
      wrongChannelSteps,
      "selections",
      "heritage-level-1",
      "Compendium.pf2e.heritages.Item.Nd9hdX8rdYyRozw8"
    );
    addRequirement(
      wrongChannel,
      wrongChannelSteps,
      "branchSelections",
      "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      "Compendium.pf2e.feats-srd.Item.CJMkxlxHiHZQYDCz"
    );
    expect(findUnsupportedPhysicalGrantRoutes(wrongChannel, wrongChannelSteps)).toEqual([]);

    const wrongSlot = createEmptyDraft(1);
    const wrongSlotSteps: PendingStep[] = [];
    addRequirement(
      wrongSlot,
      wrongSlotSteps,
      "selections",
      "heritage-level-1",
      "Compendium.pf2e.heritages.Item.Nd9hdX8rdYyRozw8"
    );
    addRequirement(
      wrongSlot,
      wrongSlotSteps,
      "selections",
      "class-feat-level-2",
      "Compendium.pf2e.feats-srd.Item.CJMkxlxHiHZQYDCz"
    );
    expect(findUnsupportedPhysicalGrantRoutes(wrongSlot, wrongSlotSteps)).toEqual([]);
  });

  it("allows Ancient Elf until an exact physical descendant is selected", () => {
    const draft = createEmptyDraft(1);
    addRequirement(draft, [], "selections", "heritage-level-1", "Compendium.pf2e.heritages.Item.Nd9hdX8rdYyRozw8");
    addRequirement(
      draft,
      [],
      "selections",
      "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      "Compendium.pf2e.feats-srd.Item.bCWieNDC1CD35tin"
    );

    expect(
      findUnsupportedPhysicalGrantRoutes(draft, [
        { slotId: "heritage-level-1" } as PendingStep,
        { slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1" } as PendingStep,
      ])
    ).toEqual([]);
  });

  it("matches canonical UUIDs rather than spoofed names or document ids", () => {
    const draft = createEmptyDraft(1);
    const spoof = selection("ancestry-feat-level-1", "Compendium.pf2e.feats-srd.Item.not-clan-pistol");
    spoof.documentId = "LvVg83ZDj8mabcWF";
    spoof.name = "Clan Pistol";
    draft.selections[spoof.slotId] = spoof;

    expect(findUnsupportedPhysicalGrantRoutes(draft, [{ slotId: "ancestry-feat-level-1" } as PendingStep])).toEqual([]);
  });

  it("retains the frozen Apply slot set as recovery-only coverage evidence", () => {
    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF"
    );
    draft.applyCompletedStepIds = ["ancestry-feat-level-1"];

    expect(findUnsupportedPhysicalGrantRoutes(draft, [])).toEqual([
      expect.objectContaining({ routeId: "clan-pistol" }),
    ]);
  });

  it("fails closed when the running PF2E version is missing or differs from the reviewed pin", () => {
    expect(physicalGrantCoverageVersionBlocker(PHYSICAL_GRANT_COVERAGE_PF2E_VERSION)).toBeNull();
    expect(physicalGrantCoverageVersionBlocker(null)).toMatchObject({
      code: "coverage-version-mismatch",
      routeId: "pf2e-version-pin",
      sourceUuid: null,
    });
    expect(physicalGrantCoverageVersionBlocker("8.4.2")?.message).toContain("8.4.2");
    expect(physicalGrantCoverageVersionBlocker("8.4.1.0")).not.toBeNull();
    expect(physicalGrantCoverageVersionBlocker("")?.message).toContain("an unknown version");
  });

  it("surfaces one version blocker before route matching and maps blockers into readiness issues", () => {
    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF"
    );
    const steps = [{ slotId: "ancestry-feat-level-1" } as PendingStep];

    expect(physicalGrantCoverageBlockers(draft, steps, "8.4.2")).toEqual([
      expect.objectContaining({ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }),
    ]);
    expect(physicalGrantCoverageIssues(draft, steps, PHYSICAL_GRANT_COVERAGE_PF2E_VERSION)).toEqual([
      expect.objectContaining({
        code: "equipment-review",
        stepId: "ancestry-feat-level-1",
        slotId: "ancestry-feat-level-1",
      }),
    ]);
  });

  it("applies the version pin when the level-1 starting-equipment surface is active", () => {
    const draft = createEmptyDraft(1);

    expect(
      physicalGrantCoverageBlockers(draft, [{ slotId: "starting-equipment-level-1" } as PendingStep], "8.4.2")
    ).toEqual([expect.objectContaining({ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" })]);
  });

  it("does not apply the level-1 coverage version pin to an ordinary later-level draft without level-1 evidence", () => {
    const draft = createEmptyDraft(2);

    expect(physicalGrantCoverageBlockers(draft, [], "8.4.2")).toEqual([]);
    expect(physicalGrantCoverageIssues(draft, [], null)).toEqual([]);
  });

  it("applies the version pin to active level-1 grant evidence in a later-level draft", () => {
    const draft = createEmptyDraft(2);
    draft.branchSelections["class-branch-innovation-level-1"] = selection(
      "class-branch-innovation-level-1",
      "Compendium.pf2e.classfeatures.Item.bok3P78CMchFibxC"
    );

    expect(
      physicalGrantCoverageBlockers(draft, [{ slotId: "class-branch-innovation-level-1" } as PendingStep], "8.4.2")
    ).toEqual([expect.objectContaining({ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" })]);
  });

  it("applies the version pin to frozen level-1 recovery evidence in a later-level draft", () => {
    const draft = createEmptyDraft(2);
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF"
    );
    draft.applyCompletedStepIds = ["ancestry-feat-level-1"];

    expect(physicalGrantCoverageBlockers(draft, [], "8.4.2")).toEqual([
      expect.objectContaining({ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }),
    ]);

    draft.applyCompletedStepIds = ["starting-equipment-level-1"];
    delete draft.selections["ancestry-feat-level-1"];
    expect(physicalGrantCoverageBlockers(draft, [], "8.4.2")).toEqual([
      expect.objectContaining({ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }),
    ]);
  });

  it("makes an otherwise complete rendered draft visibly not ready", () => {
    const draft = createEmptyDraft(1);
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF"
    );
    const readiness = withPhysicalGrantCoverageReadiness(
      { ready: true, evaluations: [], blockers: [], firstBlocker: null },
      draft,
      [{ slotId: "ancestry-feat-level-1" } as PendingStep],
      PHYSICAL_GRANT_COVERAGE_PF2E_VERSION
    );

    expect(readiness).toMatchObject({
      ready: false,
      firstBlocker: {
        code: "equipment-review",
        stepId: "ancestry-feat-level-1",
      },
    });
  });
});

function addRequirement(
  draft: ReturnType<typeof createEmptyDraft>,
  steps: PendingStep[],
  channel: PhysicalGrantSelectionChannel,
  slotId: string,
  sourceUuid: string
): void {
  draft[channel][slotId] = selection(slotId, sourceUuid);
  steps.push({ slotId } as PendingStep);
}

function selection(slotId: string, uuid: string, itemType = "feat"): SelectionRef {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/u.exec(uuid);
  return {
    slotId,
    packId: match?.[1] ?? "pf2e.feats-srd",
    documentId: match?.[2] ?? uuid,
    uuid,
    itemType,
    featType: itemType === "feat" ? "general" : null,
    name: match?.[2] ?? uuid,
    level: 1,
  };
}
