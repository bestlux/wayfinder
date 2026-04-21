import { baseContributor } from "./base-contributor.js";
import { clericContributor } from "./cleric-contributor.js";
import type { ClassContributor } from "./types.js";
import { wizardContributor } from "./wizard-contributor.js";

const CONTRIBUTORS = [wizardContributor, clericContributor] as const;
const CONTRIBUTORS_BY_SLUG = new Map<string, ClassContributor>(
  CONTRIBUTORS.map((contributor) => [contributor.slug, contributor])
);

export function getClassContributor(classSlug: string | null): ClassContributor {
  if (!classSlug) {
    return baseContributor;
  }

  return CONTRIBUTORS_BY_SLUG.get(classSlug) ?? baseContributor;
}
