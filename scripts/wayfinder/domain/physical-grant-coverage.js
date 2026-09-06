import { PHYSICAL_GRANT_COVERAGE_PF2E_VERSION, UNSUPPORTED_PHYSICAL_GRANT_ROUTES, } from "./physical-grant-route-registry.js";
export { PHYSICAL_GRANT_COVERAGE_PF2E_VERSION, UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS, UNSUPPORTED_PHYSICAL_GRANT_ROUTES, } from "./physical-grant-route-registry.js";
export function physicalGrantCoverageWarning(draft, activeSteps, pf2eVersion = currentPf2eVersion()) {
    if (pf2eVersion === PHYSICAL_GRANT_COVERAGE_PF2E_VERSION ||
        !hasLevelOnePhysicalGrantCoverageEvidence(draft, activeSteps))
        return null;
    return {
        reviewedVersion: PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
        currentVersion: nonEmpty(pf2eVersion) ? pf2eVersion : null,
    };
}
export function currentPf2eVersion() {
    const currentGame = globalThis.game;
    return currentGame?.system?.id === "pf2e" && nonEmpty(currentGame.system.version) ? currentGame.system.version : null;
}
export function physicalGrantCoverageBlockers(draft, activeSteps) {
    return findUnsupportedPhysicalGrantRoutes(draft, activeSteps);
}
export function physicalGrantCoverageIssues(draft, activeSteps) {
    return physicalGrantCoverageBlockers(draft, activeSteps).map((blocker) => ({
        code: "equipment-review",
        stepId: blocker.sourceSlotId ?? "starting-equipment-coverage",
        slotId: blocker.sourceSlotId ?? "starting-equipment",
        title: "Starting equipment coverage",
        message: blocker.message,
    }));
}
export function withPhysicalGrantCoverageReadiness(readiness, draft, activeSteps) {
    const coverageIssues = physicalGrantCoverageIssues(draft, activeSteps);
    if (coverageIssues.length === 0)
        return readiness;
    return {
        ...readiness,
        ready: false,
        blockers: [...readiness.blockers, ...coverageIssues],
        firstBlocker: readiness.firstBlocker ?? coverageIssues[0] ?? null,
    };
}
export function findUnsupportedPhysicalGrantRoutes(draft, activeSteps) {
    const activeSlotIds = new Set([
        ...activeSteps.map((step) => step.slotId),
        ...draft.applyAttemptStepIds,
        ...draft.applyCompletedStepIds,
    ]);
    const facts = [
        ...selectionFacts("selections", draft.selections, activeSlotIds),
        ...selectionFacts("branchSelections", draft.branchSelections, activeSlotIds),
    ];
    return UNSUPPORTED_PHYSICAL_GRANT_ROUTES.flatMap((route) => {
        const matches = route.activationVariants
            .map((variant) => variant.map((requirement) => facts.find((fact) => fact.sourceUuid === requirement.sourceUuid &&
            (requirement.slotId === undefined || fact.sourceSlotId === requirement.slotId) &&
            (requirement.channel === undefined || fact.channel === requirement.channel))))
            .find((variantMatches) => variantMatches.every((match) => match !== undefined));
        if (!matches)
            return [];
        const source = matches.at(-1);
        return [
            {
                code: "unsupported-physical-grant",
                routeId: route.routeId,
                reasonCode: route.blocker.reasonCode,
                sourceSlotId: source.sourceSlotId,
                sourceUuid: source.sourceUuid,
                message: `${route.label} is not supported by Wayfinder starting equipment on PF2E ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}. ${route.blocker.detail} Use the PF2E sheet for this build.`,
            },
        ];
    });
}
const PHYSICAL_GRANT_STEP_KINDS = new Set([
    "pick-item",
    "singleton-choice",
    "class-archetype",
    "class-branch",
    "class-choice",
    "starting-equipment",
]);
function hasLevelOnePhysicalGrantCoverageEvidence(draft, activeSteps) {
    if (activeSteps.some((step) => step.slotId === "starting-equipment-level-1" || (step.level === 1 && PHYSICAL_GRANT_STEP_KINDS.has(step.kind)))) {
        return true;
    }
    const frozenSlotIds = [...draft.applyAttemptStepIds, ...draft.applyCompletedStepIds];
    if (frozenSlotIds.includes("starting-equipment-level-1"))
        return true;
    const activeSlotIds = new Set([...activeSteps.map((step) => step.slotId), ...frozenSlotIds]);
    return [
        ...selectionFacts("selections", draft.selections, activeSlotIds),
        ...selectionFacts("branchSelections", draft.branchSelections, activeSlotIds),
    ].some((fact) => isLevelOneSlotId(fact.sourceSlotId));
}
function selectionFacts(channel, selections, activeSlotIds) {
    return Object.entries(selections).flatMap(([mapSlotId, selection]) => {
        if (mapSlotId !== selection.slotId || !activeSlotIds.has(mapSlotId))
            return [];
        return [{ channel, sourceSlotId: mapSlotId, sourceUuid: selection.uuid }];
    });
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isLevelOneSlotId(slotId) {
    return slotId.endsWith("-level-1");
}
//# sourceMappingURL=physical-grant-coverage.js.map