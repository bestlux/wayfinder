import { listActorItems } from "../build-state.js";
import { MODULE_ID } from "../constants.js";
import type { SelectorActorLike, SelectorApplicationDependencies } from "../selector-application.js";
import type { ActorItemLike, EmbeddedItemSource } from "../shared/actor-model.js";
import { cloneData } from "../shared/cloning.js";
import { itemMatchesSourceId } from "../shared/source-id.js";
import type { DraftState, PendingStep } from "../types.js";
import {
  assertVindicatorTracklessChoice,
  hasVindicatorProfile,
  materializeVindicatorTracklessTerrain,
  TRACKLESS_JOURNEY_UUID,
  VINDICATOR_TRACKLESS_FLAG,
  vindicatorTracklessSelection,
} from "../wayfinder/class-archetype/vindicator.js";

export async function applyVindicatorTracklessJourneyDraft(
  actor: SelectorActorLike,
  draft: DraftState,
  steps: PendingStep[],
  deps: SelectorApplicationDependencies
): Promise<void> {
  for (const step of steps) {
    if (step.kind !== "class-choice" || !step.classChoice.profileChoice) continue;
    const terrain = draft.classChoices[step.slotId];
    if (!terrain) continue;
    const selection = vindicatorTracklessSelection();
    const preparedSource = await deps.createEmbeddedSource(selection, draft, steps);
    const items = listActorItems(actor) as ActorItemLike[];
    assertVindicatorTracklessChoice(
      step,
      terrain,
      preparedSource,
      hasVindicatorProfile(draft, items) ? "vindicator" : null,
      draft.targetLevel,
      items
    );
    const matches = items.filter((item) => itemMatchesSourceId(item, TRACKLESS_JOURNEY_UUID));
    if (matches.length > 1)
      throw new Error("Cannot persist Trackless Journey terrain: duplicate feature sources exist.");
    const existing = matches[0];
    const toObject = existing?.toObject;
    const source = cloneData(
      typeof toObject === "function" ? (toObject.call(existing) as EmbeddedItemSource) : (existing ?? preparedSource!)
    );
    materializeVindicatorTracklessTerrain(source, terrain);
    if (existing?.id) {
      await actor.updateEmbeddedDocuments("Item", [
        {
          _id: existing.id,
          [`flags.${MODULE_ID}.${VINDICATOR_TRACKLESS_FLAG}`]: terrain,
          "system.description": source.system?.description,
        },
      ]);
    } else {
      const created = await actor.createEmbeddedDocuments("Item", [source]);
      if (created.length !== 1 || !itemMatchesSourceId(created[0], TRACKLESS_JOURNEY_UUID)) {
        throw new Error("Cannot persist Trackless Journey terrain: its feature was not created.");
      }
    }
  }
}
