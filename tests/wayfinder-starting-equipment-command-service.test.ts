import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft, normalizeState } from "../src/draft-service";
import { executeStartingEquipmentCommand } from "../src/wayfinder/application/starting-equipment-command-service";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  createEquipmentPolicyResolver,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
} from "../src/wayfinder/domain/equipment-policy";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import { acquisitionFixture, acquisitionLine } from "./fixtures/acquisition-fixture";

describe("starting equipment command service", () => {
  it("returns a reviewed purchase state without mutating the caller draft", async () => {
    const fixture = acquisitionFixture({ disposition: "unreviewed" });
    const context = commandContext(fixture.draft);
    const original = context.draft.acquisition;

    const result = await executeStartingEquipmentCommand(
      { type: "review-purchases" },
      context,
      ledgerDependencies(fixture) as never
    );

    expect(context.draft.acquisition).toBe(original);
    expect(result.acquisition.disposition).toMatchObject({
      kind: "purchase-ledger",
      review: { reviewedByUserId: "owner-1" },
    });
    expect(result.statusNote).toBe("Starting-equipment purchases reviewed.");
  });

  it("records retain-all as an explicit reviewed empty-cart decision", async () => {
    const fixture = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const result = await executeStartingEquipmentCommand(
      { type: "retain-all" },
      commandContext(fixture.draft),
      ledgerDependencies(fixture) as never
    );

    expect(result.acquisition.disposition).toMatchObject({
      kind: "retain-all",
      retainedCopper: fixture.ledger.remainingCopper,
      review: { reviewedByUserId: "owner-1" },
    });
  });

  it("owns add, quantity, and remove transitions and invalidates prior review", async () => {
    const empty = acquisitionFixture({ lines: [], disposition: "unreviewed" });
    const added = await executeStartingEquipmentCommand(
      { type: "add-line", line: acquisitionLine() },
      commandContext(empty.draft)
    );
    expect(added.acquisition.lines).toHaveLength(1);

    const reviewed = acquisitionFixture().draft;
    const quantity = await executeStartingEquipmentCommand(
      { type: "set-quantity", lineId: "line-1", quantity: 3 },
      commandContext(reviewed)
    );
    expect(quantity.acquisition.lines[0]?.price.requestedQuantity).toBe(3);
    expect(quantity.acquisition.lines[0]?.price.linePriceCopper).toBe(300);
    expect(quantity.acquisition.disposition).toMatchObject({
      kind: "unreviewed",
      invalidatedFrom: "purchase-ledger",
      reasons: ["quantity"],
    });

    const removed = await executeStartingEquipmentCommand(
      { type: "remove-line", lineId: "line-1" },
      commandContext(quantity.acquisition)
    );
    expect(removed.acquisition.lines).toEqual([]);
  });

  it("initializes browsing when Titan Mauler still needs a catalogue selection", async () => {
    const policy = createEquipmentPolicyResolver({
      resolveGmJudgment: () => null,
      verifyOwnerStartAttestation: () => false,
    }).resolve({
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 1,
      worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
      selectedRecipe: null,
      effectivePackIds: ["pf2e.equipment-srd"],
      enabledSourceSlugs: ["player-core"],
      knownSourceSlugs: ["player-core"],
      showEmptySources: false,
      showUnknownSources: false,
      abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
    });
    const baseline = createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-19T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    });
    const evaluateAdmission = vi.fn((args: { preparedClassGrantPlan: { grants: readonly unknown[] } }) => {
      expect(args.preparedClassGrantPlan.grants).toEqual([]);
      return { kind: "eligible-empty" as const, baseline };
    });
    const prepareClassGrantPlan = vi.fn();

    const result = await executeStartingEquipmentCommand({ type: "initialize" }, commandContext(null), {
      mintIdentity: vi.fn(() => ({ draftId: "draft-1", batchId: "batch-1", manifestId: "manifest-1" })),
      resolvePolicy: vi.fn(() => policy),
      projectClassGrants: vi.fn(async () => ({
        grants: [],
        preparedPlan: null,
        blockers: [
          {
            code: "titan-selection-required",
            profileId: "giant-instinct-titan-mauler",
            message: "Giant Instinct requires a reviewed Titan Mauler weapon selection.",
          },
        ],
      })),
      prepareClassGrantPlan,
      evaluateAdmission,
      evaluateLedger: vi.fn(),
    } as never);

    expect(result.acquisition).toMatchObject({
      baseline: { actorId: "actor-1", currencyCopper: 0 },
      disposition: { kind: "unreviewed" },
    });
    expect(result.statusNote).toContain("Choose the required Titan Mauler weapon");
    expect(prepareClassGrantPlan).not.toHaveBeenCalled();
  });
});

function commandContext(acquisition: ReturnType<typeof acquisitionFixture>["draft"] | null) {
  const draft = createEmptyDraft(1);
  draft.acquisition = acquisition;
  return {
    actor: {},
    draft,
    moduleState: normalizeState(null),
    steps: [createStartingEquipmentStep(1)],
    userId: "owner-1",
    now: () => "2026-08-19T20:00:00.000Z",
  };
}

function ledgerDependencies(fixture: ReturnType<typeof acquisitionFixture>) {
  return {
    mintIdentity: vi.fn(),
    resolvePolicy: vi.fn(),
    prepareClassGrantPlan: vi.fn(async () => fixture.classGrantPlan),
    evaluateAdmission: vi.fn(),
    evaluateLedger: vi.fn(() => fixture.ledger),
  };
}
