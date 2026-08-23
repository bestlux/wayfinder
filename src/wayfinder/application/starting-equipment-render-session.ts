import type { DraftState } from "../../types.js";
import type { WayfinderStepEvaluation } from "../domain/step-evaluation.js";
import type { StartingEquipmentStep } from "../domain/step-types.js";
import type { StartingEquipmentStepPane } from "../view-models.js";
import type { PickerSearchRequest } from "./picker-search-scheduler.js";

export const EQUIPMENT_POLICY_PART = "equipment-policy";
export const EQUIPMENT_CATALOGUE_PART = "equipment-catalogue";
export const EQUIPMENT_DETAIL_PART = "equipment-detail";
export const EQUIPMENT_CART_PART = "equipment-cart";
export const EQUIPMENT_STATUS_PART = "equipment-status";

export const EQUIPMENT_RENDER_PARTS = [
  EQUIPMENT_POLICY_PART,
  EQUIPMENT_CATALOGUE_PART,
  EQUIPMENT_DETAIL_PART,
  EQUIPMENT_CART_PART,
  EQUIPMENT_STATUS_PART,
] as const;

export type StartingEquipmentRenderPart = (typeof EQUIPMENT_RENDER_PARTS)[number];
export type StartingEquipmentRenderIntent = "search" | "facet" | "window" | "preview" | "quantity" | "recipe";

export interface StartingEquipmentRenderIdentity {
  readonly stepId: string;
  readonly targetLevel: number;
  readonly policyRevision: string;
  readonly sourceRevision: number;
}

export interface StartingEquipmentRenderSession {
  readonly identity: StartingEquipmentRenderIdentity;
  readonly viewRevision: number;
  readonly step: StartingEquipmentStep;
  readonly evaluation: WayfinderStepEvaluation;
  readonly pane: StartingEquipmentStepPane;
}

export interface StartingEquipmentRenderRequest extends PickerSearchRequest {
  readonly intent: StartingEquipmentRenderIntent;
  readonly criteriaRevision: number;
  readonly announceWindow: boolean;
  readonly offset: number;
  readonly limit: number;
}

export function startingEquipmentRenderIdentity(
  draft: DraftState,
  stepId: string,
  sourceRevision: number
): StartingEquipmentRenderIdentity {
  const acquisition = draft.acquisition;
  return {
    stepId,
    targetLevel: draft.targetLevel,
    policyRevision: acquisition
      ? `${acquisition.draftId}:${acquisition.batchId}:${acquisition.policySnapshot?.fingerprint ?? "awaiting-authority"}`
      : "not-initialized",
    sourceRevision,
  };
}

export function createStartingEquipmentRenderSession(args: {
  readonly identity: StartingEquipmentRenderIdentity;
  readonly viewRevision: number;
  readonly step: StartingEquipmentStep;
  readonly evaluation: WayfinderStepEvaluation;
  readonly pane: StartingEquipmentStepPane;
}): StartingEquipmentRenderSession {
  return {
    identity: { ...args.identity },
    viewRevision: args.viewRevision,
    step: args.step,
    evaluation: args.evaluation,
    pane: args.pane,
  };
}

export function canDeriveStartingEquipmentRender(
  session: StartingEquipmentRenderSession,
  identity: StartingEquipmentRenderIdentity,
  request: StartingEquipmentRenderRequest
): boolean {
  return (
    sameStartingEquipmentRenderIdentity(session.identity, identity) &&
    request.stepId === identity.stepId &&
    request.sourceRevision === identity.sourceRevision &&
    request.viewRevision > session.viewRevision
  );
}

export function advanceStartingEquipmentRenderSession(
  session: StartingEquipmentRenderSession,
  request: StartingEquipmentRenderRequest,
  pane: StartingEquipmentStepPane
): StartingEquipmentRenderSession {
  if (request.stepId !== session.identity.stepId || request.sourceRevision !== session.identity.sourceRevision) {
    throw new Error("Starting-equipment render request belongs to another prepared session.");
  }
  if (request.viewRevision <= session.viewRevision) {
    throw new Error("Starting-equipment render request is stale.");
  }
  return { ...session, viewRevision: request.viewRevision, pane };
}

export function startingEquipmentPartsForIntent(
  intent: StartingEquipmentRenderIntent
): readonly StartingEquipmentRenderPart[] {
  switch (intent) {
    case "search":
    case "facet":
    case "window":
      return [EQUIPMENT_CATALOGUE_PART, EQUIPMENT_DETAIL_PART];
    case "preview":
      return [EQUIPMENT_DETAIL_PART];
    case "recipe":
      return [EQUIPMENT_POLICY_PART, EQUIPMENT_STATUS_PART];
    case "quantity":
      return [...EQUIPMENT_RENDER_PARTS];
  }
}

export function canUseStartingEquipmentCommandPartial(
  draft: DraftState,
  intent: Extract<StartingEquipmentRenderIntent, "quantity" | "recipe">
): boolean {
  const acquisition = draft.acquisition;
  if (!acquisition || draft.acquisitionCorrupt) return false;
  if (intent === "recipe") return acquisition.policySnapshot === null;
  return acquisition.policySnapshot !== null && acquisition.disposition.kind === "unreviewed";
}

function sameStartingEquipmentRenderIdentity(
  left: StartingEquipmentRenderIdentity,
  right: StartingEquipmentRenderIdentity
): boolean {
  return (
    left.stepId === right.stepId &&
    left.targetLevel === right.targetLevel &&
    left.policyRevision === right.policyRevision &&
    left.sourceRevision === right.sourceRevision
  );
}
