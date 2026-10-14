import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executePreparedDraftApplication,
  prepareDraftApplication,
} from "../src/actor-updater/prepared-draft-application";
import { MODULE_ID } from "../src/constants";
import { createEmptyDraft, normalizeDraft } from "../src/draft-service";
import type { ActorItemLike, EmbeddedItemSource } from "../src/shared/actor-model";
import type { DraftState, SelectionRef } from "../src/types";
import { captureObservedClassGrantItems } from "../src/wayfinder/application/class-grant-projection-service";
import { findThaumaturgeNativeSelectorRecovery } from "../src/wayfinder/application/thaumaturge-native-selector-recovery";
import { createAcquisitionDraft } from "../src/wayfinder/domain/acquisition-draft";
import { createPreparedClassGrantPlan } from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
} from "../src/wayfinder/domain/physical-grant-route-registry";
import { createClassBranchStep, createClassChoiceStep } from "../src/wayfinder/domain/step-types";
import { nativePhysicalGrantSmokeFixture } from "./fixtures/native-physical-grant-smoke-fixture";
import { buildActorHarness, selection, setGamePacks } from "./support/actor-updater-fixtures";

const ORIGIN = THAUMATURGE_IMPLEMENT_ORIGINS[1];
const CLASS_UUID = CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass;
const BENEFIT_UUID = "Compendium.pf2e.classfeatures.Item.Initiate Benefit (Wand)";
const CHOICE_SLOT = "class-choice-initiate-benefit-wand-initiateBenefitWand-level-5";
const documents = JSON.parse(readFileSync(resolve("tests/fixtures/pf2e-thaumaturge-implements-8.5.1.json"), "utf8"))
  .documents as Record<string, EmbeddedItemSource>;

describe("prepared Thaumaturge selector recovery", () => {
  it("restores a retained pruned selector and missing Wand benefit through preparation, then preserves IDs on a cold retry", async () => {
    const fixture = recoveryFixture();
    const actor = buildActorHarness({ level: 5, items: fixture.items }).actor;
    Object.assign(actor, { id: "actor-47" });
    const nativeIds = actor.items.contents.map((item) => item.id);
    const physicalBefore = structuredClone(actor.items.contents.find((item) => item.type === "equipment"));
    const reopened = normalizeDraft(JSON.parse(JSON.stringify(fixture.draft)), 5);
    expect(
      findThaumaturgeNativeSelectorRecovery({
        draft: reopened,
        grant: fixture.grant,
        actorItems: captureObservedClassGrantItems(actor),
      })
    ).not.toBeNull();

    const prepared = await prepare(actor, reopened, fixture);
    const preparedSelector = await prepared.sources.fetchSelectionDocument(fixture.selectorSelection);
    expect(preparedSelector?.toObject().system?.rules).toEqual(documents[ORIGIN.selectorUuid].system?.rules);
    expect(
      (await prepared.sources.createEmbeddedSource(reopened.branchSelections[ORIGIN.slotId]))?.flags?.[MODULE_ID]
        ?.manualStaticItemGrants
    ).toEqual([{ key: "initiateBenefitWand", uuid: BENEFIT_UUID, choices: { initiateBenefitWand: "fire" } }]);
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();

    // Exercise the real prepared source catalog and both selector mutation phases.
    // The full acquisition/currency/finalization phases have separate runtime coverage.
    await executePreparedDraftApplication(
      {
        ...prepared,
        phaseIds: ["class-branches", "class-feature-choices"],
      },
      executionOptions()
    );
    const benefit = actor.items.contents.find((item) => item.sourceId === BENEFIT_UUID)!;
    const selector = actor.items.contents.find((item) => item.id === fixture.selectorId)!;
    expect(selector.system?.rules).toEqual([
      expect.objectContaining({ key: "ChoiceSet", flag: "implement", selection: fixture.grant.granterSourceUuid }),
      expect.objectContaining({ key: "GrantItem", uuid: "{item|flags.system.rulesSelections.implement}" }),
    ]);
    expect(selector.flags?.pf2e?.itemGrants?.implement).toMatchObject({ id: fixture.featureId });
    expect(benefit).toMatchObject({
      flags: {
        pf2e: {
          grantedBy: { id: fixture.featureId },
          rulesSelections: { initiateBenefitWand: "fire" },
        },
      },
      system: {
        rules: [expect.anything(), expect.objectContaining({ flag: "initiateBenefitWand", selection: "fire" })],
      },
    });
    expect(benefit.id).toBeDefined();
    expect(actor.items.contents.find((item) => item.type === "equipment")).toEqual(physicalBefore);
    expect(actor.items.contents.map((item) => item.id)).toEqual([...nativeIds, benefit.id]);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(actor.createEmbeddedDocuments.mock.calls[0][1]).toEqual([expect.objectContaining({ type: "feat" })]);
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();

    // A fresh actor harness and normalized saved draft prevent an in-memory
    // prepared catalog from hiding an incorrect retained-document precedence.
    const coldActor = buildActorHarness({
      level: 5,
      items: JSON.parse(JSON.stringify(actor.items.contents)) as ActorItemLike[],
    }).actor;
    Object.assign(coldActor, { id: "actor-47" });
    const coldDraft = normalizeDraft(JSON.parse(JSON.stringify(reopened)), 5);
    const retried = await prepare(coldActor, coldDraft, fixture);
    await executePreparedDraftApplication(
      {
        ...retried,
        phaseIds: ["class-branches", "class-feature-choices"],
      },
      executionOptions()
    );
    expect(coldActor.items.contents.map((item) => item.id)).toEqual(actor.items.contents.map((item) => item.id));
    expect(coldActor.items.contents.find((item) => item.sourceId === BENEFIT_UUID)).toMatchObject({
      id: benefit.id,
      flags: { pf2e: { rulesSelections: { initiateBenefitWand: "fire" } } },
    });
    expect(coldActor.items.contents.find((item) => item.id === fixture.selectorId)?.system?.rules).toEqual(
      selector.system?.rules
    );
    expect(coldActor.items.contents.find((item) => item.type === "equipment")).toEqual(physicalBefore);
    expect(coldActor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(coldActor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });
});

function executionOptions() {
  return {
    persistAcquisitionCurrencyConvergenceWitness: async () => undefined,
    readCurrentAcquisitionHistory: () => ({
      completedAcquisitionManifest: null,
      completedAcquisitionManifestCorrupt: false,
    }),
  };
}

async function prepare(
  actor: ReturnType<typeof buildActorHarness>["actor"],
  draft: DraftState,
  fixture: ReturnType<typeof recoveryFixture>
) {
  return prepareDraftApplication(actor, draft, fixture.steps, {
    validateActorAuthority: () => true,
    assertAcquisitionApplyAuthority: () => undefined,
    validateSelectionEligibility: () => true,
    prepareClassGrantPlan: () =>
      createPreparedClassGrantPlan({
        actorId: "actor-47",
        draftId: draft.acquisition!.draftId,
        batchId: draft.acquisition!.batchId,
        targetLevel: 5,
        grants: [fixture.grant],
      }),
  });
}

function recoveryFixture() {
  const native = nativePhysicalGrantSmokeFixture(["thaumaturge-wand-implement-second"]);
  const grant = native.classGrants[0].grant;
  const selectorId = native.items.find((item) => item.sourceId === ORIGIN.selectorUuid)!.id as string;
  const featureId = native.items.find((item) => item.sourceId === grant.granterSourceUuid)!.id as string;
  const physicalId = native.items.find((item) => item.isPhysical)!.id as string;
  const classId = native.items.find((item) => item.sourceId === CLASS_UUID)!.id as string;
  const items: ActorItemLike[] = native.items.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.sourceId === CLASS_UUID ? "class" : item.type,
    sourceId: item.sourceId,
    system: {
      quantity: 1,
      ...(item.sourceId === CLASS_UUID ? { slug: "thaumaturge", rules: [] } : {}),
      ...(item.id === selectorId ? { location: classId, rules: [] } : {}),
    },
    flags: {
      core: { sourceId: item.sourceId },
      [MODULE_ID]: {
        importedBy: MODULE_ID,
        slotId: item.sourceId === CLASS_UUID ? "class-level-1" : ORIGIN.slotId,
        ...(item.id === featureId
          ? {
              manualStaticItemGrants: [
                { key: "initiateBenefitWand", uuid: BENEFIT_UUID, choices: { initiateBenefitWand: "fire" } },
              ],
            }
          : {}),
      },
      pf2e: {
        ...(item.id === featureId || item.id === physicalId
          ? { grantedBy: { id: item.id === featureId ? selectorId : featureId } }
          : {}),
        itemGrants: item.id === featureId ? { wandImplement: { id: physicalId } } : {},
      },
    },
  }));
  const draft = createEmptyDraft(5);
  draft.applyAttemptStepIds = [ORIGIN.slotId];
  draft.applyRecoveryActorUpdate = { "system.details.level.value": 5 };
  draft.selections["class-level-1"] = selection(
    "class-level-1",
    "pf2e.classes",
    CLASS_UUID.split(".").at(-1)!,
    "class",
    "Thaumaturge"
  );
  draft.branchSelections[ORIGIN.slotId] = selection(
    ORIGIN.slotId,
    "pf2e.classfeatures",
    featureId,
    "feat",
    "Wand",
    "classfeature",
    5
  );
  draft.classChoices[CHOICE_SLOT] = "fire";
  draft.acquisition = {
    ...createAcquisitionDraft({
      draftId: "draft-47",
      batchId: "batch-47",
      manifestId: "manifest-47",
      targetLevel: 5,
      recipe: { kind: "permanent-items" },
    }),
    plannedClassGrants: [grant],
    baseline: createEconomicBaseline({
      actorId: "actor-47",
      capturedAt: "2026-10-14T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    }),
  };
  const branch = createClassBranchStep(5, {
    slotId: ORIGIN.slotId,
    selectorPackId: "pf2e.classfeatures",
    selectorDocumentId: selectorId,
    selectorUuid: ORIGIN.selectorUuid,
    selectorName: ORIGIN.selectorName,
    selectorRuleIndex: 0,
    grantRuleIndex: 1,
    flag: "implement",
    optionTag: "thaumaturge-implement",
    classSlug: "thaumaturge",
    dependsOn: "class",
  });
  const choice = createClassChoiceStep(5, {
    slotId: CHOICE_SLOT,
    sourcePackId: "pf2e.classfeatures",
    sourceDocumentId: "Initiate Benefit (Wand)",
    sourceUuid: BENEFIT_UUID,
    sourceName: "Initiate Benefit (Wand)",
    sourceRuleIndex: 1,
    flag: "initiateBenefitWand",
    classSlug: "thaumaturge",
    dependsOn: "class",
    options: ["cold", "electricity", "fire"].map((value) => ({ value, label: value, img: null, detail: null })),
  });
  setGamePacks({
    "pf2e.classes": { [classId]: { type: "class", name: "Thaumaturge", system: { slug: "thaumaturge", rules: [] } } },
    "pf2e.classfeatures": {
      [selectorId]: { ...documents[ORIGIN.selectorUuid], type: "feat", name: ORIGIN.selectorName },
      [featureId]: { ...documents[grant.granterSourceUuid], type: "feat", name: "Wand" },
      "Initiate Benefit (Wand)": {
        name: "Initiate Benefit (Wand)",
        type: "feat",
        system: {
          slug: "initiate-benefit-wand",
          rules: [
            { key: "RollOption", option: "feature:initiate-benefit-wand" },
            {
              key: "ChoiceSet",
              flag: "initiateBenefitWand",
              choices: choice.classChoice.options.map(({ value, label }) => ({ value, label })),
            },
          ],
        },
      },
    },
  });
  const selectorSelection: SelectionRef = {
    ...draft.branchSelections[ORIGIN.slotId],
    documentId: selectorId,
    uuid: ORIGIN.selectorUuid,
    name: ORIGIN.selectorName,
  };
  return { draft, items, grant, selectorId, featureId, selectorSelection, steps: [branch, choice] };
}
