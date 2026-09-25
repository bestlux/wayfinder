import { MODULE_ID } from "../../constants.js";
import type { EmbeddedItemSource } from "../../shared/actor-model.js";
import { itemMatchesSourceId } from "../../shared/source-id.js";
import type { ClassChoiceMeta, DraftState, PendingStep, SelectionRef } from "../../types.js";
import { createClassChoiceStep } from "../domain/step-types.js";

export const VINDICATOR_UUID = "Compendium.pf2e.classfeatures.Item.QOOwC3S41CKGkxlN";
export const TRACKLESS_JOURNEY_UUID = "Compendium.pf2e.classfeatures.Item.PeZi7E9lI4vz8EGY";
export const VINDICATOR_TRACKLESS_SLOT = "class-choice-vindicator-trackless-journey-level-5";
export const VINDICATOR_TRACKLESS_FLAG = "tracklessJourneyTerrain";
export type VindicatorTerrain = "urban" | "natural";

export function hasVindicatorProfile(draft: DraftState, actorItems: readonly unknown[]): boolean {
  return Object.keys(draft.classArchetypeChoices).length > 0
    ? Object.values(draft.classArchetypeChoices).includes("vindicator")
    : actorItems.some((item) => itemMatchesSourceId(item, VINDICATOR_UUID));
}

export function vindicatorTracklessSelection(): SelectionRef {
  return {
    slotId: VINDICATOR_TRACKLESS_SLOT,
    packId: "pf2e.classfeatures",
    documentId: "PeZi7E9lI4vz8EGY",
    uuid: TRACKLESS_JOURNEY_UUID,
    itemType: "feat",
    featType: "classfeature",
    name: "Trackless Journey",
    slug: "trackless-journey",
    level: 5,
  };
}

export function readVindicatorTracklessTerrain(actorItems: readonly unknown[]): VindicatorTerrain | null {
  const values = actorItems
    .filter((item) => itemMatchesSourceId(item, TRACKLESS_JOURNEY_UUID))
    .map((item) => (item as EmbeddedItemSource).flags?.[MODULE_ID]?.[VINDICATOR_TRACKLESS_FLAG]);
  return values.length === 1 && isVindicatorTerrain(values[0]) ? values[0] : null;
}

export function buildVindicatorTracklessJourneySteps(args: {
  draft: DraftState;
  actorItems: readonly unknown[];
  targetLevel: number;
}): PendingStep[] {
  if (args.targetLevel < 5 || !hasVindicatorProfile(args.draft, args.actorItems)) return [];
  if (!args.draft.classChoices[VINDICATOR_TRACKLESS_SLOT] && readVindicatorTracklessTerrain(args.actorItems)) return [];
  const selection = vindicatorTracklessSelection();
  return [
    createClassChoiceStep(
      5,
      {
        slotId: VINDICATOR_TRACKLESS_SLOT,
        sourcePackId: selection.packId,
        sourceDocumentId: selection.documentId,
        sourceUuid: selection.uuid,
        sourceName: selection.name,
        sourceRuleIndex: -1,
        profileChoice: "vindicator-trackless-journey",
        flag: VINDICATOR_TRACKLESS_FLAG,
        classSlug: "ranger",
        dependsOn: "class",
        options: [
          { value: "natural", label: "Natural terrain", img: null, detail: "Leave no tracks in natural terrain." },
          { value: "urban", label: "Urban terrain", img: null, detail: "Leave no tracks in urban terrain." },
        ],
      },
      {
        title: "Trackless Journey terrain",
        description: "Choose whether your vindicator's Trackless Journey benefits apply in natural or urban terrain.",
      }
    ),
  ];
}

export function assertVindicatorTracklessChoice(
  step: PendingStep,
  value: unknown,
  source: EmbeddedItemSource | null | undefined,
  activeProfileValue: string | null | undefined,
  targetLevel: number,
  actorItems: readonly unknown[] = []
): asserts value is VindicatorTerrain {
  const meta = step.classChoice;
  if (
    activeProfileValue !== "vindicator" ||
    targetLevel < 5 ||
    step.kind !== "class-choice" ||
    step.level !== 5 ||
    step.slotId !== VINDICATOR_TRACKLESS_SLOT ||
    !isVindicatorTracklessMeta(meta) ||
    !isVindicatorTerrain(value) ||
    source?.type !== "feat" ||
    source.system?.category !== "classfeature" ||
    source.system?.level?.value !== 5 ||
    (typeof source._id === "string" && source._id !== "PeZi7E9lI4vz8EGY") ||
    (Array.isArray(source.system.rules) && source.system.rules.length !== 0) ||
    actorItems.filter((item) => itemMatchesSourceId(item, TRACKLESS_JOURNEY_UUID)).length > 1
  ) {
    throw new Error(
      "Cannot persist Trackless Journey terrain: its Vindicator profile or feature authority has changed."
    );
  }
}

export function isVindicatorTracklessMeta(meta: ClassChoiceMeta | undefined): boolean {
  return (
    meta?.profileChoice === "vindicator-trackless-journey" &&
    meta.slotId === VINDICATOR_TRACKLESS_SLOT &&
    meta.sourcePackId === "pf2e.classfeatures" &&
    meta.sourceDocumentId === "PeZi7E9lI4vz8EGY" &&
    meta.sourceUuid === TRACKLESS_JOURNEY_UUID &&
    meta.sourceRuleIndex === -1 &&
    meta.flag === VINDICATOR_TRACKLESS_FLAG &&
    meta.classSlug === "ranger"
  );
}

export function materializeVindicatorTracklessTerrain(source: EmbeddedItemSource, terrain: VindicatorTerrain): void {
  source.flags ??= {};
  source.flags[MODULE_ID] ??= {};
  source.flags[MODULE_ID][VINDICATOR_TRACKLESS_FLAG] = terrain;
  source.system ??= {};
  const description = source.system.description as { value?: unknown } | undefined;
  const current = typeof description?.value === "string" ? description.value : "";
  const withoutPreviousNote = current.replace(/<p><strong>Vindicator terrain:<\/strong>[^<]*<\/p>/gu, "").trim();
  source.system.description = {
    ...description,
    value: `${withoutPreviousNote}<p><strong>Vindicator terrain:</strong> ${terrain === "urban" ? "For this vindicator, Trackless Journey applies in urban terrain instead of natural terrain." : "This vindicator uses Trackless Journey in natural terrain."}</p>`,
  };
}

function isVindicatorTerrain(value: unknown): value is VindicatorTerrain {
  return value === "urban" || value === "natural";
}
