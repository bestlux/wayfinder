import { SKILL_LABELS } from "../../constants.js";
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
        return [[normalizedSlug, { label: configuredLabel }]];
    }));
}
export function isConfiguredSkillSlug(value, configuredSkills = getConfiguredSkills()) {
    const slug = normalizeSkillSlug(value);
    return !!slug && (Object.hasOwn(SKILL_LABELS, slug) || Object.hasOwn(configuredSkills, slug));
}
export function resolveSkillLabel(slug, label, localize, configuredSkills = getConfiguredSkills()) {
    const localized = typeof label === "string" && label.length > 0 ? localize(label) : "";
    if (localized && localized !== label) {
        return localized;
    }
    const configuredLabel = configuredSkills[slug]?.label;
    const fallback = configuredLabel && configuredLabel.length > 0 ? configuredLabel : (SKILL_LABELS[slug] ?? formatSlug(slug));
    return localize(fallback);
}
function normalizeSkillSlug(value) {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}
//# sourceMappingURL=skill-config.js.map