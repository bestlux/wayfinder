import { toCompendiumItemUuid } from "../shared/compendium.js";
import { discoverGrantSelectionMeta } from "../wayfinder/grant-choice/rule-discovery.js";
import { extractEntrySlug, isRecord, numericOrNull, resolveFeatType } from "./entry.js";
export function hasUnsupportedEmbeddedChoiceSet(entry, packId, step) {
    if (!entryHasChoiceSetRule(entry)) {
        return false;
    }
    if (step.kind === "class-branch") {
        return !Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0;
    }
    if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
        return false;
    }
    if (!["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind)) {
        return false;
    }
    return !hasSupportedEmbeddedGrantChoice(entry, packId);
}
export function hidesUnsupportedEmbeddedChoiceSets(step) {
    if (step.kind === "class-branch") {
        return !Array.isArray(step.filters?.predicate) || step.filters.predicate.length === 0;
    }
    if (step.kind !== "pick-item" || step.slotKind === "grant-choice") {
        return false;
    }
    return ["ancestry-feat", "class-feat", "general-feat", "skill-feat"].includes(step.slotKind);
}
function entryHasChoiceSetRule(entry) {
    const rules = entry?.system?.rules;
    return Array.isArray(rules) && rules.some((rule) => isRecord(rule) && rule.key === "ChoiceSet");
}
function hasSupportedEmbeddedGrantChoice(entry, packId) {
    if (entry.type !== "feat") {
        return false;
    }
    const documentId = String(entry._id ?? "");
    if (!documentId) {
        return false;
    }
    const sourceSelection = {
        slotId: "embedded-choice-probe",
        packId,
        documentId,
        uuid: toCompendiumItemUuid(packId, documentId),
        itemType: "feat",
        featType: resolveFeatType(entry),
        name: String(entry.name ?? documentId),
        level: numericOrNull(entry?.system?.level?.value),
    };
    return (discoverGrantSelectionMeta({
        sourceItemType: "feat",
        sourceDocument: entry,
        sourceSelection,
        extractSlug: extractEntrySlug,
    }).length > 0);
}
//# sourceMappingURL=embedded-choice-policy.js.map