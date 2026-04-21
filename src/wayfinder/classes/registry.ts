import { baseContributor } from "./base-contributor.js";
import { clericContributor } from "./cleric-contributor.js";
import type { ClassContributor } from "./types.js";
import { wizardContributor } from "./wizard-contributor.js";

const CONTRIBUTORS: Record<string, ClassContributor> = {
  wizard: wizardContributor,
  cleric: clericContributor,
};

export function getClassContributor(classSlug: string | null): ClassContributor {
  if (!classSlug) {
    return baseContributor;
  }

  return CONTRIBUTORS[classSlug] ?? baseContributor;
}
