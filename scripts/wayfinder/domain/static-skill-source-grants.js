export function projectStaticSkillSourceGrants(args) {
    const document = args.document;
    const grants = [];
    const trainedSkills = document?.system?.trainedSkills?.value;
    if (Array.isArray(trainedSkills)) {
        for (const value of trainedSkills) {
            const slug = normalizeSkillSlug(value);
            if (slug && args.validSkillSlugs.has(slug)) {
                grants.push({ slug, rank: 1, sourceId: args.sourceId });
            }
        }
    }
    const rules = Array.isArray(document?.system?.rules) ? document.system.rules : [];
    for (const rule of rules) {
        if (!rule || typeof rule !== "object" || rule.key !== "ActiveEffectLike" || typeof rule.path !== "string") {
            continue;
        }
        const match = /^system\.skills\.([a-z][a-z0-9-]*)\.rank$/iu.exec(rule.path.trim());
        const rank = Number(rule.value);
        const slug = match?.[1]?.toLowerCase();
        if (slug && args.validSkillSlugs.has(slug) && Number.isFinite(rank) && rank >= 1) {
            grants.push({
                slug,
                rank: Math.max(1, Math.min(4, Math.floor(rank))),
                sourceId: args.sourceId,
            });
        }
    }
    const bySlug = new Map();
    for (const grant of grants) {
        const existing = bySlug.get(grant.slug);
        if (!existing || existing.rank < grant.rank)
            bySlug.set(grant.slug, grant);
    }
    return Object.freeze(Array.from(bySlug.values())
        .sort((left, right) => left.slug.localeCompare(right.slug))
        .map((grant) => Object.freeze(grant)));
}
function normalizeSkillSlug(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
//# sourceMappingURL=static-skill-source-grants.js.map