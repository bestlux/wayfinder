import { mergeActorAndDraftArchetypeFeats, projectedArchetypeFeat } from "../../pack/archetype-legality.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntryForChoiceInItems } from "../../shared/spellcasting.js";
import type { DraftState, OptionContext, PendingStep, ProjectedArchetypeFeat, SelectionRef } from "../../types.js";
import {
  projectedClassArchetypeFeatSelections,
  projectedClassArchetypeStaticFeatSelections,
  withExistingClassArchetypeChoice,
} from "../class-archetype/registry.js";
import { compileSkillProgression, type SkillProgression } from "../domain/skill-progression.js";
import { projectDraftSkillRanks } from "../domain/skill-rank-projection.js";
import { withIndefiniteArticle } from "../formatting.js";
import { collectActorRuleSelectionRollOptions, collectSkillRankRollOptions } from "../projected-rule-options.js";
import { selectionTakenLevel } from "../selection-level.js";
import { projectRegisteredDynamicChoices } from "../singleton-choice/dynamic-choice-registry.js";
import { compileSkillPaneProgression } from "./build-skill-pane-service.js";

type SingletonItemType = "ancestry" | "heritage" | "background" | "class" | "deity";
type LooseDocument = {
  name?: string;
  system?: {
    slug?: string;
    ancestry?: { slug?: string | null } | null;
    sanctification?: {
      modal?: string;
      what?: unknown[];
    } | null;
    traits?: {
      value?: unknown[];
    } | null;
    spellcasting?: unknown;
  } | null;
};
type LooseItem = {
  name?: string;
  type?: string;
  system?: {
    level?: {
      taken?: unknown;
      value?: unknown;
    } | null;
    location?: unknown;
    rules?: unknown;
    traits?: {
      value?: unknown[];
    } | null;
  } | null;
  flags?: {
    pf2e?: {
      rulesSelections?: Record<string, unknown> | null;
    } | null;
    system?: {
      rulesSelections?: Record<string, unknown> | null;
    } | null;
  } | null;
};

interface SharedContextDependencies {
  draft: DraftState;
  steps?: PendingStep[];
  excludedFeatSlotId?: string;
  maximumFeatLevel?: number;
  skillRanks?: Record<string, number>;
  skillProgression?: SkillProgression;
  fetchSelectionDocument: (selection: SelectionRef) => Promise<unknown | null>;
  extractDocumentSlug: (document: unknown) => string | null;
}

interface HasDedicationContextDependencies extends SharedContextDependencies {
  listActorItems: () => unknown[];
}

interface OptionContextDependencies extends HasDedicationContextDependencies {
  resolveDocument: (itemType: SingletonItemType) => Promise<unknown | null>;
}

export function extractContextTraits(
  document: unknown,
  extractDocumentSlug: (document: unknown) => string | null,
  fallbackSlug?: string | null
): string[] {
  const typedDocument = document as LooseDocument | null;
  const traits = Array.isArray(typedDocument?.system?.traits?.value) ? typedDocument.system.traits.value : [];
  const normalized = new Set<string>(
    traits
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  const slug = fallbackSlug ?? extractDocumentSlug(document);
  if (slug) {
    normalized.add(slug);
  }

  return Array.from(normalized);
}

export function resolveSanctificationChoice(args: {
  draft: DraftState;
  actorItems: unknown[];
  deityDocument: unknown | null;
}): "holy" | "unholy" | "none" | null {
  const { draft, actorItems, deityDocument } = args;
  const drafted = Object.entries(draft.classChoices).find(([slotId]) =>
    /^class-choice-.+-sanctification-level-\d+$/.test(slotId)
  )?.[1];
  if (drafted === "holy" || drafted === "unholy" || drafted === "none") {
    return drafted;
  }

  const actorSelection =
    actorItems
      .map((item) => (item as LooseItem | null)?.flags?.pf2e?.rulesSelections?.sanctification)
      .find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
  if (actorSelection === "holy" || actorSelection === "unholy" || actorSelection === "none") {
    return actorSelection;
  }

  if (deityDocument === null) {
    return null;
  }
  const sanctification = (deityDocument as LooseDocument | null)?.system?.sanctification;
  if (!sanctification || typeof sanctification !== "object") {
    return "none";
  }

  const modal = typeof sanctification.modal === "string" ? sanctification.modal.trim().toLowerCase() : "";
  const values = Array.isArray(sanctification.what)
    ? sanctification.what.filter((value): value is string => typeof value === "string")
    : [];

  if (modal === "must" && values.length === 1) {
    const value = values[0]?.trim().toLowerCase();
    return value === "holy" || value === "unholy" ? value : "none";
  }

  if (values.length === 0) {
    return "none";
  }

  return null;
}

export async function resolveSelectionTraits(
  selection: SelectionRef | null,
  deps: Pick<SharedContextDependencies, "fetchSelectionDocument" | "extractDocumentSlug">
): Promise<string[]> {
  if (!selection) {
    return [];
  }

  const document = await deps.fetchSelectionDocument(selection);
  return extractContextTraits(document, deps.extractDocumentSlug);
}

export async function resolveSelectionSlug(
  selection: SelectionRef | null,
  deps: Pick<SharedContextDependencies, "fetchSelectionDocument" | "extractDocumentSlug">
): Promise<string | null> {
  if (!selection) {
    return null;
  }

  const document = await deps.fetchSelectionDocument(selection);
  return deps.extractDocumentSlug(document);
}

export async function resolveSelectionClassHasSpellcasting(
  selection: SelectionRef | null,
  deps: Pick<SharedContextDependencies, "fetchSelectionDocument" | "extractDocumentSlug">
): Promise<boolean> {
  if (!selection) {
    return false;
  }

  return classDocumentHasSpellcasting(await deps.fetchSelectionDocument(selection));
}

export async function hasDedicationFeatInContext(args: HasDedicationContextDependencies): Promise<boolean> {
  const projected = await buildProjectedArchetypeFeats(args);
  return projected.some((feat) => feat.traits.includes("dedication"));
}

function draftedFeatLevel(selection: SelectionRef): number | null {
  return selectionTakenLevel(selection);
}

function actorFeatLevel(item: unknown): number | null {
  const typedItem = item as LooseItem | null;
  const takenLevel = numericLevel(typedItem?.system?.level?.taken);
  if (takenLevel !== null) {
    return takenLevel;
  }

  const location = typedItem?.system?.location;
  const locationValue =
    typeof location === "string"
      ? location
      : typeof (location as { value?: unknown } | null)?.value === "string"
        ? String((location as { value: string }).value)
        : "";
  const locationLevel = numericLevel(locationValue.match(/-(\d+)$/)?.[1]);
  return locationLevel ?? numericLevel(typedItem?.system?.level?.value);
}

function isFeatAvailableByLevel(level: number | null, maximumFeatLevel: number | undefined): boolean {
  return maximumFeatLevel === undefined || level === null || level <= maximumFeatLevel;
}

function numericLevel(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 20 ? Math.floor(numeric) : null;
}

export async function buildOptionContext(deps: OptionContextDependencies): Promise<OptionContext> {
  const actorItems = deps.listActorItems();
  const effectiveDraft = withExistingClassArchetypeChoice(deps.draft, actorItems);
  const [ancestryDocument, heritageDocument, classDocument, deityDocument, projectedArchetypeFeats] = await Promise.all(
    [
      deps.resolveDocument("ancestry"),
      deps.resolveDocument("heritage"),
      deps.resolveDocument("class"),
      deps.resolveDocument("deity"),
      buildProjectedArchetypeFeats({
        ...deps,
        draft: effectiveDraft,
        listActorItems: () => actorItems,
      }),
    ]
  );
  const hasDedicationFeat = projectedArchetypeFeats.some((feat) => feat.traits.includes("dedication"));

  const ancestrySlug = deps.extractDocumentSlug(ancestryDocument);
  const selectedUuidsBySlotId = buildSelectedUuidsBySlotId(effectiveDraft);
  const selectedSpellChoicesBySlotId = buildSelectedSpellChoicesBySlotId(effectiveDraft, deps.steps ?? []);
  const actorSourceIds = buildActorSourceIds(actorItems);
  const actorSpellUuidsByDestinationKey = buildActorSpellUuidsByDestinationKey(actorItems, deps.steps ?? []);
  const skillProgression =
    deps.skillProgression ??
    ((deps.steps?.length ?? 0) > 0
      ? await compileSkillPaneProgression(effectiveDraft, {
          baseSkillRanks: deps.skillRanks ?? {},
          steps: deps.steps,
          resolveDocument: (itemType) => deps.resolveDocument(itemType),
          localize: (value) => value,
          mode: "editing",
        })
      : undefined);
  const skillRanks = buildProjectedSkillRanks(
    deps.skillRanks,
    effectiveDraft,
    deps.steps ?? [],
    deps.maximumFeatLevel,
    skillProgression
  );
  const rollOptions = buildActiveRollOptions(effectiveDraft, deps.steps ?? [], actorItems, skillRanks);
  const registeredDynamicChoices = projectRegisteredDynamicChoices([
    ...actorItems,
    ...(await resolveDraftBranchDocuments(effectiveDraft, deps)),
  ]);
  return {
    ancestrySlug,
    ancestryTraits: extractContextTraits(ancestryDocument, deps.extractDocumentSlug, ancestrySlug),
    heritageTraits: extractContextTraits(heritageDocument, deps.extractDocumentSlug),
    classSlug: deps.extractDocumentSlug(classDocument),
    classHasSpellcasting: classDocumentHasSpellcasting(classDocument),
    deitySelected: !!deityDocument,
    sanctification: resolveSanctificationChoice({
      draft: effectiveDraft,
      actorItems,
      deityDocument,
    }),
    hasDedicationFeat,
    ...(Object.keys(selectedUuidsBySlotId).length > 0 ? { selectedUuidsBySlotId } : {}),
    ...(Object.keys(selectedSpellChoicesBySlotId).length > 0 ? { selectedSpellChoicesBySlotId } : {}),
    ...(actorSourceIds.length > 0 ? { actorSourceIds } : {}),
    ...(Object.keys(actorSpellUuidsByDestinationKey).length > 0 ? { actorSpellUuidsByDestinationKey } : {}),
    ...(rollOptions.length > 0 ? { rollOptions } : {}),
    ...(Object.keys(registeredDynamicChoices).length > 0 ? { registeredDynamicChoices } : {}),
    ...(skillRanks ? { skillRanks } : {}),
    projectedArchetypeFeats,
  };
}

async function resolveDraftBranchDocuments(draft: DraftState, deps: SharedContextDependencies): Promise<unknown[]> {
  const selections = Object.values(draft.branchSelections).filter((selection) => {
    const level = selectionTakenLevel(selection);
    return deps.maximumFeatLevel === undefined || level === null || level <= deps.maximumFeatLevel;
  });
  const documents = await Promise.all(selections.map((selection) => deps.fetchSelectionDocument(selection)));
  return documents.filter((document): document is NonNullable<typeof document> => document !== null);
}

async function buildProjectedArchetypeFeats(args: HasDedicationContextDependencies): Promise<ProjectedArchetypeFeat[]> {
  const { draft, listActorItems, fetchSelectionDocument, extractDocumentSlug, excludedFeatSlotId, maximumFeatLevel } =
    args;
  const actorItems = listActorItems();
  const effectiveDraft = withExistingClassArchetypeChoice(draft, actorItems);
  const actorFeatItems = actorItems.filter((item) => {
    const traits = extractContextTraits(item, extractDocumentSlug);
    return (
      (item as LooseItem | null)?.type === "feat" &&
      (traits.includes("archetype") || traits.includes("dedication")) &&
      isFeatAvailableByLevel(actorFeatLevel(item), maximumFeatLevel)
    );
  });
  const draftedFeatSelections = [
    ...Object.values(effectiveDraft.selections).filter((selection) => selection.itemType === "feat"),
    ...projectedClassArchetypeFeatSelections(effectiveDraft, effectiveDraft.targetLevel),
  ].filter((selection) =>
    isDraftedFeatBeforeContext(selection, args.steps ?? [], excludedFeatSlotId, maximumFeatLevel)
  );

  const actorFeats = await Promise.all(
    actorFeatItems.map(async (item) => {
      const sourceUuid = sourceIdOf(item);
      const parts = sourceUuid ? parseCompendiumItemUuid(sourceUuid) : null;
      const sourceDocument = parts
        ? await fetchSelectionDocument({
            slotId: "actor-source",
            packId: parts.packId,
            documentId: parts.documentId,
            uuid: sourceUuid ?? "",
            itemType: "feat",
            featType: null,
            name: (item as LooseItem).name ?? "Unknown Feat",
            level: actorFeatLevel(item),
          })
        : null;
      return projectedArchetypeFeat(sourceDocument ?? item, parts?.packId ?? null, {
        uuid: sourceUuid,
        name: (item as LooseItem).name,
      });
    })
  );
  const draftedDocuments = await Promise.all(
    draftedFeatSelections.map(async (selection) => ({
      selection,
      document: await fetchSelectionDocument(selection),
    }))
  );
  const draftedFeats = draftedDocuments.map(({ selection, document }) =>
    projectedArchetypeFeat(document, selection.packId, {
      uuid: selection.uuid,
      name: selection.name,
      slug: selection.slug,
    })
  );

  return mergeActorAndDraftArchetypeFeats(actorFeats, draftedFeats).filter(
    (feat) => feat.traits.includes("archetype") || feat.traits.includes("dedication")
  );
}

function isDraftedFeatBeforeContext(
  selection: SelectionRef,
  steps: PendingStep[],
  excludedFeatSlotId: string | undefined,
  maximumFeatLevel: number | undefined
): boolean {
  if (selection.slotId === excludedFeatSlotId) {
    return false;
  }

  const currentIndex = excludedFeatSlotId ? steps.findIndex((step) => step.slotId === excludedFeatSlotId) : -1;
  const selectionIndex = steps.findIndex((step) => step.slotId === selection.slotId);
  if (currentIndex >= 0 && selectionIndex >= 0) {
    return selectionIndex < currentIndex;
  }

  const level = draftedFeatLevel(selection);
  if (!isFeatAvailableByLevel(level, maximumFeatLevel)) {
    return false;
  }
  if (!excludedFeatSlotId || maximumFeatLevel === undefined || level === null || level < maximumFeatLevel) {
    return true;
  }

  return featSlotPosition(selection.slotId) < featSlotPosition(excludedFeatSlotId);
}

function featSlotPosition(slotId: string): number {
  if (slotId.startsWith("class-feat-")) {
    return 1;
  }
  if (slotId.startsWith("archetype-feat-")) {
    return 2;
  }
  return 0;
}

function buildActorSourceIds(actorItems: unknown[]): string[] {
  return Array.from(
    new Set(
      actorItems
        .map((item) => sourceIdOf(item))
        .filter((sourceId): sourceId is string => typeof sourceId === "string" && sourceId.length > 0)
    )
  );
}

function buildActorSpellUuidsByDestinationKey(actorItems: unknown[], steps: PendingStep[]): Record<string, string[]> {
  const destinationByEntryId = new Map<string, string>();
  for (const step of steps) {
    if (step.kind !== "spell-choice") {
      continue;
    }

    const entry = findSpellcastingEntryForChoiceInItems(actorItems, step.spellChoice);
    if (typeof entry?.id === "string") {
      destinationByEntryId.set(entry.id, step.spellChoice.destination.key);
    }
  }

  const uuidsByDestination = new Map<string, Set<string>>();
  for (const item of actorItems) {
    const typed = item as {
      type?: unknown;
      system?: { location?: string | { value?: unknown } | null } | null;
    } | null;
    if (typed?.type !== "spell") {
      continue;
    }

    const rawLocation = typed.system?.location;
    const location =
      typeof rawLocation === "string"
        ? rawLocation
        : rawLocation && typeof rawLocation.value === "string"
          ? rawLocation.value
          : null;
    const destinationKey = location ? destinationByEntryId.get(location) : null;
    const sourceUuid = sourceIdOf(item);
    if (!destinationKey || !sourceUuid) {
      continue;
    }

    const uuids = uuidsByDestination.get(destinationKey) ?? new Set<string>();
    uuids.add(sourceUuid);
    uuidsByDestination.set(destinationKey, uuids);
  }

  return Object.fromEntries(
    Array.from(uuidsByDestination, ([destinationKey, uuids]) => [destinationKey, Array.from(uuids)] as const)
  );
}

function buildActiveRollOptions(
  draft: DraftState,
  steps: PendingStep[],
  actorItems: unknown[],
  skillRanks: Record<string, number> | null
): string[] {
  return Array.from(
    new Set([
      ...collectDraftRollOptions(draft, steps),
      ...collectActorRuleSelectionRollOptions(actorItems),
      ...collectSkillRankRollOptions(skillRanks),
    ])
  ).sort();
}

function collectDraftRollOptions(draft: DraftState, steps: PendingStep[]): string[] {
  const options: string[] = [];
  for (const step of steps) {
    if (step.kind === "singleton-choice") {
      const rollOption = normalizeString(step.singletonChoice.rollOption);
      const selection = normalizeString(draft.singletonChoices[step.slotId]);
      if (rollOption && selection) {
        options.push(`${rollOption}:${selection}`);
      }
      continue;
    }

    if (step.kind === "class-choice") {
      const rollOption = normalizeString(step.classChoice.rollOption ?? step.classChoice.flag);
      const selection = normalizeString(draft.classChoices[step.slotId]);
      if (rollOption && selection) {
        options.push(`${rollOption}:${selection}`);
      }
      continue;
    }

    if (step.kind === "class-branch") {
      const rollOption = normalizeString(step.branch?.rollOption);
      const selection = draft.branchSelections[step.slotId];
      const selectionSlug = normalizeSkillSlug(selection?.name);
      if (rollOption && selectionSlug) {
        options.push(`${rollOption}:${selectionSlug}`);
      }
      continue;
    }

    if (step.kind !== "skill-training") {
      continue;
    }

    const training = draft.skillTrainings[step.slotId];
    if (!training) {
      continue;
    }

    for (const choice of step.training.choiceRules) {
      const rollOption = normalizeString(choice.rollOption);
      const selection = normalizeString(training.ruleChoices[choice.key]);
      if (rollOption && selection) {
        options.push(`${rollOption}:${selection}`);
      }
    }
  }

  return options;
}

function buildProjectedSkillRanks(
  baseRanks: Record<string, number> | undefined,
  draft: DraftState,
  steps: PendingStep[],
  maximumLevel: number | undefined,
  skillProgression?: SkillProgression
): Record<string, number> | null {
  if (skillProgression) {
    let projected = skillProgression.ranksBeforeSteps;
    for (const step of steps) {
      if (maximumLevel !== undefined && step.level > maximumLevel) continue;
      const compiledStep = skillProgression.stepsBySlotId[step.slotId];
      if (compiledStep) projected = compiledStep.ranksAfter;
    }
    return Object.keys(projected).length > 0 ? { ...projected } : null;
  }
  if (steps.length === 0) {
    const projected = projectDraftSkillRanks({
      baseSkillRanks: baseRanks ?? {},
      draft,
      beforeSlotId: maximumLevel === undefined ? undefined : `option-context-level-${maximumLevel}`,
    });
    return Object.keys(projected).length > 0 ? projected : null;
  }
  const activeSteps = maximumLevel === undefined ? steps : steps.filter((step) => step.level <= maximumLevel);
  const validSkillSlugs = new Set([
    ...Object.keys(baseRanks ?? {}),
    ...Object.values(draft.skillIncreases),
    ...Object.values(draft.skillTrainings).flatMap((training) => [
      ...Object.values(training.ruleChoices),
      ...training.additional,
    ]),
    ...activeSteps.flatMap((step) =>
      step.kind === "skill-training"
        ? [
            ...step.training.fixedSkills,
            ...step.training.choiceRules.flatMap((choice) => choice.options.map((option) => option.slug)),
          ]
        : []
    ),
  ]);
  const projected = compileSkillProgression({
    baselineRanks: baseRanks ?? {},
    draft,
    steps: activeSteps,
    validSkillSlugs,
    mode: "editing",
  }).finalRanks;
  return Object.keys(projected).length > 0 ? projected : null;
}

function buildSelectedUuidsBySlotId(draft: DraftState): Record<string, string> {
  const entries = [
    ...Object.entries(draft.selections),
    ...Object.entries(draft.branchSelections),
    ...projectedClassArchetypeFeatSelections(draft, draft.targetLevel).map(
      (selection) => [selection.slotId, selection] as const
    ),
    ...projectedClassArchetypeStaticFeatSelections(draft, draft.targetLevel).map(
      (selection) => [selection.slotId, selection] as const
    ),
  ]
    .map(([slotId, selection]) => [slotId, selection.uuid] as const)
    .filter(([, uuid]) => typeof uuid === "string" && uuid.length > 0);
  return Object.fromEntries(entries);
}

function buildSelectedSpellChoicesBySlotId(
  draft: DraftState,
  steps: PendingStep[]
): NonNullable<OptionContext["selectedSpellChoicesBySlotId"]> {
  const destinationsBySlotId = new Map(
    steps.flatMap((step) =>
      step.kind === "spell-choice" ? [[step.slotId, step.spellChoice.destination.key] as const] : []
    )
  );
  return Object.fromEntries(
    Object.entries(draft.spellChoices).flatMap(([slotId, selections]) => {
      const destinationKey = destinationsBySlotId.get(slotId);
      if (!destinationKey) {
        return [];
      }
      const uuids = Array.from(
        new Set(
          selections
            .map((selection) => selection.uuid)
            .filter((uuid): uuid is string => typeof uuid === "string" && uuid.length > 0)
        )
      );
      return uuids.length > 0 ? [[slotId, { destinationKey, uuids }] as const] : [];
    })
  );
}

function classDocumentHasSpellcasting(document: unknown): boolean {
  const value = (document as LooseDocument | null)?.system?.spellcasting;
  return Number(value) > 0;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function normalizeSkillSlug(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function buildContextNote(
  step: PendingStep,
  context: OptionContext,
  deps: Pick<OptionContextDependencies, "resolveDocument">
): Promise<string | null> {
  if (
    step.slotKind === "campaign-feat" &&
    step.campaignFeat?.supported.length === 1 &&
    step.campaignFeat.supported[0] === "ancestry"
  ) {
    const ancestryName = ((await deps.resolveDocument("ancestry")) as LooseDocument | null)?.name;
    return ancestryName
      ? `${step.campaignFeat.sectionLabel} feats for ${ancestryName}. Anything that keys off your class is filtered against it.`
      : null;
  }

  switch (step.slotKind) {
    case "heritage": {
      const ancestryDocument = deps.resolveDocument("ancestry");
      const ancestryName = ((await ancestryDocument) as LooseDocument | null)?.name;
      return ancestryName ? `${ancestryName} heritages, plus the versatile heritages still open to this build.` : null;
    }
    case "ancestry-feat": {
      const [ancestryDocument, heritageDocument] = await Promise.all([
        deps.resolveDocument("ancestry"),
        deps.resolveDocument("heritage"),
      ]);
      const ancestryName = (ancestryDocument as LooseDocument | null)?.name;
      const heritage = heritageDocument as LooseDocument | null;
      const isVersatile = heritage?.system?.ancestry === null;
      const heritageName = isVersatile ? heritage?.name : null;
      if (ancestryName && heritageName) {
        return `Ancestry feats for ${ancestryName}, plus what ${heritageName} opens up. Anything that keys off your class is filtered against it.`;
      }
      if (ancestryName) {
        return `Ancestry feats for ${ancestryName}. Anything that keys off your class is filtered against it.`;
      }
      return null;
    }
    case "class-feat": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      if (!className) {
        return null;
      }

      const exceptionReview = archetypeExceptionReview(context);
      return context.hasDedicationFeat
        ? `${className} feats, the follow-ups your dedications unlock, and shared feats that list ${className}.${exceptionReview} Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`
        : `${className} feats, shared feats that list ${className}, and the dedications you currently qualify for. Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`;
    }
    case "archetype-feat":
      return context.hasDedicationFeat
        ? `Free Archetype feats that follow from the dedications you have taken, minus duplicates, lockouts, and multiclass limits.${archetypeExceptionReview(context)} Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.`
        : "Dedications you currently qualify for, with your own class's multiclass limits applied. Wayfinder cannot read every access rule or written-out prerequisite, so check the unusual ones with your GM.";
    case "class-branch": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      const selectorName = step.branch?.selectorName;
      if (step.branch?.optionTag === "champion-cause") {
        if (!context.deitySelected) {
          return "Pick your deity first. Which causes are open to you depends on it.";
        }

        if (!className) {
          return null;
        }
        if (context.sanctification === "holy" || context.sanctification === "unholy") {
          return `${className} causes open to ${withIndefiniteArticle(context.sanctification)} character.`;
        }
        if (context.sanctification === "none") {
          return `${className} causes open to a character with no sanctification.`;
        }
        return `${className} causes. Your sanctification is not settled yet, so this list may narrow later.`;
      }

      if (className && selectorName) {
        return `${className} options from ${selectorName}. Wayfinder writes your pick straight into the class feature.`;
      }

      return className ? `${className} class options.` : null;
    }
    case "deity": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      return className
        ? `Deities ${withIndefiniteArticle(className)} can follow. Wayfinder wires your choice into the class feature that needs it.`
        : null;
    }
    case "class-choice": {
      if (step.classChoice?.dependsOn === "deity") {
        const deityName = ((await deps.resolveDocument("deity")) as LooseDocument | null)?.name;
        return deityName ? `Choices ${deityName} opens up.` : "Pick your deity first. This choice depends on it.";
      }

      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      return className ? `Choices that come straight from your ${className} features.` : null;
    }
    case "spell-choice": {
      const spellChoice = step.spellChoice;
      if (!spellChoice) {
        return null;
      }

      if (
        spellChoice.dependsOn === "class-branch" &&
        spellChoice.curriculumSpellNames.length === 0 &&
        spellChoice.requiresCurriculum !== false
      ) {
        return "Pick your arcane school first. It sets the curriculum these spells come from.";
      }

      const tradition = spellChoice.destination.tradition;
      const rankLabel = spellChoice.cantrip
        ? spellChoice.destination.type === "innate"
          ? `${tradition} cantrips`
          : spellChoice.excludedTraditions?.length
            ? "cantrips outside your class tradition"
            : `${tradition} cantrips`
        : spellChoice.minRank === spellChoice.maxRank
          ? `rank ${spellChoice.maxRank} ${tradition} spells`
          : `${tradition} spells of rank ${spellChoice.minRank} to ${spellChoice.maxRank}`;
      return `Adding ${rankLabel} to your ${spellChoice.destination.label}. What you prepare each day stays on the PF2E sheet.`;
    }
    case "skill-feat":
      return "Baseline skill feats. Archetype skill feats stay hidden until Wayfinder can follow that archetype's path.";
    case "general-feat":
      return "Every general feat from your enabled compendia. Wayfinder does not narrow this one by ancestry or class.";
    default:
      return null;
  }
}

function archetypeExceptionReview(context: OptionContext): string {
  return context.projectedArchetypeFeats?.some((feat) => feat.unresolvedLockoutException)
    ? " Your build leans on a dedication exception your GM allowed, which Wayfinder does not handle on its own."
    : "";
}
