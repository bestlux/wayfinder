import { describe, expect, it } from "vitest";
import { prepareDraftApplication } from "../src/actor-updater/prepared-draft-application";
import { ensureSpellcastingEntry } from "../src/actor-updater/spellcasting-entry-support";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { ActorItemLike } from "../src/shared/actor-model";
import {
  summonerSpellcastingCompatibilityIssues,
  withSummonerSpellcastingCompatibilityReadiness,
} from "../src/shared/summoner-spellcasting-compatibility";
import type { PendingStep } from "../src/types";
import { WayfinderDraftNotReadyError, type WayfinderDraftReadiness } from "../src/wayfinder/domain/step-evaluation";
import { buildActorHarness, spellChoiceStep, wizardSpellChoice } from "./support/actor-updater-fixtures";

type Tradition = "arcane" | "divine" | "occult" | "primal";

function summonerStep(tradition: Tradition, slotId = "spell-choice-summoner-cantrips-level-1"): PendingStep {
  return spellChoiceStep(
    slotId,
    {
      ...wizardSpellChoice(slotId, 5, 0, 0, true),
      classSlug: "summoner",
      destination: {
        type: "spontaneous",
        key: `summoner-${tradition}-spontaneous`,
        label: `${tradition} spell repertoire`,
        entryName: `${tradition} Spontaneous Spells`,
        tradition,
        ability: "cha",
        prepared: "spontaneous",
      },
    },
    "Summoner cantrips"
  );
}

function entry(keyTradition: Tradition, actualTradition: Tradition = keyTradition): ActorItemLike {
  return {
    id: `summoner-${keyTradition}`,
    name: "Summoner repertoire",
    type: "spellcastingEntry",
    flags: { [MODULE_ID]: { destinationKey: `summoner-${keyTradition}-spontaneous` } },
    system: {
      tradition: { value: actualTradition },
      prepared: { value: "spontaneous" },
      ability: { value: "cha" },
      slots: {},
    },
  };
}

describe("Summoner spellcasting compatibility", () => {
  it.each<Tradition>([
    "arcane",
    "divine",
    "occult",
    "primal",
  ])("accepts matching %s entries and reuses them without creating a duplicate", async (tradition) => {
    const existing = entry(tradition);
    const { actor } = buildActorHarness({ items: [existing] });
    const step = summonerStep(tradition);
    expect(summonerSpellcastingCompatibilityIssues(actor.items.contents, [step])).toEqual([]);
    expect(await ensureSpellcastingEntry(actor, step, createEmptyDraft(4))).toBe(existing);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledOnce();
    expect(actor.items.contents).toHaveLength(1);
  });

  it.each([
    ["arcane", "arcane"],
    ["primal", "arcane"],
  ] as const)("blocks conflicting key %s / actual tradition %s before direct writes", async (key, actual) => {
    const { actor } = buildActorHarness({ items: [entry(key, actual)] });
    const before = structuredClone(actor.items.contents);
    const step = summonerStep("primal");
    const issues = summonerSpellcastingCompatibilityIssues(actor.items.contents, [step]);
    expect(issues).toMatchObject([
      {
        code: "dependency-review",
        slotId: step.slotId,
        stepId: step.id,
        message: expect.stringContaining("correct the entry on the actor sheet"),
      },
    ]);
    await expect(ensureSpellcastingEntry(actor, step, createEmptyDraft(4))).rejects.toBeInstanceOf(
      WayfinderDraftNotReadyError
    );
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
    expect(actor.items.contents).toEqual(before);
  });

  it("reuses a GM-repaired entry with a stale key without creating entries or modifying its spells", async () => {
    const repaired = entry("arcane", "primal");
    const spell: ActorItemLike = {
      id: "owned-spell",
      name: "Reviewed primal spell",
      type: "spell",
      system: { location: { value: repaired.id } },
    };
    const { actor } = buildActorHarness({ items: [repaired, spell] });
    const beforeSpell = structuredClone(spell);
    const step = summonerStep("primal");
    expect(summonerSpellcastingCompatibilityIssues(actor.items.contents, [step])).toEqual([]);
    expect(await ensureSpellcastingEntry(actor, step, createEmptyDraft(4))).toBe(repaired);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.items.contents).toHaveLength(2);
    expect(repaired.flags?.[MODULE_ID]?.destinationKey).toBe("summoner-primal-spontaneous");
    expect(spell).toEqual(beforeSpell);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [expect.objectContaining({ _id: repaired.id })]);
  });

  it.each([
    "prepared",
    "ability",
  ] as const)("blocks a stale key when the repaired entry's %s still prevents reuse", (field) => {
    const mismatched = entry("arcane", "primal");
    mismatched.system![field] = { value: field === "prepared" ? "prepared" : "int" };
    expect(summonerSpellcastingCompatibilityIssues([mismatched], [summonerStep("primal")])).toHaveLength(1);
  });

  it("blocks during application preparation before actor mutation or source work", async () => {
    const { actor } = buildActorHarness({ items: [entry("arcane")] });
    const draft = createEmptyDraft(4);
    const beforeDraft = structuredClone(draft);
    const beforeItems = structuredClone(actor.items.contents);
    await expect(
      prepareDraftApplication(actor, draft, [summonerStep("divine")], { validateActorAuthority: () => true })
    ).rejects.toMatchObject({
      name: "WayfinderDraftNotReadyError",
      blockers: [expect.objectContaining({ code: "dependency-review" })],
    });
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
    expect(actor.items.contents).toEqual(beforeItems);
    expect(draft).toEqual(beforeDraft);
  });

  it("reports an old conflicting entry even when a correct entry also exists, once across repertoire steps", () => {
    const issues = summonerSpellcastingCompatibilityIssues(
      [entry("arcane"), entry("primal")],
      [summonerStep("primal"), summonerStep("primal", "spell-choice-summoner-repertoire-rank-1-level-1")]
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("correct the entry on the actor sheet");
  });

  it("ignores native and dedication entries and reuses a matching native entry", async () => {
    const nativeArcane = { ...entry("arcane"), flags: {} };
    const nativePrimal = { ...entry("primal"), flags: {} };
    const dedication = {
      ...entry("arcane"),
      flags: { [MODULE_ID]: { destinationKey: "sorcerer-arcane-spontaneous" } },
    };
    const { actor } = buildActorHarness({ items: [nativeArcane, dedication, nativePrimal] });
    const step = summonerStep("primal");
    expect(summonerSpellcastingCompatibilityIssues(actor.items.contents, [step])).toEqual([]);
    expect(await ensureSpellcastingEntry(actor, step, createEmptyDraft(4))).toBe(nativePrimal);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(nativeArcane.system?.tradition?.value).toBe("arcane");
    expect(dedication.system?.tradition?.value).toBe("arcane");
  });

  it("does not block another class's plan or items that are not spellcasting entries", () => {
    const wizard = spellChoiceStep("wizard-spells", wizardSpellChoice("wizard-spells", 1, 1, 1, false));
    expect(summonerSpellcastingCompatibilityIssues([entry("arcane")], [wizard])).toEqual([]);
    expect(
      summonerSpellcastingCompatibilityIssues([{ ...entry("arcane"), type: "spell" }], [summonerStep("primal")])
    ).toEqual([]);
    expect(summonerSpellcastingCompatibilityIssues([entry("arcane")], [])).toEqual([]);
  });

  it("surfaces a readiness blocker without replacing per-step evaluations", () => {
    const readiness: WayfinderDraftReadiness = { ready: true, evaluations: [], blockers: [], firstBlocker: null };
    const blocked = withSummonerSpellcastingCompatibilityReadiness(
      readiness,
      [entry("arcane")],
      [summonerStep("primal")]
    );
    expect(blocked.ready).toBe(false);
    expect(blocked.evaluations).toBe(readiness.evaluations);
    expect(blocked.firstBlocker).toBe(blocked.blockers[0]);
    expect(readiness.ready).toBe(true);
    expect(withSummonerSpellcastingCompatibilityReadiness(readiness, [entry("primal")], [summonerStep("primal")])).toBe(
      readiness
    );
  });
});
