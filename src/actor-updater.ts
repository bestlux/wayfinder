import { applyBoostDraft } from "./actor-updater/boost-application.js";
import { applyLanguageChoiceDraft } from "./actor-updater/language-choice-application.js";
import { syncNativeClassSpellcasting } from "./actor-updater/native-spellcasting-application.js";
import {
  createEmbeddedSource,
  createSingletonGrantItems,
  createSingletonSystemGrantItems,
  featSelections,
  hasSourceId,
  insertFeatSelection,
  orderSelections,
  replaceSingletonItems,
  restoreSingletonSourceSlotFlags,
  singletonSelections,
} from "./actor-updater/selection-application.js";
import { applySingletonChoiceDraft } from "./actor-updater/singleton-choice-application.js";
import { applySpellChoiceDraft } from "./actor-updater/spell-choice-application.js";
import { applySkillIncreaseDraft, applyTrainingDraft } from "./actor-updater/training-application.js";
import { applyClassBranchDraft } from "./class-branch-service.js";
import { applyClassFeatureChoiceDraft } from "./class-feature-choice-service.js";
import { fetchSelectionDocument } from "./pack/access.js";
import type { SelectorActorLike } from "./selector-application.js";
import type { ActorLike } from "./shared/actor-model.js";
import { usesNativeGrantItemCreation } from "./shared/grant-creation-policy.js";
import type { DraftState, PendingStep } from "./types.js";

type DraftMutationActor = SelectorActorLike &
  ActorLike & {
    update?: ActorLike["update"];
  };

interface ApplyDraftOptions {
  deferActorUpdate?: boolean;
}

export async function applyDraftToActor(
  actor: DraftMutationActor,
  draft: DraftState,
  steps: PendingStep[],
  options: ApplyDraftOptions = {}
): Promise<Record<string, unknown>> {
  const selections = orderSelections(draft, steps);
  const stepsBySlotId = new Map(steps.map((step) => [step.slotId, step]));
  const deferredActorUpdate: Record<string, unknown> = {};

  await replaceSingletonItems(actor, singletonSelections(selections), draft, steps);
  await createSingletonSystemGrantItems(actor, draft, steps);
  await createSingletonGrantItems(actor, draft, steps);
  refreshActorData(actor);

  await applySingletonChoiceDraft(actor, draft, steps);
  await applyLanguageChoiceDraft(actor, draft, steps);
  const projectedTrainingRanks = await applyTrainingDraft(actor, draft, steps);
  await applyClassBranchDraft(actor, draft, steps, {
    createEmbeddedSource,
    fetchSelectionDocument,
  });
  await applyClassFeatureChoiceDraft(actor, draft, steps, {
    createEmbeddedSource,
    fetchSelectionDocument,
  });
  await syncNativeClassSpellcasting(actor, draft);

  for (const selection of featSelections(selections)) {
    const step = stepsBySlotId.get(selection.slotId);
    if (!step) {
      continue;
    }
    if (step.kind === "pick-item" && step.slotKind === "flag-choice") {
      continue;
    }
    if (usesNativeGrantItemCreation(step)) {
      continue;
    }
    if (hasSourceId(actor, selection.uuid)) {
      continue;
    }

    await insertFeatSelection(actor, selection, step, undefined, draft, steps);
  }

  await applySingletonChoiceDraft(actor, draft, steps);
  await applySpellChoiceDraft(actor, draft, steps);
  const boostResult = await applyBoostDraft(actor, draft, undefined, {
    persistActorUpdate: !options.deferActorUpdate,
  });
  Object.assign(deferredActorUpdate, boostResult.actorUpdate);
  await applySkillIncreaseDraft(actor, draft, projectedTrainingRanks);
  await restoreSingletonSourceSlotFlags(actor, draft);

  const currentLevel = Number(actor?.system?.details?.level?.value ?? 1) || 1;
  if (draft.targetLevel > currentLevel) {
    const levelUpdate = {
      "system.details.level.value": draft.targetLevel,
    };
    Object.assign(deferredActorUpdate, levelUpdate);
    if (!options.deferActorUpdate && typeof actor.update === "function") {
      await actor.update(levelUpdate);
    }
  }

  return deferredActorUpdate;
}

function refreshActorData(actor: DraftMutationActor): void {
  if (hasPreparedPf2eFlagAlias(actor)) {
    return;
  }

  actor.prepareData?.();
}

function hasPreparedPf2eFlagAlias(actor: DraftMutationActor): boolean {
  const flags = actor.flags;
  if (!flags || typeof flags !== "object") {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(flags, "system");
  return !!descriptor && descriptor.configurable === false;
}
