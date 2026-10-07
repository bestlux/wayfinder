import { describe, expect, it } from "vitest";
import {
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { SKILL_LABELS } from "../src/constants";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { DraftState, PendingStep } from "../src/types";
import { compileSkillPaneProgression } from "../src/wayfinder/application/build-skill-pane-service";
import { buildActorHarness, selection, setGamePacks } from "./support/actor-updater-fixtures";

const MARK_SKILLS = {
  "burning-sun": "diplomacy",
  "deaths-head": "survival",
  "defiled-corpse": "religion",
  "empty-hand": "intimidation",
} as const;
type Mark = keyof typeof MARK_SKILLS;
type DraftMode = "fresh" | "reopened" | "recovery";
const SOURCE_UUID = "Compendium.test.feats.Item.hold-mark";
const CHOICE_SLOT = "singleton-choice-feat-hold-mark-holdMark-level-1";
const FEAT_SLOT = "ancestry-feat-level-1";
const VALID_SKILLS = new Set(Object.keys(SKILL_LABELS));
const BASELINE_RANKS = Object.fromEntries(Object.values(MARK_SKILLS).map((slug) => [slug, 0]));

// Minimal rule data exercises the reported conditional grant without copying feat prose.
function holdMarkDocument() {
  return {
    name: "Hold Mark",
    type: "feat",
    system: {
      slug: "hold-mark",
      category: "ancestry",
      level: { value: 1 },
      rules: [
        ...Object.entries(MARK_SKILLS).map(([mark, skill]) => ({
          key: "ActiveEffectLike",
          mode: "upgrade",
          path: `system.skills.${skill}.rank`,
          value: 1,
          predicate: [`hold-mark:${mark}`],
        })),
        {
          key: "ChoiceSet",
          flag: "holdMark",
          rollOption: "hold-mark",
          choices: Object.keys(MARK_SKILLS).map((value) => ({ value, label: value })),
        },
      ],
    },
  };
}

function scenario(mark: Mark, mode: DraftMode, retained = false) {
  const document = holdMarkDocument();
  const items = retained
    ? [
        {
          ...document,
          id: "retained-hold-mark",
          sourceId: SOURCE_UUID,
          flags: { core: { sourceId: SOURCE_UUID }, pf2e: { rulesSelections: { holdMark: mark } } },
        },
      ]
    : [];
  const { actor } = buildActorHarness({ items });
  actor.system = {
    ...actor.system,
    skills: Object.fromEntries(Object.keys(BASELINE_RANKS).map((slug) => [slug, { rank: 0 }])),
  };
  let draft = createEmptyDraft(1);
  const choiceStep: PendingStep = {
    id: CHOICE_SLOT,
    slotId: CHOICE_SLOT,
    kind: "singleton-choice",
    slotKind: "singleton-choice",
    level: 1,
    title: "Choose a hold mark",
    description: "",
    required: true,
    singletonChoice: {
      slotId: CHOICE_SLOT,
      sourceItemType: "feat",
      sourcePackId: "test.feats",
      sourceDocumentId: "hold-mark",
      sourceUuid: SOURCE_UUID,
      sourceName: "Hold Mark",
      sourceRuleIndex: 4,
      flag: "holdMark",
      prompt: "Choose a hold mark",
      predicate: [],
      rollOption: "hold-mark",
      options: Object.keys(MARK_SKILLS).map((value) => ({ value, label: value, img: null, detail: null })),
    },
  };
  const featStep: PendingStep = {
    id: FEAT_SLOT,
    slotId: FEAT_SLOT,
    kind: "pick-item",
    slotKind: "ancestry-feat",
    level: 1,
    title: "Choose an ancestry feat",
    description: "",
    required: true,
    filters: { itemType: "feat", featTypes: ["ancestry"], maxLevel: 1 },
  };
  const steps = retained ? [choiceStep] : [featStep, choiceStep];
  if (!retained) {
    draft.selections[FEAT_SLOT] = selection(FEAT_SLOT, "test.feats", "hold-mark", "feat", "Hold Mark", "ancestry");
  }
  draft.singletonChoices[CHOICE_SLOT] = mark;
  if (mode !== "fresh") draft = normalizeDraft(JSON.parse(JSON.stringify(draft)), 1);
  if (mode === "recovery") draft.applyAttemptStepIds = steps.map((step) => step.id);
  setGamePacks({ "test.feats": { "hold-mark": document } });
  return { actor, draft, steps, document, mode };
}

async function paneProgression(fixture: ReturnType<typeof scenario>, draft: DraftState = fixture.draft) {
  return compileSkillPaneProgression(draft, {
    actorDocuments: fixture.actor.items.contents,
    baseSkillRanks: BASELINE_RANKS,
    steps: fixture.steps,
    validSkillSlugs: VALID_SKILLS,
    mode: fixture.mode === "recovery" ? "recovery" : "editing",
    resolveDocument: async () => null,
    resolveSelectionDocument: async () => fixture.document,
    localize: (value) => value,
  });
}

async function prepare(fixture: ReturnType<typeof scenario>, progression: Awaited<ReturnType<typeof paneProgression>>) {
  return prepareDraftApplication(fixture.actor as never, fixture.draft, fixture.steps, {
    validateActorAuthority: () => true,
    assertAcquisitionApplyAuthority: () => undefined,
    validateSelectionEligibility: () => true,
    skillProgression: progression,
    validSkillSlugs: VALID_SKILLS,
  });
}

function expectNoWrites(actor: ReturnType<typeof buildActorHarness>["actor"]) {
  expect(actor.update).not.toHaveBeenCalled();
  expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
}

describe("issue #45 conditional skill source parity", () => {
  for (const mode of ["fresh", "reopened", "recovery"] as const) {
    it.each(
      Object.entries(MARK_SKILLS)
    )(`${mode}: projects only %s training in both pane and Apply`, async (mark, skill) => {
      const fixture = scenario(mark as Mark, mode);
      const originalDraft = structuredClone(fixture.draft);
      const progression = await paneProgression(fixture);
      const prepared = await prepare(fixture, progression);
      const grant = { slug: skill, rank: 1, sourceId: SOURCE_UUID };

      expect(progression.sourceGrants).toEqual([grant]);
      expect(prepared.skillProgression.sourceGrants).toEqual([grant]);
      expect(prepared.skillProgression.inputFingerprint).toBe(progression.inputFingerprint);
      expect(prepared.skillProgression.finalRanks).toEqual({ ...BASELINE_RANKS, [skill]: 1 });
      expect(prepared.requiredBeforeSkillGrants).toEqual([]);
      expect(prepared.skillPhaseGrants).toEqual([grant]);
      expect(fixture.draft).toEqual(originalDraft);
      expectNoWrites(fixture.actor);
    });
  }

  it.each(
    Object.entries(MARK_SKILLS)
  )("retained %s source remains required before skill training", async (mark, skill) => {
    const fixture = scenario(mark as Mark, "reopened", true);
    const progression = await paneProgression(fixture);
    const prepared = await prepare(fixture, progression);
    const grant = { slug: skill, rank: 1, sourceId: SOURCE_UUID };

    expect(progression.sourceGrants).toEqual([grant]);
    expect(prepared.skillProgression.inputFingerprint).toBe(progression.inputFingerprint);
    expect(prepared.requiredBeforeSkillGrants).toEqual([grant]);
    expect(prepared.skillPhaseGrants).toEqual([]);
    expectNoWrites(fixture.actor);
  });

  it("rejects changed choice provenance before any write even when both grants train a skill", async () => {
    const fixture = scenario("burning-sun", "fresh");
    const progression = await paneProgression(fixture);
    fixture.draft.singletonChoices[CHOICE_SLOT] = "empty-hand";

    await expect(prepare(fixture, progression)).rejects.toThrow(
      "The compiled skill progression no longer matches the active plan"
    );
    expectNoWrites(fixture.actor);
  });

  it("rejects an unselected conditional rank during Apply instead of treating every mark as allowed", async () => {
    const fixture = scenario("burning-sun", "fresh");
    const progression = await paneProgression(fixture);
    const prepared = await prepare(fixture, progression);
    fixture.actor.system.skills.religion.rank = 1;

    await expect(executePreparedDraftApplication(prepared)).rejects.toMatchObject({
      phase: "skill-training-items",
      cause: expect.objectContaining({
        message: "Skill progression changed during Apply; reopen Wayfinder and review the affected choices.",
      }),
    });
    expectNoWrites(fixture.actor);
  });
});
