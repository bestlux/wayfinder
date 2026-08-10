import { slugifyName } from "../shared/slug.js";
import { documentFeatureLevel, extractChoiceKey, getDocumentRules, matchesChoiceSetRulePredicate, } from "./rule-data.js";
export function buildProjectedChoiceRuleRollOptions(args) {
    const active = new Set();
    addOption(active, args.classSlug ? `class:${args.classSlug}` : null);
    addOption(active, args.ancestrySlug ? `ancestry:${args.ancestrySlug}` : null);
    addOption(active, args.deitySelected ? "deity" : null);
    addDraftSingletonRollOptions(active, args.draft);
    for (const option of collectSkillRankRollOptions(args.skillRanks)) {
        addOption(active, option);
    }
    for (const option of collectActorRuleSelectionRollOptions(args.actorItems)) {
        addOption(active, option);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const source of args.sources) {
            if (!source.sourceDocument || !source.sourceSelection) {
                continue;
            }
            const sourceSlug = sourceSlugFor(source);
            const sourceLevel = source.sourceLevel ?? documentFeatureLevel(source.sourceDocument);
            for (const rule of getDocumentRules(source.sourceDocument)) {
                if (rule.key !== "ChoiceSet" || !matchesChoiceSetRulePredicate(rule, active)) {
                    continue;
                }
                const flag = extractChoiceKey(rule);
                const rollOption = normalize(rule.rollOption);
                if (!flag || !rollOption) {
                    continue;
                }
                for (const value of draftedRuleSelectionValues(args.draft, source, sourceSlug, sourceLevel, flag)) {
                    const sizeBefore = active.size;
                    addOption(active, `${rollOption}:${value}`);
                    changed ||= active.size > sizeBefore;
                }
            }
        }
    }
    return active;
}
function addDraftSingletonRollOptions(active, draft) {
    for (const selection of Object.values(draft.selections)) {
        if (selection.itemType === "class") {
            const slug = normalize(selection.slug) ?? slugifyName(selection.name);
            addOption(active, slug ? `class:${slug}` : null);
        }
        else if (selection.itemType === "ancestry") {
            const slug = normalize(selection.slug) ?? slugifyName(selection.name);
            addOption(active, slug ? `ancestry:${slug}` : null);
        }
        else if (selection.itemType === "deity") {
            addOption(active, "deity");
        }
    }
}
export function collectActorRuleSelectionRollOptions(actorItems) {
    return actorItems.flatMap((item) => {
        const typedItem = item;
        const rulesSelections = {
            ...(typedItem?.flags?.system?.rulesSelections ?? {}),
            ...(typedItem?.flags?.pf2e?.rulesSelections ?? {}),
        };
        return getDocumentRules(item).flatMap((rule) => {
            if (rule.key !== "ChoiceSet") {
                return [];
            }
            const flag = extractChoiceKey(rule);
            const rollOption = normalize(rule.rollOption);
            const selection = flag ? normalize(rulesSelections[flag]) : null;
            return rollOption && selection ? [`${rollOption}:${selection}`] : [];
        });
    });
}
export function collectSkillRankRollOptions(skillRanks) {
    return Object.entries(skillRanks ?? {}).flatMap(([rawSlug, rawRank]) => {
        const slug = normalize(rawSlug)
            ?.replace(/[^a-z0-9]+/gu, "-")
            .replace(/^-+|-+$/gu, "");
        const rank = Number(rawRank);
        return slug && Number.isFinite(rank) ? [`skill:${slug}:rank:${Math.max(0, Math.min(4, Math.floor(rank)))}`] : [];
    });
}
function draftedRuleSelectionValues(draft, source, sourceSlug, sourceLevel, flag) {
    const values = new Set();
    const singletonSlotId = `singleton-choice-${source.sourceItemType}-${sourceSlug}-${flag}-level-${sourceLevel}`;
    const classChoiceSlotId = `class-choice-${sourceSlug}-${flag}-level-${sourceLevel}`;
    addOption(values, draft.singletonChoices[singletonSlotId]);
    addOption(values, draft.classChoices[classChoiceSlotId]);
    const trainingKey = `${source.sourceItemType}:${sourceSlug}:${flag}`;
    for (const training of Object.values(draft.skillTrainings)) {
        addOption(values, training.ruleChoices[trainingKey]);
    }
    const sourceSuffix = `-${source.sourceItemType}-${sourceSlug}-${flag}-level-${sourceLevel}`.toLowerCase();
    for (const [slotId, selection] of Object.entries(draft.selections)) {
        const normalizedSlotId = slotId.toLowerCase();
        if ((normalizedSlotId.startsWith("grant-choice-") || normalizedSlotId.startsWith("flag-choice-")) &&
            normalizedSlotId.endsWith(sourceSuffix)) {
            addSelectionValues(values, selection);
        }
    }
    const branchSuffix = `-${sourceSlug}-${flag}-level-${sourceLevel}`.toLowerCase();
    for (const [slotId, selection] of Object.entries(draft.branchSelections)) {
        if (slotId.toLowerCase().endsWith(branchSuffix)) {
            addSelectionValues(values, selection);
        }
    }
    return Array.from(values);
}
function addSelectionValues(values, selection) {
    if (!selection) {
        return;
    }
    addOption(values, selection.uuid);
    addOption(values, selection.slug);
    addOption(values, selection.documentId);
    addOption(values, slugifyName(selection.name));
}
function sourceSlugFor(source) {
    const documentSlug = normalize(source.sourceDocument?.system?.slug);
    return documentSlug ?? source.sourceSelection?.documentId ?? "source";
}
function addOption(options, value) {
    const normalized = normalize(value);
    if (normalized) {
        options.add(normalized);
    }
}
function normalize(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
//# sourceMappingURL=projected-rule-options.js.map