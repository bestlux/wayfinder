import { BOOST_LEVELS, type EffectiveBuildState, getEffectiveBuildState, listActorItems } from "../build-state.js";
import type { ActorItemLike, ActorLike, LooseRecord } from "../shared/actor-model.js";
import { cloneData } from "../shared/cloning.js";
import { foundryDeleteValue } from "../shared/foundry-compat.js";
import type { DraftState } from "../types.js";

interface BoostApplicationDependencies {
  getEffectiveBuildState: typeof getEffectiveBuildState;
}

interface BoostApplicationOptions {
  persistActorUpdate?: boolean;
}

interface BoostApplicationResult {
  actorUpdate: Record<string, unknown>;
}

const DEFAULT_DEPS: BoostApplicationDependencies = {
  getEffectiveBuildState,
};

export async function applyBoostDraft(
  actor: ActorLike,
  draft: DraftState,
  deps: BoostApplicationDependencies = DEFAULT_DEPS,
  options: BoostApplicationOptions = {}
): Promise<BoostApplicationResult> {
  const buildState = await deps.getEffectiveBuildState(actor, draft);
  const updates: Record<string, unknown>[] = [];
  const actorItems = listActorItems(actor) as ActorItemLike[];

  const ancestryItem = actorItems.find((item) => item?.type === "ancestry");
  if (ancestryItem && buildState.ancestry) {
    const ancestryUpdate: Record<string, unknown> = { _id: ancestryItem.id };
    if (buildState.ancestry.mode === "alternate") {
      ancestryUpdate["system.alternateAncestryBoosts"] = buildState.ancestry.alternateBoosts;
    } else {
      ancestryUpdate["system.alternateAncestryBoosts"] = emptyAncestryFieldValue(
        ancestryItem.system,
        "alternateAncestryBoosts"
      );
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
      ancestryUpdate["system.voluntary.boost"] = emptyAncestryFieldValue(ancestryItem.system, "voluntary.boost");
    }

    updates.push(ancestryUpdate);
  }

  const backgroundItem = actorItems.find((item) => item?.type === "background");
  if (backgroundItem && buildState.background) {
    const backgroundUpdate: Record<string, unknown> = { _id: backgroundItem.id };
    for (const [slot, value] of Object.entries(buildState.background.selectedBoosts)) {
      backgroundUpdate[`system.boosts.${slot}.selected`] = value;
    }
    updates.push(backgroundUpdate);
  }

  const classItem = actorItems.find((item) => item?.type === "class");
  if (classItem && buildState.class) {
    updates.push({
      _id: classItem.id,
      "system.keyAbility.selected": buildState.class.selectedKeyAbility ?? null,
    });
  }

  if (updates.length > 0 && typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  const actorUpdate: Record<string, unknown> = {
    "system.build": buildActorBuildUpdate(actor, buildState.levelBoosts, draft.boosts.levels),
  };
  if (buildState.class?.selectedKeyAbility) {
    actorUpdate["system.details.keyability.value"] = buildState.class.selectedKeyAbility;
  }

  if (options.persistActorUpdate !== false && typeof actor.update === "function") {
    await actor.update(actorUpdate);
  }

  return { actorUpdate };
}

/** PF2E's required nullable ancestry fields must remain present when cleared. */
function emptyAncestryFieldValue(system: unknown, path: "alternateAncestryBoosts" | "voluntary.boost"): unknown {
  const model = system as
    | {
        readonly schema?: {
          readonly getField?: (
            path: string
          ) => { readonly required?: boolean; readonly nullable?: boolean } | undefined;
        };
      }
    | null
    | undefined;
  const schema = model?.schema;
  const field = typeof schema?.getField === "function" ? schema.getField(path) : undefined;
  return field?.required === true && field.nullable === true ? null : foundryDeleteValue();
}

type ActorWithSourceBuild = ActorLike & {
  _source?: {
    system?: {
      build?: unknown;
    };
  };
  toObject?: () => {
    system?: {
      build?: unknown;
    };
  };
};

function buildActorBuildUpdate(
  actor: ActorLike,
  levelBoosts: EffectiveBuildState["levelBoosts"],
  draftedLevelBoosts: DraftState["boosts"]["levels"]
): Record<string, unknown> {
  const sourceActor = actor as ActorWithSourceBuild;
  const sourceBuild =
    sourceActor.toObject?.().system?.build ?? sourceActor._source?.system?.build ?? actor.system?.build ?? {};
  const build = cloneData(sourceBuild) as Record<string, unknown>;
  const attributes = cloneData(
    build.attributes && typeof build.attributes === "object" ? build.attributes : {}
  ) as LooseRecord;
  const boosts =
    attributes.boosts && typeof attributes.boosts === "object"
      ? (cloneData(attributes.boosts) as Record<string, unknown>)
      : {};

  for (const level of BOOST_LEVELS) {
    if (Object.hasOwn(draftedLevelBoosts, String(level))) {
      boosts[level] = levelBoosts[level];
    }
  }

  attributes.boosts = boosts;
  build.attributes = attributes;
  return build;
}
