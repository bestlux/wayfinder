import { createBoostStep, createPickItemStep, createSkillIncreaseStep, sortWeightForSlotKind, } from "./wayfinder/domain/step-types.js";
const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
const FREE_ARCHETYPE_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const SKILL_FEAT_LEVELS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
const GENERAL_FEAT_LEVELS = [3, 7, 11, 15, 19];
const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19];
const ABILITY_BOOST_LEVELS = [5, 10, 15, 20];
export function buildProgressionPlan(snapshot, requestedTargetLevel) {
    const currentLevel = clampLevel(snapshot.level);
    const currentSteps = buildSteps(snapshot, currentLevel, currentLevel);
    const recommendedTargetLevel = currentSteps.length > 0 || snapshot.isBlank ? currentLevel : Math.min(currentLevel + 1, 20);
    const targetLevel = clampLevel(requestedTargetLevel ?? recommendedTargetLevel);
    return {
        recommendedTargetLevel,
        targetLevel,
        steps: buildSteps(snapshot, currentLevel, targetLevel),
    };
}
export function buildSteps(snapshot, currentLevel, targetLevel) {
    const steps = [];
    if (!snapshot.singletonSlots.ancestry) {
        steps.push(makePickStep("ancestry", 1, "Choose an ancestry", "Pick the ancestry your character was born into. Lineage, traits, and a few starting boosts come from here.", {
            itemType: "ancestry",
        }));
    }
    if (!snapshot.singletonSlots.heritage) {
        steps.push(makePickStep("heritage", 1, "Choose a heritage", "Heritages refine your ancestry — a sub-lineage with its own twist on the lineup.", {
            itemType: "heritage",
        }));
    }
    if (!snapshot.singletonSlots.background) {
        steps.push(makePickStep("background", 1, "Choose a background", "Backgrounds set who your character was before adventuring — a starting boost and a couple of trained skills.", {
            itemType: "background",
        }));
    }
    if (!snapshot.singletonSlots.class) {
        steps.push(makePickStep("class", 1, "Choose a class", "Your class is the spine of the build — fighter, wizard, rogue, cleric. Almost everything else hangs off this choice.", {
            itemType: "class",
        }));
    }
    steps.push(...buildFeatSteps("ancestry-feat", "Level {level} ancestry feat", "Pick the ancestry feat unlocked at this milestone.", ANCESTRY_FEAT_LEVELS, snapshot.featCounts.ancestry, snapshot.fulfilledStepIds, targetLevel, {
        itemType: "feat",
        featTypes: ["ancestry"],
    }));
    if (snapshot.freeArchetypeEnabled) {
        steps.push(...buildFeatSteps("archetype-feat", "Level {level} Free Archetype feat", "Fill PF2E's separate Free Archetype slot. Wayfinder mirrors PF2E's available archetype pool but cannot exhaustively validate access, prerequisites, archetype-family restrictions, or dedication lockouts; confirm eligibility with your GM.", FREE_ARCHETYPE_FEAT_LEVELS, snapshot.featCounts.archetype, snapshot.fulfilledStepIds, targetLevel, {
            itemType: "feat",
            featTypes: ["class"],
        }));
    }
    steps.push(...buildFeatSteps("skill-feat", "Level {level} skill feat", "Pick the skill feat unlocked at this milestone.", SKILL_FEAT_LEVELS, snapshot.featCounts.skill, snapshot.fulfilledStepIds, targetLevel, {
        itemType: "feat",
        featTypes: ["skill"],
    }));
    steps.push(...buildFeatSteps("general-feat", "Level {level} general feat", "Pick the general feat unlocked at this milestone.", GENERAL_FEAT_LEVELS, snapshot.featCounts.general, snapshot.fulfilledStepIds, targetLevel, {
        itemType: "feat",
        featTypes: ["general"],
    }));
    if (snapshot.isBlank || !allCreationAnchorsPresent(snapshot)) {
        steps.push(makeBoostStep("ability-boosts", 1, "Assign creation boosts", "Allocate ancestry, background, class, and free level 1 boosts inside Wayfinder before finalizing the draft."));
    }
    for (const level of ABILITY_BOOST_LEVELS) {
        if (level > currentLevel && level <= targetLevel) {
            steps.push(makeBoostStep("ability-boosts", level, `Level ${level} ability boosts`, "Spend this level's four free ability boosts. Pick four different abilities — no doubling up."));
        }
    }
    for (const level of SKILL_INCREASE_LEVELS) {
        if (level > currentLevel && level <= targetLevel) {
            steps.push(makeSkillIncreaseStep(level));
        }
    }
    return sortPendingSteps(steps);
}
export function sortPendingSteps(steps) {
    return [...steps].sort((left, right) => {
        const levelDelta = left.level - right.level;
        if (levelDelta !== 0) {
            return levelDelta;
        }
        const kindDelta = sortWeightForSlotKind(left.slotKind) - sortWeightForSlotKind(right.slotKind);
        if (kindDelta !== 0) {
            return kindDelta;
        }
        const classChoiceRuleDelta = sameSourceClassChoiceRuleDelta(left, right);
        if (classChoiceRuleDelta !== 0) {
            return classChoiceRuleDelta;
        }
        return left.title.localeCompare(right.title);
    });
}
function sameSourceClassChoiceRuleDelta(left, right) {
    if (left.kind !== "class-choice" || right.kind !== "class-choice") {
        return 0;
    }
    if (left.classChoice.sourceUuid !== right.classChoice.sourceUuid) {
        return 0;
    }
    return left.classChoice.sourceRuleIndex - right.classChoice.sourceRuleIndex;
}
export function parseCompendiumAllowlist(raw) {
    return String(raw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}
export function mergePackIds(basePackIds, extraPackIds) {
    return Array.from(new Set([...basePackIds, ...extraPackIds]));
}
function buildFeatSteps(slotKind, titleTemplate, description, slotLevels, fulfilledCount, fulfilledStepIds, targetLevel, filters) {
    const milestones = slotLevels.filter((value) => value <= targetLevel);
    const fulfilledSlotIds = fulfilledStepIdsForKind(fulfilledStepIds, slotKind);
    const effectiveMilestones = fulfilledSlotIds.size > 0
        ? milestones.filter((level) => !fulfilledSlotIds.has(`${slotKind}-level-${level}`))
        : milestones.slice(Math.min(Math.max(0, fulfilledCount), milestones.length));
    return effectiveMilestones.map((level) => createPickItemStep(slotKind, level, titleTemplate.replace("{level}", String(level)), description, {
        itemType: filters.itemType,
        featTypes: filters.featTypes,
        maxLevel: level,
    }));
}
function fulfilledStepIdsForKind(fulfilledStepIds, slotKind) {
    const prefix = `${slotKind}-level-`;
    return new Set(fulfilledStepIds.filter((slotId) => slotId.startsWith(prefix)));
}
function makeSkillIncreaseStep(level) {
    const maxRankLabel = level >= 15 ? "Legendary" : level >= 7 ? "Master" : "Expert";
    return createSkillIncreaseStep(level, `Level ${level} skill increase`, `Increase one skill's proficiency rank by one step (up to ${maxRankLabel} at this level).`);
}
function allCreationAnchorsPresent(snapshot) {
    return (snapshot.singletonSlots.ancestry &&
        snapshot.singletonSlots.heritage &&
        snapshot.singletonSlots.background &&
        snapshot.singletonSlots.class);
}
function clampLevel(level) {
    if (!Number.isFinite(level)) {
        return 1;
    }
    return Math.max(1, Math.min(20, Math.floor(level)));
}
function makePickStep(slotKind, level, title, description, filters) {
    return createPickItemStep(slotKind, level, title, description, filters);
}
function makeBoostStep(_slotKind, level, title, description) {
    return createBoostStep(level, title, description);
}
//# sourceMappingURL=progression.js.map