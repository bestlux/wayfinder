import { describe, expect, it, vi } from "vitest";
import { applyClassFeatureChoiceDraft, stripPreselectedClassFeatureEntries } from "../src/class-feature-choice-service";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep, SelectionRef } from "../src/types";
import { PF2E_841_DRAGON_EIDOLON_RULES } from "./fixtures/pf2e-841-eidolons";

describe("class-feature-choice-service", () => {
  it("persists Dragon Eidolon's PF2E 8.4.1 compound tradition on an existing granted feature", async () => {
    const draft = createEmptyDraft(1);
    draft.classChoices["class-choice-dragon-eidolon-eidolonTradition-level-1"] = "arcane";
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Summoner",
            system: {},
          },
          {
            id: "dragon-1",
            type: "feat",
            name: "Dragon Eidolon",
            flags: {
              core: { sourceId: "Compendium.pf2e.classfeatures.Item.JttI3raKFGG4C8up" },
              pf2e: { rulesSelections: {} },
            },
            system: { rules: structuredClone(PF2E_841_DRAGON_EIDOLON_RULES) },
          },
        ],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, [dragonTraditionStep()], {
      createEmbeddedSource: async () => null,
      fetchSelectionDocument: async () => null,
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        _id: "dragon-1",
        "flags.pf2e.rulesSelections.eidolonTradition": { skill: "arcana", tradition: "arcane" },
        "system.rules": expect.arrayContaining([
          expect.objectContaining({
            key: "ChoiceSet",
            flag: "eidolonTradition",
            selection: { skill: "arcana", tradition: "arcane" },
          }),
        ]),
      }),
    ]);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("defers a static child choice until its planned parent can create the owned child", async () => {
    const draft = createEmptyDraft(2);
    const step = staticSanctificationStep();
    draft.classChoices[step.slotId] = "holy";
    const actor = {
      items: { contents: [] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, [step], staticSanctificationDependencies());

    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("updates a static child choice only through its exact existing parent-owned graph", async () => {
    const draft = createEmptyDraft(2);
    const step = staticSanctificationStep();
    draft.classChoices[step.slotId] = "unholy";
    const actor = {
      items: {
        contents: [staticDedicationItem("dedication-1", "deity-1"), staticDeityItem("deity-1", "dedication-1")],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, [step], staticSanctificationDependencies());

    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      {
        _id: "dedication-1",
        "flags.pf2e.itemGrants.deityCleric": {
          id: "deity-1",
          onDelete: "detach",
        },
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenLastCalledWith("Item", [
      expect.objectContaining({
        _id: "deity-1",
        "flags.pf2e.rulesSelections.sanctification": "unholy",
        "system.rules": [expect.objectContaining({ key: "ChoiceSet", flag: "sanctification", selection: "unholy" })],
      }),
    ]);
  });

  it.each([
    {
      label: "unowned child",
      items: [staticDeityItem("deity-orphan", null)],
    },
    {
      label: "wrong-owner child",
      items: [staticDedicationItem("dedication-1", null), staticDeityItem("deity-other", "other-parent")],
    },
    {
      label: "duplicate child",
      items: [staticDeityItem("deity-one", null), staticDeityItem("deity-two", null)],
    },
  ])("rejects a static $label without mutating the actor", async ({ items }) => {
    const draft = createEmptyDraft(2);
    const step = staticSanctificationStep();
    draft.classChoices[step.slotId] = "holy";
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, [step], staticSanctificationDependencies())
    ).rejects.toThrow(/ambiguous|conflicting provenance/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects a retained static child whose embedded ChoiceSet index drifted from the prepared source", async () => {
    const draft = createEmptyDraft(2);
    const step = staticSanctificationStep();
    draft.classChoices[step.slotId] = "unholy";
    const child = staticDeityItem("deity-1", "dedication-1");
    child.system.rules = [
      { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.unrelated" },
      { key: "ChoiceSet", flag: "sanctification", selection: "holy" },
    ];
    const actor = {
      items: { contents: [staticDedicationItem("dedication-1", "deity-1"), child] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, [step], staticSanctificationDependencies())
    ).rejects.toThrow(/choiceset rules have changed/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects a same-source static parent from a different feat slot", async () => {
    const draft = createEmptyDraft(2);
    const step = staticSanctificationStep();
    draft.classChoices[step.slotId] = "holy";
    const parent = staticDedicationItem("dedication-1", null);
    parent.flags["wayfinder-pf2e"].slotId = "class-feat-level-2";
    const actor = {
      items: { contents: [parent] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, [step], staticSanctificationDependencies())
    ).rejects.toThrow(/planned static grant slot has changed/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("re-resolves the static owner after another feature update replaces it during Apply", async () => {
    const draft = createEmptyDraft(2);
    const staticStep = staticSanctificationStep();
    const directStep = dragonTraditionStep();
    draft.classChoices[staticStep.slotId] = "holy";
    draft.classChoices[directStep.slotId] = "arcane";
    const items = [
      staticDedicationItem("dedication-1", null),
      {
        id: "dragon-1",
        name: "Dragon Eidolon",
        type: "feat",
        flags: {
          core: { sourceId: "Compendium.pf2e.classfeatures.Item.JttI3raKFGG4C8up" },
          pf2e: { rulesSelections: {} },
        },
        system: { rules: structuredClone(PF2E_841_DRAGON_EIDOLON_RULES) },
      },
    ] as any[];
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async (_type: string, updates: any[]) => {
        if (updates.some((update) => update._id === "dragon-1")) {
          items.splice(
            items.findIndex((item) => item.id === "dedication-1"),
            1
          );
        }
        return [];
      }),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, [staticStep, directStep], staticSanctificationDependencies())
    ).rejects.toThrow(/owner changed during apply/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("recovers a missing Commander Tactics child through its exact existing parent and reruns without duplicates", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    const items = [parent] as any[];
    let nextId = 1;
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = { id: `tactics-${nextId++}`, ...structuredClone(source) };
          items.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async (_type: string, updates: any[]) => {
        applyTestItemUpdates(items, updates);
        return [];
      }),
      deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
        for (const id of ids) {
          const index = items.findIndex((item) => item.id === id);
          if (index >= 0) items.splice(index, 1);
        }
        return [];
      }),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies());
    await applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies());

    const tactics = items.filter(
      (item) => item.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.2IysodKQuf62jmd7"
    );
    expect(tactics).toHaveLength(1);
    expect(tactics[0].flags.pf2e.grantedBy).toEqual({ id: "commander-1", onDelete: "cascade" });
    expect(tactics[0].system.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "GrantItem", uuid: "{item|flags.system.rulesSelections.firstTactic}" }),
        expect.objectContaining({ key: "GrantItem", uuid: "{item|flags.system.rulesSelections.secondTactic}" }),
      ])
    );
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(3);
    expect(items.filter((item) => item.type === "action")).toHaveLength(2);
    expect(parent.flags.pf2e.itemGrants.tactics.id).toBe(tactics[0].id);
  });

  it("converges changed Commander tactic grants through the retained exact graph without duplicates", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    const items = [
      parent,
      tactics,
      commanderTacticActionItem("old-first-1", "tactics-1", "old-first"),
      commanderTacticActionItem("old-second-1", "tactics-1", "old-second"),
    ] as any[];
    let nextId = 1;
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = { id: `replacement-${nextId++}`, ...structuredClone(source) };
          items.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async (_type: string, updates: any[]) => {
        applyTestItemUpdates(items, updates);
        return [];
      }),
      deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
        for (const id of ids) {
          const index = items.findIndex((item) => item.id === id);
          if (index >= 0) items.splice(index, 1);
        }
        return [];
      }),
    };
    const apply = () => applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies());

    await apply();

    expect(items.filter((item) => item.type === "action")).toHaveLength(2);
    expect(items.some((item) => item.id === "old-first-1" || item.id === "old-second-1")).toBe(false);
    expect(tactics.flags.pf2e.rulesSelections).toMatchObject({
      firstTactic: "Compendium.pf2e.actionspf2e.Item.first-tactic",
      secondTactic: "Compendium.pf2e.actionspf2e.Item.second-tactic",
    });
    expect(tactics.flags.pf2e.itemGrants.firstTactic.id).toBe("replacement-1");
    expect(tactics.flags.pf2e.itemGrants.secondTactic.id).toBe("replacement-2");
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["old-first-1", "old-second-1"]);

    await apply();

    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(2);
    expect(items.filter((item) => item.type === "action")).toHaveLength(2);
  });

  it("rejects retained Commander Tactics whose embedded grant route drifted without mutation", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    tactics.system.rules[1].uuid = "Compendium.pf2e.actionspf2e.Item.stale-hard-coded-route";
    const actor = {
      items: { contents: [parent, tactics] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/prepared grant-choice rules have changed/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it.each([
    { label: "unowned", ownerId: null },
    { label: "wrong-owner", ownerId: "other-selector" },
  ])("rejects a retained Commander Tactics $label linked action without mutation", async ({ ownerId }) => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    const linkedAction = commanderTacticActionItem("old-first-1", ownerId, "old-first");
    const actor = {
      items: { contents: [parent, tactics, linkedAction] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/linked child has conflicting provenance/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects duplicate exact Tactics-owned actions without a parent link before mutation", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    delete tactics.flags.pf2e.itemGrants.firstTactic;
    const actor = {
      items: {
        contents: [
          parent,
          tactics,
          commanderTacticActionItem("duplicate-first-1", "tactics-1", "first-tactic"),
          commanderTacticActionItem("duplicate-first-2", "tactics-1", "first-tactic"),
        ],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/owned child provenance is ambiguous/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects two Commander tactic routes linked to the same owned action before mutation", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "first-tactic", "first-tactic");
    tactics.flags.pf2e.itemGrants.firstTactic = { id: "shared-action", onDelete: "detach" };
    tactics.flags.pf2e.itemGrants.secondTactic = { id: "shared-action", onDelete: "detach" };
    const actor = {
      items: {
        contents: [parent, tactics, commanderTacticActionItem("shared-action", "tactics-1", "first-tactic")],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/grant routes firstTactic and secondTactic claim the same child/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects one Tactics child claimed by one route's source and another route's slot", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    delete tactics.flags.pf2e.itemGrants.firstTactic;
    delete tactics.flags.pf2e.itemGrants.secondTactic;
    const crossRouteAction = commanderTacticActionItem("cross-route-action", "tactics-1", "first-tactic");
    crossRouteAction.flags["wayfinder-pf2e"] = { slotId: steps[1]!.slotId };
    const actor = {
      items: { contents: [parent, tactics, crossRouteAction] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/grant routes firstTactic and secondTactic claim the same child/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects two empty Commander tactic routes selecting the same action before mutation", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    draft.selections[steps[1]!.slotId] = {
      ...structuredClone(draft.selections[steps[0]!.slotId]!),
      slotId: steps[1]!.slotId,
    };
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    delete tactics.flags.pf2e.itemGrants.firstTactic;
    delete tactics.flags.pf2e.itemGrants.secondTactic;
    const actor = {
      items: { contents: [parent, tactics] },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await expect(
      applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies())
    ).rejects.toThrow(/planned grant routes are ambiguous/i);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rolls back changed Commander tactics atomically and retries without stale replacements", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    parent.flags.pf2e.itemGrants.tactics = { id: "tactics-1", onDelete: "detach" };
    const tactics = commanderTacticsItem("tactics-1", "commander-1", "old-first", "old-second");
    const items = [
      parent,
      tactics,
      commanderTacticActionItem("old-first-1", "tactics-1", "old-first"),
      commanderTacticActionItem("old-second-1", "tactics-1", "old-second"),
    ] as any[];
    let nextId = 1;
    let updateCount = 0;
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = { id: `replacement-${nextId++}`, ...structuredClone(source) };
          items.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async (_type: string, updates: any[]) => {
        updateCount += 1;
        if (updateCount === 3) {
          throw new Error("final tactic link write rejected");
        }
        applyTestItemUpdates(items, updates);
        return [];
      }),
      deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
        for (const id of ids) {
          const index = items.findIndex((item) => item.id === id);
          if (index >= 0) items.splice(index, 1);
        }
        return [];
      }),
    };
    const apply = () => applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies());

    await expect(apply()).rejects.toThrow("final tactic link write rejected");
    expect(items.map((item) => item.id)).toEqual(["commander-1", "tactics-1", "old-first-1", "old-second-1"]);
    expect(tactics.flags.pf2e.rulesSelections).toMatchObject({
      firstTactic: "Compendium.pf2e.actionspf2e.Item.old-first",
      secondTactic: "Compendium.pf2e.actionspf2e.Item.old-second",
    });
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["replacement-1", "replacement-2"]);

    await expect(apply()).resolves.toBeUndefined();
    expect(items.filter((item) => item.type === "action")).toHaveLength(2);
    expect(items.some((item) => item.id === "replacement-1" || item.id === "replacement-2")).toBe(false);
    expect(tactics.flags.pf2e.itemGrants.firstTactic.id).toBe("replacement-3");
    expect(tactics.flags.pf2e.itemGrants.secondTactic.id).toBe("replacement-4");
  });

  it("rolls back a recovered Tactics child when the parent link write fails, then retries cleanly", async () => {
    const { draft, steps } = commanderStaticChoiceDraft();
    const parent = commanderDedicationItem("commander-1");
    const items = [parent] as any[];
    let nextId = 1;
    let rejectUpdate = true;
    const actor = {
      items: { contents: items },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = { id: `tactics-${nextId++}`, ...structuredClone(source) };
          items.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async (_type: string, updates: any[]) => {
        if (rejectUpdate) {
          rejectUpdate = false;
          throw new Error("parent link rejected");
        }
        applyTestItemUpdates(items, updates);
        return [];
      }),
      deleteEmbeddedDocuments: vi.fn(async (_type: string, ids: string[]) => {
        for (const id of ids) {
          const index = items.findIndex((item) => item.id === id);
          if (index >= 0) items.splice(index, 1);
        }
        return [];
      }),
    };
    const apply = () => applyClassFeatureChoiceDraft(actor as any, draft, steps, commanderStaticChoiceDependencies());

    await expect(apply()).rejects.toThrow("parent link rejected");
    expect(items).toEqual([parent]);
    await expect(apply()).resolves.toBeUndefined();
    expect(
      items.filter((item) => item.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.2IysodKQuf62jmd7")
    ).toHaveLength(1);
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["tactics-1"]);
  });

  it("strips class features that Wayfinder owns through granted-item or class-choice draft selections", () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "gorum", "Gorum", "deity");
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    const classSource = {
      system: {
        items: {
          deity: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
            name: "Deity",
          },
          divineFont: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.divine-font",
            name: "Divine Font",
          },
          doctrine: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.doctrine",
            name: "Doctrine",
          },
        },
      },
    };

    stripPreselectedClassFeatureEntries(classSource, draft, [deityStep(), divineFontStep()]);

    expect(Object.keys(classSource.system.items)).toEqual(["doctrine"]);
  });

  it("strips Divine Font for Battle Creed so its obsolete native chooser cannot open", () => {
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "battle-creed";
    const classSource = {
      system: {
        items: {
          divineFont: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.Divine Font",
            name: "Divine Font",
          },
          doctrine: {
            level: 1,
            uuid: "Compendium.pf2e.classfeatures.Item.Doctrine",
            name: "Doctrine",
          },
        },
      },
    };

    stripPreselectedClassFeatureEntries(classSource, draft, []);

    expect(Object.keys(classSource.system.items)).toEqual(["doctrine"]);
  });

  it("creates and updates class-owned feature items for cleric deity, sanctification, and divine font", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "gorum", "Gorum", "deity");
    draft.classChoices["class-choice-deity-sanctification-level-1"] = "holy";
    draft.classChoices["class-choice-divine-font-divineFont-level-1"] = "harm";

    let idCounter = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Cleric",
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) => {
        const created = sources.map((source) => {
          const item = {
            id: `created-${++idCounter}`,
            type: source.type,
            name: source.name,
            sourceId: source.flags?.core?.sourceId ?? null,
            flags: source.flags ?? {},
            system: source.system ?? {},
            _stats: source._stats ?? {},
          };
          actor.items.contents.push(item);
          return item;
        });
        return created;
      }),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    const sources = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-cleric",
        featureSource("Deity", "Compendium.pf2e.classfeatures.Item.deity-cleric", {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "deity",
              choices: {
                itemType: "deity",
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.deity}",
            },
            {
              key: "ChoiceSet",
              flag: "sanctification",
              choices: [
                { value: "holy", label: "Holy" },
                { value: "unholy", label: "Unholy" },
              ],
            },
          ],
        }),
      ],
      [
        "Compendium.pf2e.classfeatures.Item.divine-font",
        featureSource("Divine Font", "Compendium.pf2e.classfeatures.Item.divine-font", {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "divineFont",
              choices: [
                { value: "heal", label: "Heal" },
                { value: "harm", label: "Harm" },
              ],
            },
          ],
        }),
      ],
      ["Compendium.pf2e.deities.Item.gorum", featureSource("Gorum", "Compendium.pf2e.deities.Item.gorum", {})],
    ]);

    await applyClassFeatureChoiceDraft(actor as any, draft, [deityStep(), sanctificationStep(), divineFontStep()], {
      createEmbeddedSource: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? structuredClone(source) : null;
      },
      fetchSelectionDocument: async (selection) => {
        const source = sources.get(selection.uuid);
        if (!source) {
          return null;
        }

        return {
          system: structuredClone(source.system),
        };
      },
    });

    const createdSources = actor.createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const deityFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-cleric"
    );
    const deityGrant = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.deities.Item.gorum"
    );
    const divineFontFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.divine-font"
    );

    expect(deityFeature).toBeTruthy();
    expect(deityFeature.system.location).toBe("class-1");
    expect(deityFeature.system.rules).toHaveLength(2);
    expect(deityFeature.system.rules.some((rule: any) => rule.key === "GrantItem")).toBe(false);
    expect(deityFeature.flags.pf2e.rulesSelections).toEqual({
      deity: "Compendium.pf2e.deities.Item.gorum",
      sanctification: "holy",
    });

    expect(deityGrant).toBeTruthy();
    expect(deityGrant.flags.pf2e.grantedBy).toEqual({
      id: "created-1",
      onDelete: "cascade",
    });

    expect(divineFontFeature).toBeTruthy();
    expect(divineFontFeature.system.location).toBe("class-1");
    expect(divineFontFeature.flags.pf2e.rulesSelections).toEqual({
      divineFont: "harm",
    });

    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "created-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "deity",
            choices: {
              itemType: "deity",
            },
            selection: "Compendium.pf2e.deities.Item.gorum",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.deity}",
          },
          {
            key: "ChoiceSet",
            flag: "sanctification",
            choices: [
              { value: "holy", label: "Holy" },
              { value: "unholy", label: "Unholy" },
            ],
            selection: "holy",
          },
        ],
        "flags.pf2e.rulesSelections.sanctification": "holy",
        "flags.pf2e.rulesSelections.deity": "Compendium.pf2e.deities.Item.gorum",
        "flags.pf2e.itemGrants.deity": {
          id: "created-2",
          onDelete: "detach",
          nested: null,
        },
        "flags.wayfinder-pf2e.slotId": "deity-level-1",
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      {
        _id: "created-3",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "divineFont",
            choices: [
              { value: "heal", label: "Heal" },
              { value: "harm", label: "Harm" },
            ],
            selection: "harm",
          },
        ],
        "flags.pf2e.rulesSelections.divineFont": "harm",
        "flags.wayfinder-pf2e.slotId": "class-choice-divine-font-divineFont-level-1",
      },
    ]);
  });

  it("preserves fixed grant rules when creating deity-owned class features", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "iomedae", "Iomedae", "deity");

    let idCounter = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Champion",
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) =>
        sources.map((source) => {
          const item = {
            id: `created-${++idCounter}`,
            type: source.type,
            name: source.name,
            sourceId: source.flags?.core?.sourceId ?? null,
            flags: source.flags ?? {},
            system: source.system ?? {},
            _stats: source._stats ?? {},
          };
          actor.items.contents.push(item);
          return item;
        })
      ),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    const sources = new Map<string, any>([
      [
        "Compendium.pf2e.classfeatures.Item.deity-champion",
        featureSource("Deity", "Compendium.pf2e.classfeatures.Item.deity-champion", {
          category: "classfeature",
          level: { value: 1 },
          rules: [
            {
              key: "ChoiceSet",
              flag: "deity",
              choices: {
                itemType: "deity",
              },
            },
            {
              key: "GrantItem",
              uuid: "{item|flags.system.rulesSelections.deity}",
            },
            {
              key: "GrantItem",
              uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
            },
            {
              key: "GrantItem",
              uuid: "Compendium.pf2e.classfeatures.Item.champions-aura",
            },
          ],
        }),
      ],
      ["Compendium.pf2e.deities.Item.iomedae", featureSource("Iomedae", "Compendium.pf2e.deities.Item.iomedae", {})],
    ]);

    await applyClassFeatureChoiceDraft(actor as any, draft, [championDeityStep()], {
      createEmbeddedSource: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? structuredClone(source) : null;
      },
      fetchSelectionDocument: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? { system: structuredClone(source.system) } : null;
      },
    });

    const createdSources = actor.createEmbeddedDocuments.mock.calls.flatMap((call) => call[1] as any[]);
    const deityFeature = createdSources.find(
      (source) => source?.flags?.core?.sourceId === "Compendium.pf2e.classfeatures.Item.deity-champion"
    );

    expect(deityFeature).toBeTruthy();
    expect(deityFeature.system.rules).toEqual([
      {
        key: "ChoiceSet",
        flag: "deity",
        choices: {
          itemType: "deity",
        },
        selection: "Compendium.pf2e.deities.Item.iomedae",
      },
      {
        key: "GrantItem",
        uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
      },
      {
        key: "GrantItem",
        uuid: "Compendium.pf2e.classfeatures.Item.champions-aura",
      },
    ]);
  });

  it("reconciles an existing granted deity before updating the selector feature", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["deity-level-1"] = selection("pf2e.deities", "iomedae", "Iomedae", "deity");

    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Champion",
            system: {},
          },
          {
            id: "selector-1",
            type: "feat",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.classfeatures.Item.deity-champion",
              },
              pf2e: {
                rulesSelections: {
                  deity: "Compendium.pf2e.deities.Item.iomedae",
                },
                itemGrants: {
                  deity: {
                    id: "deity-1",
                  },
                },
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "deity",
                  choices: {
                    itemType: "deity",
                  },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.deity}",
                },
                {
                  key: "GrantItem",
                  uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
                },
              ],
            },
          },
          {
            id: "deity-1",
            type: "deity",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.deities.Item.iomedae",
              },
              pf2e: {
                grantedBy: {
                  id: "selector-1",
                  onDelete: "cascade",
                },
              },
            },
            system: {},
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async () => []),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    await applyClassFeatureChoiceDraft(actor as any, draft, [championDeityStep()], {
      createEmbeddedSource: async () => null,
      fetchSelectionDocument: async () => null,
    });

    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "selector-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "deity",
            choices: {
              itemType: "deity",
            },
            selection: "Compendium.pf2e.deities.Item.iomedae",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.deity}",
          },
          {
            key: "GrantItem",
            uuid: "Compendium.pf2e.classfeatures.Item.deific-weapon",
          },
        ],
        "flags.pf2e.rulesSelections.deity": "Compendium.pf2e.deities.Item.iomedae",
        "flags.wayfinder-pf2e.slotId": "deity-level-1",
      },
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(
      2,
      "Item",
      expect.arrayContaining([
        expect.objectContaining({
          _id: "selector-1",
          "flags.pf2e.itemGrants.deity": {
            id: "deity-1",
            onDelete: "detach",
            nested: null,
          },
        }),
        {
          _id: "deity-1",
          "flags.core.sourceId": "Compendium.pf2e.deities.Item.iomedae",
          "flags.pf2e.grantedBy": {
            id: "selector-1",
            onDelete: "cascade",
          },
          "flags.wayfinder-pf2e.importedBy": "wayfinder-pf2e",
          "flags.wayfinder-pf2e.slotId": "deity-level-1",
        },
      ])
    );
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledTimes(2);
  });

  it("persists an existing heritage grant selection before creating the granted feat", async () => {
    const draft = createEmptyDraft(1);
    draft.selections["grant-choice-class-heritage-ancient-elf-ancientElf-level-1"] = selection(
      "pf2e.feats-srd",
      "fighter-dedication",
      "Fighter Dedication",
      "feat"
    );

    let idCounter = 0;
    const actor = {
      items: {
        contents: [
          {
            id: "class-1",
            type: "class",
            name: "Wizard",
            system: {},
          },
          {
            id: "heritage-1",
            type: "heritage",
            name: "Ancient Elf",
            flags: {
              core: {
                sourceId: "Compendium.pf2e.heritages.Item.ancient-elf",
              },
              pf2e: {
                rulesSelections: {},
              },
            },
            system: {
              rules: [
                {
                  key: "ChoiceSet",
                  flag: "ancientElf",
                  choices: {
                    itemType: "feat",
                    filter: [
                      "item:level:1",
                      "item:category:class",
                      "item:trait:multiclass",
                      {
                        not: "{actor|system.details.class.trait}",
                      },
                    ],
                  },
                },
                {
                  key: "GrantItem",
                  uuid: "{item|flags.system.rulesSelections.ancientElf}",
                },
              ],
            },
          },
        ] as any[],
      },
      createEmbeddedDocuments: vi.fn(async (_type: string, sources: any[]) => {
        const created = sources.map((source) => {
          const item = {
            id: `created-${++idCounter}`,
            type: source.type,
            name: source.name,
            sourceId: source.flags?.core?.sourceId ?? null,
            flags: source.flags ?? {},
            system: source.system ?? {},
            _stats: source._stats ?? {},
          };
          actor.items.contents.push(item);
          return item;
        });
        return created;
      }),
      updateEmbeddedDocuments: vi.fn(async () => []),
      deleteEmbeddedDocuments: vi.fn(async () => []),
    };

    const sources = new Map<string, any>([
      [
        "Compendium.pf2e.feats-srd.Item.fighter-dedication",
        featureSource("Fighter Dedication", "Compendium.pf2e.feats-srd.Item.fighter-dedication", {
          featType: { value: "class" },
          level: { value: 1 },
          traits: { value: ["archetype", "multiclass"] },
        }),
      ],
    ]);

    await applyClassFeatureChoiceDraft(actor as any, draft, [ancientElfDedicationStep()], {
      createEmbeddedSource: async (selection) => {
        const source = sources.get(selection.uuid);
        return source ? structuredClone(source) : null;
      },
      fetchSelectionDocument: async () => null,
    });

    expect(actor.updateEmbeddedDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      actor.createEmbeddedDocuments.mock.invocationCallOrder[0]
    );
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(1, "Item", [
      {
        _id: "heritage-1",
        "system.rules": [
          {
            key: "ChoiceSet",
            flag: "ancientElf",
            choices: {
              itemType: "feat",
              filter: [
                "item:level:1",
                "item:category:class",
                "item:trait:multiclass",
                {
                  not: "{actor|system.details.class.trait}",
                },
              ],
            },
            selection: "Compendium.pf2e.feats-srd.Item.fighter-dedication",
          },
          {
            key: "GrantItem",
            uuid: "{item|flags.system.rulesSelections.ancientElf}",
          },
        ],
        "flags.pf2e.rulesSelections.ancientElf": "Compendium.pf2e.feats-srd.Item.fighter-dedication",
        "flags.wayfinder-pf2e.slotId": "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      },
    ]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({
        name: "Fighter Dedication",
        flags: expect.objectContaining({
          pf2e: expect.objectContaining({
            grantedBy: {
              id: "heritage-1",
              onDelete: "cascade",
            },
          }),
        }),
      }),
    ]);
    expect(actor.updateEmbeddedDocuments).toHaveBeenNthCalledWith(2, "Item", [
      expect.objectContaining({
        _id: "heritage-1",
        "flags.pf2e.itemGrants.ancientElf": {
          id: "created-1",
          onDelete: "detach",
          nested: null,
        },
      }),
    ]);
  });
});

function deityStep(): PendingStep {
  return {
    id: "deity-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "deity",
    title: "Choose a deity",
    description: "",
    required: true,
    slotId: "deity-level-1",
    filters: { itemType: "deity" },
    grantSelection: {
      slotId: "deity-level-1",
      sourceItemType: "classfeature",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-cleric",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "cleric",
      dependsOn: "class",
      filters: {
        itemType: "deity",
      },
    },
  };
}

function championDeityStep(): PendingStep {
  return {
    id: "deity-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "deity",
    title: "Choose a deity",
    description: "",
    required: true,
    slotId: "deity-level-1",
    filters: { itemType: "deity" },
    grantSelection: {
      slotId: "deity-level-1",
      sourceItemType: "classfeature",
      selectorPackId: "pf2e.classfeatures",
      selectorDocumentId: "deity-champion",
      selectorUuid: "Compendium.pf2e.classfeatures.Item.deity-champion",
      selectorName: "Deity",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "deity",
      itemType: "deity",
      classSlug: "champion",
      dependsOn: "class",
      filters: {
        itemType: "deity",
      },
    },
  };
}

function ancientElfDedicationStep(): PendingStep {
  return {
    id: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
    level: 1,
    kind: "pick-item",
    slotKind: "grant-choice",
    title: "Ancient Elf feat grant",
    description: "",
    required: true,
    slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
    filters: {
      itemType: "feat",
    },
    grantSelection: {
      slotId: "grant-choice-class-heritage-ancient-elf-ancientElf-level-1",
      sourceItemType: "heritage",
      selectorPackId: "pf2e.heritages",
      selectorDocumentId: "ancient-elf",
      selectorUuid: "Compendium.pf2e.heritages.Item.ancient-elf",
      selectorName: "Ancient Elf",
      selectorRuleIndex: 0,
      grantRuleIndex: 1,
      flag: "ancientElf",
      itemType: "feat",
      classSlug: null,
      dependsOn: "class",
      filters: {
        itemType: "feat",
      },
    },
  };
}

function sanctificationStep(): PendingStep {
  return {
    id: "class-choice-deity-sanctification-level-1",
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Sanctification",
    description: "",
    required: true,
    slotId: "class-choice-deity-sanctification-level-1",
    classChoice: {
      slotId: "class-choice-deity-sanctification-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "deity-cleric",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      sourceName: "Deity",
      sourceRuleIndex: 2,
      flag: "sanctification",
      classSlug: "cleric",
      dependsOn: "deity",
      options: [
        { value: "holy", label: "Holy", img: null, detail: null },
        { value: "unholy", label: "Unholy", img: null, detail: null },
      ],
    },
  };
}

function divineFontStep(): PendingStep {
  return {
    id: "class-choice-divine-font-divineFont-level-1",
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Divine Font",
    description: "",
    required: true,
    slotId: "class-choice-divine-font-divineFont-level-1",
    classChoice: {
      slotId: "class-choice-divine-font-divineFont-level-1",
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "divine-font",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.divine-font",
      sourceName: "Divine Font",
      sourceRuleIndex: 0,
      flag: "divineFont",
      classSlug: "cleric",
      dependsOn: "deity",
      options: [
        { value: "heal", label: "Heal", img: null, detail: null },
        { value: "harm", label: "Harm", img: null, detail: null },
      ],
    },
  };
}

function dragonTraditionStep(): PendingStep {
  const slotId = "class-choice-dragon-eidolon-eidolonTradition-level-1";
  return {
    id: slotId,
    level: 1,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Eidolon Tradition",
    description: "Choose a tradition.",
    required: true,
    slotId,
    classChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "JttI3raKFGG4C8up",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.JttI3raKFGG4C8up",
      sourceName: "Dragon Eidolon",
      sourceRuleIndex: 0,
      flag: "eidolonTradition",
      classSlug: "summoner",
      dependsOn: "class",
      options: [
        {
          value: "arcane",
          label: "Arcane",
          img: null,
          detail: null,
          ruleValue: { skill: "arcana", tradition: "arcane" },
        },
      ],
    },
  };
}

function staticSanctificationStep(): Extract<PendingStep, { kind: "class-choice" }> {
  const slotId = "class-choice-deity-cleric-sanctification-level-2";
  const ownerSelection: SelectionRef = {
    slotId: "archetype-feat-level-2",
    packId: "pf2e.feats-srd",
    documentId: "cleric-dedication",
    uuid: "Compendium.pf2e.feats-srd.Item.cleric-dedication",
    itemType: "feat",
    featType: "class",
    name: "Cleric Dedication",
    level: 2,
  };
  return {
    id: slotId,
    level: 2,
    kind: "class-choice",
    slotKind: "class-choice",
    title: "Sanctification",
    description: "",
    required: true,
    slotId,
    classChoice: {
      slotId,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "deity-cleric",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.deity-cleric",
      sourceName: "Deity (Cleric)",
      sourceRuleIndex: 0,
      flag: "sanctification",
      classSlug: "fighter",
      dependsOn: "deity",
      staticGrantOwner: {
        grantRuleIndex: 0,
        selection: ownerSelection,
      },
      options: [
        { value: "holy", label: "Holy", img: null, detail: null },
        { value: "unholy", label: "Unholy", img: null, detail: null },
      ],
    },
  };
}

function staticSanctificationDependencies() {
  const ownerUuid = "Compendium.pf2e.feats-srd.Item.cleric-dedication";
  const childUuid = "Compendium.pf2e.classfeatures.Item.deity-cleric";
  return {
    createEmbeddedSource: async (requested: SelectionRef) => {
      if (requested.uuid === ownerUuid) {
        return {
          name: "Cleric Dedication",
          type: "feat",
          system: {},
          flags: {
            "wayfinder-pf2e": {
              manualStaticItemGrants: [
                {
                  key: "deityCleric",
                  uuid: childUuid,
                  choices: { sanctification: "unholy" },
                },
              ],
            },
          },
        };
      }
      if (requested.uuid === childUuid) {
        return featureSource("Deity (Cleric)", childUuid, {
          rules: [{ key: "ChoiceSet", flag: "sanctification" }],
        });
      }
      return null;
    },
    fetchSelectionDocument: async () => null,
  };
}

function staticDedicationItem(id: string, childId: string | null): any {
  return {
    id,
    name: "Cleric Dedication",
    type: "feat",
    flags: {
      core: { sourceId: "Compendium.pf2e.feats-srd.Item.cleric-dedication" },
      pf2e: childId ? { itemGrants: { deityCleric: { id: childId, onDelete: "detach" } } } : {},
      "wayfinder-pf2e": { slotId: "archetype-feat-level-2" },
    },
    system: {},
  };
}

function staticDeityItem(id: string, parentId: string | null): any {
  return {
    id,
    name: "Deity (Cleric)",
    type: "feat",
    flags: {
      core: { sourceId: "Compendium.pf2e.classfeatures.Item.deity-cleric" },
      pf2e: {
        rulesSelections: { sanctification: "holy" },
        ...(parentId ? { grantedBy: { id: parentId, onDelete: "cascade" } } : {}),
      },
    },
    system: { rules: [{ key: "ChoiceSet", flag: "sanctification", selection: "holy" }] },
  };
}

function commanderStaticChoiceDraft(): { draft: ReturnType<typeof createEmptyDraft>; steps: PendingStep[] } {
  const draft = createEmptyDraft(2);
  const ownerSelection: SelectionRef = {
    slotId: "archetype-feat-level-2",
    packId: "pf2e.feats-srd",
    documentId: "e9iVLfL7KIfUG3NV",
    uuid: "Compendium.pf2e.feats-srd.Item.e9iVLfL7KIfUG3NV",
    itemType: "feat",
    featType: "class",
    name: "Commander Dedication",
    level: 2,
  };
  const choices = [
    ["firstTactic", "first-tactic"],
    ["secondTactic", "second-tactic"],
  ] as const;
  const steps = choices.map(([flag, documentId], index): PendingStep => {
    const slotId = `grant-choice-class-classfeature-tactics-${flag}-level-2`;
    draft.selections[slotId] = {
      slotId,
      packId: "pf2e.actionspf2e",
      documentId,
      uuid: `Compendium.pf2e.actionspf2e.Item.${documentId}`,
      itemType: "action",
      featType: null,
      name: documentId,
      level: null,
    };
    return {
      id: slotId,
      level: 2,
      kind: "pick-item",
      slotKind: "grant-choice",
      title: flag,
      description: "",
      required: true,
      slotId,
      filters: { itemType: "action" },
      grantSelection: {
        slotId,
        sourceItemType: "classfeature",
        selectorPackId: "pf2e.classfeatures",
        selectorDocumentId: "2IysodKQuf62jmd7",
        selectorUuid: "Compendium.pf2e.classfeatures.Item.2IysodKQuf62jmd7",
        selectorName: "Tactics",
        selectorRuleIndex: index * 2,
        grantRuleIndex: index * 2 + 1,
        flag,
        itemType: "action",
        classSlug: null,
        dependsOn: "class",
        filters: { itemType: "action" },
        staticGrantOwner: { grantRuleIndex: 2, selection: ownerSelection },
      },
    };
  });
  return { draft, steps };
}

function commanderStaticChoiceDependencies() {
  const ownerUuid = "Compendium.pf2e.feats-srd.Item.e9iVLfL7KIfUG3NV";
  const tacticsUuid = "Compendium.pf2e.classfeatures.Item.2IysodKQuf62jmd7";
  return {
    createEmbeddedSource: async (selection: SelectionRef) => {
      if (selection.uuid === ownerUuid) {
        return {
          name: "Commander Dedication",
          type: "feat",
          system: {},
          flags: {
            "wayfinder-pf2e": {
              manualStaticItemGrants: [
                {
                  key: "tactics",
                  uuid: tacticsUuid,
                  choices: {
                    firstTactic: "Compendium.pf2e.actionspf2e.Item.first-tactic",
                    secondTactic: "Compendium.pf2e.actionspf2e.Item.second-tactic",
                  },
                },
              ],
            },
          },
        };
      }
      if (selection.uuid === tacticsUuid) {
        return {
          name: "Tactics",
          type: "feat",
          system: {
            rules: [
              { key: "ChoiceSet", flag: "firstTactic" },
              { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.firstTactic}" },
              { key: "ChoiceSet", flag: "secondTactic" },
              { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.secondTactic}" },
            ],
          },
          flags: {},
        };
      }
      if (selection.packId === "pf2e.actionspf2e") {
        return {
          name: selection.name,
          type: "action",
          system: {},
          flags: { core: { sourceId: selection.uuid } },
        };
      }
      return null;
    },
    fetchSelectionDocument: async () => null,
  };
}

function commanderDedicationItem(id: string): any {
  return {
    id,
    name: "Commander Dedication",
    type: "feat",
    flags: {
      core: { sourceId: "Compendium.pf2e.feats-srd.Item.e9iVLfL7KIfUG3NV" },
      pf2e: { itemGrants: {} },
      "wayfinder-pf2e": { slotId: "archetype-feat-level-2" },
    },
    system: { location: "archetype-2" },
  };
}

function commanderTacticsItem(id: string, parentId: string, firstDocumentId: string, secondDocumentId: string): any {
  return {
    id,
    name: "Tactics",
    type: "feat",
    flags: {
      core: { sourceId: "Compendium.pf2e.classfeatures.Item.2IysodKQuf62jmd7" },
      pf2e: {
        grantedBy: { id: parentId, onDelete: "cascade" },
        rulesSelections: {
          firstTactic: `Compendium.pf2e.actionspf2e.Item.${firstDocumentId}`,
          secondTactic: `Compendium.pf2e.actionspf2e.Item.${secondDocumentId}`,
        },
        itemGrants: {
          firstTactic: { id: "old-first-1", onDelete: "detach" },
          secondTactic: { id: "old-second-1", onDelete: "detach" },
        },
      },
    },
    system: {
      rules: [
        {
          key: "ChoiceSet",
          flag: "firstTactic",
          selection: `Compendium.pf2e.actionspf2e.Item.${firstDocumentId}`,
        },
        { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.firstTactic}" },
        {
          key: "ChoiceSet",
          flag: "secondTactic",
          selection: `Compendium.pf2e.actionspf2e.Item.${secondDocumentId}`,
        },
        { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.secondTactic}" },
      ],
    },
  };
}

function commanderTacticActionItem(id: string, parentId: string | null, documentId: string): any {
  return {
    id,
    name: documentId,
    type: "action",
    flags: {
      core: { sourceId: `Compendium.pf2e.actionspf2e.Item.${documentId}` },
      pf2e: parentId ? { grantedBy: { id: parentId, onDelete: "cascade" } } : {},
    },
    system: {},
  };
}

function applyTestItemUpdates(items: any[], updates: any[]): void {
  for (const update of updates) {
    const item = items.find((candidate) => candidate.id === update._id);
    if (!item) continue;
    for (const [path, value] of Object.entries(update)) {
      if (path === "_id") continue;
      const segments = path.split(".");
      let target = item;
      for (const segment of segments.slice(0, -1)) {
        target[segment] ??= {};
        target = target[segment];
      }
      target[segments.at(-1)!] = structuredClone(value);
    }
  }
}

function selection(packId: string, documentId: string, name: string, itemType: string): SelectionRef {
  return {
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: `Compendium.${packId}.Item.${documentId}`,
    itemType,
    featType: itemType === "feat" ? "classfeature" : null,
    name,
    level: 1,
  };
}

function featureSource(name: string, sourceId: string, system: Record<string, unknown>): any {
  return {
    name,
    type: "feat",
    _stats: {
      compendiumSource: sourceId,
    },
    system,
    flags: {
      core: {
        sourceId,
      },
      pf2e: {
        rulesSelections: {},
      },
      "wayfinder-pf2e": {
        importedBy: "wayfinder-pf2e",
      },
    },
  };
}
