import { sourceIdOf } from "../../shared/source-id.js";
import { wizardMaxSpellRank } from "../../shared/spellcasting.js";
import { createSpellChoiceStep } from "../domain/step-types.js";
const WIZARD_SPELLBOOK_DESTINATION = {
    type: "spellbook",
    key: "wizard-arcane-prepared",
    label: "Wizard spellbook",
    entryName: "Arcane Prepared Spells",
    tradition: "arcane",
    ability: "int",
    prepared: "prepared",
};
const CLERIC_PREPARED_DESTINATION = {
    type: "prepared",
    key: "cleric-divine-prepared",
    label: "Divine prepared spells",
    entryName: "Divine Prepared Spells",
    tradition: "divine",
    ability: "wis",
    prepared: "prepared",
};
export async function buildSpellChoiceSteps(params) {
    const { draft, currentLevel, effectiveClassDocument, effectiveDeityDocument, effectiveSchoolDocument, targetLevel, extractSlug, readExistingSpellChoiceSelections, } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const classSlug = extractSlug(effectiveClassDocument);
    if (classSlug === "wizard") {
        return buildWizardSpellChoiceSteps({
            draft,
            currentLevel,
            effectiveClassDocument,
            effectiveSchoolDocument,
            targetLevel,
            extractSlug,
            readExistingSpellChoiceSelections,
            classSlug,
        });
    }
    if (classSlug === "cleric") {
        return buildClericSpellChoiceSteps({
            draft,
            effectiveClassDocument,
            effectiveDeityDocument,
            readExistingSpellChoiceSelections,
            classSlug,
        });
    }
    return [];
}
function buildWizardSpellChoiceSteps(params) {
    const { draft, currentLevel, effectiveClassDocument, effectiveSchoolDocument, targetLevel, extractSlug, readExistingSpellChoiceSelections, classSlug, } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const wizardSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Wizard Spellcasting");
    const schoolSource = sourceRefFromDocument(effectiveSchoolDocument);
    const schoolName = effectiveSchoolDocument?.name ?? "Arcane School";
    const schoolSlug = extractSlug(effectiveSchoolDocument);
    const schoolCurriculum = parseCurriculumSpells(effectiveSchoolDocument?.system?.description?.value);
    const isUnifiedTheory = schoolSlug === "school-of-unified-magical-theory";
    const steps = [];
    const pushStep = (step) => {
        const choice = step.spellChoice;
        if (!choice) {
            steps.push(step);
            return;
        }
        const existingSelections = readExistingSpellChoiceSelections(choice);
        const draftedSelections = draft.spellChoices[step.slotId] ?? [];
        if (existingSelections.length >= choice.count && draftedSelections.length === 0) {
            return;
        }
        steps.push(step);
    };
    pushStep(makeSpellChoiceStep({
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
    pushStep(makeSpellChoiceStep({
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
        pushStep(makeSpellChoiceStep({
            slotId: "spell-choice-wizard-unified-rank-1-level-1",
            level: 1,
            title: "Unified theory bonus spell",
            description: "Add the extra 1st-rank arcane spell granted by the School of Unified Magical Theory.",
            source: schoolSource ?? {
                sourcePackId: null,
                sourceDocumentId: null,
                sourceUuid: null,
                sourceName: schoolName,
            },
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
        pushStep(makeSpellChoiceStep({
            slotId: "spell-choice-wizard-curriculum-rank-1-level-1",
            level: 1,
            title: "Arcane school curriculum spells",
            description: "Add the two 1st-rank curriculum spells granted by your arcane school.",
            source: schoolSource ?? {
                sourcePackId: null,
                sourceDocumentId: null,
                sourceUuid: null,
                sourceName: schoolName,
            },
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
        pushStep(makeSpellChoiceStep({
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
            pushStep(makeSpellChoiceStep({
                slotId: `spell-choice-wizard-curriculum-rank-${maxRank}-level-${level}`,
                level,
                title: `Level ${level} curriculum spell`,
                description: `Add the extra rank ${maxRank} curriculum spell granted when your arcane school unlocks a new spell rank.`,
                source: schoolSource ?? {
                    sourcePackId: null,
                    sourceDocumentId: null,
                    sourceUuid: null,
                    sourceName: schoolName,
                },
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
function buildClericSpellChoiceSteps(params) {
    const { draft, effectiveClassDocument, effectiveDeityDocument, readExistingSpellChoiceSelections, classSlug } = params;
    if (!effectiveClassDocument) {
        return [];
    }
    const clericSpellcastingSource = findClassFeatureSource(effectiveClassDocument, "Cleric Spellcasting");
    const deityRankOneSpellNames = parseDeitySpellNames(effectiveDeityDocument, 1);
    const steps = [];
    const pushStep = (step) => {
        const choice = step.spellChoice;
        if (!choice) {
            steps.push(step);
            return;
        }
        const existingSelections = readExistingSpellChoiceSelections(choice);
        const draftedSelections = draft.spellChoices[step.slotId] ?? [];
        if (existingSelections.length >= choice.count && draftedSelections.length === 0) {
            return;
        }
        steps.push(step);
    };
    pushStep(makeSpellChoiceStep({
        slotId: "spell-choice-cleric-cantrips-level-1",
        level: 1,
        title: "Cleric prepared cantrips",
        description: "Choose the five divine cantrips your cleric begins prepared with.",
        source: clericSpellcastingSource,
        classSlug,
        dependsOn: "class",
        count: 5,
        minRank: 0,
        maxRank: 0,
        cantrip: true,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: [],
        restrictToCommon: true,
        destination: CLERIC_PREPARED_DESTINATION,
    }));
    pushStep(makeSpellChoiceStep({
        slotId: "spell-choice-cleric-rank-1-level-1",
        level: 1,
        title: "Cleric prepared spells",
        description: "Choose the two 1st-rank divine spells your cleric begins prepared with.",
        source: clericSpellcastingSource,
        classSlug,
        dependsOn: "class",
        count: 2,
        minRank: 1,
        maxRank: 1,
        cantrip: false,
        curriculumSpellNames: [],
        additionalAllowedSpellNames: deityRankOneSpellNames,
        restrictToCommon: true,
        destination: CLERIC_PREPARED_DESTINATION,
    }));
    return steps;
}
function makeSpellChoiceStep(args) {
    return createSpellChoiceStep(args.level, args.title, args.description, {
        slotId: args.slotId,
        sourcePackId: args.source.sourcePackId,
        sourceDocumentId: args.source.sourceDocumentId,
        sourceUuid: args.source.sourceUuid,
        sourceName: args.source.sourceName,
        classSlug: args.classSlug,
        dependsOn: args.dependsOn,
        destination: { ...args.destination },
        count: args.count,
        minRank: args.minRank,
        maxRank: args.maxRank,
        cantrip: args.cantrip,
        curriculumSpellNames: args.curriculumSpellNames,
        additionalAllowedSpellNames: args.additionalAllowedSpellNames,
        restrictToCommon: args.restrictToCommon,
    });
}
function findClassFeatureSource(classDocument, featureName) {
    const classItems = Object.values(classDocument?.system?.items ?? {});
    const entry = classItems.find((item) => item?.name === featureName && typeof item?.uuid === "string");
    const parsed = entry?.uuid ? parseCompendiumUuid(entry.uuid) : null;
    return {
        sourcePackId: parsed?.packId ?? null,
        sourceDocumentId: parsed?.documentId ?? null,
        sourceUuid: entry?.uuid ?? null,
        sourceName: featureName,
    };
}
function sourceRefFromDocument(document) {
    if (!document) {
        return null;
    }
    const sourceUuid = sourceIdOf(document);
    const parsed = sourceUuid ? parseCompendiumUuid(sourceUuid) : null;
    return {
        sourcePackId: parsed?.packId ?? null,
        sourceDocumentId: parsed?.documentId ?? null,
        sourceUuid,
        sourceName: String(document.name ?? "Class Feature"),
    };
}
function parseCurriculumSpells(raw) {
    const description = typeof raw === "string" ? raw : "";
    const matches = description.matchAll(/<li><strong>([^<]+):<\/strong>\s*([\s\S]*?)<\/li>/gi);
    const result = {};
    for (const [, label, content] of matches) {
        const rank = rankFromCurriculumLabel(label);
        if (rank === null) {
            continue;
        }
        result[rank] = collectCurriculumSpellNames(String(content));
    }
    return result;
}
function collectCurriculumSpellNames(content) {
    const names = new Set();
    for (const match of content.matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\](?:\{([^}]+)\})?/gi)) {
        const name = normalizeCurriculumSpellName(match[2] ?? match[1] ?? "");
        if (name) {
            names.add(name);
        }
    }
    for (const match of content.matchAll(/<a\b[^>]*data-uuid="Compendium\.pf2e\.spells-srd\.Item\.[^"]+"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const name = normalizeCurriculumSpellName(match[1] ?? "");
        if (name) {
            names.add(name);
        }
    }
    return Array.from(names);
}
function rankFromCurriculumLabel(label) {
    const normalized = label.trim().toLowerCase();
    if (normalized === "cantrips" || normalized === "cantrip") {
        return 0;
    }
    const map = {
        "1st": 1,
        "2nd": 2,
        "3rd": 3,
        "4th": 4,
        "5th": 5,
        "6th": 6,
        "7th": 7,
        "8th": 8,
        "9th": 9,
    };
    return map[normalized] ?? null;
}
function parseDeitySpellNames(document, rank) {
    const value = document?.system?.spells?.[rank];
    const rawValues = Array.isArray(value) ? value : value ? [value] : [];
    const names = new Set();
    for (const raw of rawValues) {
        const name = spellNameFromDeityReference(raw);
        if (name) {
            names.add(name);
        }
    }
    return Array.from(names);
}
function spellNameFromDeityReference(raw) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return null;
    }
    const match = /\.Item\.(.+)$/.exec(raw.trim());
    const name = match?.[1] ?? raw;
    return name
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function decodeCompendiumName(raw) {
    return decodeURIComponent(raw).replace(/\+/g, " ").trim();
}
function normalizeCurriculumSpellName(raw) {
    const decoded = decodeCompendiumName(raw);
    return decoded
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function parseCompendiumUuid(uuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/.exec(uuid);
    if (!match) {
        return null;
    }
    return {
        packId: match[1],
        documentId: match[2],
    };
}
//# sourceMappingURL=step-builders.js.map