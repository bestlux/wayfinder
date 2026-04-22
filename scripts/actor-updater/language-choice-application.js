export async function applyLanguageChoiceDraft(actor, draft, steps) {
    if (typeof actor?.update !== "function") {
        return;
    }
    const languageStep = steps.find((step) => step.kind === "language-choice");
    if (!languageStep) {
        return;
    }
    const selections = Array.from(new Set(draft.languageChoices[languageStep.slotId] ?? []));
    await actor.update({
        "system.details.languages.value": selections,
    });
}
//# sourceMappingURL=language-choice-application.js.map