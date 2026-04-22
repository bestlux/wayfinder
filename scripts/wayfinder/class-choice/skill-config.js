import { SKILL_ABILITIES, SKILL_LABELS } from "../../constants.js";
import { formatSlug } from "../formatting.js";
export function getConfiguredSkills() {
    const configured = globalThis.CONFIG?.PF2E?.skills;
    if (!configured || typeof configured !== "object") {
        return {};
    }
    return Object.fromEntries(Object.entries(configured).flatMap(([slug, value]) => {
        const normalizedSlug = normalizeSkillSlug(slug);
        if (!normalizedSlug) {
            return [];
        }
        const configuredLabel = typeof value === "string" ? value : typeof value?.label === "string" ? value.label : formatSlug(slug);
        const configuredAttribute = typeof value === "object" && typeof value?.attribute === "string"
            ? value.attribute.trim().toLowerCase()
            : SKILL_ABILITIES[normalizedSlug];
        return [[normalizedSlug, { label: configuredLabel, attribute: configuredAttribute }]];
    }));
}
export function isConfiguredSkillSlug(value, configuredSkills = getConfiguredSkills()) {
    const slug = normalizeSkillSlug(value);
    return !!slug && (Object.hasOwn(SKILL_LABELS, slug) || Object.hasOwn(configuredSkills, slug));
}
export function resolveSkillLabel(slug, label, localize, configuredSkills = getConfiguredSkills()) {
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
    const fallback = configuredLabel && configuredLabel.length > 0 ? configuredLabel : (SKILL_LABELS[slug] ?? formatSlug(slug));
    return localize(fallback);
}
export function getSkillAbility(slug, configuredSkills = getConfiguredSkills()) {
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
function looksLikeLocalizationKey(value) {
    return /^[A-Z0-9_]+(?:\.[A-Z0-9_]+)+$/i.test(value);
}
function normalizeSkillSlug(value) {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}
//# sourceMappingURL=skill-config.js.map