import { SKILL_LABELS } from "../constants.js";

export function resolveSingletonChoiceSkillGrant(args: {
  rules: unknown;
  flag: string;
  selection: string;
}): { skillSlug: string; rank: number } | null {
  const skillSlug = normalizeSkillSlug(args.selection);
  if (!skillSlug || !isKnownSkillSlug(skillSlug)) {
    return null;
  }

  const rules = Array.isArray(args.rules) ? args.rules : [];
  let grantedRank: number | null = null;

  for (const rule of rules) {
    if (!matchesSingletonChoiceSkillRankRule(rule, args.flag, skillSlug)) {
      continue;
    }

    const rank = normalizeGrantedRank((rule as { value?: unknown }).value);
    if (rank === null) {
      continue;
    }

    grantedRank = grantedRank === null ? rank : Math.max(grantedRank, rank);
  }

  return grantedRank === null ? null : { skillSlug, rank: grantedRank };
}

function matchesSingletonChoiceSkillRankRule(rule: unknown, flag: string, skillSlug: string): boolean {
  if (!rule || typeof rule !== "object") {
    return false;
  }

  const effect = rule as { key?: unknown; path?: unknown };
  if (effect.key !== "ActiveEffectLike" || typeof effect.path !== "string") {
    return false;
  }

  const normalizedPath = effect.path.replace(/\s+/g, "");
  if (normalizedPath === `system.skills.${skillSlug}.rank`) {
    return true;
  }

  return (
    normalizedPath === `system.skills.{item|flags.pf2e.rulesSelections.${flag}}.rank` ||
    normalizedPath === `system.skills.{item|flags.system.rulesSelections.${flag}}.rank`
  );
}

function normalizeGrantedRank(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(4, Math.floor(numeric)));
}

function isKnownSkillSlug(value: string): boolean {
  if (Object.hasOwn(SKILL_LABELS, value)) {
    return true;
  }

  const configuredSkills = (
    globalThis as typeof globalThis & {
      CONFIG?: {
        PF2E?: {
          skills?: Record<string, unknown>;
        };
      };
    }
  ).CONFIG?.PF2E?.skills;

  return !!configuredSkills && Object.hasOwn(configuredSkills, value);
}

function normalizeSkillSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
