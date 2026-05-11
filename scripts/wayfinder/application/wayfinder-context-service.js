import { modeLabel } from "../plan-service.js";
export async function buildWayfinderContext(args) {
    const summary = buildSummaryItems(args.summaryDocuments);
    const dossierLine = summary
        .filter((item) => item.complete)
        .map((item) => item.value)
        .filter(Boolean)
        .join(" • ") || "Creation path in progress";
    const activeStepIndex = args.activeStep ? args.steps.findIndex((step) => step.id === args.activeStep?.id) : -1;
    const stepRows = await Promise.all(args.steps.map(async (step, index) => {
        const complete = await args.isStepComplete(step);
        return {
            id: step.id,
            index: index + 1,
            level: step.level,
            title: step.title,
            active: step.id === args.activeStep?.id,
            complete,
            invalidated: args.recentlyInvalidatedStepIds.has(step.slotId) && !complete,
            modeLabel: modeLabel(step.kind),
            status: await args.getStepStatus(step),
            firstInLevel: index === 0 || args.steps[index - 1]?.level !== step.level,
        };
    }));
    return {
        actorName: args.actorName,
        dossierLine,
        currentLevel: args.currentLevel,
        targetLevel: args.targetLevel,
        hasPendingSteps: args.steps.length > 0,
        canApplyDraft: args.steps.length > 0,
        guidance: "Review one decision at a time, keep the draft coherent, and let earlier choices narrow what comes next.",
        summary,
        stepCount: args.steps.length,
        completedCount: stepRows.filter((step) => step.complete).length,
        activeStepIndex: activeStepIndex + 1,
        statusNote: args.statusNote,
        steps: stepRows,
        activePane: args.activePane,
        canGoPrevious: activeStepIndex > 0,
        canGoNext: activeStepIndex >= 0 && activeStepIndex < args.steps.length - 1,
    };
}
function buildSummaryItems(documents) {
    const summary = [
        {
            label: "Ancestry",
            value: documents.ancestry?.name ?? "Missing",
            complete: !!documents.ancestry,
        },
        {
            label: "Heritage",
            value: documents.heritage?.name ?? "Missing",
            complete: !!documents.heritage,
        },
        {
            label: "Background",
            value: documents.background?.name ?? "Missing",
            complete: !!documents.background,
        },
        {
            label: "Class",
            value: documents.classDocument?.name ?? "Missing",
            complete: !!documents.classDocument,
        },
    ];
    if (documents.classDocument?.name === "Cleric" || documents.deity) {
        summary.push({
            label: "Deity",
            value: documents.deity?.name ?? "Missing",
            complete: !!documents.deity,
        });
    }
    return summary;
}
//# sourceMappingURL=wayfinder-context-service.js.map