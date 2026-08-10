import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
export function buildSpontaneousRepertoireSpellChoiceSteps(params) {
    const source = findClassFeatureSource(params.effectiveClassDocument, params.spellcastingFeatureName);
    const destination = {
        type: "spontaneous",
        key: `${params.classSlug}-${params.tradition}-spontaneous`,
        label: `${formatTitle(params.tradition)} spell repertoire`,
        entryName: `${formatTitle(params.tradition)} Spontaneous Spells`,
        tradition: params.tradition,
        ability: params.ability,
        prepared: "spontaneous",
    };
    const steps = [];
    const addStep = (step) => appendPendingSpellChoiceStep(steps, step, params.draft, params.readExistingSpellChoiceSelections);
    addGrantedSpellStep(params, addStep, destination, 0, 1);
    addStep(makeSpellChoiceStep({
        slotId: `spell-choice-${params.classSlug}-cantrips-level-1`,
        level: 1,
        title: `${formatTitle(params.classSlug)} cantrips`,
        description: `Choose the ${params.cantripCount} ${params.tradition} cantrips in your starting repertoire.`,
        source,
        classSlug: params.classSlug,
        dependsOn: "class",
        count: params.cantripCount,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination,
    }));
    addGrantedSpellStep(params, addStep, destination, 1, 1);
    addStep(makeSpellChoiceStep({
        slotId: `spell-choice-${params.classSlug}-repertoire-rank-1-level-1`,
        level: 1,
        title: `${formatTitle(params.classSlug)} starting repertoire`,
        description: `Choose the ${params.initialRankOneCount} 1st-rank ${params.tradition} spells in your starting repertoire.`,
        source,
        classSlug: params.classSlug,
        dependsOn: "class",
        count: params.initialRankOneCount,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination,
    }));
    for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
        const rank = wizardMaxSpellRank(level);
        if (rank > (params.maximumSpellRank ?? 10)) {
            continue;
        }
        if (rank === 10 && level > 19) {
            continue;
        }
        const count = rank === 10 ? 2 : level % 2 === 1 ? params.rankIncreaseCount : params.rankMaintenanceCount;
        if (level % 2 === 1) {
            addGrantedSpellStep(params, addStep, destination, rank, level);
        }
        addStep(makeSpellChoiceStep({
            slotId: `spell-choice-${params.classSlug}-repertoire-rank-${rank}-level-${level}`,
            level,
            title: `Level ${level} ${formatTitle(params.classSlug)} repertoire`,
            description: `Choose ${count} rank ${rank} ${params.tradition} spell${count === 1 ? "" : "s"} for your repertoire.`,
            source,
            classSlug: params.classSlug,
            dependsOn: "class",
            count,
            minRank: rank,
            maxRank: rank,
            cantrip: false,
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: true,
            destination,
        }));
    }
    return steps;
}
function addGrantedSpellStep(params, addStep, destination, rank, level) {
    const grantedSpell = params.grantedSpells?.[rank];
    if (!grantedSpell || !params.grantedSpellSource) {
        return;
    }
    const isCantrip = rank === 0;
    const giftLabel = grantedSpell.name || (isCantrip ? "the cantrip" : `the rank ${rank} spell`);
    const allowedNames = grantedSpell.name ? [grantedSpell.name] : [];
    addStep(makeSpellChoiceStep({
        slotId: `spell-choice-${params.classSlug}-granted-${isCantrip ? "cantrip" : `rank-${rank}`}-level-${level}`,
        level,
        title: `${formatTitle(params.classSlug)} ${isCantrip ? "granted cantrip" : `rank ${rank} granted spell`}`,
        description: `Add ${giftLabel} granted by your bloodline.`,
        source: params.grantedSpellSource,
        classSlug: params.classSlug,
        dependsOn: "class-branch",
        count: 1,
        minRank: rank,
        maxRank: rank,
        cantrip: isCantrip,
        curriculumSpellNames: allowedNames,
        additionalAllowedSpellNames: allowedNames,
        additionalAllowedSpellUuids: [grantedSpell.uuid],
        restrictToCommon: false,
        destination,
    }));
}
function formatTitle(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}
//# sourceMappingURL=spontaneous-step-builder.js.map