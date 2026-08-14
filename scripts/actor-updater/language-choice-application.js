export async function applyLanguageChoiceDraft(actor, draft, steps) {
    const update = buildLanguageChoiceUpdate(draft, steps);
    if (Object.keys(update).length > 0 && typeof actor?.update === "function") {
        await actor.update(update);
    }
}
export function buildLanguageChoiceUpdate(draft, steps) {
    const languageStep = steps.find((step) => step.kind === "language-choice");
    if (!languageStep) {
        return {};
    }
    const selections = Array.from(new Set(draft.languageChoices[languageStep.slotId] ?? []));
    return {
        "system.details.languages.value": selections,
    };
}
//# sourceMappingURL=language-choice-application.js.map