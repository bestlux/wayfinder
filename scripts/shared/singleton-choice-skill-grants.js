import { SKILL_LABELS } from "../constants.js";
export function resolveSingletonChoiceSkillGrant(args) {
    const skillSlug = normalizeSkillSlug(args.selection);
    if (!skillSlug || !isKnownSkillSlug(skillSlug)) {
        return null;
    }
    const rules = Array.isArray(args.rules) ? args.rules : [];
    let grantedRank = null;
    for (const rule of rules) {
        if (!matchesSingletonChoiceSkillRankRule(rule, args.flag, skillSlug)) {
            continue;
        }
        const rank = normalizeGrantedRank(rule.value);
        if (rank === null) {
            continue;
        }
        grantedRank = grantedRank === null ? rank : Math.max(grantedRank, rank);
    }
    return grantedRank === null ? null : { skillSlug, rank: grantedRank };
}
function matchesSingletonChoiceSkillRankRule(rule, flag, skillSlug) {
    if (!rule || typeof rule !== "object") {
        return false;
    }
    const effect = rule;
    if (effect.key !== "ActiveEffectLike" || typeof effect.path !== "string") {
        return false;
    }
    const normalizedPath = effect.path.replace(/\s+/g, "");
    if (normalizedPath === `system.skills.${skillSlug}.rank`) {
        return true;
    }
    return (normalizedPath === `system.skills.{item|flags.pf2e.rulesSelections.${flag}}.rank` ||
        normalizedPath === `system.skills.{item|flags.system.rulesSelections.${flag}}.rank`);
}
function normalizeGrantedRank(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return Math.max(0, Math.min(4, Math.floor(numeric)));
}
function isKnownSkillSlug(value) {
    if (Object.hasOwn(SKILL_LABELS, value)) {
        return true;
    }
    const configuredSkills = globalThis.CONFIG?.PF2E?.skills;
    return !!configuredSkills && Object.hasOwn(configuredSkills, value);
}
function normalizeSkillSlug(value) {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}
//# sourceMappingURL=singleton-choice-skill-grants.js.map