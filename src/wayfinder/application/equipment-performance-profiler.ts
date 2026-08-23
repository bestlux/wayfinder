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
] as const);

export type EquipmentProfileStage = (typeof EQUIPMENT_PROFILE_STAGES)[number];

export interface EquipmentProfileStageStart {
  readonly id: number;
  readonly stage: EquipmentProfileStage;
  readonly startedAt: number;
}

export interface EquipmentProfileStageCompletion extends EquipmentProfileStageStart {
  readonly completedAt: number;
  readonly durationMs: number;
  readonly status: "completed" | "failed";
  readonly details: Readonly<Record<string, unknown>>;
}

export interface EquipmentProfileStageObserver {
  /** The returned owner token binds completion to the sample active at stage start. */
  start(event: EquipmentProfileStageStart): unknown;
  complete(event: EquipmentProfileStageCompletion, owner: unknown): void;
}

let observer: EquipmentProfileStageObserver | null = null;
let nextStageId = 1;

/**
 * Installs the optional diagnostic observer used by the live equipment profile.
 * Ordinary Wayfinder sessions retain the direct operation path and do not call a clock.
 */
export function registerEquipmentProfileStageObserver(nextObserver: EquipmentProfileStageObserver | null): () => void {
  const previous = observer;
  observer = nextObserver;
  return () => {
    if (observer === nextObserver) observer = previous;
  };
}

export function profileEquipmentStage<T>(
  stage: EquipmentProfileStage,
  operation: () => T,
  details: () => Readonly<Record<string, unknown>> = () => ({})
): T {
  const activeObserver = observer;
  if (!activeObserver) return operation();

  const startedAt = performance.now();
  const start = { id: nextStageId++, stage, startedAt } as const;
  const timingName = `wayfinder:equipment:${stage}`;
  const startMark = `${timingName}:${start.id}:start`;
  try {
    performance.mark(startMark);
  } catch {
    // Raw observer timing remains available when User Timing is unavailable.
  }
  let owner: unknown;
  try {
    owner = activeObserver.start(start);
  } catch {
    owner = null;
  }

  try {
    const result = operation();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          completeStage(activeObserver, owner, start, "completed", details);
          return value;
        },
        (error: unknown) => {
          completeStage(activeObserver, owner, start, "failed", details);
          throw error;
        }
      ) as T;
    }
    completeStage(activeObserver, owner, start, "completed", details);
    return result;
  } catch (error) {
    completeStage(activeObserver, owner, start, "failed", details);
    throw error;
  }
}

function completeStage(
  activeObserver: EquipmentProfileStageObserver,
  owner: unknown,
  start: EquipmentProfileStageStart,
  status: EquipmentProfileStageCompletion["status"],
  details: () => Readonly<Record<string, unknown>>
): void {
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
  } catch {
    // User Timing is optional; the observer still receives the raw interval.
  }
  let completedDetails: Readonly<Record<string, unknown>>;
  try {
    completedDetails = details();
  } catch {
    completedDetails = { detailCaptureFailed: true };
  }
  try {
    activeObserver.complete(
      {
        ...start,
        completedAt,
        durationMs: completedAt - start.startedAt,
        status,
        details: completedDetails,
      },
      owner
    );
  } catch {
    // Profiling is diagnostic and must never alter production behavior.
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") && "then" in value;
}
