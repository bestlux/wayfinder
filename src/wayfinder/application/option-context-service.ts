import { projectedArchetypeFeat } from "../../pack/archetype-legality.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { findSpellcastingEntryForChoiceInItems } from "../../shared/spellcasting.js";
import type { DraftState, OptionContext, PendingStep, ProjectedArchetypeFeat, SelectionRef } from "../../types.js";
import {
  projectedClassArchetypeFeatSelections,
  projectedClassArchetypeStaticFeatSelections,
  withExistingClassArchetypeChoice,
} from "../class-archetype/registry.js";
import { projectDraftSkillRanks } from "../domain/skill-rank-projection.js";

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

export async function hasDedicationFeatInContext(args: HasDedicationContextDependencies): Promise<boolean> {
  const projected = await buildProjectedArchetypeFeats(args);
  return projected.some((feat) => feat.traits.includes("dedication"));
}

function draftedFeatLevel(selection: SelectionRef): number | null {
  const slotLevel = selection.slotId.match(/-level-(\d+)$/)?.[1];
  return numericLevel(slotLevel) ?? numericLevel(selection.level);
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
  const rollOptions = buildActiveRollOptions(effectiveDraft, deps.steps ?? [], actorItems);
  const skillRanks = buildProjectedSkillRanks(
    deps.skillRanks,
    effectiveDraft,
    deps.steps ?? [],
    skillProjectionBoundarySlotId(deps.maximumFeatLevel)
  );
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
    ...(skillRanks ? { skillRanks } : {}),
    projectedArchetypeFeats,
  };
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

  return [...actorFeats, ...draftedFeats].filter(
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

function buildActiveRollOptions(draft: DraftState, steps: PendingStep[], actorItems: unknown[]): string[] {
  return Array.from(
    new Set([...collectDraftRollOptions(draft, steps), ...collectActorRuleSelectionRollOptions(actorItems)])
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

function collectActorRuleSelectionRollOptions(actorItems: unknown[]): string[] {
  return actorItems.flatMap((item) => {
    const typedItem = item as LooseItem | null;
    const rules = Array.isArray(typedItem?.system?.rules) ? typedItem.system.rules : [];
    const rulesSelections = {
      ...(typedItem?.flags?.system?.rulesSelections ?? {}),
      ...(typedItem?.flags?.pf2e?.rulesSelections ?? {}),
    };

    return rules.flatMap((rule) => {
      if (!isRecord(rule) || rule.key !== "ChoiceSet") {
        return [];
      }

      const flag = normalizeString(rule.flag) ?? normalizeString(rule.rollOption) ?? normalizeString(rule.slug);
      const rollOption = normalizeString(rule.rollOption);
      const selection = flag ? normalizeString(rulesSelections[flag]) : null;
      return rollOption && selection ? [`${rollOption}:${selection}`] : [];
    });
  });
}

function buildProjectedSkillRanks(
  baseRanks: Record<string, number> | undefined,
  draft: DraftState,
  steps: PendingStep[],
  beforeSlotId: string | undefined
): Record<string, number> | null {
  const additionalTrainingSkillsBySlotId: Record<string, unknown[]> = {};
  for (const step of steps) {
    if (step.kind !== "skill-training") {
      continue;
    }

    const training = draft.skillTrainings[step.slotId];
    if (!training) {
      continue;
    }

    additionalTrainingSkillsBySlotId[step.slotId] = [
      ...step.training.fixedSkills,
      ...step.training.fixedLores,
      ...step.training.loreChoices.map((choice) => training.loreChoices[choice.key]),
    ];
  }

  const projected = projectDraftSkillRanks({
    baseSkillRanks: baseRanks ?? {},
    draft,
    beforeSlotId,
    additionalTrainingSkillsBySlotId,
  });
  return Object.keys(projected).length > 0 ? projected : null;
}

function skillProjectionBoundarySlotId(maximumFeatLevel: number | undefined): string | undefined {
  return maximumFeatLevel === undefined ? undefined : `option-context-level-${maximumFeatLevel}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
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
      ? `Showing ${step.campaignFeat.sectionLabel} feats keyed to ${ancestryName}. Class-dependent feats are filtered against the drafted class.`
      : null;
  }

  switch (step.slotKind) {
    case "heritage": {
      const ancestryDocument = deps.resolveDocument("ancestry");
      const ancestryName = ((await ancestryDocument) as LooseDocument | null)?.name;
      return ancestryName
        ? `Showing ${ancestryName} heritages and versatile heritage options that remain legal for this draft.`
        : null;
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
        return `Showing ancestry feats keyed to ${ancestryName} plus versatile-heritage feats unlocked by ${heritageName}. Class-dependent feats are filtered against the drafted class.`;
      }
      if (ancestryName) {
        return `Showing ancestry feats keyed to ${ancestryName}. Class-dependent feats are filtered against the drafted class.`;
      }
      return null;
    }
    case "class-feat": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      if (!className) {
        return null;
      }

      return context.hasDedicationFeat
        ? `Showing feats keyed to ${className} plus legal archetype follow-up feats unlocked by projected dedications. Shared class feats that list ${className} also remain available. Special dedication exceptions, unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.`
        : `Showing feats keyed to ${className} plus dedications legal for the projected draft. Shared class feats that list ${className} also remain available. Unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.`;
    }
    case "archetype-feat":
      return context.hasDedicationFeat
        ? "Showing Free Archetype feats legal for resolved dedication families, standard lockouts, duplicates, current-class multiclass limits, and supported skill-rank prerequisites. Special dedication exceptions, unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation."
        : "Showing dedications legal for the projected draft, including current-class multiclass limits and supported skill-rank prerequisites. Unresolved family metadata, access, and unsupported free-text prerequisites still require GM confirmation.";
    case "class-branch": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      const selectorName = step.branch?.selectorName;
      if (step.branch?.optionTag === "champion-cause") {
        if (!context.deitySelected) {
          return "Resolve the deity step first so Wayfinder can narrow champion causes to the legal sanctification path.";
        }

        const sanctificationLabel =
          context.sanctification === "holy"
            ? "holy"
            : context.sanctification === "unholy"
              ? "unholy"
              : context.sanctification === "none"
                ? "non-sanctified"
                : "currently unresolved";
        return className
          ? `Showing ${className} causes currently legal for the ${sanctificationLabel} sanctification state in this draft.`
          : null;
      }

      if (className && selectorName) {
        return `Showing ${className} options granted by ${selectorName}. Wayfinder will write the selector choice into PF2E's native class-feature data on apply.`;
      }

      return className ? `Showing class branch options keyed to ${className}.` : null;
    }
    case "deity": {
      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      return className
        ? `Showing deity choices currently legal for ${className}. Wayfinder will wire the selected deity into PF2E's native class-feature data on apply.`
        : null;
    }
    case "class-choice": {
      if (step.classChoice?.dependsOn === "deity") {
        const deityName = ((await deps.resolveDocument("deity")) as LooseDocument | null)?.name;
        return deityName
          ? `Showing choices unlocked by ${deityName}. Wayfinder will write this directly into the granting class feature on apply.`
          : "Resolve the deity step first so Wayfinder can narrow this class choice.";
      }

      const className = ((await deps.resolveDocument("class")) as LooseDocument | null)?.name;
      return className
        ? `Showing direct class-feature choices from ${className}. Wayfinder will write this directly into the granting class feature on apply.`
        : null;
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
        return "Resolve the arcane school step first so Wayfinder can narrow this list to the chosen curriculum.";
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
      const sourceLabel = spellChoice.sourceName || "Wizard Spellcasting";
      return `Showing ${rankLabel} that will be added to the ${spellChoice.destination.label}. Source: ${sourceLabel}. Daily prepared loadouts remain on PF2E's character sheet.`;
    }
    case "skill-feat":
      return "Showing baseline skill feats. Archetype-tagged skill feats stay hidden until Wayfinder tracks a specific archetype path.";
    case "general-feat":
      return "Showing the full general-feat pool from the enabled compendia. Wayfinder does not narrow this step by ancestry or class draft.";
    default:
      return null;
  }
}
