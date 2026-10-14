import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
  type PhysicalGrantCoverageBlocker,
  type PhysicalGrantSelectionChannel,
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
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

export interface PhysicalGrantCoverageWarning {
  readonly reviewedVersion: string;
  readonly currentVersion: string | null;
}

export function physicalGrantCoverageWarning(
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  pf2eVersion: string | null = currentPf2eVersion()
): PhysicalGrantCoverageWarning | null {
  if (
    pf2eVersion === PHYSICAL_GRANT_COVERAGE_PF2E_VERSION ||
    !hasLevelOnePhysicalGrantCoverageEvidence(draft, activeSteps)
  )
    return null;
  return {
    reviewedVersion: PHYSICAL_GRANT_COVERAGE_PF2E_VERSION,
    currentVersion: nonEmpty(pf2eVersion) ? pf2eVersion : null,
  };
}

export function currentPf2eVersion(): string | null {
  const currentGame = (globalThis as { game?: { system?: { id?: unknown; version?: unknown } } }).game;
  return currentGame?.system?.id === "pf2e" && nonEmpty(currentGame.system.version) ? currentGame.system.version : null;
}

export function physicalGrantCoverageBlockers(
  draft: DraftState,
  activeSteps: readonly PendingStep[]
): readonly PhysicalGrantCoverageBlocker[] {
  return findUnsupportedPhysicalGrantRoutes(draft, activeSteps);
}

export function physicalGrantCoverageIssues(
  draft: DraftState,
  activeSteps: readonly PendingStep[]
): WayfinderStepIssue[] {
  return physicalGrantCoverageBlockers(draft, activeSteps).map((blocker) => ({
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
  activeSteps: readonly PendingStep[]
): WayfinderDraftReadiness {
  const coverageIssues = physicalGrantCoverageIssues(draft, activeSteps);
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
  ].filter((fact) => !isReviewedThaumaturgeOrigin(fact, draft, activeSlotIds));

  const blockers = UNSUPPORTED_PHYSICAL_GRANT_ROUTES.flatMap((route) => {
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
        message: `${route.label} is not supported by Wayfinder starting equipment. ${route.blocker.detail} Use the PF2E sheet for this build.`,
      },
    ];
  });
  const root = draft.selections["class-level-1"];
  if (root?.uuid === CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass && root.itemType === "class") {
    for (const origin of THAUMATURGE_IMPLEMENT_ORIGINS) {
      const selection = draft.branchSelections[origin.slotId];
      if (
        !selection ||
        !activeSlotIds.has(origin.slotId) ||
        selection.slotId !== origin.slotId ||
        THAUMATURGE_FIXED_IMPLEMENTS.some(
          (entry) => selection.uuid === `Compendium.pf2e.classfeatures.Item.${entry.featureId}`
        ) ||
        blockers.some((blocker) => blocker.sourceSlotId === origin.slotId)
      )
        continue;
      blockers.push({
        code: "unsupported-physical-grant",
        routeId: "thaumaturge-unreviewed-implement",
        reasonCode: "unprofiled-native-grant",
        sourceSlotId: origin.slotId,
        sourceUuid: selection.uuid,
        message:
          "This Thaumaturge implement has no reviewed native equipment support in Wayfinder. Use the PF2E sheet for this build.",
      });
    }
  }
  return blockers;
}

function isReviewedThaumaturgeOrigin(
  fact: ActiveSelectionFact,
  draft: DraftState,
  activeSlotIds: ReadonlySet<string>
): boolean {
  const root = draft.selections["class-level-1"];
  const selection = draft.branchSelections[fact.sourceSlotId];
  const origin = THAUMATURGE_IMPLEMENT_ORIGINS.find((entry) => entry.slotId === fact.sourceSlotId);
  if (
    fact.channel !== "branchSelections" ||
    !origin ||
    draft.targetLevel < origin.level ||
    root?.slotId !== "class-level-1" ||
    root.itemType !== "class" ||
    root.uuid !== CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass ||
    selection?.slotId !== fact.sourceSlotId ||
    selection.itemType !== "feat" ||
    selection.featType !== "classfeature" ||
    !THAUMATURGE_FIXED_IMPLEMENTS.some(
      (entry) => fact.sourceUuid === `Compendium.pf2e.classfeatures.Item.${entry.featureId}`
    )
  )
    return false;
  // PF2E can reuse an existing same-source grant; two origins may never claim one implement.
  return !THAUMATURGE_IMPLEMENT_ORIGINS.some(
    (entry) =>
      entry.slotId !== fact.sourceSlotId &&
      entry.level <= draft.targetLevel &&
      activeSlotIds.has(entry.slotId) &&
      draft.branchSelections[entry.slotId]?.uuid === fact.sourceUuid
  );
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
