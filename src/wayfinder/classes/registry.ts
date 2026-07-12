import { bardContributor } from "./bard-contributor.js";
import { baseContributor } from "./base-contributor.js";
import {
  animistContributor,
  druidContributor,
  magusContributor,
  oracleContributor,
  psychicContributor,
  sorcererContributor,
  summonerContributor,
  witchContributor,
} from "./caster-contributors.js";
import { clericContributor } from "./cleric-contributor.js";
import { gunslingerContributor } from "./gunslinger-contributor.js";
import { investigatorContributor } from "./investigator-contributor.js";
import type { ClassContributor } from "./types.js";
import { wizardContributor } from "./wizard-contributor.js";

const CONTRIBUTORS = [
  wizardContributor,
  clericContributor,
  gunslingerContributor,
  investigatorContributor,
  bardContributor,
  animistContributor,
  druidContributor,
  magusContributor,
  oracleContributor,
  psychicContributor,
  sorcererContributor,
  summonerContributor,
  witchContributor,
] as const;
const CONTRIBUTORS_BY_SLUG = new Map<string, ClassContributor>(
  CONTRIBUTORS.map((contributor) => [contributor.slug, contributor])
);

export function getClassContributor(classSlug: string | null): ClassContributor {
  if (!classSlug) {
    return baseContributor;
  }

  return CONTRIBUTORS_BY_SLUG.get(classSlug) ?? baseContributor;
}
