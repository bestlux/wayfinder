import type { EffectiveBuildState } from "../../build-state.js";
import type { AbilityKey } from "../../types.js";

type BoostRecord = Record<string, { value: AbilityKey[]; selected: AbilityKey | null }>;

export function requiredBoostSlots(record: BoostRecord | undefined): number {
  return Object.values(record ?? {}).filter((boost) => Array.isArray(boost?.value) && boost.value.length > 0).length;
}

export function canChooseFromSlotRecord(
  record: BoostRecord | undefined,
  selectedBoosts: Record<string, AbilityKey | null>,
  attribute: AbilityKey
): boolean {
  return Object.entries(record ?? {}).some(
    ([slot, boost]) =>
      (!selectedBoosts[slot] || selectedBoosts[slot] === attribute) &&
      Array.isArray(boost?.value) &&
      boost.value.includes(attribute)
  );
}

export function isAncestryBoostSectionComplete(buildState: EffectiveBuildState): boolean {
  const ancestry = buildState.ancestry;
  if (!ancestry) {
    return false;
  }

  return ancestry.mode === "alternate"
    ? ancestry.alternateBoosts.length === 2
    : Object.values(ancestry.selectedBoosts).filter((value) => value !== null).length ===
        requiredBoostSlots(ancestry.document?.system?.boosts);
}

export function isBackgroundBoostSectionComplete(buildState: EffectiveBuildState): boolean {
  const background = buildState.background;
  if (!background) {
    return false;
  }

  return background.buildBoosts.length === requiredBoostSlots(background.document?.system?.boosts);
}

export function isClassBoostSectionComplete(buildState: EffectiveBuildState): boolean {
  return !!buildState.class?.selectedKeyAbility;
}

export function remainingCreationBoostChoices(buildState: EffectiveBuildState): number {
  const ancestryRemaining = buildState.ancestry
    ? buildState.ancestry.mode === "alternate"
      ? Math.max(0, 2 - buildState.ancestry.alternateBoosts.length)
      : Math.max(
          0,
          requiredBoostSlots(buildState.ancestry.document?.system?.boosts) -
            Object.values(buildState.ancestry.selectedBoosts).filter((value) => value !== null).length
        )
    : 1;
  const backgroundRemaining = buildState.background
    ? Math.max(
        0,
        requiredBoostSlots(buildState.background.document?.system?.boosts) - buildState.background.buildBoosts.length
      )
    : 1;
  const classRemaining = buildState.class?.selectedKeyAbility ? 0 : 1;
  const levelRemaining = Math.max(0, buildState.allowedBoosts[1] - buildState.levelBoosts[1].length);
  return ancestryRemaining + backgroundRemaining + classRemaining + levelRemaining;
}
