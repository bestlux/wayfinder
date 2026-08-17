import type { PendingStep, SelectionRef, SpellChoicePublication } from "../../types.js";
import { selectionTakenLevel } from "../selection-level.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
import type { ReadExistingSpellChoiceSelections, SpellChoiceClassDocument, SpellChoiceDocumentLike } from "./types.js";

interface FeatSpellChoiceSource {
  sourceSelection: SelectionRef;
  sourceDocument: unknown;
}

interface ClassSpellcastingProfile {
  classSlug: string;
  tradition: string;
  ability: string;
  destinationKey: string;
  destinationLabel: string;
  entryName: string;
}

const NECROMANCER_DEDICATION_UUID = "Compendium.pf2e.feats-srd.Item.Tt6WVxyR4YjmvZLO";

export function buildFeatSpellChoiceSteps(args: {
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  effectiveClassDocument: SpellChoiceClassDocument | null;
  featSources: FeatSpellChoiceSource[];
  extractSlug: (document: SpellChoiceDocumentLike | null) => string | null;
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
}): PendingStep[] {
  const classProfile = classSpellcastingProfile(args.effectiveClassDocument, args.extractSlug);
  const steps: PendingStep[] = [];
  for (const source of args.featSources) {
    if (source.sourceSelection.uuid === NECROMANCER_DEDICATION_UUID) {
      appendFeatSpellChoiceStep({
        steps,
        draft: args.draft,
        readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
        source,
        title: "Necromancer dirge cantrips",
        description: "Choose the four common occult cantrips in your necromancer dirge. You can prepare two each day.",
        classSlug: null,
        dependsOn: null,
        count: 4,
        destination: {
          type: "spellbook",
          key: "necromancer-occult-dirge",
          entryReuse: "key-only",
          preparedCantripSlots: 2,
          label: "Necromancer dirge",
          entryName: "Necromancer Dirge",
          tradition: "occult",
          ability: "int",
          prepared: "prepared",
        },
      });
      continue;
    }

    if (classProfile && isAdaptedCantripDocument(source.sourceDocument)) {
      appendFeatSpellChoiceStep({
        steps,
        draft: args.draft,
        readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
        source,
        title: "Adapted cantrip",
        description: "Choose the cantrip this feat adapts from a magical tradition other than your class tradition.",
        classSlug: classProfile.classSlug,
        dependsOn: "class",
        excludedTraditions: [classProfile.tradition],
        destination: {
          type: "spellbook",
          key: classProfile.destinationKey,
          label: classProfile.destinationLabel,
          entryName: classProfile.entryName,
          tradition: classProfile.tradition,
          ability: classProfile.ability,
          prepared: "prepared",
        },
      });
      continue;
    }

    const innateCantripSlugs = extractInnateArcaneCantripSlugs(source.sourceDocument);
    if (innateCantripSlugs.length > 0) {
      appendFeatSpellChoiceStep({
        steps,
        draft: args.draft,
        readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
        source,
        title: source.sourceSelection.name,
        description: "Choose the cantrip this feat grants as an innate arcane spell.",
        classSlug: null,
        dependsOn: null,
        allowedSpellSlugs: innateCantripSlugs,
        destination: {
          type: "innate",
          key: `feat-${source.sourceSelection.documentId}-innate-arcane`,
          label: "Innate arcane spells",
          entryName: "Innate Arcane Spells",
          tradition: "arcane",
          ability: "cha",
          prepared: "innate",
        },
      });
    }
  }

  return steps;
}

function appendFeatSpellChoiceStep(args: {
  steps: PendingStep[];
  draft: Parameters<typeof appendPendingSpellChoiceStep>[2];
  readExistingSpellChoiceSelections: ReadExistingSpellChoiceSelections;
  source: FeatSpellChoiceSource;
  title: string;
  description: string;
  classSlug: string | null;
  dependsOn: "class" | null;
  count?: number;
  allowedSpellSlugs?: string[];
  excludedTraditions?: string[];
  destination: Parameters<typeof makeSpellChoiceStep>[0]["destination"];
}): void {
  const sourceSlug = extractSourceSlug(args.source.sourceDocument) ?? args.source.sourceSelection.documentId;
  const level = selectionTakenLevel(args.source.sourceSelection);
  const sourcePublication = extractSourcePublication(args.source.sourceDocument);
  appendPendingSpellChoiceStep(
    args.steps,
    makeSpellChoiceStep({
      slotId: `spell-choice-feat-${sourceSlug}-cantrip-level-${level}`,
      level,
      title: args.title,
      description: args.description,
      source: {
        sourcePackId: args.source.sourceSelection.packId,
        sourceDocumentId: args.source.sourceSelection.documentId,
        sourceUuid: args.source.sourceSelection.uuid,
        sourceName: args.source.sourceSelection.name,
      },
      ...(sourcePublication ? { sourcePublication } : {}),
      classSlug: args.classSlug,
      dependsOn: args.dependsOn,
      count: args.count ?? 1,
      minRank: 0,
      maxRank: 0,
      cantrip: true,
      ...(args.allowedSpellSlugs ? { allowedSpellSlugs: args.allowedSpellSlugs } : {}),
      ...(args.excludedTraditions ? { excludedTraditions: args.excludedTraditions } : {}),
      curriculumSpellNames: [],
      additionalAllowedSpellNames: [],
      restrictToCommon: true,
      destination: args.destination,
    }),
    args.draft,
    args.readExistingSpellChoiceSelections
  );
}

function extractSourcePublication(document: unknown): SpellChoicePublication | null {
  const publication = (
    document as {
      system?: {
        publication?: {
          title?: unknown;
          authors?: unknown;
          license?: unknown;
          remaster?: unknown;
        };
      };
    } | null
  )?.system?.publication;
  if (
    typeof publication?.title !== "string" ||
    publication.title.trim().length === 0 ||
    typeof publication.authors !== "string" ||
    (publication.license !== "OGL" && publication.license !== "ORC") ||
    typeof publication.remaster !== "boolean"
  ) {
    return null;
  }
  return {
    title: publication.title.trim(),
    authors: publication.authors,
    license: publication.license,
    remaster: publication.remaster,
  };
}

function extractSourceSlug(document: unknown): string | null {
  const slug = (document as { system?: { slug?: unknown } } | null)?.system?.slug;
  return typeof slug === "string" && slug.trim().length > 0 ? slug.trim() : null;
}

function classSpellcastingProfile(
  classDocument: SpellChoiceClassDocument | null,
  extractSlug: (document: SpellChoiceDocumentLike | null) => string | null
): ClassSpellcastingProfile | null {
  const classSlug = extractSlug(classDocument);
  switch (classSlug) {
    case "cleric":
      return {
        classSlug,
        tradition: "divine",
        ability: "wis",
        destinationKey: "cleric-divine-prepared",
        destinationLabel: "Divine prepared spells",
        entryName: "Divine Prepared Spells",
      };
    case "wizard":
      return {
        classSlug,
        tradition: "arcane",
        ability: "int",
        destinationKey: "wizard-arcane-prepared",
        destinationLabel: "Wizard spellbook",
        entryName: "Wizard spellbook",
      };
    default:
      return null;
  }
}

function isAdaptedCantripDocument(document: unknown): boolean {
  const typedDocument = document as {
    system?: {
      slug?: unknown;
      description?: {
        value?: unknown;
      };
    };
  } | null;
  if (typedDocument?.system?.slug === "adapted-cantrip") {
    return true;
  }

  const description =
    typeof typedDocument?.system?.description?.value === "string" ? typedDocument.system.description.value : "";
  return /\bchoose one cantrip from a magical tradition other than your own\b/i.test(description);
}

function extractInnateArcaneCantripSlugs(document: unknown): string[] {
  const typedDocument = document as {
    system?: {
      rules?: unknown;
      description?: {
        value?: unknown;
      };
    };
  } | null;
  const description =
    typeof typedDocument?.system?.description?.value === "string" ? typedDocument.system.description.value : "";
  if (!/\binnate arcane spell\b/i.test(description)) {
    return [];
  }

  const rules = Array.isArray(typedDocument?.system?.rules) ? typedDocument.system.rules : [];
  for (const rule of rules) {
    const typedRule = rule as {
      key?: unknown;
      choices?: {
        itemType?: unknown;
        slugsAsValues?: unknown;
        filter?: unknown;
      };
    } | null;
    if (
      typedRule?.key !== "ChoiceSet" ||
      typedRule.choices?.itemType !== "spell" ||
      typedRule.choices.slugsAsValues !== true
    ) {
      continue;
    }

    return extractItemSlugPredicates(typedRule.choices.filter);
  }

  return [];
}

function extractItemSlugPredicates(value: unknown): string[] {
  if (typeof value === "string") {
    const match = /^item:slug:(.+)$/.exec(value.trim());
    return match ? [match[1]] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractItemSlugPredicates(entry));
  }

  const record = value as { or?: unknown; and?: unknown } | null;
  if (record && typeof record === "object") {
    return [...extractItemSlugPredicates(record.or), ...extractItemSlugPredicates(record.and)];
  }

  return [];
}
