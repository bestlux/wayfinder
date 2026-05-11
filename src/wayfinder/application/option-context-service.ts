import type { DraftState, OptionContext, PendingStep, SelectionRef } from "../../types.js";

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
  type?: string;
  system?: {
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
  const { draft, listActorItems, fetchSelectionDocument, extractDocumentSlug } = args;
  const actorHasDedication = listActorItems().some(
    (item) =>
      (item as LooseItem | null)?.type === "feat" &&
      extractContextTraits(item, extractDocumentSlug).includes("dedication")
  );
  if (actorHasDedication) {
    return true;
  }

  const draftedFeatSelections = Object.values(draft.selections).filter((selection) => selection.itemType === "feat");
  if (draftedFeatSelections.length === 0) {
    return false;
  }

  const draftedFeatDocuments = await Promise.all(
    draftedFeatSelections.map((selection) => fetchSelectionDocument(selection))
  );
  return draftedFeatDocuments.some((document) =>
    extractContextTraits(document, extractDocumentSlug).includes("dedication")
  );
}

export async function buildOptionContext(deps: OptionContextDependencies): Promise<OptionContext> {
  const [ancestryDocument, heritageDocument, classDocument, deityDocument, hasDedicationFeat] = await Promise.all([
    deps.resolveDocument("ancestry"),
    deps.resolveDocument("heritage"),
    deps.resolveDocument("class"),
    deps.resolveDocument("deity"),
    hasDedicationFeatInContext(deps),
  ]);

  const ancestrySlug = deps.extractDocumentSlug(ancestryDocument);
  const selectedUuidsBySlotId = buildSelectedUuidsBySlotId(deps.draft);
  const actorItems = deps.listActorItems();
  const rollOptions = buildActiveRollOptions(deps.draft, deps.steps ?? [], actorItems);
  const skillRanks = buildProjectedSkillRanks(deps.skillRanks, deps.draft, deps.steps ?? []);
  return {
    ancestrySlug,
    ancestryTraits: extractContextTraits(ancestryDocument, deps.extractDocumentSlug, ancestrySlug),
    heritageTraits: extractContextTraits(heritageDocument, deps.extractDocumentSlug),
    classSlug: deps.extractDocumentSlug(classDocument),
    classHasSpellcasting: classDocumentHasSpellcasting(classDocument),
    deitySelected: !!deityDocument,
    sanctification: resolveSanctificationChoice({
      draft: deps.draft,
      actorItems,
      deityDocument,
    }),
    hasDedicationFeat,
    ...(Object.keys(selectedUuidsBySlotId).length > 0 ? { selectedUuidsBySlotId } : {}),
    ...(rollOptions.length > 0 ? { rollOptions } : {}),
    ...(skillRanks ? { skillRanks } : {}),
  };
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

function normalizeSkillRanks(value: Record<string, number> | undefined): Record<string, number> | null {
  if (!value) {
    return null;
  }

  const entries = Object.entries(value).flatMap(([slug, rank]) => {
    const normalizedSlug = normalizeString(slug);
    const numericRank = Number(rank);
    return normalizedSlug && Number.isFinite(numericRank)
      ? [[normalizedSlug, Math.max(0, Math.min(4, Math.floor(numericRank)))] as const]
      : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function buildProjectedSkillRanks(
  baseRanks: Record<string, number> | undefined,
  draft: DraftState,
  steps: PendingStep[]
): Record<string, number> | null {
  const projected = normalizeSkillRanks(baseRanks) ?? {};

  for (const step of steps) {
    if (step.kind !== "skill-training") {
      continue;
    }

    const training = draft.skillTrainings[step.slotId];
    if (!training) {
      continue;
    }

    for (const skill of step.training.fixedSkills) {
      setMinimumRank(projected, skill, 1);
    }

    for (const choice of step.training.choiceRules) {
      setMinimumRank(projected, training.ruleChoices[choice.key], 1);
    }

    for (const skill of training.additional) {
      setMinimumRank(projected, skill, 1);
    }

    for (const lore of step.training.fixedLores) {
      setMinimumRank(projected, lore, 1);
    }

    for (const choice of step.training.loreChoices) {
      setMinimumRank(projected, training.loreChoices[choice.key], 1);
    }
  }

  for (const skill of Object.values(draft.skillIncreases)) {
    const slug = normalizeSkillSlug(skill);
    if (!slug) {
      continue;
    }
    setMinimumRank(projected, slug, (projected[slug] ?? 0) + 1);
  }

  return Object.keys(projected).length > 0 ? projected : null;
}

function setMinimumRank(ranks: Record<string, number>, rawSlug: unknown, rank: number): void {
  const slug = normalizeSkillSlug(rawSlug);
  if (!slug) {
    return;
  }

  ranks[slug] = Math.max(ranks[slug] ?? 0, rank);
}

function buildSelectedUuidsBySlotId(draft: DraftState): Record<string, string> {
  const entries = [...Object.entries(draft.selections), ...Object.entries(draft.branchSelections)]
    .map(([slotId, selection]) => [slotId, selection.uuid] as const)
    .filter(([, uuid]) => typeof uuid === "string" && uuid.length > 0);
  return Object.fromEntries(entries);
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
        ? `Showing feats keyed to ${className} plus archetype follow-up feats unlocked by an existing dedication. Shared class feats that list ${className} also remain available.`
        : `Showing feats keyed to ${className} plus dedication feats that can begin an archetype path. Shared class feats that list ${className} also remain available.`;
    }
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
