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
    traits?: {
      value?: unknown[];
    } | null;
  } | null;
  flags?: {
    pf2e?: {
      rulesSelections?: {
        sanctification?: unknown;
      } | null;
    } | null;
  } | null;
};

interface SharedContextDependencies {
  draft: DraftState;
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
  return {
    ancestrySlug,
    ancestryTraits: extractContextTraits(ancestryDocument, deps.extractDocumentSlug, ancestrySlug),
    heritageTraits: extractContextTraits(heritageDocument, deps.extractDocumentSlug),
    classSlug: deps.extractDocumentSlug(classDocument),
    classHasSpellcasting: classDocumentHasSpellcasting(classDocument),
    deitySelected: !!deityDocument,
    sanctification: resolveSanctificationChoice({
      draft: deps.draft,
      actorItems: deps.listActorItems(),
      deityDocument,
    }),
    hasDedicationFeat,
  };
}

function classDocumentHasSpellcasting(document: unknown): boolean {
  const value = (document as LooseDocument | null)?.system?.spellcasting;
  return Number(value) > 0;
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

      if (spellChoice.dependsOn === "class-branch" && spellChoice.curriculumSpellNames.length === 0) {
        return "Resolve the arcane school step first so Wayfinder can narrow this list to the chosen curriculum.";
      }

      const rankLabel = spellChoice.cantrip
        ? spellChoice.destination.type === "innate"
          ? `${spellChoice.destination.tradition} cantrips`
          : spellChoice.excludedTraditions?.length
            ? "cantrips outside your class tradition"
            : "arcane cantrips"
        : spellChoice.minRank === spellChoice.maxRank
          ? `rank ${spellChoice.maxRank} arcane spells`
          : `arcane spells of rank ${spellChoice.minRank} to ${spellChoice.maxRank}`;
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
