import { BOOST_LEVELS, getEffectiveBuildState, listActorItems } from "../build-state.js";
import type { DraftState } from "../types.js";

interface BoostApplicationDependencies {
  getEffectiveBuildState: typeof getEffectiveBuildState;
}

const DEFAULT_DEPS: BoostApplicationDependencies = {
  getEffectiveBuildState,
};

export async function applyBoostDraft(
  actor: any,
  draft: DraftState,
  deps: BoostApplicationDependencies = DEFAULT_DEPS
): Promise<void> {
  const buildState = await deps.getEffectiveBuildState(actor, draft);
  const updates: any[] = [];

  const ancestryItem = listActorItems(actor).find((item: any) => item?.type === "ancestry");
  if (ancestryItem && buildState.ancestry) {
    const ancestryUpdate: Record<string, unknown> = { _id: ancestryItem.id };
    if (buildState.ancestry.mode === "alternate") {
      ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
    } else {
      ancestryUpdate["system.-=alternateAncestryBoosts"] = null;
    }

    for (const [slot, value] of Object.entries(buildState.ancestry.selectedBoosts)) {
      ancestryUpdate[`system.boosts.${slot}.selected`] = value;
    }

    ancestryUpdate["system.voluntary.flaws"] = buildState.ancestry.voluntary.enabled
      ? buildState.ancestry.voluntary.flaws
      : [];
    if (buildState.ancestry.voluntary.enabled && buildState.ancestry.voluntary.legacy) {
      ancestryUpdate["system.voluntary.boost"] = buildState.ancestry.voluntary.boost;
    } else {
      ancestryUpdate["system.voluntary.-=boost"] = null;
    }

    updates.push(ancestryUpdate);
  }

  const backgroundItem = listActorItems(actor).find((item: any) => item?.type === "background");
  if (backgroundItem && buildState.background) {
    const backgroundUpdate: Record<string, unknown> = { _id: backgroundItem.id };
    for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
      backgroundUpdate[`system.boosts.${slot}.selected`] = value;
    }
    updates.push(backgroundUpdate);
  }

  const classItem = listActorItems(actor).find((item: any) => item?.type === "class");
  if (classItem && buildState.class) {
    updates.push({
      _id: classItem.id,
      "system.keyAbility.selected": buildState.class.selectedKeyAbility ?? null,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  const actorBoostUpdate = Object.fromEntries(
    BOOST_LEVELS.map((level) => [`system.build.attributes.boosts.${level}`, buildState.levelBoosts[level]])
  );
  await actor.update(actorBoostUpdate);
}
