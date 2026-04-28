import type { PendingStep, SelectionRef } from "../../types.js";
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
  allowedSpellSlugs?: string[];
  excludedTraditions?: string[];
  destination: Parameters<typeof makeSpellChoiceStep>[0]["destination"];
}): void {
  const sourceSlug = extractSourceSlug(args.source.sourceDocument) ?? args.source.sourceSelection.documentId;
  const level = args.source.sourceSelection.level ?? 1;
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
      classSlug: args.classSlug,
      dependsOn: args.dependsOn,
      count: 1,
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
