import { stripPreselectedClassBranchEntries } from "../class-branch-service.js";
import { stripPreselectedClassFeatureEntries } from "../class-feature-choice-service.js";
import { MODULE_ID } from "../constants.js";
import { fetchSelectionDocument } from "../pack-service.js";
import { parseCompendiumItemUuid } from "../shared/compendium.js";
import { usesNativeGrantItemCreation } from "../shared/grant-creation-policy.js";
import { applyRuleSelectionToSource, ensureRuleSelections, stampImportedItemSource, } from "../shared/pf2e-item-source.js";
import { extractDocumentSlug, slugifyName } from "../shared/slug.js";
import { stripManualSystemItemGrants } from "./manual-system-item-grants.js";
import { EXPLICIT_GRANT_SOURCE_ITEM_TYPES } from "./selection-constants.js";
export const DEFAULT_CREATE_DEPS = {
    fetchSelectionDocument,
    stripPreselectedClassFeatureEntries,
    stripPreselectedClassBranchEntries,
};
export async function createEmbeddedSource(selection, draft, steps = [], deps = DEFAULT_CREATE_DEPS) {
    const document = await deps.fetchSelectionDocument(selection);
    if (!document) {
        return null;
    }
    const source = document.toObject();
    if (selection.itemType === "class" && draft) {
        deps.stripPreselectedClassFeatureEntries(source, draft, steps);
        deps.stripPreselectedClassBranchEntries(source, draft, steps);
    }
    if (draft) {
        stripManualSystemItemGrants(source);
        applyPendingSingletonChoices(source, selection, draft, steps);
        applyPendingClassChoices(source, selection, draft, steps);
        applyPendingBoostSelections(source, selection, draft);
        await applyPendingGrantChoiceSelections(source, selection, draft, steps, deps);
        await applyPendingStaticGrantPreselectChoices(source, draft, steps, deps);
        applyPendingTrainingSelections(source, selection, draft, steps);
        resolveGrantItemPreselectChoiceReferences(source);
    }
    if (draft && selection.itemType === "feat") {
        await applyPendingFeatSpellChoices(source, selection, draft, steps, deps);
    }
    stampImportedItemSource(source, { sourceId: selection.uuid, slotId: selection.slotId });
    return source;
}
function applyPendingBoostSelections(source, selection, draft) {
    if (!["ancestry", "background", "class"].includes(selection.itemType)) {
        return;
    }
    if (selection.itemType === "ancestry") {
        const ancestryBoosts = draft.boosts.ancestry;
        if (!ancestryBoosts.modeTouched &&
            Object.keys(ancestryBoosts.selectedBoosts).length === 0 &&
            !ancestryBoosts.voluntary.touched &&
            !ancestryBoosts.voluntary.enabled) {
            return;
        }
        source.system ??= {};
        if (ancestryBoosts.mode === "alternate") {
            source.system.alternateAncestryBoosts = [...ancestryBoosts.alternateBoosts];
        }
        else if (ancestryBoosts.modeTouched) {
            delete source.system.alternateAncestryBoosts;
        }
        applySelectedBoosts(source, ancestryBoosts.selectedBoosts);
        source.system.voluntary ??= {};
        source.system.voluntary.flaws = ancestryBoosts.voluntary.enabled ? [...ancestryBoosts.voluntary.flaws] : [];
        if (ancestryBoosts.voluntary.enabled && ancestryBoosts.voluntary.legacy) {
            source.system.voluntary.boost = ancestryBoosts.voluntary.boost;
        }
        else {
            delete source.system.voluntary.boost;
        }
        return;
    }
    if (selection.itemType === "background") {
        if (Object.keys(draft.boosts.background.selectedBoosts).length === 0) {
            return;
        }
        source.system ??= {};
        applySelectedBoosts(source, draft.boosts.background.selectedBoosts);
        return;
    }
    if (selection.itemType === "class") {
        if (!draft.boosts.class.keyAbility) {
            return;
        }
        source.system ??= {};
        source.system.keyAbility ??= {};
        source.system.keyAbility.selected = draft.boosts.class.keyAbility;
    }
}
function applySelectedBoosts(source, selectedBoosts) {
    source.system ??= {};
    source.system.boosts ??= {};
    for (const [slot, selected] of Object.entries(selectedBoosts)) {
        const boost = source.system.boosts[slot];
        if (boost && typeof boost === "object") {
            boost.selected = selected;
        }
    }
}
function applyPendingSingletonChoices(source, selection, draft, steps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const step of steps) {
        if (step.kind !== "singleton-choice" ||
            !step.singletonChoice ||
            step.singletonChoice.sourceUuid !== selection.uuid) {
            continue;
        }
        const value = draft.singletonChoices[step.slotId];
        if (typeof value !== "string" || value.length === 0) {
            continue;
        }
        applyRuleSelection(source, step.singletonChoice.sourceRuleIndex, step.singletonChoice.flag, value);
    }
}
function applyPendingClassChoices(source, selection, draft, steps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const step of steps) {
        if (step.kind !== "class-choice" || !step.classChoice || step.classChoice.sourceUuid !== selection.uuid) {
            continue;
        }
        const value = draft.classChoices[step.slotId];
        if (typeof value !== "string" || value.length === 0) {
            continue;
        }
        applyRuleSelection(source, step.classChoice.sourceRuleIndex, step.classChoice.flag, value);
    }
}
function applyPendingTrainingSelections(source, selection, draft, steps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const step of steps) {
        if (step.kind !== "skill-training" || !step.training) {
            continue;
        }
        const training = draft.skillTrainings[step.slotId];
        if (!training) {
            continue;
        }
        for (const choiceRule of step.training.choiceRules) {
            const choice = training.ruleChoices[choiceRule.key];
            if (choice) {
                applyTrainingRuleSelection(source, selection, choiceRule.persistence, choiceRule.flag, choice);
            }
        }
        for (const loreChoice of step.training.loreChoices) {
            const choice = training.loreChoices[loreChoice.key];
            if (choice) {
                applyTrainingRuleSelection(source, selection, loreChoice.persistence, loreChoice.flag, choice);
            }
        }
    }
}
function applyTrainingRuleSelection(source, selection, persistence, flag, value) {
    if (!persistence || persistence.sourceUuid !== selection.uuid) {
        return;
    }
    applyRuleSelection(source, persistence.sourceRuleIndex, flag, value);
}
async function applyPendingGrantChoiceSelections(source, selection, draft, steps, deps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    ensureRuleSelections(source);
    const grantRuleIndexesToRemove = new Set();
    for (const step of steps) {
        if (step.kind !== "pick-item" || !step.grantSelection || step.grantSelection.selectorUuid !== selection.uuid) {
            continue;
        }
        const grantedSelection = draft.selections[step.slotId];
        if (!grantedSelection) {
            continue;
        }
        applyRuleSelection(source, step.grantSelection.selectorRuleIndex, step.grantSelection.flag, grantedSelection.uuid);
        const grantRule = rules[step.grantSelection.grantRuleIndex];
        if (grantRule && typeof grantRule === "object") {
            const preselectChoices = await collectGrantedItemPreselectChoices(grantedSelection, draft, steps, deps);
            if (Object.keys(preselectChoices).length > 0) {
                const ruleRecord = grantRule;
                ruleRecord.preselectChoices = {
                    ...(isLooseRecord(ruleRecord.preselectChoices) ? ruleRecord.preselectChoices : {}),
                    ...preselectChoices,
                };
            }
        }
        if (EXPLICIT_GRANT_SOURCE_ITEM_TYPES.has(step.grantSelection.sourceItemType) &&
            !usesNativeGrantItemCreation(step)) {
            grantRuleIndexesToRemove.add(step.grantSelection.grantRuleIndex);
        }
    }
    if (grantRuleIndexesToRemove.size > 0) {
        source.system ??= {};
        source.system.rules = rules.filter((_rule, index) => !grantRuleIndexesToRemove.has(index));
    }
}
async function collectGrantedItemPreselectChoices(grantedSelection, draft, steps, deps) {
    const preselectChoices = {};
    for (const step of steps) {
        if (step.kind === "skill-training" && step.training && draft.skillTrainings[step.slotId]) {
            const training = draft.skillTrainings[step.slotId];
            for (const choiceRule of step.training.choiceRules) {
                const value = training.ruleChoices[choiceRule.key];
                if (choiceRule.persistence?.sourceUuid === grantedSelection.uuid && value) {
                    preselectChoices[choiceRule.flag] = value;
                }
            }
            for (const loreChoice of step.training.loreChoices) {
                const value = training.loreChoices[loreChoice.key];
                if (loreChoice.persistence?.sourceUuid === grantedSelection.uuid && value) {
                    preselectChoices[loreChoice.flag] = value;
                }
            }
        }
        if (step.kind === "spell-choice" && step.spellChoice?.sourceUuid === grantedSelection.uuid) {
            const spellSelections = draft.spellChoices[step.slotId] ?? [];
            const spellSelection = spellSelections[0];
            if (spellSelection) {
                const flag = await resolveGrantedSpellChoiceFlag(grantedSelection, deps);
                if (flag) {
                    preselectChoices[flag] = await resolveSpellChoiceSelectionValue(spellSelection, deps);
                }
            }
        }
        if (step.kind === "singleton-choice" && step.singletonChoice?.sourceUuid === grantedSelection.uuid) {
            const value = draft.singletonChoices[step.slotId];
            if (typeof value === "string" && value.length > 0) {
                preselectChoices[step.singletonChoice.flag] = value;
            }
        }
        if (step.kind === "pick-item" && step.grantSelection?.selectorUuid === grantedSelection.uuid) {
            const nestedSelection = draft.selections[step.slotId];
            if (nestedSelection) {
                preselectChoices[step.grantSelection.flag] = nestedSelection.uuid;
            }
        }
        if (step.kind === "class-choice" && step.classChoice?.sourceUuid === grantedSelection.uuid) {
            const value = draft.classChoices[step.slotId];
            if (typeof value === "string" && value.length > 0) {
                preselectChoices[step.classChoice.flag] = value;
            }
        }
    }
    return preselectChoices;
}
async function applyPendingStaticGrantPreselectChoices(source, draft, steps, deps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const rule of rules) {
        if (!isLooseRecord(rule) || rule.key !== "GrantItem") {
            continue;
        }
        const uuid = typeof rule.uuid === "string" ? rule.uuid : null;
        const grantedSelection = uuid ? selectionFromStaticGrantUuid(uuid) : null;
        if (!grantedSelection) {
            continue;
        }
        const preselectChoices = await collectGrantedItemPreselectChoices(grantedSelection, draft, steps, deps);
        if (Object.keys(preselectChoices).length === 0) {
            continue;
        }
        rule.preselectChoices = {
            ...(isLooseRecord(rule.preselectChoices) ? rule.preselectChoices : {}),
            ...preselectChoices,
        };
        registerManualStaticItemGrant(source, grantedSelection.uuid, preselectChoices);
    }
    const manualGrants = readManualStaticItemGrants(source);
    if (manualGrants.length > 0) {
        source.system ??= {};
        source.system.rules = rules.filter((rule) => !(isLooseRecord(rule) &&
            rule.key === "GrantItem" &&
            typeof rule.uuid === "string" &&
            manualGrants.some((grant) => grant.uuid === rule.uuid)));
    }
}
function resolveGrantItemPreselectChoiceReferences(source) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const rule of rules) {
        if (!isLooseRecord(rule) || rule.key !== "GrantItem" || !isLooseRecord(rule.preselectChoices)) {
            continue;
        }
        for (const [key, value] of Object.entries(rule.preselectChoices)) {
            if (typeof value !== "string") {
                continue;
            }
            const resolved = resolveRuleSelectionReference(source, value);
            if (resolved) {
                rule.preselectChoices[key] = resolved;
            }
        }
    }
}
function resolveRuleSelectionReference(source, value) {
    const match = /^\{item\|flags\.(?:system|pf2e)\.rulesSelections\.([^}]+)\}$/u.exec(value);
    if (!match) {
        return null;
    }
    const flag = match[1];
    const pf2eSelection = source.flags?.pf2e?.rulesSelections?.[flag];
    if (typeof pf2eSelection === "string" && pf2eSelection.length > 0) {
        return pf2eSelection;
    }
    const systemFlags = source.flags?.system;
    const systemRulesSelections = isLooseRecord(systemFlags) ? systemFlags.rulesSelections : null;
    const systemSelection = isLooseRecord(systemRulesSelections) ? systemRulesSelections[flag] : null;
    return typeof systemSelection === "string" && systemSelection.length > 0 ? systemSelection : null;
}
function selectionFromStaticGrantUuid(uuid) {
    if (uuid.includes("{")) {
        return null;
    }
    const parsed = parseCompendiumItemUuid(uuid);
    if (!parsed) {
        return null;
    }
    return {
        slotId: `static-grant-${slugifyName(parsed.documentId) ?? "item"}`,
        packId: parsed.packId,
        documentId: parsed.documentId,
        uuid,
        itemType: parsed.packId === "pf2e.deities" ? "deity" : "feat",
        featType: parsed.packId === "pf2e.classfeatures" ? "classfeature" : null,
        name: parsed.documentId,
        level: null,
    };
}
function registerManualStaticItemGrant(source, uuid, choices) {
    const key = manualStaticGrantKey(uuid);
    if (!key) {
        return;
    }
    source.flags ??= {};
    source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        manualStaticItemGrants: [
            ...readManualStaticItemGrants(source),
            {
                key,
                uuid,
                choices,
            },
        ],
    };
}
function readManualStaticItemGrants(source) {
    const grants = source.flags?.[MODULE_ID]?.manualStaticItemGrants;
    if (!Array.isArray(grants)) {
        return [];
    }
    return grants.flatMap((grant) => {
        if (!isLooseRecord(grant) ||
            typeof grant.key !== "string" ||
            typeof grant.uuid !== "string" ||
            !isLooseRecord(grant.choices)) {
            return [];
        }
        return [
            {
                key: grant.key,
                uuid: grant.uuid,
                choices: Object.fromEntries(Object.entries(grant.choices).filter((entry) => typeof entry[1] === "string")),
            },
        ];
    });
}
function manualStaticGrantKey(uuid) {
    const parsed = parseCompendiumItemUuid(uuid);
    return parsed ? toDromedary(slugifyName(parsed.documentId) ?? parsed.documentId) : null;
}
function toDromedary(value) {
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
async function resolveGrantedSpellChoiceFlag(grantedSelection, deps) {
    const document = await deps.fetchSelectionDocument(grantedSelection);
    const source = document?.toObject();
    const rules = Array.isArray(source?.system?.rules) ? source.system.rules : [];
    const rule = rules.find((entry) => isSpellChoiceRule(entry));
    return typeof rule?.flag === "string" ? rule.flag : null;
}
async function applyPendingFeatSpellChoices(source, selection, draft, steps, deps) {
    const rules = Array.isArray(source.system?.rules) ? source.system.rules : [];
    if (rules.length === 0) {
        return;
    }
    for (const step of steps) {
        if (step.kind !== "spell-choice" || !step.spellChoice || step.spellChoice.sourceUuid !== selection.uuid) {
            continue;
        }
        const spellSelection = draft.spellChoices[step.slotId]?.[0];
        if (!spellSelection) {
            continue;
        }
        const ruleIndex = rules.findIndex((rule) => isSpellChoiceRule(rule));
        const rule = ruleIndex >= 0 ? rules[ruleIndex] : null;
        const flag = typeof rule?.flag === "string" ? rule.flag : null;
        if (!flag) {
            continue;
        }
        const spellSlug = await resolveSpellChoiceSelectionValue(spellSelection, deps);
        applyRuleSelection(source, ruleIndex, flag, spellSlug);
    }
}
async function resolveSpellChoiceSelectionValue(spellSelection, deps) {
    const spellDocument = await deps.fetchSelectionDocument(spellSelection);
    return (extractDocumentSlug(spellDocument) ??
        extractDocumentSlug(spellDocument?.toObject()) ??
        slugifyName(spellSelection.name) ??
        spellSelection.documentId);
}
function applyRuleSelection(source, sourceRuleIndex, flag, value) {
    applyRuleSelectionToSource(source, sourceRuleIndex, flag, value);
}
function isSpellChoiceRule(rule) {
    const choices = rule.choices;
    return rule.key === "ChoiceSet" && typeof rule.flag === "string" && choices?.itemType === "spell";
}
function isLooseRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=selection-source-application.js.map