import { describe, expect, it } from "vitest";
import {
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { projectPreparedSkillSources } from "../src/actor-updater/prepared-skill-source-projection";
import { SKILL_LABELS } from "../src/constants";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { ActorItemLike } from "../src/shared/actor-model";
import type { PendingStep } from "../src/types";
import { compileSkillPaneProgression } from "../src/wayfinder/application/build-skill-pane-service";
import { COMMANDER_NATIVE_LORE_UUID, commanderNativeLoreSource } from "./fixtures/commander-native-lore";
import { buildActorHarness, classSelectionStep, selection, setGamePacks } from "./support/actor-updater-fixtures";

const validSkillSlugs = new Set(Object.keys(SKILL_LABELS));
const commanderSelection = () => selection("class-level-1", "pf2e.classes", "Oyee5Ds9uwYLEkD0", "class", "Commander");

function trainingStep(): PendingStep {
  return {
    id: "skill-training-commander-level-1",
    slotId: "skill-training-commander-level-1",
    kind: "skill-training",
    slotKind: "skill-training",
    level: 1,
    title: "Commander training",
    description: "",
    required: true,
    training: {
      classSlug: "commander",
      className: "Commander",
      fixedSkills: ["society"],
      fixedLores: [],
      choiceRules: [],
      loreChoices: [],
      additionalCount: 1,
    },
  };
}

function retainedCommander(): ActorItemLike {
  return {
    ...commanderNativeLoreSource(),
    id: "retained-commander",
    sourceId: COMMANDER_NATIVE_LORE_UUID,
    flags: { core: { sourceId: COMMANDER_NATIVE_LORE_UUID } },
  };
}

function scenario(mode: "fresh" | "retained" | "recovery") {
  const isRetained = mode !== "fresh";
  const { actor } = buildActorHarness({
    level: mode === "retained" ? 5 : 1,
    items: isRetained ? [retainedCommander()] : [],
  });
  actor.system!.skills = {
    society: { rank: isRetained ? 1 : 0 },
    athletics: { rank: 0 },
    religion: { rank: 0 },
    ...(isRetained ? { "warfare-lore": { rank: mode === "retained" ? 2 : 1 } } : {}),
  };
  let draft = createEmptyDraft(mode === "retained" ? 7 : 5);
  const training = trainingStep();
  const steps = isRetained ? [training] : [classSelectionStep(), training];
  if (!isRetained) draft.selections["class-level-1"] = commanderSelection();
  draft.skillTrainings[training.slotId] = { additional: ["athletics"], ruleChoices: {}, loreChoices: {} };
  if (mode === "recovery") {
    draft = normalizeDraft(JSON.parse(JSON.stringify(draft)), 5);
    draft.applyAttemptStepIds = steps.map((step) => step.id);
  }
  const document = commanderNativeLoreSource();
  setGamePacks({ "pf2e.classes": { Oyee5Ds9uwYLEkD0: { ...document, name: "Commander", type: "class" } } });
  return { actor, draft, steps, document };
}

function expectNoWrites(actor: ReturnType<typeof buildActorHarness>["actor"]) {
  expect(actor.update).not.toHaveBeenCalled();
  expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
}

async function prepare(fixture: ReturnType<typeof scenario>) {
  const baselineRanks = Object.fromEntries(
    Object.entries(fixture.actor.system!.skills!).map(([slug, data]) => [slug, Number(data.rank)])
  );
  const progression = await compileSkillPaneProgression(fixture.draft, {
    actorDocuments: fixture.actor.items.contents,
    baseSkillRanks: baselineRanks,
    steps: fixture.steps,
    resolveDocument: async (type) =>
      type === "class"
        ? (fixture.actor.items.contents.find((item) => item.type === "class") ?? fixture.document)
        : null,
    resolveSelectionDocument: async () => fixture.document,
    validSkillSlugs: new Set([...validSkillSlugs, ...Object.keys(baselineRanks)]),
    mode: fixture.draft.applyAttemptStepIds.length > 0 ? "recovery" : "editing",
    localize: (value) => value,
  });
  return prepareDraftApplication(fixture.actor as never, fixture.draft, fixture.steps, {
    validateActorAuthority: () => true,
    skillProgression: progression,
  });
}

describe("prepared native Commander skill expectation", () => {
  it.each([
    "fresh",
    "retained",
    "recovery",
  ] as const)("%s keeps current-level native expectation separate from manual progression", async (mode) => {
    const fixture = scenario(mode);
    const prepared = await prepare(fixture);
    expect(prepared.requiredBeforeSkillGrants).toContainEqual({
      slug: "warfare-lore",
      rank: mode === "retained" ? 2 : 1,
      sourceId: COMMANDER_NATIVE_LORE_UUID,
    });
    expect(prepared.skillProgression.sourceGrants).toEqual([
      { slug: "society", rank: 1, sourceId: COMMANDER_NATIVE_LORE_UUID },
    ]);
    expect(prepared.skillPhaseGrants).toEqual([]);
    expect(prepared.validSkillSlugs.has("warfare-lore")).toBe(mode !== "fresh");
    expectNoWrites(fixture.actor);
  });

  it("does not authorize an inactive Commander source when another class is selected", () => {
    const draft = createEmptyDraft(5);
    const classStep = classSelectionStep();
    const fighter = selection(classStep.slotId, "pf2e.classes", "fighter", "class", "Fighter");
    draft.selections[classStep.slotId] = fighter;
    const projection = projectPreparedSkillSources({
      draft,
      steps: [classStep],
      validSkillSlugs,
      currentActorLevel: 1,
      sources: [
        { selection: commanderSelection(), source: commanderNativeLoreSource() },
        { selection: fighter, source: { type: "class", system: { slug: "fighter", rules: [] } } },
      ],
    });
    expect(projection.requiredBeforeSkillGrants).toEqual([]);
  });

  it("rejects identified native source drift during preparation before any write", async () => {
    const fixture = scenario("fresh");
    fixture.document.system!.rules![0].predicate = ["class:commander"];
    setGamePacks({ "pf2e.classes": { Oyee5Ds9uwYLEkD0: { ...fixture.document, name: "Commander", type: "class" } } });
    await expect(prepare(fixture)).rejects.toThrow("Commander native Warfare Lore changed");
    expectNoWrites(fixture.actor);
  });

  it.each([
    "fresh",
    "retained",
    "recovery",
  ] as const)("%s accepts only the source-proven native rank at the skill phase", async (mode) => {
    const fixture = scenario(mode);
    const prepared = await prepare(fixture);
    const levelBeforeApply = Number(fixture.actor.system!.details!.level!.value);
    const expectedNativeRank = mode === "retained" ? 2 : 1;
    let observedBeforeSkills: number | undefined;
    await executePreparedDraftApplication(prepared, {
      onCheckpoint: (checkpoint) => {
        if (checkpoint.checkpointId === "phase:skill-training-items:before") {
          // Model the independently probed native preparation after class creation.
          fixture.actor.system!.skills!.society.rank = 1;
          fixture.actor.system!.skills!["warfare-lore"] = { rank: expectedNativeRank };
          observedBeforeSkills = Number(fixture.actor.system!.skills!["warfare-lore"].rank);
        }
      },
    });
    expect(observedBeforeSkills).toBe(expectedNativeRank);
    expect(levelBeforeApply).toBe(mode === "retained" ? 5 : 1);
    expect(fixture.actor.system!.details!.level!.value).toBe(mode === "retained" ? 7 : 5);
    expect(fixture.actor.update.mock.calls.flatMap(([update]) => Object.keys(update))).not.toContain(
      "system.skills.warfare-lore.rank"
    );
  });

  it.each([
    "warfare-lore",
    "unrelated-lore",
    "religion",
  ])("still rejects unexpected %s rank drift before skill writes", async (slug) => {
    const fixture = scenario("recovery");
    const prepared = await prepare(fixture);
    fixture.actor.system!.skills![slug] = { rank: slug === "warfare-lore" ? 2 : 1 };
    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      phase: "skill-training-items",
      cause: expect.objectContaining({
        message: "Skill progression changed during Apply; reopen Wayfinder and review the affected choices.",
      }),
    });
    expectNoWrites(fixture.actor);
  });

  it("uses the retained source that will prepare the actor, even when the pack changes", async () => {
    const fixture = scenario("retained");
    const changedPack = commanderNativeLoreSource();
    (changedPack.system!.rules![0].value as Record<string, unknown>).rank = 4;
    setGamePacks({ "pf2e.classes": { Oyee5Ds9uwYLEkD0: { ...changedPack, name: "Commander", type: "class" } } });
    const prepared = await prepare(fixture);
    expect(prepared.requiredBeforeSkillGrants).toContainEqual({
      slug: "warfare-lore",
      rank: 2,
      sourceId: COMMANDER_NATIVE_LORE_UUID,
    });
    expectNoWrites(fixture.actor);
  });
});
