import { describe, expect, it, vi } from "vitest";
import { prepareDraftApplication } from "../src/actor-updater/prepared-draft-application";
import { createEmptyDraft, normalizeDraft, normalizeState } from "../src/draft-service";
import type { SelectionRef, SpellChoiceStep } from "../src/types";
import { WayfinderDraftNotReadyError } from "../src/wayfinder/domain/step-evaluation";
import {
  buildAppliedSpellRarityAttestations,
  buildSpellRarityAttestationReviewLines,
  createSpellRarityAttestation,
  evaluateSpellRarityAttestation,
  frozenSpellRarityAttestationForStep,
  listSpellRarityAttestationProblems,
  listSpellRarityRecoveryProblems,
  normalizeSpellRarityAttestation,
  removeOrphanedSpellRarityAttestations,
} from "../src/wayfinder/spell-choice/rarity-attestation";

describe("restricted-spell player attestations", () => {
  it("migrates legacy Booleans deterministically without inventing authority", () => {
    const raw = { targetLevel: 1, spellRarityAccess: { [STEP_ID]: true, ignored: false } };
    const first = normalizeDraft(raw, 1);
    const second = normalizeDraft(raw, 1);

    expect(first.spellRarityAttestations).toEqual({
      [STEP_ID]: {
        version: 1,
        kind: "spell-rarity-access",
        trust: "player-attestation",
        status: "unresolved",
        slotId: STEP_ID,
        migratedFrom: "legacy-boolean",
      },
    });
    expect(JSON.stringify(second.spellRarityAttestations)).toBe(JSON.stringify(first.spellRarityAttestations));
    expect(first.updatedAt).toBeNull();
  });

  it("treats the new field as authoritative and rejects malformed claims", () => {
    const draft = normalizeDraft(
      {
        targetLevel: 1,
        spellRarityAttestations: {},
        spellRarityAccess: { [STEP_ID]: true },
      },
      1
    );

    expect(draft.spellRarityAttestations).toEqual({});
    expect(
      normalizeSpellRarityAttestation(STEP_ID, {
        version: 1,
        kind: "spell-rarity-access",
        trust: "player-attestation",
        status: "attested",
        claimedBasis: "gm-approval",
      })
    ).toBeNull();
  });

  it("binds an attestation to actor, step, target, policy, author, time, basis, and reason", () => {
    const step = spellStep();
    const draft = createEmptyDraft(5);
    draft.spellRarityAttestations[STEP_ID] = createSpellRarityAttestation({
      actorId: "actor-1",
      step,
      targetLevel: 5,
      worldRarityCeiling: "common",
      claimedBasis: "reported-gm-permission",
      reason: "  The player reports campaign permission.  ",
      authorUserId: "user-1",
      authorName: "Player One",
      attestedAt: "2026-08-16T12:34:56.000Z",
    });

    expect(draft.spellRarityAttestations[STEP_ID]).toMatchObject({
      trust: "player-attestation",
      status: "attested",
      claimedBasis: "reported-gm-permission",
      reason: "The player reports campaign permission.",
      authorUserId: "user-1",
      authorName: "Player One",
      attestedAt: "2026-08-16T12:34:56.000Z",
      subject: {
        actorId: "actor-1",
        slotId: STEP_ID,
        stepId: STEP_ID,
        targetLevel: 5,
        stepLevel: 5,
        destinationKey: "wizard-spellbook",
        stepRarityCeiling: "common",
        worldRarityCeiling: "common",
      },
    });
    expect(evaluateSpellRarityAttestation("actor-1", draft, step, "common")).toMatchObject({
      state: "attested",
      granted: true,
    });
    expect(evaluateSpellRarityAttestation("actor-2", draft, step, "common")).toMatchObject({
      state: "stale",
      granted: false,
    });
    expect(evaluateSpellRarityAttestation("actor-1", draft, step, "unique")).toMatchObject({
      state: "unused",
      granted: false,
    });
  });

  it("keeps migrated and stale claims actionable while removing vanished subjects", () => {
    const step = spellStep();
    const draft = normalizeDraft({ targetLevel: 5, spellRarityAccess: { [STEP_ID]: true } }, 5);

    expect(listSpellRarityAttestationProblems("actor-1", draft, [step], "common")).toEqual([
      expect.objectContaining({
        slotId: STEP_ID,
        stepId: STEP_ID,
        message: expect.stringContaining("review the migrated"),
      }),
    ]);
    expect(removeOrphanedSpellRarityAttestations(draft, [])).toEqual([STEP_ID]);
    expect(draft.spellRarityAttestations).toEqual({});
  });

  it("snapshots exact selected spells into durable, explicitly non-authoritative review evidence", () => {
    const step = spellStep();
    const draft = createEmptyDraft(5);
    draft.spellRarityAttestations[STEP_ID] = currentAttestation(step);
    draft.spellChoices[STEP_ID] = [spellSelection()];

    const applied = buildAppliedSpellRarityAttestations("actor-1", draft, [step], "common");
    expect(applied).toEqual([
      expect.objectContaining({
        trust: "player-attestation",
        subjectLabel: "Wizard spellbook",
        selectedSpells: [spellSelection()],
      }),
    ]);
    expect(buildSpellRarityAttestationReviewLines(applied)[0]).toContain(
      "Access note, the player's word and not a Wayfinder check"
    );
    expect(buildSpellRarityAttestationReviewLines(applied)[0]).toContain("Forbidding Ward");
    expect(buildSpellRarityAttestationReviewLines(applied)[0]).toContain("Wizard spellbook");
    expect(
      normalizeState({
        lastAppliedAt: "2026-08-16T12:35:00.000Z",
        lastTargetLevel: 5,
        completedStepIds: [STEP_ID],
        lastAppliedSpellRarityAttestations: applied,
      }).lastAppliedSpellRarityAttestations
    ).toEqual(applied);
  });

  it("uses the frozen partial-Apply receipt after the original spell step disappears", () => {
    const step = spellStep();
    const draft = createEmptyDraft(5);
    draft.spellRarityAttestations[STEP_ID] = currentAttestation(step);
    draft.spellChoices[STEP_ID] = [spellSelection()];
    draft.applyAttemptStepIds = [STEP_ID];
    draft.applySpellRarityAttestations = buildAppliedSpellRarityAttestations("actor-1", draft, [step], "common");

    expect(listSpellRarityRecoveryProblems("actor-1", draft)).toEqual([]);
    expect(frozenSpellRarityAttestationForStep("actor-1", draft, step)).toEqual(draft.applySpellRarityAttestations[0]);

    draft.spellChoices[STEP_ID] = [
      { ...spellSelection(), documentId: "fireball", uuid: "Compendium.pf2e.spells-srd.Item.fireball" },
    ];
    expect(listSpellRarityRecoveryProblems("actor-1", draft)).toEqual([
      expect.objectContaining({ slotId: STEP_ID, message: expect.stringContaining("no longer matches") }),
    ]);
    expect(frozenSpellRarityAttestationForStep("actor-1", draft, step)).toBeNull();
    expect(listSpellRarityRecoveryProblems("copied-actor", draft)).not.toEqual([]);
  });

  it("treats an empty recovery receipt as frozen instead of inferring new evidence", () => {
    const step = spellStep();
    const draft = createEmptyDraft(5);
    draft.applyAttemptStepIds = [STEP_ID];

    expect(listSpellRarityRecoveryProblems("actor-1", draft)).toEqual([]);

    draft.spellRarityAttestations[STEP_ID] = currentAttestation(step);
    draft.spellChoices[STEP_ID] = [spellSelection()];
    expect(listSpellRarityRecoveryProblems("actor-1", draft)).toEqual([
      expect.objectContaining({ slotId: STEP_ID, message: expect.stringContaining("no longer matches") }),
    ]);
  });

  it("rejects unresolved claim evidence before source preparation or actor writes", async () => {
    const step = spellStep();
    const draft = normalizeDraft({ targetLevel: 5, spellRarityAccess: { [STEP_ID]: true } }, 5);
    draft.spellChoices[STEP_ID] = [spellSelection()];
    const createEmbeddedSource = vi.fn();
    const fetchSelectionDocument = vi.fn();

    const apply = prepareDraftApplication({ id: "actor-1" } as never, draft, [step], {
      validateActorAuthority: () => true,
      spellRarityCeiling: "common",
      createEmbeddedSource,
      fetchSelectionDocument,
    });

    await expect(apply).rejects.toBeInstanceOf(WayfinderDraftNotReadyError);
    await expect(apply).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: "access-attestation", slotId: STEP_ID })],
    });
    expect(createEmbeddedSource).not.toHaveBeenCalled();
    expect(fetchSelectionDocument).not.toHaveBeenCalled();
  });
});

const STEP_ID = "spell-choice-wizard-spellbook-level-5";

function spellStep(): SpellChoiceStep {
  return {
    id: STEP_ID,
    level: 5,
    kind: "spell-choice",
    slotKind: "spell-choice",
    title: "Wizard spellbook",
    description: "",
    required: true,
    slotId: STEP_ID,
    filters: { itemType: "spell" },
    spellChoice: {
      slotId: STEP_ID,
      sourcePackId: "pf2e.classfeatures",
      sourceDocumentId: "wizard-spellcasting",
      sourceUuid: "Compendium.pf2e.classfeatures.Item.wizard-spellcasting",
      sourceName: "Wizard Spellcasting",
      classSlug: "wizard",
      dependsOn: "class",
      destination: {
        type: "spellbook",
        key: "wizard-spellbook",
        label: "Wizard spellbook",
        entryName: "Wizard Spellcasting",
        tradition: "arcane",
        ability: "int",
        prepared: "prepared",
      },
      count: 1,
      minRank: 1,
      maxRank: 2,
      cantrip: false,
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
    },
  };
}

function currentAttestation(step: SpellChoiceStep) {
  return createSpellRarityAttestation({
    actorId: "actor-1",
    step,
    targetLevel: 5,
    worldRarityCeiling: "common",
    claimedBasis: "rules-access",
    reason: "The character has Access through a campaign feature.",
    authorUserId: "user-1",
    authorName: "Player One",
    attestedAt: "2026-08-16T12:34:56.000Z",
  });
}

function spellSelection(): SelectionRef {
  return {
    slotId: STEP_ID,
    packId: "pf2e.spells-srd",
    documentId: "forbidding-ward",
    uuid: "Compendium.pf2e.spells-srd.Item.forbidding-ward",
    itemType: "spell",
    featType: null,
    name: "Forbidding Ward",
    level: 1,
  };
}
