import { buildMagusSpellChoiceSteps } from "../spell-choice/magus-step-builder.js";
import { buildPreparedSpellChoiceSteps } from "../spell-choice/prepared-step-builder.js";
import { buildSpontaneousRepertoireSpellChoiceSteps } from "../spell-choice/spontaneous-step-builder.js";
import { findClassFeatureDocumentByOtherTag, parseTraditionFromClassFeatureDocument, } from "../spell-choice/tradition-utils.js";
export const animistContributor = preparedContributor({
    slug: "animist",
    classLabel: "Animist",
    spellcastingFeatureName: "Animist & Apparition Spellcasting",
    tradition: "divine",
    ability: "wis",
    cantripCount: 2,
    rankOneCount: 1,
});
export const druidContributor = preparedContributor({
    slug: "druid",
    classLabel: "Druid",
    spellcastingFeatureName: "Druid Spellcasting",
    tradition: "primal",
    ability: "wis",
    cantripCount: 5,
    rankOneCount: 2,
});
export const magusContributor = {
    slug: "magus",
    async buildSpellChoiceSteps(args) {
        return buildMagusSpellChoiceSteps({
            draft: args.draft,
            currentLevel: args.currentLevel,
            effectiveClassDocument: args.effectiveClassDocument,
            targetLevel: args.targetLevel,
            readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
        });
    },
};
export const oracleContributor = spontaneousContributor({
    slug: "oracle",
    spellcastingFeatureName: "Oracle Spellcasting",
    tradition: "divine",
    ability: "cha",
});
export const psychicContributor = spontaneousContributor({
    slug: "psychic",
    spellcastingFeatureName: "Psychic Spellcasting",
    tradition: "occult",
    ability: "int",
    cantripCount: 3,
    initialRankOneCount: 2,
});
export const sorcererContributor = branchTraditionSpontaneousContributor({
    slug: "sorcerer",
    spellcastingFeatureName: "Sorcerer Spellcasting",
    branchTag: "sorcerer-bloodline",
    fallbackTradition: "arcane",
    ability: "cha",
});
export const summonerContributor = branchTraditionSpontaneousContributor({
    slug: "summoner",
    spellcastingFeatureName: "Summoner Spellcasting",
    branchTag: "summoner-eidolon",
    fallbackTradition: "arcane",
    ability: "cha",
});
export const witchContributor = {
    slug: "witch",
    async buildSpellChoiceSteps(args) {
        const patron = findClassFeatureDocumentByOtherTag(args.effectiveClassFeatureDocuments ?? [], "witch-patron");
        const tradition = parseTraditionFromClassFeatureDocument(patron, "occult");
        return buildPreparedSpellChoiceSteps({
            draft: args.draft,
            effectiveClassDocument: args.effectiveClassDocument,
            classSlug: "witch",
            classLabel: "Witch",
            spellcastingFeatureName: "Witch Spellcasting",
            tradition,
            ability: "int",
            cantripCount: 5,
            rankOneCount: 2,
            readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
        });
    },
};
function preparedContributor(config) {
    return {
        slug: config.slug,
        async buildSpellChoiceSteps(args) {
            return buildPreparedSpellChoiceSteps({
                draft: args.draft,
                effectiveClassDocument: args.effectiveClassDocument,
                classSlug: config.slug,
                classLabel: config.classLabel,
                spellcastingFeatureName: config.spellcastingFeatureName,
                tradition: config.tradition,
                ability: config.ability,
                cantripCount: config.cantripCount,
                rankOneCount: config.rankOneCount,
                readExistingSpellChoiceSelections: args.readExistingSpellChoiceSelections,
            });
        },
    };
}
function spontaneousContributor(config) {
    return {
        slug: config.slug,
        async buildSpellChoiceSteps(args) {
            return buildSpontaneousRepertoireSpellChoiceSteps({
                ...args,
                classSlug: config.slug,
                spellcastingFeatureName: config.spellcastingFeatureName,
                tradition: config.tradition,
                ability: config.ability,
                cantripCount: config.cantripCount ?? 5,
                initialRankOneCount: config.initialRankOneCount ?? 2,
                rankIncreaseCount: 2,
                rankMaintenanceCount: 1,
            });
        },
    };
}
function branchTraditionSpontaneousContributor(config) {
    return {
        slug: config.slug,
        async buildSpellChoiceSteps(args) {
            const branch = findClassFeatureDocumentByOtherTag(args.effectiveClassFeatureDocuments ?? [], config.branchTag);
            const tradition = parseTraditionFromClassFeatureDocument(branch, config.fallbackTradition);
            return buildSpontaneousRepertoireSpellChoiceSteps({
                ...args,
                classSlug: config.slug,
                spellcastingFeatureName: config.spellcastingFeatureName,
                tradition,
                ability: config.ability,
                cantripCount: 5,
                initialRankOneCount: 2,
                rankIncreaseCount: 2,
                rankMaintenanceCount: 1,
            });
        },
    };
}
//# sourceMappingURL=caster-contributors.js.map