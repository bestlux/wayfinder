import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { slugifyName } from "../shared/slug.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, matchesChoiceSetRulePredicate, toNonEmptyString, } from "./rule-data.js";
import { selectionTakenLevel } from "./selection-level.js";
/**
 * Loads only direct, static GrantItem targets that themselves carry ChoiceSets.
 *
 * This is deliberately one level deep. Dynamic `{item|flags...}` grants are
 * selections made by an earlier rule and are handled by the existing guided
 * lanes after that selection is drafted.
 */
export async function resolveStaticGrantChoiceSources(args) {
    const grants = args.sources.flatMap(({ sourceSelection, sourceDocument }) => staticGrantSelections(sourceSelection, sourceDocument, args.activeRollOptions).map((grant) => ({
        ...grant,
        parentSelection: sourceSelection,
    })));
    const occurrenceCounts = new Map();
    for (const grant of grants) {
        const key = staticGrantOccurrenceKey(grant.selection);
        occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
    }
    const pending = grants.map(async ({ grantRuleIndex, preselectChoices, selection, parentSelection, }) => {
        const sourceDocument = await args.fetchSelectionDocument(selection);
        const choiceRules = sourceDocument
            ? getDocumentRules(sourceDocument).filter((rule) => rule.key === "ChoiceSet")
            : [];
        if (!sourceDocument ||
            choiceRules.length === 0 ||
            choiceRules.every((rule) => {
                const key = extractChoiceKey(rule);
                return key !== null && typeof preselectChoices[key] === "string" && preselectChoices[key].length > 0;
            })) {
            return null;
        }
        const sourceItemType = inferGrantedSourceItemType(selection, sourceDocument);
        const sourceLevel = selectionTakenLevel(parentSelection, documentFeatureLevel(sourceDocument));
        return {
            grantRuleIndex,
            supportsGuidedChoices: occurrenceCounts.get(staticGrantOccurrenceKey(selection)) === 1,
            parentSelection,
            sourceItemType,
            sourceSelection: {
                ...selection,
                name: toNonEmptyString(sourceDocument.name) ?? selection.name,
                level: sourceLevel,
                featType: sourceItemType,
            },
            sourceDocument,
            sourceLevel,
        };
    });
    const resolved = await Promise.all(pending);
    return dedupeStaticGrantSources(resolved.filter((source) => source !== null));
}
function staticGrantOccurrenceKey(childSelection) {
    return childSelection.uuid.trim().toLowerCase();
}
export function staticGrantSelections(parentSelection, sourceDocument, activeRollOptions = new Set()) {
    const sourceRollOptions = buildSourceRollOptions(parentSelection, sourceDocument, activeRollOptions);
    return getDocumentRules(sourceDocument).flatMap((rule, grantRuleIndex) => {
        if (rule.key !== "GrantItem" || !matchesChoiceSetRulePredicate(rule, sourceRollOptions)) {
            return [];
        }
        const uuid = toNonEmptyString(rule.uuid);
        // Braced UUIDs depend on prior rule selections and are not static grants.
        const parsed = uuid && !uuid.includes("{") ? parseCompendiumItemUuid(uuid) : null;
        if (!uuid || !parsed) {
            return [];
        }
        return [
            {
                grantRuleIndex,
                preselectChoices: isStringRecord(rule.preselectChoices) ? rule.preselectChoices : {},
                selection: {
                    slotId: `static-grant-choice-${parentSelection.slotId}-${grantRuleIndex}`,
                    packId: parsed.packId,
                    documentId: parsed.documentId,
                    uuid,
                    itemType: "feat",
                    featType: parsed.packId === "pf2e.classfeatures" ? "classfeature" : null,
                    name: parsed.documentId,
                    level: parentSelection.level,
                },
            },
        ];
    });
}
function buildSourceRollOptions(parentSelection, sourceDocument, activeRollOptions) {
    const options = new Set(Array.from(activeRollOptions, (option) => option.trim().toLowerCase()));
    const sourceSlug = toNonEmptyString(sourceDocument?.system?.slug)?.toLowerCase() ??
        parentSelection.slug?.trim().toLowerCase() ??
        slugifyName(parentSelection.name);
    const sourceCategory = toNonEmptyString(sourceDocument?.system?.featType
        ?.value ?? sourceDocument?.system?.category)?.toLowerCase();
    if (sourceSlug) {
        options.add(`${sourceCategory === "classfeature" ? "feature" : "feat"}:${sourceSlug}`);
    }
    options.add(`self:level:${selectionTakenLevel(parentSelection, documentFeatureLevel(sourceDocument))}`);
    return options;
}
function inferGrantedSourceItemType(selection, document) {
    const category = toNonEmptyString(document?.system?.category);
    return selection.packId === "pf2e.classfeatures" || category === "classfeature" ? "classfeature" : "feat";
}
function dedupeStaticGrantSources(sources) {
    const byParentAndUuid = new Map();
    for (const source of sources) {
        byParentAndUuid.set(`${source.parentSelection.uuid}|${source.grantRuleIndex}|${source.sourceSelection.uuid}`, source);
    }
    return Array.from(byParentAndUuid.values());
}
function isStringRecord(value) {
    return (!!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value).every((entry) => typeof entry === "string"));
}
//# sourceMappingURL=static-grant-choice-sources.js.map