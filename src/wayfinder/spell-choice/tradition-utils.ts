import type { SpellChoiceSchoolDocument } from "./types.js";

const TRADITIONS = ["arcane", "divine", "occult", "primal"] as const;
export type SpellTradition = (typeof TRADITIONS)[number];

export function findClassFeatureDocumentByOtherTag(
  documents: readonly SpellChoiceSchoolDocument[],
  otherTag: string
): SpellChoiceSchoolDocument | null {
  const normalized = otherTag.trim().toLowerCase();
  return (
    documents.find((document) => {
      const tags = (document.system?.traits as { otherTags?: unknown } | undefined)?.otherTags;
      return Array.isArray(tags) && tags.some((tag) => String(tag).trim().toLowerCase() === normalized);
    }) ?? null
  );
}

export function parseTraditionFromClassFeatureDocument(
  document: SpellChoiceSchoolDocument | null | undefined,
  fallback: SpellTradition
): SpellTradition {
  const description = String(document?.system?.description?.value ?? "").toLowerCase();
  const proficiencies = document?.system?.proficiencies as { aliases?: { witch?: unknown } } | undefined;
  const alias = String(proficiencies?.aliases?.witch ?? "").toLowerCase();
  for (const tradition of TRADITIONS) {
    if (alias === tradition) {
      return tradition;
    }

    if (
      description.includes(`<strong>spell list</strong> ${tradition}`) ||
      description.includes(`<strong>tradition</strong> ${tradition}`) ||
      description.includes(`spell list</strong> ${tradition}`) ||
      description.includes(`tradition</strong> ${tradition}`)
    ) {
      return tradition;
    }
  }

  return fallback;
}
