import { resolveSingletonChoiceSkillGrant } from "../shared/singleton-choice-skill-grants.js";
import { listPlannedStaticSkillSources } from "../wayfinder/application/planned-static-skill-source-service.js";
import { projectStaticSkillSourceGrants } from "../wayfinder/domain/static-skill-source-grants.js";
const FOUNDATION_ITEM_TYPES = new Set(["ancestry", "heritage", "background", "class"]);
export function projectPreparedSkillSources(args) {
    const sourcesByUuid = new Map();
    for (const entry of args.sources) {
        if (!sourcesByUuid.has(entry.selection.uuid))
            sourcesByUuid.set(entry.selection.uuid, entry);
    }
    const sourceGrants = [];
    const requiredBeforeSkillGrants = [];
    const plannedStaticSources = listPlannedStaticSkillSources(args.draft, args.steps);
    const plannedStaticSourcesByUuid = new Map(plannedStaticSources.map((source) => [source.selection.uuid, source]));
    const selectedFoundationUuidByType = new Map(plannedStaticSources
        .filter(({ selection }) => FOUNDATION_ITEM_TYPES.has(selection.itemType))
        .map(({ selection }) => [selection.itemType, selection.uuid]));
    const selectedFoundationUuids = new Set(selectedFoundationUuidByType.values());
    for (const entry of args.sources) {
        const plannedSource = plannedStaticSourcesByUuid.get(entry.selection.uuid);
        const selectedFoundationUuid = selectedFoundationUuidByType.get(entry.selection.itemType);
        const retainedFoundation = FOUNDATION_ITEM_TYPES.has(entry.selection.itemType) && selectedFoundationUuid === undefined;
        if (!plannedSource && !retainedFoundation)
            continue;
        const staticGrants = projectStaticSkillSourceGrants({
            document: entry.source,
            sourceId: entry.selection.uuid,
            validSkillSlugs: args.validSkillSlugs,
        });
        sourceGrants.push(...staticGrants);
        if (plannedSource?.requiredBeforeSkillPhase || retainedFoundation) {
            requiredBeforeSkillGrants.push(...staticGrants);
        }
    }
    for (const step of args.steps) {
        if (step.kind !== "singleton-choice")
            continue;
        const selection = args.draft.singletonChoices[step.slotId];
        if (!selection)
            continue;
        const source = sourcesByUuid.get(step.singletonChoice.sourceUuid);
        if (!source) {
            throw new Error(`${step.title} cannot be prepared because its exact source document was not inspected.`);
        }
        const grant = resolveSingletonChoiceSkillGrant({
            rules: source.source.system?.rules,
            flag: step.singletonChoice.flag,
            selection,
        });
        if (grant && args.validSkillSlugs.has(grant.skillSlug)) {
            const projectedGrant = {
                slug: grant.skillSlug,
                rank: grant.rank,
                sourceId: step.singletonChoice.sourceUuid,
            };
            sourceGrants.push(projectedGrant);
            requiredBeforeSkillGrants.push(projectedGrant);
        }
        const staticGrants = projectStaticSkillSourceGrants({
            document: source.source,
            sourceId: step.singletonChoice.sourceUuid,
            validSkillSlugs: args.validSkillSlugs,
        });
        sourceGrants.push(...staticGrants);
        requiredBeforeSkillGrants.push(...staticGrants);
    }
    const skillPhaseGrants = [];
    for (const step of args.steps) {
        if (step.kind !== "skill-training")
            continue;
        const training = args.draft.skillTrainings[step.slotId];
        if (!training)
            continue;
        for (const choice of step.training.choiceRules) {
            const selection = training.ruleChoices[choice.key];
            if (!selection || !choice.persistence)
                continue;
            const source = sourcesByUuid.get(choice.persistence.sourceUuid);
            if (!source) {
                throw new Error(`${step.title} cannot be prepared because its exact training source was not inspected.`);
            }
            const grant = resolveSingletonChoiceSkillGrant({
                rules: source.source.system?.rules,
                flag: choice.flag,
                selection,
            });
            if (grant && args.validSkillSlugs.has(grant.skillSlug)) {
                const projectedGrant = {
                    slug: grant.skillSlug,
                    rank: grant.rank,
                    sourceId: choice.persistence.sourceUuid,
                };
                if (selectedFoundationUuids.has(choice.persistence.sourceUuid)) {
                    requiredBeforeSkillGrants.push(projectedGrant);
                }
                else {
                    skillPhaseGrants.push(projectedGrant);
                }
            }
        }
    }
    return Object.freeze({
        sourceGrants: freezeGrants(sourceGrants),
        requiredBeforeSkillGrants: freezeGrants(requiredBeforeSkillGrants),
        skillPhaseGrants: freezeGrants(skillPhaseGrants),
    });
}
function freezeGrants(grants) {
    const byIdentity = new Map();
    for (const grant of grants) {
        const key = `${grant.sourceId ?? ""}:${grant.slug}`;
        const existing = byIdentity.get(key);
        if (!existing || existing.rank < grant.rank)
            byIdentity.set(key, grant);
    }
    return Object.freeze(Array.from(byIdentity.values())
        .sort((left, right) => `${left.sourceId ?? ""}:${left.slug}:${left.rank}`.localeCompare(`${right.sourceId ?? ""}:${right.slug}:${right.rank}`))
        .map((grant) => Object.freeze({ ...grant })));
}
//# sourceMappingURL=prepared-skill-source-projection.js.map