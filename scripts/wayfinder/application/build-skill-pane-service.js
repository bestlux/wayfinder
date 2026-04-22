import { SKILL_LABELS } from "../../constants.js";
import { resolveSingletonChoiceSkillGrant } from "../../shared/singleton-choice-skill-grants.js";
import { extractDocumentSlug } from "../../shared/slug.js";
import { formatSlug } from "../formatting.js";
import { buildSkillIncreasePane, buildSkillTrainingPane, compareSkillIncreaseSlotIds } from "../panes/skill-pane.js";
import { discoverSingletonChoiceSpecs } from "../singleton-choice/rule-discovery.js";
export async function buildSkillPane(step, draft, deps) {
    if (step.kind !== "skill-training" && step.kind !== "skill-increase") {
        return null;
    }
    const projectedRanks = await projectSkillRanks(draft, step.slotId, {
        baseSkillRanks: deps.baseSkillRanks,
        resolveDocument: deps.resolveDocument,
        localize: deps.localize,
    });
    const skillEntries = buildSkillList(projectedRanks, {
        configSkills: deps.configSkills,
        localize: deps.localize,
    });
    if (step.kind === "skill-training") {
        return buildSkillTrainingPane(step, draft, projectedRanks, skillEntries, {
            isTrainingStepComplete: deps.isTrainingStepComplete,
        });
    }
    return buildSkillIncreasePane(step, draft, projectedRanks, skillEntries);
}
export async function projectSkillRanks(draft, upToSlotId, deps) {
    const projected = { ...deps.baseSkillRanks };
    const [ancestryDocument, heritageDocument, backgroundDocument, classDocument] = await Promise.all([
        deps.resolveDocument("ancestry"),
        deps.resolveDocument("heritage"),
        deps.resolveDocument("background"),
        deps.resolveDocument("class"),
    ]);
    for (const slug of extractFixedTrainedSkills(backgroundDocument)) {
        projected[slug] = Math.max(projected[slug] ?? 0, 1);
    }
    for (const slug of extractFixedTrainedSkills(classDocument)) {
        projected[slug] = Math.max(projected[slug] ?? 0, 1);
    }
    for (const slug of extractDraftedSingletonSkillChoices(draft, [
        { sourceItemType: "ancestry", document: ancestryDocument },
        { sourceItemType: "heritage", document: heritageDocument },
        { sourceItemType: "background", document: backgroundDocument },
    ], deps.localize)) {
        projected[slug] = Math.max(projected[slug] ?? 0, 1);
    }
    const sortedTrainingSlotIds = Object.keys(draft.skillTrainings).sort((left, right) => left.localeCompare(right));
    for (const slotId of sortedTrainingSlotIds) {
        if (slotId >= upToSlotId) {
            break;
        }
        const training = draft.skillTrainings[slotId];
        if (!training) {
            continue;
        }
        for (const slug of [...Object.values(training.ruleChoices), ...training.additional]) {
            if (!slug) {
                continue;
            }
            projected[slug] = Math.max(projected[slug] ?? 0, 1);
        }
    }
    const sortedSlotIds = Object.keys(draft.skillIncreases).sort(compareSkillIncreaseSlotIds);
    for (const slotId of sortedSlotIds) {
        if (slotId >= upToSlotId) {
            break;
        }
        const slug = draft.skillIncreases[slotId];
        if (slug && typeof projected[slug] === "number") {
            projected[slug] = Math.min(4, projected[slug] + 1);
        }
        else if (slug) {
            projected[slug] = 1;
        }
    }
    return projected;
}
function extractFixedTrainedSkills(document) {
    const typedDocument = document;
    const skills = Array.isArray(typedDocument?.system?.trainedSkills?.value)
        ? typedDocument.system.trainedSkills.value
        : [];
    return skills
        .filter((entry) => typeof entry === "string" && entry.length > 0)
        .map((entry) => entry.trim().toLowerCase());
}
function extractDraftedSingletonSkillChoices(draft, sources, localize) {
    return sources.flatMap(({ sourceItemType, document }) => {
        const sourceSlug = extractDocumentSlug(document);
        const sourceRules = document?.system?.rules;
        if (!document || !sourceSlug) {
            return [];
        }
        return discoverSingletonChoiceSpecs({
            sourceItemType,
            sourceDocument: document,
            sourceSlug,
            localize,
        })
            .map((choice) => {
            const selection = draft.singletonChoices[choice.slotId] ?? null;
            if (!selection || !choice.options.some((option) => option.value === selection)) {
                return null;
            }
            return resolveSingletonChoiceSkillGrant({
                rules: sourceRules,
                flag: choice.flag,
                selection,
            })?.skillSlug;
        })
            .filter((selection) => typeof selection === "string" && selection.length > 0);
    });
}
function buildSkillList(actorSkillRanks, deps) {
    const result = [];
    const seen = new Set();
    if (deps.configSkills && typeof deps.configSkills === "object") {
        for (const slug of Object.keys(deps.configSkills)) {
            const sourceLabel = resolveConfigSkillLabel(deps.configSkills[slug]);
            const label = skillLabel(slug, sourceLabel, deps.localize);
            result.push({ slug, label });
            seen.add(slug);
        }
    }
    else {
        for (const [slug, label] of Object.entries(SKILL_LABELS)) {
            result.push({ slug, label: skillLabel(slug, label, deps.localize) });
            seen.add(slug);
        }
    }
    for (const slug of Object.keys(actorSkillRanks)) {
        if (!seen.has(slug)) {
            result.push({ slug, label: skillLabel(slug, undefined, deps.localize) });
        }
    }
    return result.sort((left, right) => left.label.localeCompare(right.label));
}
function resolveConfigSkillLabel(entry) {
    if (typeof entry === "string") {
        return entry;
    }
    if (!entry || typeof entry !== "object") {
        return undefined;
    }
    const label = entry.label;
    return typeof label === "string" ? label : undefined;
}
function skillLabel(slug, sourceLabel, localize) {
    const localized = typeof sourceLabel === "string" && sourceLabel.length > 0 ? localize(sourceLabel) : "";
    if (localized && localized !== sourceLabel) {
        return localized;
    }
    const fallback = SKILL_LABELS[slug];
    if (fallback) {
        return localize(fallback);
    }
    return formatSlug(slug);
}
//# sourceMappingURL=build-skill-pane-service.js.map