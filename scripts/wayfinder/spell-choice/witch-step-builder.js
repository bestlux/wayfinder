import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import { buildPreparedSpellChoiceSteps, preparedSpellChoiceDestination } from "./prepared-step-builder.js";
import { findClassFeatureSource } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
export function buildWitchSpellChoiceSteps(params) {
    const initialSteps = buildPreparedSpellChoiceSteps({
        draft: params.draft,
        effectiveClassDocument: params.effectiveClassDocument,
        classSlug: "witch",
        classLabel: "Witch",
        spellcastingFeatureName: "Witch Spellcasting",
        tradition: params.tradition,
        ability: "int",
        cantripCount: 5,
        rankOneCount: 2,
        readExistingSpellChoiceSelections: params.readExistingSpellChoiceSelections,
    });
    const source = findClassFeatureSource(params.effectiveClassDocument, "Witch Spellcasting");
    const destination = {
        ...preparedSpellChoiceDestination({
            classSlug: "witch",
            tradition: params.tradition,
            ability: "int",
        }),
        type: "spellbook",
        label: "Witch familiar spells",
    };
    const learnedSteps = [];
    const addStep = (step) => appendPendingSpellChoiceStep(learnedSteps, step, params.draft, params.readExistingSpellChoiceSelections);
    for (let level = Math.max(2, params.currentLevel + 1); level <= params.targetLevel; level += 1) {
        addStep(makeSpellChoiceStep({
            slotId: `spell-choice-witch-familiar-level-${level}`,
            level,
            title: `Level ${level} witch familiar spells`,
            description: `Add the two ${params.tradition} spells your familiar learns at level ${level}. They can be any spell rank you can currently cast.`,
            source,
            classSlug: "witch",
            dependsOn: "class",
            count: 2,
            minRank: 1,
            maxRank: wizardMaxSpellRank(level),
            cantrip: false,
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: true,
            reuseExistingEntryOnly: true,
            destination,
        }));
    }
    return [...initialSteps, ...learnedSteps];
}
//# sourceMappingURL=witch-step-builder.js.map