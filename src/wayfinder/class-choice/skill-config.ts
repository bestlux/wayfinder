import { SKILL_ABILITIES, SKILL_LABELS } from "../../constants.js";
import { formatSlug } from "../formatting.js";

type ConfiguredSkillRecord = Record<string, string | { label?: unknown; attribute?: unknown }>;

export type SkillConfigMap = Record<string, { label: string; attribute?: string }>;

export function getConfiguredSkills(): SkillConfigMap {
  const configured = (
    globalThis as typeof globalThis & {
      CONFIG?: {
        PF2E?: {
          skills?: ConfiguredSkillRecord;
        };
      };
    }
  ).CONFIG?.PF2E?.skills;

  if (!configured || typeof configured !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(configured).flatMap(([slug, value]) => {
      const normalizedSlug = normalizeSkillSlug(slug);
      if (!normalizedSlug) {
        return [];
      }

      const configuredLabel =
        typeof value === "string" ? value : typeof value?.label === "string" ? value.label : formatSlug(slug);
      const configuredAttribute =
        typeof value === "object" && typeof value?.attribute === "string"
          ? value.attribute.trim().toLowerCase()
          : SKILL_ABILITIES[normalizedSlug];

      return [[normalizedSlug, { label: configuredLabel, attribute: configuredAttribute }]];
    })
  );
}

export function isConfiguredSkillSlug(
  value: string,
  configuredSkills: SkillConfigMap = getConfiguredSkills()
): boolean {
  const slug = normalizeSkillSlug(value);
  return !!slug && (Object.hasOwn(SKILL_LABELS, slug) || Object.hasOwn(configuredSkills, slug));
}

export function resolveSkillLabel(
  slug: string,
  label: string | undefined,
  localize: (value: string) => string,
  configuredSkills: SkillConfigMap = getConfiguredSkills()
): string {
  const explicitLabel = typeof label === "string" ? label.trim() : "";
  if (explicitLabel.length > 0) {
    const localized = localize(explicitLabel);
    if (localized && localized !== explicitLabel) {
      return localized;
    }

    if (!looksLikeLocalizationKey(explicitLabel)) {
      return explicitLabel;
    }
  }

  const configuredLabel = configuredSkills[slug]?.label;
  const fallback =
    configuredLabel && configuredLabel.length > 0 ? configuredLabel : (SKILL_LABELS[slug] ?? formatSlug(slug));
  return localize(fallback);
}

export function getSkillAbility(slug: string, configuredSkills: SkillConfigMap = getConfiguredSkills()): string | null {
  const normalizedSlug = normalizeSkillSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const configuredAbility = configuredSkills[normalizedSlug]?.attribute;
  if (typeof configuredAbility === "string" && configuredAbility.length > 0) {
    return configuredAbility;
  }

  return SKILL_ABILITIES[normalizedSlug] ?? null;
}

function looksLikeLocalizationKey(value: string): boolean {
  return /^[A-Z0-9_]+(?:\.[A-Z0-9_]+)+$/i.test(value);
}

function normalizeSkillSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
