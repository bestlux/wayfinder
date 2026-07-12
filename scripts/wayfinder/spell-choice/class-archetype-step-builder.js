import { classArchetypeProfile, documentIsPalatineDetective, documentIsWayOfTheSpellshot, } from "../class-archetype/registry.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
export function buildSpellshotSpellChoiceSteps(params) {
    if (params.targetLevel < 2 ||
        !params.effectiveClassFeatureDocuments.some((document) => documentIsWayOfTheSpellshot(document))) {
        return [];
    }
    const source = profileSource("way-of-the-spellshot");
    if (!source) {
        return [];
    }
    const steps = [];
    appendPendingSpellChoiceStep(steps, makeSpellChoiceStep({
        slotId: "spell-choice-spellshot-spellbook-cantrips-level-2",
        level: 2,
        title: "Spellshot spellbook cantrips",
        description: "Choose the four common arcane cantrips that begin your spellshot spellbook.",
        source,
        classSlug: "gunslinger",
        dependsOn: "class-branch",
        requiresCurriculum: false,
        count: 4,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination: {
            type: "spellbook",
            key: "spellshot-arcane-spellbook",
            entryReuse: "key-only",
            label: "Spellshot spellbook",
            entryName: "Spellshot Spellbook",
            tradition: "arcane",
            ability: "int",
            prepared: "prepared",
        },
    }), params.draft, params.readExistingSpellChoiceSelections);
    return steps;
}
export function buildPalatineDetectiveSpellChoiceSteps(params) {
    if (!params.effectiveClassFeatureDocuments.some((document) => documentIsPalatineDetective(document))) {
        return [];
    }
    const source = profileSource("palatine-detective");
    if (!source) {
        return [];
    }
    const steps = [];
    for (const tradition of ["divine", "occult"]) {
        appendPendingSpellChoiceStep(steps, makeSpellChoiceStep({
            slotId: `spell-choice-palatine-detective-${tradition}-cantrip-level-1`,
            level: 1,
            title: `Palatine Detective ${tradition} cantrip`,
            description: `Choose one common ${tradition} cantrip to cast as an innate spell using Intelligence.`,
            source,
            classSlug: "investigator",
            dependsOn: "class-branch",
            requiresCurriculum: false,
            count: 1,
            minRank: 0,
            maxRank: 0,
            cantrip: true,
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: true,
            destination: {
                type: "innate",
                key: `palatine-detective-${tradition}-innate`,
                entryReuse: "key-only",
                label: `Palatine Detective ${tradition} innate spells`,
                entryName: `Innate ${titleCase(tradition)} Spells`,
                tradition,
                ability: "int",
                prepared: "innate",
            },
        }), params.draft, params.readExistingSpellChoiceSelections);
    }
    return steps;
}
function profileSource(value) {
    const profile = classArchetypeProfile(value);
    return profile
        ? {
            sourcePackId: profile.selection.packId,
            sourceDocumentId: profile.selection.documentId,
            sourceUuid: profile.selection.uuid,
            sourceName: profile.selection.name,
        }
        : null;
}
function titleCase(value) {
    return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
//# sourceMappingURL=class-archetype-step-builder.js.map