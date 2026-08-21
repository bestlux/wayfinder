import { isActiveSkillTrainingChoice } from "./skill-training-choice-availability.js";
export function compileSkillProgression(options) {
    const baselineRanks = normalizeRanks(options.baselineRanks);
    const projected = { ...baselineRanks };
    const sourceGrants = Object.freeze((options.sourceGrants ?? []).flatMap((grant) => {
        const slug = normalizeSkillSlug(grant.slug);
        return slug
            ? [
                Object.freeze({
                    slug,
                    rank: normalizeRank(grant.rank ?? 1),
                    ...(grant.sourceId ? { sourceId: grant.sourceId } : {}),
                }),
            ]
            : [];
    }));
    const validSkillSlugs = Object.freeze(Array.from(options.validSkillSlugs).sort());
    for (const grant of sourceGrants) {
        setMinimumRank(projected, grant.slug, grant.rank);
    }
    const ranksBeforeSteps = freezeRanks(projected);
    const reconciledTrainings = {};
    const reconciledIncreases = {};
    const changedStepIds = new Set();
    const stepResults = [];
    for (const step of options.steps) {
        if (step.kind !== "skill-training" && step.kind !== "skill-increase")
            continue;
        const ranksBefore = freezeRanks(projected);
        const issues = [];
        if (step.kind === "skill-training") {
            const reconciliation = reconcileTraining(step, options, ranksBefore, issues);
            if (reconciliation.training) {
                reconciledTrainings[step.slotId] = reconciliation.training;
            }
            if (reconciliation.changed)
                changedStepIds.add(step.slotId);
            applyTrainingRanks(projected, step, reconciliation.training);
            stepResults.push(freezeStep({
                stepId: step.id,
                slotId: step.slotId,
                kind: step.kind,
                ranksBefore,
                ranksAfter: freezeRanks(projected),
                issues,
                progress: trainingProgress(step, reconciliation.training, issues),
            }));
            continue;
        }
        const selected = normalizeSkillSlug(options.draft.skillIncreases[step.slotId]);
        if (selected) {
            if (!options.validSkillSlugs.has(selected)) {
                issues.push(issue(step, "invalid-skill-increase", { slug: selected }));
                changedStepIds.add(step.slotId);
            }
            else if ((projected[selected] ?? 0) >= maxProficiencyRank(step.level)) {
                issues.push(issue(step, "skill-increase-at-cap", { slug: selected }));
                changedStepIds.add(step.slotId);
            }
            else {
                reconciledIncreases[step.slotId] = selected;
                projected[selected] = Math.min(4, (projected[selected] ?? 0) + 1);
            }
        }
        const progress = freezeProgress({
            selectedCount: selected && issues.length === 0 ? 1 : 0,
            requiredCount: 1,
            remainingCount: selected && issues.length === 0 ? 0 : 1,
            excessCount: 0,
            complete: !!selected && issues.length === 0,
        });
        stepResults.push(freezeStep({
            stepId: step.id,
            slotId: step.slotId,
            kind: step.kind,
            ranksBefore,
            ranksAfter: freezeRanks(projected),
            issues,
            progress,
        }));
    }
    const steps = Object.freeze(stepResults);
    const stepsBySlotId = Object.freeze(Object.fromEntries(steps.map((step) => [step.slotId, step])));
    const issues = Object.freeze(steps.flatMap((step) => step.issues));
    return Object.freeze({
        inputFingerprint: skillProgressionInputFingerprint(options),
        mode: options.mode,
        validSkillSlugs,
        baselineRanks: Object.freeze({ ...baselineRanks }),
        sourceGrants,
        ranksBeforeSteps,
        steps,
        stepsBySlotId,
        issues,
        finalRanks: freezeRanks(projected),
        reconciliation: Object.freeze({
            skillTrainings: freezeTrainingRecord(reconciledTrainings),
            skillIncreases: Object.freeze({ ...reconciledIncreases }),
            changedStepIds: Object.freeze(Array.from(changedStepIds)),
        }),
    });
}
export function skillProgressionInputFingerprint(options) {
    const plan = [];
    for (const step of options.steps) {
        if (step.kind === "skill-increase") {
            plan.push({
                kind: step.kind,
                slotId: step.slotId,
                level: step.level,
                selection: options.draft.skillIncreases[step.slotId] ?? null,
            });
        }
        else if (step.kind === "skill-training") {
            plan.push({
                kind: step.kind,
                slotId: step.slotId,
                level: step.level,
                training: step.training,
                selection: options.draft.skillTrainings[step.slotId] ?? null,
            });
        }
    }
    return JSON.stringify({
        baselineRanks: Object.entries(normalizeRanks(options.baselineRanks)).sort(([left], [right]) => left.localeCompare(right)),
        sourceGrants: (options.sourceGrants ?? [])
            .flatMap((grant) => {
            const slug = normalizeSkillSlug(grant.slug);
            return slug
                ? [
                    {
                        slug,
                        rank: normalizeRank(grant.rank ?? 1),
                        sourceId: grant.sourceId ?? null,
                    },
                ]
                : [];
        })
            .sort((left, right) => `${left.sourceId ?? ""}:${left.slug}:${left.rank}`.localeCompare(`${right.sourceId ?? ""}:${right.slug}:${right.rank}`)),
        validSkillSlugs: Array.from(options.validSkillSlugs).sort(),
        mode: options.mode,
        plan,
    });
}
export function maxProficiencyRank(level) {
    if (level >= 15)
        return 4;
    if (level >= 7)
        return 3;
    return 2;
}
function reconcileTraining(step, options, ranksBefore, issues) {
    const source = options.draft.skillTrainings[step.slotId];
    if (!source)
        return { training: null, changed: false };
    const activeRuleKeys = new Set(step.training.choiceRules.map((choice) => choice.key));
    const activeLoreKeys = new Set(step.training.loreChoices.map((choice) => choice.key));
    for (const key of Object.keys(source.ruleChoices)) {
        if (!activeRuleKeys.has(key))
            issues.push(issue(step, "unknown-rule-choice", { key }));
    }
    for (const key of Object.keys(source.loreChoices)) {
        if (!activeLoreKeys.has(key))
            issues.push(issue(step, "unknown-lore-choice", { key }));
    }
    const candidateRuleChoices = Object.fromEntries(step.training.choiceRules.flatMap((choice) => {
        const slug = normalizeSkillSlug(source.ruleChoices[choice.key]);
        if (!slug)
            return [];
        if (!options.validSkillSlugs.has(slug)) {
            issues.push(issue(step, "invalid-skill", { key: choice.key, slug }));
            return [];
        }
        return [[choice.key, slug]];
    }));
    const reservedAdditional = new Set([...step.training.fixedSkills, ...Object.values(candidateRuleChoices)]);
    const seenAdditional = new Set();
    const additional = [];
    for (const rawSlug of source.additional) {
        const slug = normalizeSkillSlug(rawSlug);
        if (!slug || !options.validSkillSlugs.has(slug)) {
            issues.push(issue(step, "invalid-skill", { slug: slug ?? String(rawSlug) }));
            continue;
        }
        if (seenAdditional.has(slug)) {
            issues.push(issue(step, "duplicate-additional", { slug }));
            continue;
        }
        seenAdditional.add(slug);
        if (reservedAdditional.has(slug)) {
            issues.push(issue(step, "reserved-additional", { slug }));
            continue;
        }
        if ((ranksBefore[slug] ?? 0) >= 1 && options.mode !== "recovery") {
            issues.push(issue(step, "already-trained-additional", { slug }));
            continue;
        }
        if (additional.length >= step.training.additionalCount) {
            issues.push(issue(step, "excess-additional", { slug }));
            continue;
        }
        additional.push(slug);
    }
    const ruleCandidate = {
        ruleChoices: candidateRuleChoices,
        additional,
        loreChoices: {},
    };
    const ruleChoices = Object.fromEntries(step.training.choiceRules.flatMap((choice) => {
        const slug = candidateRuleChoices[choice.key];
        if (!slug)
            return [];
        if (!isActiveSkillTrainingChoice(step.training, ruleCandidate, choice, ranksBefore, slug, options.mode === "recovery")) {
            issues.push(issue(step, "inactive-rule-choice", { key: choice.key, slug }));
            return [];
        }
        return [[choice.key, slug]];
    }));
    const loreChoices = Object.fromEntries(step.training.loreChoices.flatMap((choice) => {
        const selected = normalizeLoreValue(source.loreChoices[choice.key]);
        if (!selected)
            return [];
        const matchingSuggestion = choice.suggestions.find((suggestion) => sameLoreValue(suggestion, selected));
        if (!choice.allowCustom && !matchingSuggestion) {
            issues.push(issue(step, "invalid-lore-choice", { key: choice.key }));
            return [];
        }
        return [[choice.key, matchingSuggestion ?? selected]];
    }));
    const training = freezeTraining({ ruleChoices, additional, loreChoices });
    return { training, changed: !sameTraining(source, training) };
}
function applyTrainingRanks(ranks, step, training) {
    for (const slug of [
        ...step.training.fixedSkills,
        ...step.training.fixedLores,
        ...Object.values(training?.ruleChoices ?? {}),
        ...(training?.additional ?? []),
        ...Object.values(training?.loreChoices ?? {}),
    ]) {
        setMinimumRank(ranks, slug, 1);
    }
}
function trainingProgress(step, training, issues) {
    const selectedRuleCount = step.training.choiceRules.filter((choice) => !!training?.ruleChoices[choice.key]).length;
    const selectedLoreCount = step.training.loreChoices.filter((choice) => !!training?.loreChoices[choice.key]).length;
    const additionalCount = training?.additional.length ?? 0;
    const requiredCount = step.training.choiceRules.length + step.training.additionalCount + step.training.loreChoices.length;
    const selectedCount = selectedRuleCount + selectedLoreCount + additionalCount;
    const remainingCount = Math.max(0, requiredCount - selectedCount);
    const excessCount = issues.filter((entry) => entry.code === "excess-additional").length;
    return freezeProgress({
        selectedCount,
        requiredCount,
        remainingCount,
        excessCount,
        complete: remainingCount === 0 && excessCount === 0 && issues.length === 0,
    });
}
function issue(step, code, detail = {}) {
    return Object.freeze({ code, stepId: step.id, slotId: step.slotId, ...detail });
}
function normalizeRanks(source) {
    const ranks = {};
    for (const [rawSlug, rawRank] of Object.entries(source)) {
        const slug = normalizeSkillSlug(rawSlug);
        const rank = Number(rawRank);
        if (slug && Number.isFinite(rank))
            ranks[slug] = normalizeRank(rank);
    }
    return ranks;
}
function normalizeRank(value) {
    const rank = Number(value);
    return Number.isFinite(rank) ? Math.max(0, Math.min(4, Math.floor(rank))) : 1;
}
function setMinimumRank(ranks, rawSlug, rank) {
    const slug = normalizeSkillSlug(rawSlug);
    if (slug)
        ranks[slug] = Math.max(ranks[slug] ?? 0, rank);
}
function normalizeSkillSlug(value) {
    if (typeof value !== "string" || value.trim().length === 0)
        return null;
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function normalizeLoreValue(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().replace(/\s+/g, " ") : null;
}
function sameLoreValue(left, right) {
    return normalizeLoreValue(left)?.toLowerCase() === normalizeLoreValue(right)?.toLowerCase();
}
function sameTraining(left, right) {
    return (sameRecord(left.ruleChoices, right.ruleChoices) &&
        left.additional.length === right.additional.length &&
        left.additional.every((slug, index) => slug === right.additional[index]) &&
        sameRecord(left.loreChoices, right.loreChoices));
}
function sameRecord(left, right) {
    const leftEntries = Object.entries(left);
    return leftEntries.length === Object.keys(right).length && leftEntries.every(([key, value]) => right[key] === value);
}
function freezeRanks(ranks) {
    return Object.freeze({ ...ranks });
}
function freezeTraining(training) {
    return Object.freeze({
        ruleChoices: Object.freeze({ ...training.ruleChoices }),
        additional: Object.freeze([...training.additional]),
        loreChoices: Object.freeze({ ...training.loreChoices }),
    });
}
function freezeTrainingRecord(source) {
    return Object.freeze(Object.fromEntries(Object.entries(source).map(([slotId, training]) => [slotId, training])));
}
function freezeProgress(progress) {
    return Object.freeze({ ...progress });
}
function freezeStep(step) {
    return Object.freeze({
        ...step,
        issues: Object.freeze([...step.issues]),
        progress: freezeProgress(step.progress),
    });
}
//# sourceMappingURL=skill-progression.js.map