import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import type { DraftState } from "../src/types";
import {
  advanceStartingEquipmentRenderSession,
  canDeriveStartingEquipmentRender,
  canUseStartingEquipmentCommandPartial,
  commitStartingEquipmentRenderSession,
  createStartingEquipmentRenderSession,
  EQUIPMENT_CART_PART,
  EQUIPMENT_CATALOGUE_PART,
  EQUIPMENT_DETAIL_PART,
  EQUIPMENT_POLICY_PART,
  EQUIPMENT_STATUS_PART,
  type StartingEquipmentRenderRequest,
  startingEquipmentPartsForIntent,
  startingEquipmentRenderIdentity,
} from "../src/wayfinder/application/starting-equipment-render-session";
import type { StartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import { STARTING_EQUIPMENT_RESULT_WINDOW } from "../src/wayfinder/starting-equipment-result-window";
import type { StartingEquipmentStepPane } from "../src/wayfinder/view-models";
import { acquisitionFixture } from "./fixtures/acquisition-fixture";

describe("starting equipment render session", () => {
  it("invalidates exact step, target, policy, source, and stale view revisions", () => {
    const draft = reviewedDraft();
    const identity = startingEquipmentRenderIdentity(draft, STEP.id, 4);
    const session = createStartingEquipmentRenderSession({
      identity,
      viewRevision: 8,
      step: STEP,
      evaluation: EVALUATION,
      pane: pane(),
    });
    const current = request({ viewRevision: 9, sourceRevision: 4 });

    expect(canDeriveStartingEquipmentRender(session, identity, current)).toBe(true);
    expect(canDeriveStartingEquipmentRender(session, identity, { ...current, stepId: "other-step" })).toBe(false);
    expect(canDeriveStartingEquipmentRender(session, identity, { ...current, sourceRevision: 5 })).toBe(false);
    expect(canDeriveStartingEquipmentRender(session, identity, { ...current, viewRevision: 8 })).toBe(false);

    const otherTarget = { ...draft, targetLevel: 6 };
    expect(
      canDeriveStartingEquipmentRender(session, startingEquipmentRenderIdentity(otherTarget, STEP.id, 4), current)
    ).toBe(false);

    const acquisition = draft.acquisition!;
    const otherPolicy: DraftState = {
      ...draft,
      acquisition: {
        ...acquisition,
        policySnapshot: { ...acquisition.policySnapshot!, fingerprint: "changed-policy" },
      },
    };
    expect(
      canDeriveStartingEquipmentRender(session, startingEquipmentRenderIdentity(otherPolicy, STEP.id, 4), current)
    ).toBe(false);
  });

  it("advances only forward within the same prepared source session", () => {
    const draft = reviewedDraft();
    const session = createStartingEquipmentRenderSession({
      identity: startingEquipmentRenderIdentity(draft, STEP.id, 2),
      viewRevision: 3,
      step: STEP,
      evaluation: EVALUATION,
      pane: pane(),
    });
    const next = advanceStartingEquipmentRenderSession(
      session,
      request({ viewRevision: 4, sourceRevision: 2 }),
      pane()
    );

    expect(next.viewRevision).toBe(4);
    expect(() =>
      advanceStartingEquipmentRenderSession(next, request({ viewRevision: 4, sourceRevision: 2 }), pane())
    ).toThrow(/stale/i);
    expect(() =>
      advanceStartingEquipmentRenderSession(next, request({ viewRevision: 5, sourceRevision: 3 }), pane())
    ).toThrow(/another prepared session/i);
  });

  it("keeps the last ready catalogue session when preview enrichment fails", () => {
    const draft = reviewedDraft();
    const current = createStartingEquipmentRenderSession({
      identity: startingEquipmentRenderIdentity(draft, STEP.id, 2),
      viewRevision: 3,
      step: STEP,
      evaluation: EVALUATION,
      pane: pane([{ sourceUuid: "retryable-item" }]),
    });
    const failedPreview = advanceStartingEquipmentRenderSession(
      current,
      request({ intent: "preview", viewRevision: 4, sourceRevision: 2 }),
      pane([], "error")
    );

    expect(
      commitStartingEquipmentRenderSession(
        current,
        failedPreview,
        request({ intent: "preview", viewRevision: 4, sourceRevision: 2 })
      )
    ).toBe(current);
    expect(
      commitStartingEquipmentRenderSession(
        current,
        failedPreview,
        request({ intent: "search", viewRevision: 4, sourceRevision: 2 })
      )
    ).toBe(failedPreview);
  });

  it("maps only steady actions to replaceable equipment parts", () => {
    expect(startingEquipmentPartsForIntent("search")).toEqual([EQUIPMENT_CATALOGUE_PART, EQUIPMENT_DETAIL_PART]);
    expect(startingEquipmentPartsForIntent("facet")).toEqual([EQUIPMENT_CATALOGUE_PART, EQUIPMENT_DETAIL_PART]);
    expect(startingEquipmentPartsForIntent("window")).toEqual([EQUIPMENT_CATALOGUE_PART, EQUIPMENT_DETAIL_PART]);
    expect(startingEquipmentPartsForIntent("preview")).toEqual([EQUIPMENT_DETAIL_PART]);
    expect(startingEquipmentPartsForIntent("recipe")).toEqual([EQUIPMENT_POLICY_PART, EQUIPMENT_STATUS_PART]);
    expect(startingEquipmentPartsForIntent("quantity")).toEqual([
      EQUIPMENT_POLICY_PART,
      EQUIPMENT_CATALOGUE_PART,
      EQUIPMENT_DETAIL_PART,
      EQUIPMENT_CART_PART,
      EQUIPMENT_STATUS_PART,
    ]);
  });

  it("allows command partials only while readiness cannot transition", () => {
    const unreviewed = reviewedDraft("unreviewed");
    expect(canUseStartingEquipmentCommandPartial(unreviewed, "quantity")).toBe(true);
    expect(canUseStartingEquipmentCommandPartial(reviewedDraft(), "quantity")).toBe(false);

    const awaiting = reviewedDraft("unreviewed");
    awaiting.acquisition = { ...awaiting.acquisition!, policySnapshot: null };
    expect(canUseStartingEquipmentCommandPartial(awaiting, "recipe")).toBe(true);
    expect(canUseStartingEquipmentCommandPartial(unreviewed, "recipe")).toBe(false);

    awaiting.acquisitionCorrupt = true;
    expect(canUseStartingEquipmentCommandPartial(awaiting, "recipe")).toBe(false);
  });

  it("retains a complete lightweight catalogue projection", () => {
    const draft = reviewedDraft();
    const session = createStartingEquipmentRenderSession({
      identity: startingEquipmentRenderIdentity(draft, STEP.id, 1),
      viewRevision: 1,
      step: STEP,
      evaluation: EVALUATION,
      pane: pane(
        Array.from({ length: STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize + 1 }, (_, index) => ({
          sourceUuid: `item-${index}`,
        }))
      ),
    });
    expect(session.pane.catalogue.items).toHaveLength(STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize + 1);
  });
});

const STEP: StartingEquipmentStep = {
  id: "starting-equipment-level-5",
  slotId: "starting-equipment-level-5",
  slotKind: "starting-equipment",
  kind: "starting-equipment",
  level: 5,
  title: "Starting equipment",
  description: "Choose gear.",
  required: true,
};

const EVALUATION = {
  state: "incomplete" as const,
  complete: false as const,
  status: "Choose gear",
  issue: {
    code: "equipment-review" as const,
    stepId: STEP.id,
    slotId: STEP.slotId,
    title: STEP.title,
    message: "Review gear.",
  },
};

function reviewedDraft(disposition: "reviewed" | "unreviewed" = "reviewed"): DraftState {
  const draft = createEmptyDraft(5);
  draft.acquisition = acquisitionFixture({ disposition }).draft;
  return draft;
}

function request(overrides: Partial<StartingEquipmentRenderRequest> = {}): StartingEquipmentRenderRequest {
  return {
    viewRevision: 2,
    sourceRevision: 1,
    stepId: STEP.id,
    query: "",
    intent: "search",
    criteriaRevision: 0,
    announceWindow: true,
    offset: 0,
    limit: STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize,
    ...overrides,
  };
}

function pane(
  items: readonly unknown[] = [],
  state: StartingEquipmentStepPane["catalogue"]["state"] = "ready"
): StartingEquipmentStepPane {
  return {
    kind: "starting-equipment",
    catalogue: { items, state },
  } as unknown as StartingEquipmentStepPane;
}
