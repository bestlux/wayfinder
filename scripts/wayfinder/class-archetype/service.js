import { itemMatchesSourceId } from "../../shared/source-id.js";
import { buildClassBranchStepsFromRules } from "../class-choice/step-builders.js";
import { createClassArchetypeStep, createPickItemStep } from "../domain/step-types.js";
import { activeClassArchetypeProfile, buildClassArchetypeMeta } from "./registry.js";
export async function buildClassArchetypeSteps(args) {
    const branchSteps = await buildClassBranchStepsFromRules(args);
    return branchSteps.flatMap((step) => {
        const meta = buildClassArchetypeMeta(step.branch);
        if (!meta) {
            return [];
        }
        const ownDecision = args.draft.classArchetypeChoices[meta.slotId];
        if (!ownDecision && (args.readExistingBranchSelection(step.branch) || args.draft.branchSelections[step.slotId])) {
            return [];
        }
        return [
            createClassArchetypeStep(step.level, meta, {
                title: `${step.branch.selectorName}: standard or archetype`,
                description: "Choose the standard class progression or a supported class archetype. This decision changes later class features and spellcasting.",
            }),
        ];
    });
}
export function buildClassArchetypeFallbackFeatSteps(args) {
    const profile = activeClassArchetypeProfile(args.draft, args.actorItems);
    if (!profile) {
        return [];
    }
    return profile.fallbackFeatChoices.flatMap((choice) => {
        if (choice.level > args.targetLevel || staticGrantReplacementAlreadyApplied(args.actorItems, choice)) {
            return [];
        }
        if (args.actorItems.some((item) => itemMatchesSourceId(item, choice.grantedBySourceUuid))) {
            return [];
        }
        const projectedSingletonSources = args.projectedSingletonSources ?? [];
        const existingItem = args.actorItems.find((item) => itemMatchesSourceId(item, choice.existingSourceUuid) &&
            !itemWasGrantedByReplacedSingleton(item, args.actorItems, projectedSingletonSources));
        const projectedItem = projectedSingletonSources.some(({ sourceDocument }) => documentDirectlyGrantsChoice(sourceDocument, choice));
        if ((!existingItem && !projectedItem) ||
            (existingItem && itemWasGrantedBySource(existingItem, args.actorItems, choice.grantedBySourceUuid))) {
            return [];
        }
        return [
            createPickItemStep("grant-choice", choice.level, choice.title, choice.description, choice.filters, {
                slotId: choice.slotId,
                staticGrantReplacement: {
                    sourceUuid: choice.grantedBySourceUuid,
                    originalGrantUuids: choice.originalRuleUuids,
                    flag: choice.flag,
                },
            }),
        ];
    });
}
function documentDirectlyGrantsChoice(document, choice) {
    const rules = document?.system?.rules;
    if (!Array.isArray(rules)) {
        return false;
    }
    const matchingUuids = new Set([choice.existingSourceUuid, ...choice.originalRuleUuids]);
    return rules.some((entry) => {
        const rule = entry;
        return rule?.key === "GrantItem" && typeof rule.uuid === "string" && matchingUuids.has(rule.uuid);
    });
}
function itemWasGrantedByReplacedSingleton(item, actorItems, projectedSingletonSources) {
    const replacedTypes = new Set(projectedSingletonSources.map((source) => source.sourceItemType));
    const grantedById = item?.flags?.pf2e?.grantedBy
        ?.id;
    if (typeof grantedById !== "string") {
        return false;
    }
    const granter = actorItems.find((candidate) => candidate?.id === grantedById);
    return typeof granter?.type === "string" && replacedTypes.has(granter.type);
}
function staticGrantReplacementAlreadyApplied(actorItems, choice) {
    const source = actorItems.find((item) => itemMatchesSourceId(item, choice.grantedBySourceUuid));
    const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
    return rules.some((entry) => {
        const rule = entry;
        return (rule?.key === "GrantItem" &&
            rule.flag === choice.flag &&
            typeof rule.uuid === "string" &&
            !choice.originalRuleUuids.includes(rule.uuid));
    });
}
function itemWasGrantedBySource(item, actorItems, sourceUuid) {
    const grantedById = item?.flags?.pf2e?.grantedBy
        ?.id;
    return (typeof grantedById === "string" &&
        actorItems.some((candidate) => candidate?.id === grantedById && itemMatchesSourceId(candidate, sourceUuid)));
}
//# sourceMappingURL=service.js.map