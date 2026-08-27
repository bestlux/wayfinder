import type { SelectionRef, SkillTrainingChoiceMeta } from "../../types.js";
import { resolveSkillLabel, type SkillConfigMap } from "./skill-config.js";

interface InitialSkillChoiceProfile {
  sourceUuid: string;
  classSlug: string;
  key: string;
  flag: string;
  prompt: string;
  options: Array<{ slug: string; label: string }>;
}

const INITIAL_SKILL_CHOICE_PROFILES: readonly InitialSkillChoiceProfile[] = [
  {
    sourceUuid: "Compendium.pf2e.classes.Item.9KiqZVG9r5g8mC4V",
    classSlug: "animist",
    key: "initial-skill",
    flag: "initialSkill",
    prompt: "Choose Nature or Occultism",
    options: [
      { slug: "nature", label: "PF2E.Skill.Nature" },
      { slug: "occultism", label: "PF2E.Skill.Occultism" },
    ],
  },
];

export function registeredInitialClassSkillChoices(args: {
  classSlug: string | null;
  className: string;
  classSelection: SelectionRef | null;
  localize: (value: string) => string;
  configuredSkills: SkillConfigMap;
  nativeChoices: readonly SkillTrainingChoiceMeta[];
}): SkillTrainingChoiceMeta[] {
  const classSlug = args.classSlug?.trim().toLowerCase();
  const sourceUuid = args.classSelection?.uuid.trim().toLowerCase();
  if (!classSlug || !sourceUuid) return [];

  return INITIAL_SKILL_CHOICE_PROFILES.filter(
    (profile) =>
      profile.classSlug === classSlug &&
      profile.sourceUuid.toLowerCase() === sourceUuid &&
      !args.nativeChoices.some((choice) =>
        hasSameSkills(
          profile.options.map((option) => option.slug),
          choice.options.map((option) => option.slug)
        )
      )
  ).map((profile) => ({
    key: `class:${classSlug}:${profile.key}`,
    flag: profile.flag,
    prompt: args.localize(profile.prompt),
    sourceLabel: args.className,
    options: profile.options.map((option) => ({
      slug: option.slug,
      label: resolveSkillLabel(option.slug, option.label, args.localize, args.configuredSkills),
    })),
    persistence: null,
  }));
}

function hasSameSkills(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSlugs = left.map((slug) => slug.trim().toLowerCase()).sort();
  const rightSlugs = right.map((slug) => slug.trim().toLowerCase()).sort();
  return leftSlugs.every((slug, index) => slug === rightSlugs[index]);
}
