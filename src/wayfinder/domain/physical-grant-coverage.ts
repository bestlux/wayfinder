import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import {
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  type PhysicalGrantCoverageBlocker,
  type PhysicalGrantSelectionChannel,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES,
} from "./physical-grant-route-registry.js";
import type { WayfinderDraftReadiness, WayfinderStepIssue } from "./step-evaluation.js";

export {
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  type PhysicalGrantCoverageBlocker,
  type PhysicalGrantSelectionChannel,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTE_IDS,
  UNSUPPORTED_PHYSICAL_GRANT_ROUTES,
  type UnsupportedPhysicalGrantReason,
  type UnsupportedPhysicalGrantRoute,
} from "./physical-grant-route-registry.js";

export function physicalGrantCoverageVersionBlocker(pf2eVersion: string | null): PhysicalGrantCoverageBlocker | null {
  if (pf2eVersion === PHYSICAL_GRANT_COVERAGE_PF2E_VERSION) return null;
  const observed = nonEmpty(pf2eVersion) ? pf2eVersion : "an unknown version";
  return {
    code: "coverage-version-mismatch",
    routeId: "pf2e-version-pin",
    reasonCode: "pf2e-version-mismatch",
    sourceSlotId: null,
    sourceUuid: null,
    message: `Starting-equipment physical-grant coverage is qualified for PF2E ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}, not ${observed}. Review is blocked until the coverage matrix is refreshed.`,
  };
}

export function currentPf2eVersion(): string | null {
  const currentGame = (globalThis as { game?: { system?: { id?: unknown; version?: unknown } } }).game;
  return currentGame?.system?.id === "pf2e" && nonEmpty(currentGame.system.version) ? currentGame.system.version : null;
}

export function physicalGrantCoverageBlockers(
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): readonly PhysicalGrantCoverageBlocker[] {
  const versionBlocker = hasLevelOnePhysicalGrantCoverageEvidence(draft, activeSteps)
    ? physicalGrantCoverageVersionBlocker(pf2eVersion)
    : null;
  return versionBlocker ? [versionBlocker] : findUnsupportedPhysicalGrantRoutes(draft, activeSteps);
}

export function physicalGrantCoverageIssues(
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): WayfinderStepIssue[] {
  return physicalGrantCoverageBlockers(draft, activeSteps, pf2eVersion).map((blocker) => ({
    code: "equipment-review",
    stepId: blocker.sourceSlotId ?? "starting-equipment-coverage",
    slotId: blocker.sourceSlotId ?? "starting-equipment",
    title: "Starting equipment coverage",
    message: blocker.message,
  }));
}

export function withPhysicalGrantCoverageReadiness(
  readiness: WayfinderDraftReadiness,
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): WayfinderDraftReadiness {
  const coverageIssues = physicalGrantCoverageIssues(draft, activeSteps, pf2eVersion);
  if (coverageIssues.length === 0) return readiness;
  return {
    ...readiness,
    ready: false,
    blockers: [...readiness.blockers, ...coverageIssues],
    firstBlocker: readiness.firstBlocker ?? coverageIssues[0] ?? null,
  };
}

export function findUnsupportedPhysicalGrantRoutes(
  draft: DraftState,
  activeSteps: readonly PendingStep[]
): readonly PhysicalGrantCoverageBlocker[] {
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
      .map((variant) =>
        variant.map((requirement) =>
          facts.find(
            (fact) =>
              fact.sourceUuid === requirement.sourceUuid &&
              (requirement.slotId === undefined || fact.sourceSlotId === requirement.slotId) &&
              (requirement.channel === undefined || fact.channel === requirement.channel)
          )
        )
      )
      .find((variantMatches) => variantMatches.every((match) => match !== undefined));
    if (!matches) return [];
    const source = matches.at(-1)!;
    return [
      {
        code: "unsupported-physical-grant" as const,
        routeId: route.routeId,
        reasonCode: route.blocker.reasonCode,
        sourceSlotId: source.sourceSlotId,
        sourceUuid: source.sourceUuid,
        message: `${route.label} is not supported by Wayfinder starting equipment on PF2E ${PHYSICAL_GRANT_COVERAGE_PF2E_VERSION}. ${route.blocker.detail} Use the PF2E sheet for this build.`,
      },
    ];
  });
}

interface ActiveSelectionFact {
  readonly channel: PhysicalGrantSelectionChannel;
  readonly sourceSlotId: string;
  readonly sourceUuid: string;
}

const PHYSICAL_GRANT_STEP_KINDS = new Set<PendingStep["kind"]>([
  "pick-item",
  "singleton-choice",
  "class-archetype",
  "class-branch",
  "class-choice",
  "starting-equipment",
]);

function hasLevelOnePhysicalGrantCoverageEvidence(draft: DraftState, activeSteps: readonly PendingStep[]): boolean {
  if (
    activeSteps.some(
      (step) =>
        step.slotId === "starting-equipment-level-1" || (step.level === 1 && PHYSICAL_GRANT_STEP_KINDS.has(step.kind))
    )
  ) {
    return true;
  }

  const frozenSlotIds = [...draft.applyAttemptStepIds, ...draft.applyCompletedStepIds];
  if (frozenSlotIds.includes("starting-equipment-level-1")) return true;

  const activeSlotIds = new Set([...activeSteps.map((step) => step.slotId), ...frozenSlotIds]);
  return [
    ...selectionFacts("selections", draft.selections, activeSlotIds),
    ...selectionFacts("branchSelections", draft.branchSelections, activeSlotIds),
  ].some((fact) => isLevelOneSlotId(fact.sourceSlotId));
}

function selectionFacts(
  channel: PhysicalGrantSelectionChannel,
  selections: Readonly<Record<string, SelectionRef>>,
  activeSlotIds: ReadonlySet<string>
): ActiveSelectionFact[] {
  return Object.entries(selections).flatMap(([mapSlotId, selection]) => {
    if (mapSlotId !== selection.slotId || !activeSlotIds.has(mapSlotId)) return [];
    return [{ channel, sourceSlotId: mapSlotId, sourceUuid: selection.uuid }];
  });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLevelOneSlotId(slotId: string): boolean {
  return slotId.endsWith("-level-1");
}
