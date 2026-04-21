import { type ProjectedAbilityState, projectAbilities } from "./build-state/ability-projection.js";
import type { BuildStateActor, BuildStateDocument, EffectiveBoostRecord } from "./build-state/document-types.js";
import { getEffectiveSingletonDocument, listActorItems } from "./build-state/singleton-resolution.js";
import { ABILITY_KEYS } from "./constants.js";
import type { AbilityKey, BoostDraftState, BoostLevel, DraftState } from "./types.js";

const BOOST_LEVELS = [1, 5, 10, 15, 20] as const satisfies readonly BoostLevel[];

interface EffectiveAncestryState {
  document: BuildStateDocument;
  mode: "standard" | "alternate";
  selectedBoosts: Record<string, AbilityKey | null>;
  alternateBoosts: AbilityKey[];
  lockedBoosts: AbilityKey[];
  voluntary: {
    enabled: boolean;
    legacy: boolean;
    boost: AbilityKey | null;
    flaws: AbilityKey[];
  };
  buildBoosts: AbilityKey[];
  buildFlaws: AbilityKey[];
}

interface EffectiveBackgroundState {
  document: BuildStateDocument;
  selectedBoosts: Record<string, AbilityKey | null>;
  buildBoosts: AbilityKey[];
}

interface EffectiveClassState {
  document: BuildStateDocument;
  keyAbilityOptions: AbilityKey[];
  selectedKeyAbility: AbilityKey | null;
}

interface EffectiveBuildState {
  ancestry: EffectiveAncestryState | null;
  heritage: BuildStateDocument | null;
  background: EffectiveBackgroundState | null;
  class: EffectiveClassState | null;
  deity: BuildStateDocument | null;
  levelBoosts: Record<BoostLevel, AbilityKey[]>;
  allowedBoosts: Record<BoostLevel, number>;
  projectedAbilities: Record<AbilityKey, ProjectedAbilityState>;
}

async function getEffectiveBuildState(actor: BuildStateActor, draft: DraftState): Promise<EffectiveBuildState> {
  const [ancestryDocument, heritageDocument, backgroundDocument, classDocument, deityDocument] = await Promise.all([
    getEffectiveSingletonDocument(actor, draft, "ancestry"),
    getEffectiveSingletonDocument(actor, draft, "heritage"),
    getEffectiveSingletonDocument(actor, draft, "background"),
    getEffectiveSingletonDocument(actor, draft, "class"),
    getEffectiveSingletonDocument(actor, draft, "deity"),
  ]);

  const ancestry = ancestryDocument ? buildEffectiveAncestryState(ancestryDocument, draft.boosts) : null;
  const background = backgroundDocument ? buildEffectiveBackgroundState(backgroundDocument, draft.boosts) : null;
  const effectiveClass = classDocument ? buildEffectiveClassState(classDocument, draft.boosts) : null;
  const levelBoosts = buildEffectiveLevelBoosts(actor, draft.boosts);
  const allowedBoosts = buildAllowedBoosts(draft.targetLevel);
  const projectedAbilities = projectAbilities({
    ancestryBoosts: ancestry?.buildBoosts ?? [],
    ancestryFlaws: ancestry?.buildFlaws ?? [],
    backgroundBoosts: background?.buildBoosts ?? [],
    classBoost: effectiveClass?.selectedKeyAbility ?? null,
    levelBoosts,
  });

  return {
    ancestry,
    heritage: heritageDocument,
    background,
    class: effectiveClass,
    deity: deityDocument,
    levelBoosts,
    allowedBoosts,
    projectedAbilities,
  };
}

function buildEffectiveAncestryState(document: BuildStateDocument, boosts: BoostDraftState): EffectiveAncestryState {
  const boostEntries = Object.entries(document?.system?.boosts ?? {}) as Array<[string, EffectiveBoostRecord]>;
  const committedMode = Array.isArray(document?.system?.alternateAncestryBoosts) ? "alternate" : "standard";
  const mode = boosts.ancestry.modeTouched ? boosts.ancestry.mode : committedMode;
  const selectedBoosts = Object.fromEntries(
    boostEntries.map(([key, boost]) => [key, boosts.ancestry.selectedBoosts[key] ?? normalizeAbility(boost?.selected)])
  ) as Record<string, AbilityKey | null>;

  const lockedBoosts = boostEntries
    .flatMap(([, boost]) => (boost.value.length === 1 ? boost.value : []))
    .filter(isAbilityKey);
  const alternateBoosts =
    mode === "alternate"
      ? normalizeAbilityList(
          boosts.ancestry.modeTouched ? boosts.ancestry.alternateBoosts : document?.system?.alternateAncestryBoosts,
          2
        )
      : [];
  const voluntary = normalizeVoluntaryState(
    boosts.ancestry.voluntary.touched ? boosts.ancestry.voluntary : document?.system?.voluntary
  );

  const buildBoosts =
    mode === "alternate"
      ? [...alternateBoosts]
      : Object.values(selectedBoosts).filter((ability): ability is AbilityKey => ability !== null);
  if (voluntary.enabled && voluntary.legacy && voluntary.boost) {
    buildBoosts.push(voluntary.boost);
  }

  return {
    document,
    mode,
    selectedBoosts,
    alternateBoosts,
    lockedBoosts,
    voluntary,
    buildBoosts,
    buildFlaws: voluntary.enabled ? [...voluntary.flaws] : [],
  };
}

function buildEffectiveBackgroundState(
  document: BuildStateDocument,
  boosts: BoostDraftState
): EffectiveBackgroundState {
  const boostEntries = Object.entries(document?.system?.boosts ?? {}) as Array<[string, EffectiveBoostRecord]>;
  const selectedBoosts = Object.fromEntries(
    boostEntries.map(([key, boost]) => [
      key,
      boosts.background.selectedBoosts[key] ?? normalizeAbility(boost?.selected),
    ])
  ) as Record<string, AbilityKey | null>;

  return {
    document,
    selectedBoosts,
    buildBoosts: Object.values(selectedBoosts).filter((ability): ability is AbilityKey => ability !== null),
  };
}

function buildEffectiveClassState(document: BuildStateDocument, boosts: BoostDraftState): EffectiveClassState {
  const keyAbilityOptions = normalizeAbilityList(document?.system?.keyAbility?.value, 6);
  return {
    document,
    keyAbilityOptions,
    selectedKeyAbility: boosts.class.keyAbility ?? normalizeAbility(document?.system?.keyAbility?.selected),
  };
}

function buildEffectiveLevelBoosts(actor: BuildStateActor, boosts: BoostDraftState): Record<BoostLevel, AbilityKey[]> {
  const actorBuildBoosts = actor?.system?.build?.attributes?.boosts ?? {};
  return Object.fromEntries(
    BOOST_LEVELS.map((level) => {
      const draftSelection = boosts.levels[String(level)];
      const source = Array.isArray(draftSelection) ? draftSelection : actorBuildBoosts[level];
      return [level, normalizeAbilityList(source, 4)];
    })
  ) as Record<BoostLevel, AbilityKey[]>;
}

function buildAllowedBoosts(targetLevel: number): Record<BoostLevel, number> {
  return Object.fromEntries(BOOST_LEVELS.map((level) => [level, level <= targetLevel ? 4 : 0])) as Record<
    BoostLevel,
    number
  >;
}

function normalizeAbility(value: unknown): AbilityKey | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isAbilityKey(normalized) ? normalized : null;
}

function normalizeAbilityList(value: unknown, maxLength = 6): AbilityKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((entry) => normalizeAbility(entry)).filter((entry): entry is AbilityKey => entry !== null))
  ).slice(0, maxLength);
}

function normalizeVoluntaryState(
  value: Partial<BoostDraftState["ancestry"]["voluntary"]> | undefined
): EffectiveAncestryState["voluntary"] {
  const legacy =
    value?.legacy === true ||
    (typeof value?.legacy !== "boolean" && Object.prototype.hasOwnProperty.call(value ?? {}, "boost"));
  const flaws = Array.isArray(value?.flaws)
    ? value.flaws
        .map((entry) => normalizeAbility(entry))
        .filter((entry): entry is AbilityKey => entry !== null)
        .slice(0, legacy ? 2 : 6)
    : [];
  const boost = normalizeAbility(value?.boost);
  return {
    enabled: value?.enabled === true || legacy || flaws.length > 0 || boost !== null,
    legacy,
    boost,
    flaws,
  };
}

function isAbilityKey(value: unknown): value is AbilityKey {
  return typeof value === "string" && ABILITY_KEYS.includes(value as AbilityKey);
}

export type { EffectiveBuildState, ProjectedAbilityState };
export { BOOST_LEVELS, getEffectiveBuildState, getEffectiveSingletonDocument, listActorItems };
