import { getEffectiveBuildState, listActorItems } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import { fetchSelectionDocument } from "../../pack-service.js";
import { parseCompendiumItemUuid } from "../../shared/compendium.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { sourceIdOf } from "../../shared/source-id.js";
import { buildClassBranchSteps, buildClassChoiceSteps, buildClassFeatSteps, buildClassGrantedItemSteps, buildClassSkillFeatSteps, buildClassTrainingSteps, } from "../class-choice-service.js";
import { findDraftSelectionByType } from "../draft-decisions.js";
import { readExistingBranchSelection, readExistingClassChoiceSelection, readExistingGrantedSelection, readExistingLanguageSelections, readExistingSingletonChoiceSelection, readExistingSingletonSourceSelection, } from "../existing-selection-service.js";
import { buildGrantChoiceSteps } from "../grant-choice-service.js";
import { buildLanguageChoiceSteps } from "../language-choice-service.js";
import { buildWayfinderPlan } from "../plan-service.js";
import { documentFeatureLevel, getDocumentRules, matchesChoicePredicateList, toNonEmptyString } from "../rule-data.js";
import { buildSingletonChoiceSteps } from "../singleton-choice-service.js";
import { buildFeatSpellChoiceSteps } from "../spell-choice/feat-step-builder.js";
import { asSpellChoiceClassDocument } from "../spell-choice/types.js";
import { buildSpellChoiceSteps, readExistingSpellChoiceSelections } from "../spell-choice-service.js";
const DEFAULT_DEPS = {
    buildWayfinderPlan,
    buildClassFeatSteps,
    buildClassSkillFeatSteps,
    buildClassTrainingSteps,
    buildGrantChoiceSteps,
    buildSingletonChoiceSteps,
    buildLanguageChoiceSteps,
    buildClassBranchSteps,
    buildClassGrantedItemSteps,
    buildClassChoiceSteps,
    buildSpellChoiceSteps,
    findDraftSelectionByType,
    readExistingSingletonSourceSelection,
    readExistingBranchSelection,
    readExistingGrantedSelection,
    readExistingLanguageSelections,
    readExistingClassChoiceSelection,
    readExistingSingletonChoiceSelection,
    readExistingSpellChoiceSelections,
    fetchSelectionDocument,
    extractDocumentSlug,
};
export async function buildWayfinderAppPlan(args, deps = DEFAULT_DEPS) {
    return deps.buildWayfinderPlan(args.snapshot, args.draft, {
        buildClassFeatSteps: async (planSnapshot, _planDraft, targetLevel) => deps.buildClassFeatSteps({
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fulfilledCount: planSnapshot.featCounts.class,
            fulfilledStepIds: planSnapshot.fulfilledStepIds,
        }),
        buildClassSkillFeatSteps: async (planSnapshot, _planDraft, targetLevel) => deps.buildClassSkillFeatSteps({
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fulfilledCount: countAppliedWayfinderSlotSelections(args.actor, "skill-feat"),
            fulfilledStepIds: planSnapshot.fulfilledStepIds,
        }),
        buildClassTrainingSteps: async (_planSnapshot, planDraft, targetLevel) => {
            const effectiveBuildState = await getEffectiveBuildState(args.actor, planDraft);
            return deps.buildClassTrainingSteps({
                draftClassSelection: deps.findDraftSelectionByType(planDraft, "class"),
                sourceSelections: [
                    {
                        sourceItemType: "ancestry",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "ancestry") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "ancestry"),
                        sourceDocument: effectiveBuildState.ancestry?.document ?? null,
                    },
                    {
                        sourceItemType: "heritage",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "heritage") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "heritage"),
                        sourceDocument: effectiveBuildState.heritage,
                    },
                    {
                        sourceItemType: "background",
                        sourceSelection: deps.findDraftSelectionByType(planDraft, "background") ??
                            deps.readExistingSingletonSourceSelection(args.actor, "background"),
                        sourceDocument: effectiveBuildState.background?.document ?? null,
                    },
                    ...(await resolveSkillTrainingFeatSources(planDraft, args, deps)),
                ],
                targetLevel,
                effectiveBuildState,
                fetchSelectionDocument: deps.fetchSelectionDocument,
                extractSlug: deps.extractDocumentSlug,
                localize: args.localize,
            });
        },
        buildGrantChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildGrantChoiceSteps({
            draft: planDraft,
            targetLevel,
            hasClassSelection: !!(deps.findDraftSelectionByType(planDraft, "class") ??
                deps.readExistingSingletonSourceSelection(args.actor, "class")),
            hasDeitySelection: !!(deps.findDraftSelectionByType(planDraft, "deity") ??
                deps.readExistingSingletonSourceSelection(args.actor, "deity")),
            sources: await resolveGrantChoiceSources(planDraft, args, deps),
            extractSlug: deps.extractDocumentSlug,
            readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
        }),
        buildSingletonChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildSingletonChoiceSteps({
            draft: planDraft,
            targetLevel,
            sources: await resolveSingletonChoiceSources(planDraft, args, deps),
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
            readExistingSingletonChoiceSelection: (choice) => deps.readExistingSingletonChoiceSelection(args.actor, choice),
        }),
        buildLanguageChoiceSteps: async (planSnapshot, planDraft, targetLevel) => deps.buildLanguageChoiceSteps({
            snapshot: planSnapshot,
            targetLevel,
            draft: planDraft,
            effectiveBuildState: await getEffectiveBuildState(args.actor, planDraft),
            availableLanguageSlugs: listAvailableLanguageSlugs(),
            readExistingLanguageSelections: () => deps.readExistingLanguageSelections(args.actor),
            localizeLanguage: (slug) => localizeLanguageLabel(slug),
        }),
        buildClassBranchSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassBranchSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            readExistingBranchSelection: (branch) => deps.readExistingBranchSelection(args.actor, branch),
        }),
        buildClassGrantedItemSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassGrantedItemSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            readExistingGrantedSelection: (grant) => deps.readExistingGrantedSelection(args.actor, grant),
        }),
        buildClassChoiceSteps: async (_planSnapshot, planDraft, targetLevel) => deps.buildClassChoiceSteps({
            draft: planDraft,
            effectiveClassDocument: await args.resolveDocument("class"),
            effectiveDeityDocument: await args.resolveDocument("deity"),
            additionalClassFeatures: await resolveSelectedClassFeatureChoiceSources(planDraft, args, deps),
            targetLevel,
            fetchSelectionDocument: deps.fetchSelectionDocument,
            extractSlug: deps.extractDocumentSlug,
            localize: args.localize,
            readExistingClassChoiceSelection: (choice) => deps.readExistingClassChoiceSelection(args.actor, choice),
        }),
        buildSpellChoiceSteps: async (planSnapshot, planDraft, targetLevel) => {
            const effectiveClassDocument = await args.resolveDocument("class");
            const effectiveDeityDocument = await args.resolveDocument("deity");
            const effectiveSchoolDocument = await args.resolveArcaneSchoolDocument();
            const readExistingSelections = (choice) => deps.readExistingSpellChoiceSelections(args.actor, choice);
            return [
                ...(await deps.buildSpellChoiceSteps({
                    draft: planDraft,
                    currentLevel: planSnapshot.level,
                    effectiveClassDocument,
                    effectiveDeityDocument,
                    effectiveSchoolDocument,
                    effectiveClassFeatureDocuments: await resolveSpellChoiceClassFeatureDocuments(planDraft, args, deps),
                    targetLevel,
                    extractSlug: deps.extractDocumentSlug,
                    readExistingSpellChoiceSelections: readExistingSelections,
                })),
                ...buildFeatSpellChoiceSteps({
                    draft: planDraft,
                    effectiveClassDocument: asSpellChoiceClassDocument(effectiveClassDocument),
                    featSources: await resolveSpellChoiceFeatSources(planDraft, args, deps),
                    extractSlug: deps.extractDocumentSlug,
                    readExistingSpellChoiceSelections: readExistingSelections,
                }),
            ];
        },
    });
}
function localizeLanguageLabel(slug) {
    const globals = globalThis;
    const configLanguages = globals.CONFIG?.PF2E?.languages ?? {};
    const languageKey = configLanguages[slug];
    if (typeof languageKey === "string" && languageKey.length > 0) {
        return game.i18n.localize(languageKey);
    }
    return slug
        .split(/[-_ ]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
function listAvailableLanguageSlugs() {
    const globals = globalThis;
    const unavailable = normalizeLanguageSet(globals.game?.pf2e?.settings?.campaign?.languages?.unavailable);
    return Object.keys(globals.CONFIG?.PF2E?.languages ?? {})
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug) => slug.length > 0 && !unavailable.has(slug));
}
function normalizeLanguageSet(value) {
    if (value instanceof Set) {
        return new Set(Array.from(value).filter((slug) => typeof slug === "string"));
    }
    if (Array.isArray(value)) {
        return new Set(value.filter((slug) => typeof slug === "string"));
    }
    return new Set();
}
export async function findPlanStepBySlotId(args, slotId, deps = DEFAULT_DEPS) {
    const plan = await buildWayfinderAppPlan(args, deps);
    return plan.steps.find((step) => step.slotId === slotId) ?? null;
}
async function resolveSingletonChoiceSources(draft, args, deps) {
    const itemTypes = [
        "ancestry",
        "heritage",
        "background",
        "class",
        "deity",
    ];
    const documents = await Promise.all(itemTypes.map((itemType) => args.resolveDocument(itemType)));
    const singletonItemSources = itemTypes
        .map((itemType, index) => {
        const sourceSelection = deps.findDraftSelectionByType(draft, itemType) ??
            deps.readExistingSingletonSourceSelection(args.actor, itemType);
        return {
            sourceItemType: itemType,
            sourceSelection,
            sourceDocument: documents[index],
        };
    })
        .filter((entry) => !!entry.sourceSelection && !!entry.sourceDocument);
    const featSelections = dedupeSelectionsByUuid([
        ...Object.values(draft.selections).filter(isSingletonChoiceFeatSelection),
        ...readExistingSkillTrainingFeatSelections(args.actor),
    ]);
    const featDocuments = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    return [
        ...singletonItemSources,
        ...featSelections.flatMap((sourceSelection, index) => {
            const sourceDocument = featDocuments[index];
            return sourceDocument
                ? [
                    {
                        sourceItemType: "feat",
                        sourceSelection,
                        sourceDocument,
                    },
                ]
                : [];
        }),
    ];
}
async function resolveSkillTrainingFeatSources(draft, args, deps) {
    const featSelections = dedupeSelectionsByUuid([
        ...Object.values(draft.selections).filter(isSkillTrainingFeatSelection),
        ...readExistingSkillTrainingFeatSelections(args.actor),
    ]);
    const documents = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    return featSelections.flatMap((sourceSelection, index) => {
        const sourceDocument = documents[index];
        return sourceDocument
            ? [
                {
                    sourceItemType: "feat",
                    sourceSelection,
                    sourceDocument,
                },
            ]
            : [];
    });
}
async function resolveGrantChoiceSources(draft, args, deps) {
    const sourceItemTypes = ["ancestry", "heritage", "background"];
    const sourceDocuments = await Promise.all(sourceItemTypes.map((itemType) => args.resolveDocument(itemType)));
    const featSelections = dedupeSelectionsByUuid([
        ...Object.values(draft.selections).filter(isGrantChoiceSourceFeatSelection),
        ...readExistingSkillTrainingFeatSelections(args.actor).filter(isGrantChoiceSourceFeatSelection),
    ]);
    const featDocuments = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    const classFeatureSelections = resolveSelectedClassFeatureSelections(draft, args.actor);
    const classFeatureDocuments = await Promise.all(classFeatureSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    return [
        ...sourceItemTypes.flatMap((sourceItemType, index) => {
            const sourceSelection = deps.findDraftSelectionByType(draft, sourceItemType) ??
                deps.readExistingSingletonSourceSelection(args.actor, sourceItemType);
            const sourceDocument = sourceDocuments[index];
            return sourceSelection && sourceDocument
                ? [
                    {
                        sourceItemType,
                        sourceSelection,
                        sourceDocument,
                    },
                ]
                : [];
        }),
        ...featSelections.flatMap((sourceSelection, index) => {
            const sourceDocument = featDocuments[index];
            return sourceDocument
                ? [
                    {
                        sourceItemType: "feat",
                        sourceSelection,
                        sourceDocument,
                    },
                ]
                : [];
        }),
        ...classFeatureSelections.flatMap((sourceSelection, index) => {
            const sourceDocument = classFeatureDocuments[index];
            return sourceDocument
                ? [
                    {
                        sourceItemType: "classfeature",
                        sourceSelection,
                        sourceDocument,
                    },
                ]
                : [];
        }),
    ];
}
function isAncestryFeatSelection(selection) {
    return selection.itemType === "feat" && selection.featType === "ancestry";
}
function isGrantChoiceFeatSelection(selection) {
    return (selection.itemType === "feat" &&
        selection.slotId.startsWith("grant-choice-") &&
        !isGrantChoiceClassFeatureSelection(selection));
}
function isGrantChoiceSourceFeatSelection(selection) {
    return selection.itemType === "feat" && selection.featType !== "classfeature";
}
async function resolveSpellChoiceClassFeatureDocuments(draft, args, deps) {
    const selections = resolveSelectedClassFeatureSelections(draft, args.actor);
    const documents = await Promise.all(selections.map((selection) => deps.fetchSelectionDocument(selection)));
    return documents.filter((document) => document !== null);
}
async function resolveSelectedClassFeatureChoiceSources(draft, args, deps) {
    const effectiveClassDocument = await args.resolveDocument("class");
    const classSlug = effectiveClassDocument ? deps.extractDocumentSlug(effectiveClassDocument) : null;
    const directSelections = resolveSelectedClassFeatureSelections(draft, args.actor);
    const directDocuments = await Promise.all(directSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    const directSources = directSelections.flatMap((selection, index) => {
        const document = directDocuments[index];
        return document ? [{ level: documentFeatureLevel(document), selection, document }] : [];
    });
    const staticGrantSelections = dedupeSelectionsByUuid(directSources.flatMap((source) => staticClassFeatureGrantSelections({
        actor: args.actor,
        classSlug,
        draft,
        extractSlug: deps.extractDocumentSlug,
        source,
    })));
    const staticGrantDocuments = await Promise.all(staticGrantSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    const staticGrantSources = staticGrantSelections.flatMap((selection, index) => {
        const document = staticGrantDocuments[index];
        return document ? [{ level: documentFeatureLevel(document), selection, document }] : [];
    });
    return dedupeClassFeatureSourcesByUuid([...directSources, ...staticGrantSources]);
}
function resolveSelectedClassFeatureSelections(draft, actor) {
    return dedupeSelectionsByUuid([
        ...Object.values(draft.branchSelections),
        ...Object.values(draft.selections).filter((selection) => isGrantChoiceClassFeatureSelection(selection)),
        ...readExistingClassFeatureSelections(actor),
    ]);
}
function staticClassFeatureGrantSelections(args) {
    const rollOptions = buildClassFeatureRollOptions(args);
    return getDocumentRules(args.source.document).flatMap((rule) => {
        if (rule.key !== "GrantItem") {
            return [];
        }
        const predicate = Array.isArray(rule.predicate) ? rule.predicate : [];
        if (predicate.length > 0 && !matchesChoicePredicateList(predicate, (statement) => rollOptions.has(statement))) {
            return [];
        }
        const uuid = toNonEmptyString(rule.uuid);
        const parsed = uuid ? parseCompendiumItemUuid(uuid) : null;
        if (!uuid || !parsed || parsed.packId !== "pf2e.classfeatures") {
            return [];
        }
        return [
            {
                slotId: `static-classfeature-grant-${parsed.documentId}`,
                packId: parsed.packId,
                documentId: parsed.documentId,
                uuid,
                itemType: "feat",
                featType: "classfeature",
                name: parsed.documentId,
                level: null,
            },
        ];
    });
}
function buildClassFeatureRollOptions(args) {
    const sourceSlug = args.extractSlug(args.source.document) ?? args.source.selection.documentId;
    const sourceLevel = documentFeatureLevel(args.source.document);
    const existingRulesSelections = readExistingRulesSelections(args.actor, args.source.selection.uuid);
    const rollOptions = new Set();
    if (args.classSlug) {
        rollOptions.add(`class:${args.classSlug}`.toLowerCase());
    }
    for (const rule of getDocumentRules(args.source.document)) {
        if (rule.key !== "ChoiceSet") {
            continue;
        }
        const choiceKey = classChoiceKeyForRule(rule, sourceSlug);
        if (!choiceKey) {
            continue;
        }
        const slotId = `class-choice-${sourceSlug}-${choiceKey}-level-${sourceLevel}`;
        const ruleFlag = toNonEmptyString(rule.flag);
        const selected = toNonEmptyString(args.draft.classChoices[slotId]) ??
            toNonEmptyString(existingRulesSelections[choiceKey]) ??
            (ruleFlag ? toNonEmptyString(existingRulesSelections[ruleFlag]) : null);
        if (!selected) {
            continue;
        }
        const rollOption = toNonEmptyString(rule.rollOption);
        if (rollOption) {
            rollOptions.add(`${rollOption}:${selected}`.toLowerCase());
        }
        rollOptions.add(`${choiceKey}:${selected}`.toLowerCase());
        if (ruleFlag && ruleFlag !== choiceKey) {
            rollOptions.add(`${ruleFlag}:${selected}`.toLowerCase());
        }
    }
    return rollOptions;
}
function classChoiceKeyForRule(rule, sourceSlug) {
    const flag = toNonEmptyString(rule.flag) ?? toNonEmptyString(rule.slug);
    return flag ? sanitizeChoiceFlag(flag) : toDromedaryFlag(sourceSlug);
}
function sanitizeChoiceFlag(value) {
    return value.replace(/[^-a-z0-9]/gi, "");
}
function toDromedaryFlag(value) {
    const parts = value
        .trim()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean);
    if (parts.length === 0) {
        return null;
    }
    return parts
        .map((part, index) => {
        const lower = part.toLowerCase();
        return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
        .join("");
}
function readExistingRulesSelections(actor, sourceUuid) {
    const item = listActorItems(actor).find((entry) => sourceIdOf(entry) === sourceUuid);
    return {
        ...(item?.flags?.system?.rulesSelections ?? {}),
        ...(item?.flags?.pf2e?.rulesSelections ?? {}),
    };
}
function dedupeClassFeatureSourcesByUuid(sources) {
    const byUuid = new Map();
    for (const source of sources) {
        byUuid.set(source.selection.uuid, source);
    }
    return Array.from(byUuid.values());
}
function isGrantChoiceClassFeatureSelection(selection) {
    return selection.slotId.startsWith("grant-choice-") && selection.packId === "pf2e.classfeatures";
}
function isSkillTrainingFeatSelection(selection) {
    return isAncestryFeatSelection(selection) || isGrantChoiceFeatSelection(selection);
}
function isSingletonChoiceFeatSelection(selection) {
    return isGrantChoiceFeatSelection(selection);
}
function readExistingClassFeatureSelections(actor) {
    return listActorItems(actor)
        .map((item) => selectionFromClassFeatureItem(item))
        .filter((selection) => selection !== null);
}
function selectionFromClassFeatureItem(item) {
    const typedItem = item;
    if (!typedItem || typedItem.type !== "feat") {
        return null;
    }
    const featType = typedItem.system?.featType?.value ?? typedItem.system?.category;
    if (featType !== "classfeature") {
        return null;
    }
    const sourceId = sourceIdOf(typedItem);
    const parsed = sourceId ? parseCompendiumItemUuid(sourceId) : null;
    if (!sourceId || !parsed) {
        return null;
    }
    const existingSlotId = typeof typedItem.flags?.[MODULE_ID]?.slotId === "string" && typedItem.flags[MODULE_ID].slotId.length > 0
        ? typedItem.flags[MODULE_ID].slotId
        : null;
    const level = toPositiveInteger(typedItem.system?.level?.value) ?? 1;
    return {
        slotId: existingSlotId ?? `existing-classfeature-${parsed.documentId}`,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid: sourceId,
        itemType: "feat",
        featType: "classfeature",
        name: typeof typedItem.name === "string" ? typedItem.name : parsed.documentId,
        level,
    };
}
async function resolveSpellChoiceFeatSources(draft, args, deps) {
    const featSelections = dedupeSelectionsByUuid([
        ...Object.values(draft.selections).filter(isAncestryFeatSelection),
        ...readExistingSkillTrainingFeatSelections(args.actor).filter(isAncestryFeatSelection),
    ]);
    const documents = await Promise.all(featSelections.map((selection) => deps.fetchSelectionDocument(selection)));
    return featSelections.flatMap((sourceSelection, index) => {
        const sourceDocument = documents[index];
        return sourceDocument ? [{ sourceSelection, sourceDocument }] : [];
    });
}
function readExistingSkillTrainingFeatSelections(actor) {
    return listActorItems(actor)
        .map((item) => selectionFromSkillTrainingFeatItem(item))
        .filter((selection) => selection !== null);
}
function countAppliedWayfinderSlotSelections(actor, slotKind) {
    const slotPrefix = `${slotKind}-level-`;
    const slotIds = new Set();
    for (const item of listActorItems(actor)) {
        const typedItem = item;
        const slotId = typedItem?.flags?.[MODULE_ID]?.slotId;
        if (typedItem?.type === "feat" && typeof slotId === "string" && slotId.startsWith(slotPrefix)) {
            slotIds.add(slotId);
        }
    }
    return slotIds.size;
}
function selectionFromSkillTrainingFeatItem(item) {
    const typedItem = item;
    if (!typedItem || typedItem.type !== "feat") {
        return null;
    }
    const featType = typedItem.system?.featType?.value ?? typedItem.system?.category;
    const existingSlotId = typeof typedItem.flags?.[MODULE_ID]?.slotId === "string" && typedItem.flags[MODULE_ID].slotId.length > 0
        ? typedItem.flags[MODULE_ID].slotId
        : null;
    const isSupportedFeat = featType === "ancestry" || !!existingSlotId?.startsWith("grant-choice-");
    if (!isSupportedFeat) {
        return null;
    }
    const sourceId = sourceIdOf(typedItem);
    if (!sourceId) {
        return null;
    }
    const parsed = parseCompendiumItemUuid(sourceId);
    if (!parsed) {
        return null;
    }
    const level = toPositiveInteger(typedItem.system?.level?.value) ?? 1;
    const slotId = existingSlotId ?? `ancestry-feat-level-${level}`;
    return {
        slotId,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid: sourceId,
        itemType: "feat",
        featType: "ancestry",
        name: typeof typedItem.name === "string" ? typedItem.name : "",
        level,
    };
}
function dedupeSelectionsByUuid(selections) {
    const seen = new Set();
    const result = [];
    for (const selection of selections) {
        if (seen.has(selection.uuid)) {
            continue;
        }
        seen.add(selection.uuid);
        result.push(selection);
    }
    return result;
}
function toPositiveInteger(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : null;
}
//# sourceMappingURL=wayfinder-plan-builder-service.js.map