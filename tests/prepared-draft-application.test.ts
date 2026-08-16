import { describe, expect, it, vi } from "vitest";
import { applyDraftToActor, type DraftApplyPhase, DraftApplyPhaseError } from "../src/actor-updater";
import {
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import type { PendingStep, SpellChoiceStep } from "../src/types";
import { WayfinderDraftNotReadyError } from "../src/wayfinder/domain/step-evaluation";
import { createLanguageChoiceStep } from "../src/wayfinder/domain/step-types";
import { buildActorHarness, classSelectionStep, selection, setGamePacks } from "./support/actor-updater-fixtures";

const PHASE_IDS: DraftApplyPhase[] = [
  "singleton-replacements",
  "singleton-system-grants",
  "singleton-explicit-grants",
  "singleton-choice-persistence-early",
  "skill-training-items",
  "class-archetype",
  "class-branches",
  "class-feature-choices",
  "native-spellcasting-before-feats",
  "feat-selections",
  "singleton-choice-persistence-late",
  "spell-choices",
  "native-spellcasting-after-spells",
  "boost-item-updates",
  "source-flag-restoration",
  "verify-outcome",
  "finalize-actor",
];

describe("prepared draft application", () => {
  it("resolves selected sources before the first actor mutation", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({ "pf2e.classes": {} });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection(
      "class-level-1",
      "pf2e.classes",
      "missing-class",
      "class",
      "Missing Class"
    );

    await expect(prepareDraftApplication(actor as never, draft, [classSelectionStep()])).rejects.toThrow(
      "source document Compendium.pf2e.classes.Item.missing-class could not be resolved"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects an ineligible selected option before the first actor mutation", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");

    await expect(
      prepareDraftApplication(actor as never, draft, [classSelectionStep()], {
        validateSelectionEligibility: () => false,
      })
    ).rejects.toThrow("Wizard is no longer eligible");
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects a stale scalar choice before resolving or mutating actor documents", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    draft.classArchetypeChoices["class-archetype-doctrine-level-1"] = "removed-doctrine";
    const step = {
      id: "class-archetype-doctrine-level-1",
      level: 1,
      kind: "class-archetype",
      slotKind: "class-archetype",
      title: "Cleric doctrine",
      description: "",
      required: true,
      slotId: "class-archetype-doctrine-level-1",
      classArchetype: {
        slotId: "class-archetype-doctrine-level-1",
        standardValue: "standard",
        sourceName: "Doctrine",
        options: [{ value: "standard", label: "Standard", img: null, detail: null }],
        selector: {
          slotId: "class-archetype-doctrine-level-1",
          selectorPackId: "pf2e.classfeatures",
          selectorDocumentId: "doctrine",
          selectorUuid: "Compendium.pf2e.classfeatures.Item.doctrine",
          selectorName: "Doctrine",
          selectorRuleIndex: 0,
          flag: "doctrine",
          optionTag: "doctrine",
          classSlug: "cleric",
          dependsOn: "class",
        },
      },
    } satisfies PendingStep;

    await expect(prepareDraftApplication(actor as never, draft, [step])).rejects.toThrow(
      "Cleric doctrine changed after this draft was prepared"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects invalid active skill increases and ignores inactive stale entries", async () => {
    const invalidHarness = buildActorHarness();
    const invalidDraft = createEmptyDraft(3);
    invalidDraft.skillIncreases["skill-increase-level-3"] = "not-a-pf2e-skill";
    await expect(
      prepareDraftApplication(invalidHarness.actor as never, invalidDraft, [skillIncreaseStep(3)])
    ).rejects.toThrow("Skill increase 3 changed after this draft was prepared");
    expect(invalidHarness.actor.update).not.toHaveBeenCalled();

    const inactiveHarness = buildActorHarness();
    await applyDraftToActor(inactiveHarness.actor as never, invalidDraft, []);
    expect(inactiveHarness.actor.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ "system.skills.not-a-pf2e-skill.rank": expect.anything() })
    );

    const cappedHarness = buildActorHarness();
    cappedHarness.actor.system = { ...cappedHarness.actor.system, skills: { arcana: { rank: 2 } } };
    const cappedDraft = createEmptyDraft(3);
    cappedDraft.skillIncreases["skill-increase-level-3"] = "arcana";
    await expect(
      prepareDraftApplication(cappedHarness.actor as never, cappedDraft, [skillIncreaseStep(3)])
    ).rejects.toThrow("Skill increase 3 changed after this draft was prepared");
    expect(cappedHarness.actor.update).not.toHaveBeenCalled();

    const configuredHarness = buildActorHarness();
    const configuredDraft = createEmptyDraft(3);
    configuredDraft.skillIncreases["skill-increase-level-3"] = "warfare-lore";
    await expect(
      prepareDraftApplication(configuredHarness.actor as never, configuredDraft, [skillIncreaseStep(3)], {
        validSkillSlugs: new Set(["warfare-lore"]),
      })
    ).resolves.toBeDefined();
  });

  it("prepares but does not expect a flag-choice value to become an actor item", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.feats-srd": {
        "multifarious-muse": {
          name: "Multifarious Muse",
          type: "feat",
          system: {
            rules: [{ key: "ChoiceSet", flag: "muse", choices: [{ value: "enigma", label: "Enigma" }] }],
          },
        },
      },
      "pf2e.classfeatures": {
        enigma: { name: "Enigma", type: "feat", system: { category: "classfeature" } },
      },
    });
    const draft = createEmptyDraft(2);
    const slotId = "flag-choice-none-feat-multifarious-muse-muse-level-2";
    draft.selections[slotId] = selection(slotId, "pf2e.classfeatures", "enigma", "feat", "Enigma");
    const step = flagChoiceStep();

    const prepared = await prepareDraftApplication(actor as never, draft, [step]);

    expect(prepared.sources.expectedSelections.map((entry) => entry.uuid)).not.toContain(
      "Compendium.pf2e.classfeatures.Item.enigma"
    );
    expect(prepared.sources.expectedSelections.map((entry) => entry.uuid)).toContain(
      "Compendium.pf2e.feats-srd.Item.multifarious-muse"
    );
  });

  it("rejects spell over-selection before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();
    const draft = createEmptyDraft(1);
    const step = spellChoiceStep(1);
    draft.spellChoices[step.slotId] = [
      selection(step.slotId, "pf2e.spells-srd", "detect-magic", "spell", "Detect Magic"),
      selection(step.slotId, "pf2e.spells-srd", "guidance", "spell", "Guidance"),
    ];

    await expect(
      prepareDraftApplication(actor as never, draft, [step], { fetchSelectionDocument })
    ).rejects.toMatchObject({
      name: "WayfinderDraftNotReadyError",
      blockers: [expect.objectContaining({ code: "too-many-choices", stepId: step.id })],
    });
    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects a missing scalar choice before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();

    await expect(
      prepareDraftApplication(actor as never, createEmptyDraft(1), [classSelectionStep()], {
        fetchSelectionDocument,
      })
    ).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);

    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("rejects an underfilled language choice before resolving or mutating documents", async () => {
    const { actor } = buildActorHarness();
    const fetchSelectionDocument = vi.fn();
    const step = languageChoiceStep();
    const draft = createEmptyDraft(1);
    draft.languageChoices[step.slotId] = ["draconic"];

    await expect(
      prepareDraftApplication(actor as never, draft, [step], { fetchSelectionDocument })
    ).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: "missing-choice", stepId: step.id })],
    });

    expect(fetchSelectionDocument).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("accepts a reuse-only spell step when an earlier selected step prepares the destination", async () => {
    const { actor } = buildActorHarness();
    setGamePacks({
      "pf2e.spells-srd": {
        guidance: { name: "Guidance", type: "spell", system: { level: { value: 0 } } },
        fear: { name: "Fear", type: "spell", system: { level: { value: 1 } } },
      },
    });
    const draft = createEmptyDraft(2);
    const initialStep = spellChoiceStep(1);
    const laterStep = {
      ...spellChoiceStep(1),
      id: "spell-choice-witch-familiar-level-2",
      level: 2,
      slotId: "spell-choice-witch-familiar-level-2",
      title: "Level 2 witch familiar spells",
      spellChoice: {
        ...spellChoiceStep(1).spellChoice,
        slotId: "spell-choice-witch-familiar-level-2",
        reuseExistingEntryOnly: true,
      },
    } satisfies PendingStep;
    draft.spellChoices[initialStep.slotId] = [
      selection(initialStep.slotId, "pf2e.spells-srd", "guidance", "spell", "Guidance"),
    ];
    draft.spellChoices[laterStep.slotId] = [selection(laterStep.slotId, "pf2e.spells-srd", "fear", "spell", "Fear")];

    await expect(prepareDraftApplication(actor as never, draft, [initialStep, laterStep])).resolves.toBeDefined();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("executes from retained prepared sources after the live pack changes", async () => {
    const { actor, createdItems } = buildActorHarness();
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    const prepared = await prepareDraftApplication(actor as never, draft, [classSelectionStep()]);
    setGamePacks({ "pf2e.classes": {} });

    await executePreparedDraftApplication(prepared);

    expect(createdItems).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Wizard", type: "class" })]));
  });

  it("does not finalize when PF2E vetoes an expected feat creation", async () => {
    const { actor } = buildActorHarness();
    actor.feats = {
      get: () => ({ slots: { "class-2": { id: "class-2", level: 2, feat: null } } }),
    };
    actor.createEmbeddedDocuments.mockResolvedValue([]);
    setGamePacks({
      "pf2e.feats-srd": {
        intimidating: { name: "Intimidating Strike", type: "feat", system: { category: "class", level: { value: 2 } } },
      },
    });
    const draft = createEmptyDraft(2);
    draft.selections["class-feat-level-2"] = selection(
      "class-feat-level-2",
      "pf2e.feats-srd",
      "intimidating",
      "feat",
      "Intimidating Strike",
      "class",
      2
    );
    const step: PendingStep = {
      id: "class-feat-level-2",
      level: 2,
      kind: "pick-item",
      slotKind: "class-feat",
      title: "Class feat",
      description: "",
      required: true,
      slotId: "class-feat-level-2",
      filters: { itemType: "feat", featTypes: ["class"] },
    };

    await expect(applyDraftToActor(actor as never, draft, [step])).rejects.toMatchObject({
      phase: "verify-outcome",
    });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("does not finalize when PF2E cannot create a selected spell destination", async () => {
    const { actor } = buildActorHarness();
    actor.createEmbeddedDocuments.mockResolvedValue([]);
    setGamePacks({
      "pf2e.spells-srd": {
        "detect-magic": { name: "Detect Magic", type: "spell", system: { level: { value: 0 } } },
      },
    });
    const draft = createEmptyDraft(1);
    const step = spellChoiceStep(1);
    draft.spellChoices[step.slotId] = [
      selection(step.slotId, "pf2e.spells-srd", "detect-magic", "spell", "Detect Magic"),
    ];

    await expect(applyDraftToActor(actor as never, draft, [step])).rejects.toMatchObject({
      phase: "verify-outcome",
    });
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("exposes named phases and identifies the failed boundary", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    const prepared = await prepareDraftApplication(actor as never, draft, []);
    const observed: string[] = [];

    await expect(
      executePreparedDraftApplication(prepared, {
        beforePhase: (phase) => {
          observed.push(phase);
          if (phase === "class-branches") throw new Error("injected failure");
        },
      })
    ).rejects.toMatchObject({
      name: "DraftApplyPhaseError",
      phase: "class-branches",
      completedPhases: [
        "singleton-replacements",
        "singleton-system-grants",
        "singleton-explicit-grants",
        "singleton-choice-persistence-early",
        "skill-training-items",
        "class-archetype",
      ],
    });
    expect(observed.at(-1)).toBe("class-branches");
    expect(actor.update).not.toHaveBeenCalled();
  });

  it.each(PHASE_IDS)("stops at the injected %s boundary without finalizing", async (failedPhase) => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "old-class",
          type: "class",
          name: "Fighter",
          flags: { core: { sourceId: "Compendium.pf2e.classes.Item.fighter" } },
          system: {},
        },
      ],
    });
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");
    const prepared = await prepareDraftApplication(actor as never, draft, [classSelectionStep()]);
    const observed: DraftApplyPhase[] = [];

    let failure: DraftApplyPhaseError | null = null;
    try {
      await executePreparedDraftApplication(prepared, {
        beforePhase: (phase) => {
          observed.push(phase);
          if (phase === failedPhase) throw new Error("injected failure");
        },
      });
    } catch (error) {
      failure = error as DraftApplyPhaseError;
    }
    expect(failure).toMatchObject({
      phase: failedPhase,
      completedPhases: PHASE_IDS.slice(0, PHASE_IDS.indexOf(failedPhase)),
    });
    expect(observed).toEqual(PHASE_IDS.slice(0, PHASE_IDS.indexOf(failedPhase) + 1));
    expect(actor.update).not.toHaveBeenCalled();
    if (PHASE_IDS.indexOf(failedPhase) > 0) {
      expect(actor.createEmbeddedDocuments).toHaveBeenCalled();
      expect(failure?.completedReceipts[0]?.createdItemIds).not.toEqual([]);
    }
  });

  it("rechecks actor authority immediately before the first phase", async () => {
    const { actor } = buildActorHarness();
    let authorized = true;
    const prepared = await prepareDraftApplication(actor as never, createEmptyDraft(1), [], {
      validateActorAuthority: () => authorized,
    });
    authorized = false;

    await expect(executePreparedDraftApplication(prepared)).rejects.toThrow(
      "current user can no longer modify this PF2E character"
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("shares the same mandatory readiness rejection for coalesced actor operations", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    const steps = [classSelectionStep()];

    const first = applyDraftToActor(actor as never, draft, steps);
    const second = applyDraftToActor(actor as never, draft, steps);

    expect(second).toBe(first);
    await expect(first).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);
    await expect(second).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("does not share concurrent applies with different operation options", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstPhase = vi.fn(async () => barrier);

    const first = applyDraftToActor(actor as never, draft, [], {
      beforePhase: (phase) => (phase === "singleton-replacements" ? firstPhase() : undefined),
    });
    const second = applyDraftToActor(actor as never, draft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.state.lastAppliedAt": "different-timestamp" },
      validateSelectionEligibility: () => false,
    });

    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(firstPhase).toHaveBeenCalledTimes(1));
    release?.();
    await Promise.all([first, second]);
    expect(actor.update).toHaveBeenCalledTimes(2);
  });

  it("serializes different drafts for the same actor", async () => {
    const { actor } = buildActorHarness();
    const firstDraft = createEmptyDraft(1);
    const secondDraft = createEmptyDraft(2);
    const order: string[] = [];
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = applyDraftToActor(actor as never, firstDraft, [], {
      beforePhase: async (phase) => {
        if (phase === "singleton-replacements") {
          order.push("first-start");
          await barrier;
          order.push("first-end");
        }
      },
    });
    const second = applyDraftToActor(actor as never, secondDraft, [], {
      beforePhase: (phase) => {
        if (phase === "singleton-replacements") order.push("second-start");
      },
    });

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("uses invocation-time draft, steps, and final update for queued Apply", async () => {
    const { actor } = buildActorHarness();
    actor.system = { ...actor.system, skills: { arcana: { rank: 0 }, diplomacy: { rank: 0 } } };
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      beforePhase: (phase) => (phase === "singleton-replacements" ? barrier : undefined),
    });
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";
    const steps = [skillIncreaseStep(3)];
    const finalActorUpdate = { "flags.test.snapshot": "original" };

    const queued = applyDraftToActor(actor as never, draft, steps, { finalActorUpdate });
    draft.skillIncreases["skill-increase-level-3"] = "diplomacy";
    steps.splice(0, 1);
    finalActorUpdate["flags.test.snapshot"] = "mutated";
    release?.();
    await Promise.all([first, queued]);

    expect(actor.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        "flags.test.snapshot": "original",
        "system.skills.arcana.rank": 1,
      })
    );
    expect(actor.update).not.toHaveBeenCalledWith(expect.objectContaining({ "system.skills.diplomacy.rank": 1 }));
  });

  it("keeps semantically different repeats distinct while another draft is queued", async () => {
    const { actor } = buildActorHarness();
    const firstDraft = createEmptyDraft(1);
    const secondDraft = createEmptyDraft(2);
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = applyDraftToActor(actor as never, firstDraft, [], {
      beforePhase: (phase) => (phase === "singleton-replacements" ? barrier : undefined),
    });
    const second = applyDraftToActor(actor as never, secondDraft, []);
    const repeatedFirst = applyDraftToActor(actor as never, firstDraft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.state.lastAppliedAt": "later" },
    });

    expect(repeatedFirst).not.toBe(first);
    release?.();
    await Promise.all([first, second, repeatedFirst]);
  });

  it("allows different actors to prepare and execute concurrently", async () => {
    const firstHarness = buildActorHarness();
    const secondHarness = buildActorHarness();
    const started = new Set<string>();
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (name: string, actor: unknown) =>
      applyDraftToActor(actor as never, createEmptyDraft(1), [], {
        beforePhase: async (phase) => {
          if (phase !== "singleton-replacements") return;
          started.add(name);
          await barrier;
        },
      });

    const first = run("first", firstHarness.actor);
    const second = run("second", secondHarness.actor);
    await vi.waitFor(() => expect(started).toEqual(new Set(["first", "second"])));
    release?.();
    await Promise.all([first, second]);
  });

  it("keeps lifecycle finalization inside the per-actor queue", async () => {
    const { actor } = buildActorHarness();
    const order: string[] = [];
    let release: (() => void) | null = null;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    actor.update.mockImplementationOnce(async () => {
      order.push("first-finalize-start");
      await barrier;
      order.push("first-finalize-end");
      return {};
    });

    const first = applyDraftToActor(actor as never, createEmptyDraft(1), [], {
      finalActorUpdate: { "flags.test.operation": "first" },
    });
    const second = applyDraftToActor(actor as never, createEmptyDraft(2), [], {
      beforePhase: (phase) => {
        if (phase === "singleton-replacements") order.push("second-start");
      },
      finalActorUpdate: { "flags.test.operation": "second" },
    });

    await vi.waitFor(() => expect(order).toEqual(["first-finalize-start"]));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-finalize-start", "first-finalize-end", "second-start"]);
  });

  it("keeps phase errors typed through the facade", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);

    const apply = applyDraftToActor(actor as never, draft, [], {
      beforePhase: (phase) => {
        if (phase === "singleton-replacements") throw new Error("stop");
      },
    });

    await expect(apply).rejects.toBeInstanceOf(DraftApplyPhaseError);
    expect(actor.update).not.toHaveBeenCalled();
  });

  it("reports final actor update failure as a phase and permits retry", async () => {
    const { actor } = buildActorHarness();
    const draft = createEmptyDraft(1);
    actor.update.mockRejectedValueOnce(new Error("final update failed"));

    await expect(
      applyDraftToActor(actor as never, draft, [], {
        finalActorUpdate: { "flags.wayfinder-pf2e.draft": null },
      })
    ).rejects.toMatchObject({ phase: "finalize-actor" });

    await applyDraftToActor(actor as never, draft, [], {
      finalActorUpdate: { "flags.wayfinder-pf2e.draft": null },
    });
    expect(actor.update).toHaveBeenCalledTimes(2);
  });

  it("retries a late failure without applying a skill increase twice", async () => {
    const { actor } = buildActorHarness();
    actor.system = { ...actor.system, skills: { arcana: { rank: 0 } } };
    const draft = createEmptyDraft(3);
    draft.skillIncreases["skill-increase-level-3"] = "arcana";

    await expect(
      applyDraftToActor(actor as never, draft, [], {
        beforePhase: (phase) => {
          if (phase === "source-flag-restoration") throw new Error("late failure");
        },
      })
    ).rejects.toBeInstanceOf(DraftApplyPhaseError);
    expect(actor.system.skills?.arcana?.rank).toBe(0);
    expect(actor.update).not.toHaveBeenCalled();

    await applyDraftToActor(actor as never, draft, [skillIncreaseStep(3)]);

    expect(actor.system.skills?.arcana?.rank).toBe(1);
    expect(actor.update).toHaveBeenCalledTimes(1);
  });

  it("retries after a completed singleton phase without duplicating the final selection", async () => {
    const { actor } = buildActorHarness({
      items: [
        {
          id: "old-class",
          type: "class",
          name: "Fighter",
          flags: { core: { sourceId: "Compendium.pf2e.classes.Item.fighter" } },
          system: {},
        },
      ],
    });
    const createItems = actor.createEmbeddedDocuments.getMockImplementation() as (
      type: string,
      sources: EmbeddedItemSource[]
    ) => Promise<ActorItemLike[]>;
    actor.createEmbeddedDocuments.mockImplementation(async (type, sources) => {
      if (sources.some((source) => source.type === "class")) {
        actor.items.contents = actor.items.contents.filter((item) => item.type !== "class");
      }
      return createItems(type, sources);
    });
    setGamePacks({
      "pf2e.classes": { wizard: { name: "Wizard", type: "class", system: {} } },
    });
    const draft = createEmptyDraft(1);
    draft.selections["class-level-1"] = selection("class-level-1", "pf2e.classes", "wizard", "class", "Wizard");

    await expect(
      applyDraftToActor(actor as never, draft, [classSelectionStep()], {
        beforePhase: (phase) => {
          if (phase === "source-flag-restoration") throw new Error("late failure");
        },
      })
    ).rejects.toMatchObject({ phase: "source-flag-restoration" });

    await applyDraftToActor(actor as never, draft, [classSelectionStep()]);
    expect(actor.items.contents.filter((item) => item.type === "class")).toEqual([
      expect.objectContaining({ name: "Wizard" }),
    ]);
  });
});

function skillIncreaseStep(level: number): PendingStep {
  const slotId = `skill-increase-level-${level}`;
  return {
    id: slotId,
    level,
    kind: "skill-increase",
    slotKind: "skill-increase",
    title: `Skill increase ${level}`,
    description: "",
    required: true,
    slotId,
  };
}

function spellChoiceStep(count: number): SpellChoiceStep {
  return {
    id: "spell-choice-wizard-cantrips-level-1",
    level: 1,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Wizard cantrips",
    description: "",
    required: true,
    slotId: "spell-choice-wizard-cantrips-level-1",
    filters: { itemType: "spell", packIds: ["pf2e.spells-srd"] },
    spellChoice: {
      slotId: "spell-choice-wizard-cantrips-level-1",
      sourcePackId: null,
      sourceDocumentId: null,
      sourceUuid: null,
      sourceName: "Wizard",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: "wizard-spellbook",
        label: "Wizard spellbook",
        entryName: "Arcane Prepared Spells",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function languageChoiceStep() {
  return createLanguageChoiceStep(1, {
    slotId: "language-choice-level-1",
    sourceItemType: "ancestry",
    sourceName: "Human",
    grantedLanguages: ["common"],
    count: 2,
    options: [
      { value: "draconic", label: "Draconic", requiresGmApproval: false },
      { value: "dwarven", label: "Dwarven", requiresGmApproval: false },
    ],
  });
}

function flagChoiceStep(): PendingStep {
  const slotId = "flag-choice-none-feat-multifarious-muse-muse-level-2";
  return {
    id: slotId,
    level: 2,
    kind: "pick-item",
    slotKind: "flag-choice",
    title: "Choose a muse",
    description: "",
    required: true,
    slotId,
    filters: { itemType: "feat" },
    flagChoice: {
      slotId,
      sourceItemType: "feat",
      sourcePackId: "pf2e.feats-srd",
      sourceDocumentId: "multifarious-muse",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.multifarious-muse",
      sourceName: "Multifarious Muse",
      sourceRuleIndex: 0,
      flag: "muse",
      prompt: "Choose a muse",
      itemType: "feat",
      selectionValue: "uuid",
      dependsOn: "class",
      filters: { itemType: "feat" },
    },
  };
}
