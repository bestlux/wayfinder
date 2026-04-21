import { SKILL_LABELS } from "../../constants.js";
import { formatSlug } from "../formatting.js";

type ConfiguredSkillRecord = Record<string, string | { label?: unknown }>;

export type SkillConfigMap = Record<string, { label: string }>;

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

      return [[normalizedSlug, { label: configuredLabel }]];
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
  const localized = typeof label === "string" && label.length > 0 ? localize(label) : "";
  if (localized && localized !== label) {
    return localized;
  }

  const configuredLabel = configuredSkills[slug]?.label;
  const fallback =
    configuredLabel && configuredLabel.length > 0 ? configuredLabel : (SKILL_LABELS[slug] ?? formatSlug(slug));
  return localize(fallback);
}

function normalizeSkillSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
