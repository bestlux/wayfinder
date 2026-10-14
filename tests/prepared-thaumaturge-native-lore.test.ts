import { describe, expect, it } from "vitest";
import {
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { projectPreparedSkillSources } from "../src/actor-updater/prepared-skill-source-projection";
import { MODULE_ID, SKILL_LABELS } from "../src/constants";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import type { PendingStep } from "../src/types";
import { compileSkillPaneProgression } from "../src/wayfinder/application/build-skill-pane-service";
import {
  THAUMATURGE_NATIVE_LORE_CLASS_UUID as CLASS_UUID,
  THAUMATURGE_NATIVE_LORE_UUID as LORE_UUID,
  thaumaturgeLoreClassSource,
  thaumaturgeLoreFeatureSource,
} from "./fixtures/thaumaturge-native-lore";
import { buildActorHarness, classSelectionStep, selection, setGamePacks } from "./support/actor-updater-fixtures";

const classSelection = () => selection("class-level-1", "pf2e.classes", "Y5GsHqzCzJlKka6x", "class", "Thaumaturge");
const validSkillSlugs = new Set(Object.keys(SKILL_LABELS));

function retained(source: EmbeddedItemSource, uuid: string, id: string): ActorItemLike {
  return { ...source, id, sourceId: uuid, flags: { core: { sourceId: uuid } } };
}

function trainingStep(): PendingStep {
  return {
    id: "skill-training-thaumaturge-level-1",
    slotId: "skill-training-thaumaturge-level-1",
    kind: "skill-training",
    slotKind: "skill-training",
    level: 1,
    title: "Thaumaturge training",
    description: "",
    required: true,
    training: {
      classSlug: "thaumaturge",
      className: "Thaumaturge",
      fixedSkills: ["arcana", "nature", "occultism", "religion"],
      fixedLores: ["Esoteric Lore", "Sailing Lore"],
      choiceRules: [],
      loreChoices: [],
      additionalCount: 1,
    },
  };
}

function scenario(mode: "fresh" | "retained" | "recovery", version: "8.5.1" | "8.6.1" = "8.6.1") {
  const classDocument = thaumaturgeLoreClassSource();
  const loreDocument = thaumaturgeLoreFeatureSource(version);
  const isRetained = mode !== "fresh";
  const { actor } = buildActorHarness({
    level: mode === "retained" ? 5 : 1,
    items: isRetained
      ? [retained(classDocument, CLASS_UUID, "class"), retained(loreDocument, LORE_UUID, "feature")]
      : [],
  });
  actor.system!.skills = Object.fromEntries(
    [...validSkillSlugs].map((slug) => [
      slug,
      { rank: isRetained && ["arcana", "nature", "occultism", "religion"].includes(slug) ? 1 : 0 },
    ])
  );
  if (isRetained && version === "8.6.1") actor.system!.skills!["esoteric-lore"] = { rank: mode === "retained" ? 2 : 1 };
  let draft = createEmptyDraft(mode === "retained" ? 7 : 5);
  const training = trainingStep();
  const steps = isRetained ? [training] : [classSelectionStep(), training];
  if (!isRetained) draft.selections["class-level-1"] = classSelection();
  draft.skillTrainings[training.slotId] = { additional: ["athletics"], ruleChoices: {}, loreChoices: {} };
  if (mode === "recovery") {
    draft = normalizeDraft(JSON.parse(JSON.stringify(draft)), 5);
    draft.applyAttemptStepIds = steps.map((step) => step.id);
  }
  setPacks(classDocument, loreDocument);
  return { actor, draft, steps, classDocument, loreDocument };
}

function setPacks(classDocument: EmbeddedItemSource, loreDocument: EmbeddedItemSource) {
  setGamePacks({
    "pf2e.classes": { Y5GsHqzCzJlKka6x: { ...classDocument, type: "class", name: "Thaumaturge" } },
    "pf2e.classfeatures": { cvQmPkJtybMcHinK: { ...loreDocument, type: "feat", name: "Esoteric Lore" } },
  });
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
        ? (fixture.actor.items.contents.find((item) => item.type === "class") ?? fixture.classDocument)
        : null,
    resolveSelectionDocument: async () => fixture.classDocument,
    validSkillSlugs: new Set([...validSkillSlugs, ...Object.keys(baselineRanks)]),
    mode: fixture.draft.applyAttemptStepIds.length > 0 ? "recovery" : "editing",
    localize: (value) => value,
  });
  return prepareDraftApplication(fixture.actor as never, fixture.draft, fixture.steps, {
    validateActorAuthority: () => true,
    skillProgression: progression,
  });
}

function expectNoWrites(actor: ReturnType<typeof buildActorHarness>["actor"]) {
  expect(actor.update).not.toHaveBeenCalled();
  expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
}

describe("prepared native Thaumaturge skill expectation", () => {
  it.each([
    "fresh",
    "retained",
    "recovery",
  ] as const)("%s keeps current-level expectation separate from manual progression", async (mode) => {
    const fixture = scenario(mode);
    const prepared = await prepare(fixture);
    expect(prepared.requiredBeforeSkillGrants).toContainEqual({
      slug: "esoteric-lore",
      rank: mode === "retained" ? 2 : 1,
      sourceId: LORE_UUID,
    });
    expect(prepared.skillProgression.sourceGrants.map((grant) => grant.slug)).not.toContain("esoteric-lore");
    expect(prepared.skillPhaseGrants).toEqual([]);
    expectNoWrites(fixture.actor);
    await executePreparedDraftApplication(prepared, {
      onCheckpoint: (checkpoint) => {
        if (checkpoint.checkpointId === "phase:skill-training-items:before") {
          for (const slug of ["arcana", "nature", "occultism", "religion"])
            fixture.actor.system!.skills![slug].rank = 1;
          fixture.actor.system!.skills!["esoteric-lore"] = { rank: mode === "retained" ? 2 : 1 };
        }
      },
    });
    expect(fixture.actor.system!.details!.level!.value).toBe(mode === "retained" ? 7 : 5);
    expect(fixture.actor.items.contents.filter((item) => item.type === "lore").map((item) => item.name)).toEqual([
      "Sailing Lore",
    ]);
    expect(fixture.actor.update.mock.calls.flatMap(([update]) => Object.keys(update))).not.toContain(
      "system.skills.esoteric-lore.rank"
    );
  });

  it("preserves the exact older manual Lore behavior", async () => {
    const fixture = scenario("fresh", "8.5.1");
    const prepared = await prepare(fixture);
    expect(prepared.requiredBeforeSkillGrants.some((grant) => grant.slug === "esoteric-lore")).toBe(false);
    await executePreparedDraftApplication(prepared, {
      onCheckpoint: (checkpoint) => {
        if (checkpoint.checkpointId === "phase:skill-training-items:before") {
          for (const slug of ["arcana", "nature", "occultism", "religion"])
            fixture.actor.system!.skills![slug].rank = 1;
        }
      },
    });
    expect(fixture.actor.items.contents.filter((item) => item.type === "lore").map((item) => item.name)).toEqual([
      "Esoteric Lore",
      "Sailing Lore",
    ]);
  });

  it("preserves existing manual Esoteric Lore data while avoiding a new fixed Lore item", async () => {
    const fixture = scenario("recovery");
    const training = fixture.steps[0];
    const lore: ActorItemLike = {
      id: "manual-lore",
      name: "Esoteric Lore",
      type: "lore",
      system: { proficient: { value: 2 }, mod: { value: 7 } },
      flags: { [MODULE_ID]: { importedBy: MODULE_ID, slotId: training.slotId, trainingKey: "fixed:0" } },
    };
    fixture.actor.items.contents.push(lore);
    const original = structuredClone(lore);
    await executePreparedDraftApplication(await prepare(fixture));
    expect(lore).toEqual(original);
    expect(
      fixture.actor.items.contents.filter((item) => item.type === "lore" && item.name === "Esoteric Lore")
    ).toHaveLength(1);
    expect(fixture.actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("uses retained feature rules rather than changed pack rules", async () => {
    const fixture = scenario("retained");
    const changed = thaumaturgeLoreFeatureSource();
    (changed.system!.rules![1].value as Record<string, unknown>).rank = 4;
    setPacks(fixture.classDocument, changed);
    expect((await prepare(fixture)).requiredBeforeSkillGrants).toContainEqual({
      slug: "esoteric-lore",
      rank: 2,
      sourceId: LORE_UUID,
    });
    expectNoWrites(fixture.actor);
  });

  it("rejects retained feature drift before any actor write", async () => {
    const fixture = scenario("retained");
    fixture.actor.items.contents[1].system!.rules![1].predicate = ["class:thaumaturge"];
    await expect(prepare(fixture)).rejects.toThrow("Thaumaturge native Esoteric Lore changed");
    expectNoWrites(fixture.actor);
  });

  it("rejects a missing inspected child or changed new class child before any actor write", async () => {
    const fixture = scenario("fresh");
    setGamePacks({
      "pf2e.classes": { Y5GsHqzCzJlKka6x: { ...fixture.classDocument, type: "class", name: "Thaumaturge" } },
    });
    await expect(prepare(fixture)).rejects.toThrow("its exact source could not be inspected");
    expectNoWrites(fixture.actor);
    const changed = thaumaturgeLoreFeatureSource();
    changed.system!.rules![1].mode = "upgrade";
    setPacks(fixture.classDocument, changed);
    await expect(prepare(fixture)).rejects.toThrow("Thaumaturge native Esoteric Lore changed");
    expectNoWrites(fixture.actor);
  });

  it("keeps retained older feature behavior even if the current pack has the native rule", async () => {
    const fixture = scenario("retained", "8.5.1");
    setPacks(fixture.classDocument, thaumaturgeLoreFeatureSource());
    const prepared = await prepare(fixture);
    expect(prepared.requiredBeforeSkillGrants.some((grant) => grant.slug === "esoteric-lore")).toBe(false);
    await executePreparedDraftApplication(prepared);
    expect(
      fixture.actor.items.contents.filter((item) => item.type === "lore" && item.name === "Esoteric Lore")
    ).toHaveLength(1);
  });

  it.each(["esoteric-lore", "unrelated-lore", "athletics"])("still rejects unexpected %s rank drift", async (slug) => {
    const fixture = scenario("recovery");
    const prepared = await prepare(fixture);
    fixture.actor.system!.skills![slug] = { rank: slug === "esoteric-lore" ? 2 : 1 };
    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      phase: "skill-training-items",
      cause: expect.objectContaining({
        message: "Skill progression changed during Apply; reopen Wayfinder and review the affected choices.",
      }),
    });
    expectNoWrites(fixture.actor);
  });

  it("does not authorize an inactive Thaumaturge source after selecting a different class", () => {
    const draft = createEmptyDraft(5);
    const classStep = classSelectionStep();
    const fighter = selection(classStep.slotId, "pf2e.classes", "fighter", "class", "Fighter");
    draft.selections[classStep.slotId] = fighter;
    expect(
      projectPreparedSkillSources({
        draft,
        steps: [classStep],
        validSkillSlugs,
        currentActorLevel: 1,
        sources: [
          { selection: classSelection(), source: thaumaturgeLoreClassSource() },
          { selection: fighter, source: { type: "class", system: { slug: "fighter", rules: [] } } },
        ],
      }).requiredBeforeSkillGrants
    ).toEqual([]);
  });
});
