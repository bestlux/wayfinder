import { appendPendingSpellChoiceStep, makeSpellChoiceStep } from "./step-helpers.js";
export function buildFeatSpellChoiceSteps(args) {
    const classProfile = classSpellcastingProfile(args.effectiveClassDocument, args.extractSlug);
    if (!classProfile) {
        return [];
    }
    const steps = [];
    for (const source of args.featSources) {
        if (!isAdaptedCantripDocument(source.sourceDocument)) {
            continue;
        }
        const sourceSlug = extractSourceSlug(source.sourceDocument) ?? source.sourceSelection.documentId;
        const level = source.sourceSelection.level ?? 1;
        appendPendingSpellChoiceStep(steps, makeSpellChoiceStep({
            slotId: `spell-choice-feat-${sourceSlug}-cantrip-level-${level}`,
            level,
            title: "Adapted cantrip",
            description: "Choose the cantrip this feat adapts from a magical tradition other than your class tradition.",
            source: {
                sourcePackId: source.sourceSelection.packId,
                sourceDocumentId: source.sourceSelection.documentId,
                sourceUuid: source.sourceSelection.uuid,
                sourceName: source.sourceSelection.name,
            },
            classSlug: classProfile.classSlug,
            dependsOn: "class",
            count: 1,
            minRank: 0,
            maxRank: 0,
            cantrip: true,
            excludedTraditions: [classProfile.tradition],
            curriculumSpellNames: [],
            additionalAllowedSpellNames: [],
            restrictToCommon: true,
            destination: {
                type: "spellbook",
                key: classProfile.destinationKey,
                label: classProfile.destinationLabel,
                entryName: classProfile.entryName,
                tradition: classProfile.tradition,
                ability: classProfile.ability,
                prepared: "prepared",
            },
        }), args.draft, args.readExistingSpellChoiceSelections);
    }
    return steps;
}
function extractSourceSlug(document) {
    const slug = document?.system?.slug;
    return typeof slug === "string" && slug.trim().length > 0 ? slug.trim() : null;
}
function classSpellcastingProfile(classDocument, extractSlug) {
    const classSlug = extractSlug(classDocument);
    switch (classSlug) {
        case "cleric":
            return {
                classSlug,
                tradition: "divine",
                ability: "wis",
                destinationKey: "cleric-divine-prepared",
                destinationLabel: "Divine prepared spells",
                entryName: "Divine Prepared Spells",
            };
        case "wizard":
            return {
                classSlug,
                tradition: "arcane",
                ability: "int",
                destinationKey: "wizard-arcane-prepared",
                destinationLabel: "Wizard spellbook",
                entryName: "Wizard spellbook",
            };
        default:
            return null;
    }
}
function isAdaptedCantripDocument(document) {
    const typedDocument = document;
    if (typedDocument?.system?.slug === "adapted-cantrip") {
        return true;
    }
    const description = typeof typedDocument?.system?.description?.value === "string" ? typedDocument.system.description.value : "";
    return /\bchoose one cantrip from a magical tradition other than your own\b/i.test(description);
}
//# sourceMappingURL=feat-step-builder.js.map