import { buildGrantChoiceStepsFromRules } from "./grant-choice/step-builders.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, isRecord, toNonEmptyString } from "./rule-data.js";
export async function buildGrantChoiceSteps(params) {
    if (params.targetLevel < 1) {
        return [];
    }
    return params.sources
        .flatMap((source) => buildGrantChoiceStepsFromRules({
        sourceItemType: source.sourceItemType,
        effectiveSourceDocument: source.sourceDocument,
        sourceSelection: source.sourceSelection,
        extractSlug: params.extractSlug,
    }).map((step) => ({ source, step })))
        .filter(({ source, step }) => {
        if (!isSourceRollOptionReady(step, source, params.draft, params.extractSlug)) {
            return false;
        }
        const dependency = step.grantSelection?.dependsOn ?? null;
        if (dependency === "class" && !params.hasClassSelection) {
            return false;
        }
        if (dependency === "deity" && !params.hasDeitySelection) {
            return false;
        }
        return (!step.grantSelection ||
            !shouldSkipExistingStep(params.draft.selections[step.slotId], params.readExistingGrantedSelection(step.grantSelection)));
    })
        .map(({ step }) => step);
}
function shouldSkipExistingStep(draftSelection, actorSelection) {
    return !!actorSelection && !draftSelection;
}
function isSourceRollOptionReady(step, source, draft, extractSlug) {
    if (step.kind !== "pick-item" || step.slotKind !== "grant-choice" || !step.grantSelection) {
        return true;
    }
    if (!source.sourceDocument || !source.sourceSelection) {
        return true;
    }
    const sourceRollOptions = collectReferencedSourceRollOptions(step.grantSelection.filters, source.sourceDocument);
    if (sourceRollOptions.size === 0) {
        return true;
    }
    const sourceSlug = extractSlug(source.sourceDocument) ?? source.sourceSelection.documentId;
    const draftedRollOptions = collectDraftedSourceRollOptions({
        draft,
        sourceItemType: source.sourceItemType,
        sourceSlug,
        sourceLevel: documentFeatureLevel(source.sourceDocument),
        sourceRollOptions,
    });
    for (const rollOption of sourceRollOptions.keys()) {
        if (!draftedRollOptions.has(rollOption)) {
            return false;
        }
    }
    return true;
}
function collectReferencedSourceRollOptions(filters, sourceDocument) {
    const sourceRollOptions = collectSourceRollOptions(sourceDocument);
    if (sourceRollOptions.size === 0) {
        return sourceRollOptions;
    }
    const predicateStrings = collectPredicateStrings([
        ...(filters.contextPredicate ?? []),
        ...Object.values(filters.uuidPredicates ?? {}).flat(),
    ]);
    const referenced = new Map();
    for (const [rollOption, flag] of sourceRollOptions) {
        if (predicateStrings.some((predicate) => predicate.startsWith(`${rollOption}:`))) {
            referenced.set(rollOption, flag);
        }
    }
    return referenced;
}
function collectSourceRollOptions(sourceDocument) {
    const rollOptions = new Map();
    for (const rule of getDocumentRules(sourceDocument)) {
        if (rule.key !== "ChoiceSet") {
            continue;
        }
        const flag = extractChoiceKey(rule);
        const rollOption = toNonEmptyString(rule.rollOption);
        if (!flag || !rollOption) {
            continue;
        }
        rollOptions.set(rollOption.trim().toLowerCase(), flag);
    }
    return rollOptions;
}
function collectDraftedSourceRollOptions(args) {
    const selectedRollOptions = new Set();
    for (const [rollOption, flag] of args.sourceRollOptions) {
        const singletonSlotId = `singleton-choice-${args.sourceItemType}-${args.sourceSlug}-${flag}-level-${args.sourceLevel}`;
        const singletonSelection = args.draft.singletonChoices[singletonSlotId];
        if (typeof singletonSelection === "string" && singletonSelection.trim().length > 0) {
            selectedRollOptions.add(rollOption);
            continue;
        }
        const trainingKey = `${args.sourceItemType}:${args.sourceSlug}:${flag}`;
        for (const training of Object.values(args.draft.skillTrainings)) {
            const selection = training.ruleChoices[trainingKey];
            if (typeof selection === "string" && selection.trim().length > 0) {
                selectedRollOptions.add(rollOption);
            }
        }
    }
    return selectedRollOptions;
}
function collectPredicateStrings(predicate) {
    if (typeof predicate === "string") {
        return [predicate.trim().toLowerCase()].filter((entry) => entry.length > 0);
    }
    if (Array.isArray(predicate)) {
        return predicate.flatMap((entry) => collectPredicateStrings(entry));
    }
    if (!isRecord(predicate)) {
        return [];
    }
    return [
        ...collectPredicateStringsFromBranch(predicate.or),
        ...collectPredicateStringsFromBranch(predicate.nor),
        ...collectPredicateStringsFromBranch(predicate.not),
    ];
}
function collectPredicateStringsFromBranch(branch) {
    if (branch === undefined) {
        return [];
    }
    return collectPredicateStrings(branch);
}
//# sourceMappingURL=grant-choice-service.js.map