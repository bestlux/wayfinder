import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import { parseCurriculumSpells } from "./metadata-parsing.js";
import { fallbackSourceRef, findClassFeatureSource, sourceRefFromDocument } from "./source-utils.js";
import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
const WIZARD_SPELLBOOK_DESTINATION = {
    type: "spellbook",
    key: "wizard-arcane-prepared",
    label: "Wizard spellbook",
    entryName: "Arcane Prepared Spells",
    tradition: "arcane",
    ability: "int",
    prepared: "prepared",
};
export function buildWizardSpellChoiceSteps(params) {
    const { draft, currentLevel, effectiveClassDocument, effectiveSchoolDocument, targetLevel, extractSlug, readExistingSpellChoiceSelections, classSlug, } = params;
    const wizardSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Wizard Spellcasting");
    const schoolName = String(effectiveSchoolDocument?.name ?? "Arcane School");
    const schoolSource = sourceRefFromDocument(effectiveSchoolDocument) ?? fallbackSourceRef(schoolName);
    const schoolSlug = extractSlug(effectiveSchoolDocument);
    const schoolCurriculum = parseCurriculumSpells(effectiveSchoolDocument?.system?.description?.value);
    const isUnifiedTheory = schoolSlug === "school-of-unified-magical-theory";
    const steps = [];
    const addStep = (step) => appendPendingSpellChoiceStep(steps, step, draft, readExistingSpellChoiceSelections);
    addStep(makeSpellChoiceStep({
        slotId: "spell-choice-wizard-spellbook-cantrips-level-1",
        level: 1,
        title: "Wizard spellbook cantrips",
        description: "Add the 10 arcane cantrips that begin your wizard spellbook.",
        source: wizardSpellcastingSource,
        classSlug,
        dependsOn: "class",
        count: 10,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: WIZARD_SPELLBOOK_DESTINATION,
    }));
    addStep(makeSpellChoiceStep({
        slotId: "spell-choice-wizard-spellbook-rank-1-level-1",
        level: 1,
        title: "Wizard spellbook spells",
        description: "Add the five 1st-rank arcane spells that begin your spellbook.",
        source: wizardSpellcastingSource,
        classSlug,
        dependsOn: "class",
        count: 5,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: false,
        destination: WIZARD_SPELLBOOK_DESTINATION,
    }));
    if (isUnifiedTheory) {
        addStep(makeSpellChoiceStep({
            slotId: "spell-choice-wizard-unified-rank-1-level-1",
            level: 1,
            title: "Unified theory bonus spell",
            description: "Add the extra 1st-rank arcane spell granted by the School of Unified Magical Theory.",
            source: schoolSource,
            classSlug,
            dependsOn: "class-branch",
            count: 1,
            minRank: 1,
            maxRank: 1,
            cantrip: false,
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: false,
            destination: WIZARD_SPELLBOOK_DESTINATION,
        }));
    }
    else {
        addStep(makeSpellChoiceStep({
            slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
            level: 1,
            title: "Arcane school curriculum spells",
            description: "Add the two 1st-rank curriculum spells granted by your arcane school.",
            source: schoolSource,
            classSlug,
            dependsOn: "class-branch",
            count: 2,
            minRank: 1,
            maxRank: 1,
            cantrip: false,
            curriculumSpellNames: schoolCurriculum[1] ?? [],
            additionalAllowedSpellNames: [],
            restrictToCommon: false,
            destination: WIZARD_SPELLBOOK_DESTINATION,
        }));
    }
    for (let level = Math.max(2, currentLevel + 1); level <= targetLevel; level += 1) {
        const maxRank = wizardMaxSpellRank(level);
        addStep(makeSpellChoiceStep({
            slotId: `spell-choice-wizard-spellbook-level-${level}`,
            level,
            title: `Level ${level} spellbook additions`,
            description: `Add the two arcane spells you learn at level ${level}. They can be any spell rank you can currently cast.`,
            source: wizardSpellcastingSource,
            classSlug,
            dependsOn: "class",
            count: 2,
            minRank: 1,
            maxRank,
            cantrip: false,
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: false,
            destination: WIZARD_SPELLBOOK_DESTINATION,
        }));
        if (!isUnifiedTheory && level >= 3 && level % 2 === 1) {
            addStep(makeSpellChoiceStep({
                slotId: `spell-choice-wizard-curriculum-rank-${maxRank}-level-${level}`,
                level,
                title: `Level ${level} curriculum spell`,
                description: `Add the extra rank ${maxRank} curriculum spell granted when your arcane school unlocks a new spell rank.`,
                source: schoolSource,
                classSlug,
                dependsOn: "class-branch",
                count: 1,
                minRank: maxRank,
                maxRank,
                cantrip: false,
                curriculumSpellNames: schoolCurriculum[maxRank] ?? [],
                additionalAllowedSpellNames: [],
                restrictToCommon: false,
                destination: WIZARD_SPELLBOOK_DESTINATION,
            }));
        }
    }
    return steps;
}
//# sourceMappingURL=wizard-step-builder.js.map