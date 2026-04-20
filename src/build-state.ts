import { ABILITY_KEYS } from "./constants.js";
import { fetchSelectionDocument } from "./pack-service.js";
import { cloneData } from "./shared/cloning.js";
import type { AbilityKey, BoostDraftState, BoostLevel, DraftState, SelectionRef } from "./types.js";

const BOOST_LEVELS = [1, 5, 10, 15, 20] as const satisfies readonly BoostLevel[];

interface EffectiveBoostRecord {
  value: AbilityKey[];
  selected: AbilityKey | null;
}

interface EffectiveAncestryState {
  document: any;
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
  document: any;
  selectedBoosts: Record<string, AbilityKey | null>;
  buildBoosts: AbilityKey[];
}

interface EffectiveClassState {
  document: any;
  keyAbilityOptions: AbilityKey[];
  selectedKeyAbility: AbilityKey | null;
}

interface ProjectedAbilityState {
  key: AbilityKey;
  modifier: number;
  partial: boolean;
  boostCount: number;
  flawCount: number;
}

interface EffectiveBuildState {
  ancestry: EffectiveAncestryState | null;
  heritage: any | null;
  background: EffectiveBackgroundState | null;
  class: EffectiveClassState | null;
  deity: any | null;
  levelBoosts: Record<BoostLevel, AbilityKey[]>;
  allowedBoosts: Record<BoostLevel, number>;
  projectedAbilities: Record<AbilityKey, ProjectedAbilityState>;
}

async function getEffectiveBuildState(actor: any, draft: DraftState): Promise<EffectiveBuildState> {
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
  const projectedAbilities = buildProjectedAbilities({
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

async function getEffectiveSingletonDocument(
  actor: any,
  draft: DraftState,
  itemType: "ancestry" | "heritage" | "background" | "class" | "deity"
): Promise<any | null> {
  const draftSelection = findDraftSelectionByType(draft, itemType);
  if (draftSelection) {
    const draftDocument = await fetchSelectionDocument(draftSelection);
    if (draftDocument) {
      return toPlainDocument(draftDocument);
    }
  }

  const actorItem = listActorItems(actor).find((item: any) => item?.type === itemType);
  if (!actorItem) {
    return null;
  }

  const sourceDocument = await resolveSourceDocumentFromActorItem(actorItem, itemType);
  return toPlainDocument(sourceDocument ?? actorItem);
}

function findDraftSelectionByType(
  draft: DraftState,
  itemType: "ancestry" | "heritage" | "background" | "class" | "deity"
): SelectionRef | null {
  return Object.values(draft.selections).find((selection) => selection.itemType === itemType) ?? null;
}

function listActorItems(actor: any): any[] {
  if (Array.isArray(actor?.items?.contents)) {
    return actor.items.contents;
  }

  if (Array.isArray(actor?.items)) {
    return actor.items;
  }

  return [];
}

async function resolveSourceDocumentFromActorItem(
  actorItem: any,
  itemType: "ancestry" | "heritage" | "background" | "class" | "deity"
): Promise<any | null> {
  const sourceId = actorItem?.flags?.core?.sourceId;
  if (typeof sourceId !== "string" || !sourceId.startsWith("Compendium.")) {
    return null;
  }

  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(sourceId);
  const packId = match?.[1];
  const documentId = match?.[2];
  if (!packId || !documentId) {
    return null;
  }

  return fetchSelectionDocument({
    slotId: `${itemType}-level-1`,
    packId,
    documentId,
    uuid: sourceId,
    itemType,
    featType: null,
    name: actorItem.name ?? "",
    level: null,
  });
}

function toPlainDocument(document: any): any {
  if (!document) {
    return null;
  }

  if (typeof document.toObject === "function") {
    return cloneData(document.toObject());
  }

  return cloneData(document);
}

function buildEffectiveAncestryState(document: any, boosts: BoostDraftState): EffectiveAncestryState {
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

function buildEffectiveBackgroundState(document: any, boosts: BoostDraftState): EffectiveBackgroundState {
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

function buildEffectiveClassState(document: any, boosts: BoostDraftState): EffectiveClassState {
  const keyAbilityOptions = normalizeAbilityList(document?.system?.keyAbility?.value, 6);
  return {
    document,
    keyAbilityOptions,
    selectedKeyAbility: boosts.class.keyAbility ?? normalizeAbility(document?.system?.keyAbility?.selected),
  };
}

function buildEffectiveLevelBoosts(actor: any, boosts: BoostDraftState): Record<BoostLevel, AbilityKey[]> {
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

function buildProjectedAbilities({
  ancestryBoosts,
  ancestryFlaws,
  backgroundBoosts,
  classBoost,
  levelBoosts,
}: {
  ancestryBoosts: AbilityKey[];
  ancestryFlaws: AbilityKey[];
  backgroundBoosts: AbilityKey[];
  classBoost: AbilityKey | null;
  levelBoosts: Record<BoostLevel, AbilityKey[]>;
}): Record<AbilityKey, ProjectedAbilityState> {
  return Object.fromEntries(
    ABILITY_KEYS.map((key) => {
      const boostCount =
        countOccurrences(ancestryBoosts, key) +
        countOccurrences(backgroundBoosts, key) +
        (classBoost === key ? 1 : 0) +
        countOccurrences(levelBoosts[1], key) +
        countOccurrences(levelBoosts[5], key) +
        countOccurrences(levelBoosts[10], key) +
        countOccurrences(levelBoosts[15], key) +
        countOccurrences(levelBoosts[20], key);
      const flawCount = countOccurrences(ancestryFlaws, key);
      const netBoosts = boostCount - flawCount;
      const modifier = netBoosts <= 4 ? netBoosts : 4 + Math.floor((netBoosts - 4) / 2);
      const partial = netBoosts >= 5 && netBoosts % 2 === 1;

      return [
        key,
        {
          key,
          modifier,
          partial,
          boostCount,
          flawCount,
        },
      ];
    })
  ) as Record<AbilityKey, ProjectedAbilityState>;
}

function countOccurrences(list: AbilityKey[], ability: AbilityKey): number {
  return list.filter((entry) => entry === ability).length;
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

function normalizeVoluntaryState(value: BoostDraftState["ancestry"]["voluntary"]): EffectiveAncestryState["voluntary"] {
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
