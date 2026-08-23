export const EQUIPMENT_PROFILE_STAGES = Object.freeze([
    "catalogue-index-wait",
    "catalogue-index-materialization",
    "catalogue-normalization",
    "catalogue-policy-evaluation",
    "actor-pricing-fingerprint",
    "drafted-size-resolution",
    "criteria-filter-facet-projection",
    "browse-record-source-assembly",
    "criteria-rank",
    "equipment-ui-projection",
    "equipment-pane-assembly",
    "mounted-row-projection",
]);
let observer = null;
let nextStageId = 1;
/**
 * Installs the optional diagnostic observer used by the live equipment profile.
 * Ordinary Wayfinder sessions retain the direct operation path and do not call a clock.
 */
export function registerEquipmentProfileStageObserver(nextObserver) {
    const previous = observer;
    observer = nextObserver;
    return () => {
        if (observer === nextObserver)
            observer = previous;
    };
}
export function profileEquipmentStage(stage, operation, details = () => ({})) {
    const activeObserver = observer;
    if (!activeObserver)
        return operation();
    const startedAt = performance.now();
    const start = { id: nextStageId++, stage, startedAt };
    const timingName = `wayfinder:equipment:${stage}`;
    const startMark = `${timingName}:${start.id}:start`;
    try {
        performance.mark(startMark);
    }
    catch {
        // Raw observer timing remains available when User Timing is unavailable.
    }
    let owner;
    try {
        owner = activeObserver.start(start);
    }
    catch {
        owner = null;
    }
    try {
        const result = operation();
        if (isPromiseLike(result)) {
            return Promise.resolve(result).then((value) => {
                completeStage(activeObserver, owner, start, "completed", details);
                return value;
            }, (error) => {
                completeStage(activeObserver, owner, start, "failed", details);
                throw error;
            });
        }
        completeStage(activeObserver, owner, start, "completed", details);
        return result;
    }
    catch (error) {
        completeStage(activeObserver, owner, start, "failed", details);
        throw error;
    }
}
function completeStage(activeObserver, owner, start, status, details) {
    const completedAt = performance.now();
    const timingName = `wayfinder:equipment:${start.stage}`;
    const startMark = `${timingName}:${start.id}:start`;
    const endMark = `${timingName}:${start.id}:end`;
    try {
        performance.mark(endMark);
        performance.measure(timingName, startMark, endMark);
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
        performance.clearMeasures(timingName);
    }
    catch {
        // User Timing is optional; the observer still receives the raw interval.
    }
    let completedDetails;
    try {
        completedDetails = details();
    }
    catch {
        completedDetails = { detailCaptureFailed: true };
    }
    try {
        activeObserver.complete({
            ...start,
            completedAt,
            durationMs: completedAt - start.startedAt,
            status,
            details: completedDetails,
        }, owner);
    }
    catch {
        // Profiling is diagnostic and must never alter production behavior.
    }
}
function isPromiseLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function") && "then" in value;
}
//# sourceMappingURL=equipment-performance-profiler.js.map