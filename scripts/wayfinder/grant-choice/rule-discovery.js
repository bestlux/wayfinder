import { resolveChoiceSetFilters } from "../choice-set-filters.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, matchesChoiceSetRulePredicate, predicateIncludesString, toNonEmptyString, } from "../rule-data.js";
export function discoverGrantSelectionMeta(args) {
    const { sourceItemType, sourceDocument, sourceSelection, extractSlug } = args;
    const document = sourceDocument;
    const sourceName = toNonEmptyString(document?.name) ?? sourceSelection.name;
    const sourceSlug = extractSlug(sourceDocument) ?? sourceSelection.documentId;
    const level = args.sourceLevel ?? documentFeatureLevel(sourceDocument);
    const rules = getDocumentRules(sourceDocument);
    return rules.flatMap((rule, sourceRuleIndex) => {
        const flag = extractChoiceKey(rule);
        if (rule.key !== "ChoiceSet" || !flag) {
            return [];
        }
        const resolution = resolveChoiceSetFilters(rule, {
            sourceLevel: level,
            sourceDocumentLevel: documentFeatureLevel(sourceDocument),
            actorContext: args.actorContext,
            requireResolvedActorPlaceholders: args.requireResolvedActorPlaceholders,
        });
        if (!resolution) {
            return [];
        }
        const filters = resolution.filters;
        const dependsOn = resolution.actorDependencies.includes("class")
            ? "class"
            : resolveGrantDependency(sourceItemType, grantDependencyPredicates(filters));
        const dependencyKey = dependsOn ?? "none";
        const slotId = `grant-choice-${dependencyKey}-${sourceItemType}-${sourceSlug}-${flag}-level-${level}`;
        const selectedValue = args.selectedValuesBySlotId?.[slotId];
        if (!matchesChoiceSetRulePredicate(rule, args.activeRollOptions ?? new Set()) &&
            (!selectedValue ||
                !matchesAfterRemovingOwnGrantOption(rule, args.activeRollOptions ?? new Set(), filters.itemType, selectedValue))) {
            return [];
        }
        const grantRuleIndex = rules.findIndex((entry) => entry.key === "GrantItem" && typeof entry.uuid === "string" && entry.uuid.includes(`rulesSelections.${flag}`));
        if (grantRuleIndex === -1) {
            return [];
        }
        return [
            {
                slotId,
                sourceItemType,
                selectorPackId: sourceSelection.packId,
                selectorDocumentId: sourceSelection.documentId,
                selectorUuid: sourceSelection.uuid,
                selectorName: sourceName,
                selectorRuleIndex: sourceRuleIndex,
                grantRuleIndex,
                flag,
                itemType: filters.itemType,
                classSlug: null,
                dependsOn,
                filters,
                ...(args.staticGrantOwner ? { staticGrantOwner: args.staticGrantOwner } : {}),
            },
        ];
    });
}
function matchesAfterRemovingOwnGrantOption(rule, activeRollOptions, itemType, selection) {
    const withoutOwnChoice = new Set(activeRollOptions);
    const rollOption = toNonEmptyString(rule.rollOption)?.toLowerCase();
    const values = [selection.uuid, selection.slug, selection.documentId, selection.name]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase());
    let removed = false;
    if (rollOption) {
        for (const value of values) {
            removed = withoutOwnChoice.delete(`${rollOption}:${value}`) || removed;
        }
    }
    if (itemType === "deity") {
        removed = withoutOwnChoice.delete("deity") || removed;
    }
    return removed && matchesChoiceSetRulePredicate(rule, withoutOwnChoice);
}
function grantDependencyPredicates(filters) {
    return [
        ...(filters.predicate ?? []),
        ...(filters.contextPredicate ?? []),
        ...Object.values(filters.uuidPredicates ?? {}).flat(),
    ];
}
function resolveGrantDependency(sourceItemType, predicate) {
    if (sourceItemType === "classfeature") {
        return "class";
    }
    if (predicateIncludesString(predicate, "{actor|system.details.class.trait}") ||
        predicateIncludesString(predicate, "item:trait:multiclass")) {
        return "class";
    }
    if (predicateIncludesString(predicate, "deity:primary:")) {
        return "deity";
    }
    return null;
}
//# sourceMappingURL=rule-discovery.js.map