import { extractDocumentSlug } from "../../shared/slug.js";
import { isRecord } from "../rule-data.js";
/** Project the profile's initial class training without changing a cached or embedded document. */
export function withClassArchetypeInitialTraining(document, profile) {
    if (!isRecord(document) || !profile?.initialTraining || extractDocumentSlug(document) !== profile.classSlug) {
        return document;
    }
    const source = typeof document.toObject === "function" ? document.toObject() : document;
    if (!isRecord(source))
        return document;
    const system = isRecord(source.system) ? source.system : {};
    const trainedSkills = isRecord(system.trainedSkills) ? system.trainedSkills : {};
    return {
        ...source,
        ...(typeof document.uuid === "string" ? { uuid: document.uuid } : {}),
        system: {
            ...system,
            trainedSkills: {
                ...trainedSkills,
                value: [...profile.initialTraining.fixedSkills],
                ...(profile.initialTraining.additional === undefined ? {} : { additional: profile.initialTraining.additional }),
            },
        },
    };
}
/**
 * Static skill projection does not evaluate predicates. Suppress only fixed skill
 * grants that explicitly exclude this profile; keep native rule indices intact
 * in the document used by Apply.
 */
export function classArchetypeInitialTrainingProjection(document, profile) {
    const projected = withClassArchetypeInitialTraining(document, profile);
    if (projected === document || !profile || !isRecord(projected) || !isRecord(projected.system))
        return projected;
    const rules = projected.system.rules;
    if (!Array.isArray(rules))
        return projected;
    return {
        ...projected,
        system: {
            ...projected.system,
            rules: rules.filter((rule) => !(isRecord(rule) &&
                rule.key === "ActiveEffectLike" &&
                typeof rule.path === "string" &&
                /^system\.skills\.[a-z][a-z0-9-]*\.rank$/iu.test(rule.path) &&
                Array.isArray(rule.predicate) &&
                rule.predicate.some((statement) => isRecord(statement) && statement.not === `feature:${profile.value}`))),
        },
    };
}
//# sourceMappingURL=training-policy.js.map