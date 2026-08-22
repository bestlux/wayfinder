import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createEmptyDraft } from "../src/draft-service";
import { CLASS_GRANT_PROFILE_UUIDS, createPlannedClassGrant } from "../src/wayfinder/domain/class-grant-reconciliation";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  createEquipmentPolicyRequest,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  declineEquipmentPolicyRequest,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentPolicyRequestDecisionV1,
} from "../src/wayfinder/domain/equipment-policy";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import {
  buildStartingEquipmentPane as buildStartingEquipmentPaneLocalized,
  MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS,
} from "../src/wayfinder/panes/starting-equipment-pane";
import type { StartingEquipmentCatalogueRecord } from "../src/wayfinder/view-models";
import { acquisitionFixture, acquisitionLine, acquisitionPrice } from "./fixtures/acquisition-fixture";
import { localizeAcquisitionEnglish } from "./fixtures/acquisition-localization-fixture";

function buildStartingEquipmentPane(
  ...args: [
    Parameters<typeof buildStartingEquipmentPaneLocalized>[0],
    Parameters<typeof buildStartingEquipmentPaneLocalized>[1],
    Parameters<typeof buildStartingEquipmentPaneLocalized>[2],
    Parameters<typeof buildStartingEquipmentPaneLocalized>[3],
    Parameters<typeof buildStartingEquipmentPaneLocalized>[5]?,
  ]
) {
  return buildStartingEquipmentPaneLocalized(args[0], args[1], args[2], args[3], localizeAcquisitionEnglish, args[4]);
}

/**
 * Markup elements permitted in ONE catalogue row template.
 *
 * This is NOT the release budget. `equipment-catalogue-profile.json` freezes
 * `maxResultDomElementCount`, which the live profile measures as every descendant of
 * `.equipment-result-list` across all rendered rows (browser-equipment-profile.js). A per-row
 * template cap cannot enforce that; the two numbers are unrelated. Live qualification owns the
 * release budget.
 */
const MAX_RESULT_ROW_TEMPLATE_ELEMENTS = 12;

describe("starting equipment pane", () => {
  it("renders level-5 allowance buckets separately from residual coin", () => {
    const draft = createEmptyDraft(5);
    const allowanceLine = acquisitionLine({
      itemLevel: 3,
      funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "level-3-1" } },
      price: acquisitionLine({ requestedQuantity: 20 }).price,
    });
    draft.acquisition = acquisitionFixture({ lines: [allowanceLine], disposition: "unreviewed" }).draft;
    draft.acquisition = {
      ...draft.acquisition,
      policySnapshot: {
        ...draft.acquisition.policySnapshot!,
        material: {
          ...draft.acquisition.policySnapshot!.material,
          budgetCopper: 5_000,
          allowances: [
            { allowanceId: "level-1-1", itemLevel: 1 },
            { allowanceId: "level-1-2", itemLevel: 1 },
            { allowanceId: "level-2-1", itemLevel: 2 },
            { allowanceId: "level-3-1", itemLevel: 3 },
            { allowanceId: "level-3-2", itemLevel: 3 },
            { allowanceId: "level-4-1", itemLevel: 4 },
          ],
        },
      },
    };
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.level-three",
      name: "Level 3 permanent item",
      itemType: "equipment",
      level: 3,
      rarity: "common",
      sourceLabel: "Player Core",
      priceCopper: 2_000,
      priceLabel: "20 gp",
      bulkLabel: "L",
      handsLabel: null,
      traits: [],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: false,
      exceptionRequestable: false,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 1,
        records: [record],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.policy.allowances).toHaveLength(6);
    expect(pane.policy.allowances.find((allowance) => allowance.allowanceId === "level-3-1")?.used).toBe(true);
    expect(pane.cart).toMatchObject({ spentLabel: "0 gp", remainingLabel: "50 gp" });
    expect(pane.catalogue.items[0]).toMatchObject({
      canBuyWithCurrency: true,
      allowanceOptions: [
        { allowanceId: "level-3-2", label: "Use a level 3 allowance" },
        { allowanceId: "level-4-1", label: "Use a level 4 allowance" },
      ],
    });
  });

  it("keeps an allowance-funded item priced normally when coin alone cannot cover it", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    draft.acquisition = {
      ...draft.acquisition,
      policySnapshot: {
        ...draft.acquisition.policySnapshot!,
        material: {
          ...draft.acquisition.policySnapshot!.material,
          budgetCopper: 1_000,
          allowances: [{ allowanceId: "level-4-1", itemLevel: 4 }],
        },
      },
    };
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.beyond-coin",
      name: "Level 4 permanent item",
      itemType: "equipment",
      level: 4,
      rarity: "common",
      sourceLabel: "Player Core",
      // Far beyond the 10 gp budget, but squarely inside the level-4 allowance.
      priceCopper: 7_500,
      priceLabel: "75 gp",
      bulkLabel: "L",
      handsLabel: null,
      traits: [],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: false,
      exceptionRequestable: false,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 1,
        records: [record],
        filters: [],
        activeFilters: {},
        previewSourceUuid: record.sourceUuid,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    const item = pane.catalogue.items[0]!;
    expect(item.currencyAffordable).toBe(false);
    expect(item.canBuyWithCurrency).toBe(false);
    // The allowance can pay for it, so it must not be presented as out of reach.
    expect(item.canAdd).toBe(true);
    expect(item.allowanceOptions).toHaveLength(1);

    const catalogue = readFileSync(resolve("templates/wayfinder/starting-equipment-catalogue.hbs"), "utf8");
    const detail = readFileSync(resolve("templates/wayfinder/starting-equipment-detail.hbs"), "utf8");
    for (const template of [catalogue, detail]) {
      expect(template).toContain("{{#unless canAdd}} is-unaffordable{{/unless}}");
      expect(template).not.toContain("{{#unless affordable}} is-unaffordable{{/unless}}");
    }
  });

  it("does not offer an allowance for a catalogue-blocked permanent item", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.unsupported.equipment.Item.blocked",
      name: "Blocked permanent item",
      itemType: "equipment",
      level: 4,
      rarity: "uncommon",
      sourceLabel: "Unsupported Source",
      priceCopper: 7_500,
      priceLabel: "75 gp",
      bulkLabel: "L",
      handsLabel: null,
      traits: [],
      available: false,
      unavailableReason: "This source is not available under current policy.",
      titanMaulerEligible: false,
      exceptionRequestable: true,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 1,
        records: [record],
        filters: [],
        activeFilters: {},
        previewSourceUuid: record.sourceUuid,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.items[0]).toMatchObject({
      canAdd: false,
      canBuyWithCurrency: false,
      allowanceOptions: [],
      unavailableReason: "Needs your GM to allow this source or rarity.",
    });
  });

  it("unblocks an item re-request only after decline, not while an approval still needs repair", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.uncommon",
      name: "Reviewed item",
      itemType: "equipment",
      level: 1,
      rarity: "uncommon",
      sourceLabel: "Player Core",
      priceCopper: 100,
      priceLabel: "1 gp",
      bulkLabel: "L",
      handsLabel: null,
      traits: [],
      available: false,
      unavailableReason: "Requires approval.",
      titanMaulerEligible: false,
      exceptionRequestable: true,
    };
    const request = createEquipmentPolicyRequest({
      requestId: "request-item-1",
      facts: {
        kind: "rarity-source-exception",
        actorId: "actor-1",
        draftId: draft.acquisition.draftId,
        targetLevel: 5,
        scope: "rarity",
        sourceUuid: record.sourceUuid,
        packId: "pf2e.equipment-srd",
        publicationSlug: "player-core",
        rarity: "uncommon",
      },
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-20T12:00:00.000Z",
      reason: "Please review this item",
    });
    draft.equipmentPolicyRequests = [request];
    const decision: EquipmentPolicyRequestDecisionV1 = {
      version: 1,
      outcome: "approved",
      factsFingerprint: request.factsFingerprint,
      request: {
        requestId: request.requestId,
        requesterUserId: request.requesterUserId,
        requesterName: request.requesterName,
        requestedAt: request.requestedAt,
        reason: request.reason,
        facts: request.facts,
      },
      decidedByUserId: "gm-1",
      decidedByName: "Game Master",
      decidedAt: "2026-08-20T13:00:00.000Z",
      reason: "Reviewed",
    };
    const catalogue = {
      state: "ready" as const,
      message: "",
      query: "",
      matchedRecordCount: 1,
      records: [record],
      filters: [],
      activeFilters: {},
      previewSourceUuid: record.sourceUuid,
      titanMauler: { required: false, selectedSourceUuid: null },
    };
    const setup = {
      worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
      judgments: [],
      requestDecisions: [decision],
      isGm: false,
    };

    const approvalRepair = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      catalogue,
      setup
    );
    expect(approvalRepair.catalogue.items[0]?.canRequestException).toBe(false);

    const declined = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Declined", issue: null },
      catalogue,
      { ...setup, requestDecisions: [{ ...decision, outcome: "declined" }] }
    );
    expect(declined.catalogue.items[0]?.canRequestException).toBe(true);
  });

  it("projects policy, catalogue, affordability, cart quantity, and review state without OptionRecord", () => {
    const draft = createEmptyDraft(1);
    draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.item",
      name: "Adventurer's Pack",
      itemType: "equipment",
      level: 0,
      rarity: "common",
      sourceLabel: "Player Core",
      priceCopper: 100,
      priceLabel: "1 gp",
      bulkLabel: "1",
      handsLabel: null,
      traits: ["common"],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: false,
      exceptionRequestable: false,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      {
        state: "incomplete",
        complete: false,
        status: "Review purchases or retain all",
        issue: {
          code: "equipment-review",
          stepId: "starting-equipment-level-1",
          slotId: "starting-equipment-level-1",
          title: "Starting equipment",
          message: "Review purchases.",
        },
      },
      {
        state: "ready",
        message: "",
        query: "pack",
        matchedRecordCount: 1,
        records: [record],
        filters: [{ key: "type", label: "Equipment", value: "equipment" }],
        activeFilters: { type: ["equipment"] },
        previewSourceUuid: record.sourceUuid,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.templateKind).toBe("starting-equipment");
    expect(pane.policy).toMatchObject({
      budgetLabel: "10 gp",
      automaticEligibilityLabel: "Common gear from 1 approved pack",
    });
    expect(pane.catalogue.items[0]).toMatchObject({
      name: "Adventurer's Pack",
      currencyAffordable: true,
      canAdd: true,
      previewAriaLabel: "Preview Adventurer's Pack · Level 0 · Common · Player Core · 1 gp · Available",
      buyAriaLabel: "Buy Adventurer's Pack with coin",
      buyFocusId: `starting-equipment-item:${record.sourceUuid}:coin`,
      requestExceptionAriaLabel: "Request an exact exception for Adventurer's Pack",
      titanMaulerAriaLabel: "Choose Adventurer's Pack as the Titan Mauler weapon",
    });
    expect(pane.catalogue.filters[0]).toMatchObject({
      value: "equipment",
      selected: true,
      focusId: "starting-equipment-filter:type:equipment",
    });
    expect(pane.catalogue.resultAnnouncement).toBe("Showing 1 of 1");
    expect(pane.cart.lines[0]).toMatchObject({
      quantity: 1,
      focusId: "starting-equipment-line:line-1",
      decreaseAriaLabel: "Decrease quantity of Adventurer's Pack",
      decreaseFocusId: "starting-equipment-line:line-1:decrease",
      increaseFocusId: "starting-equipment-line:line-1:increase",
      removeFocusId: "starting-equipment-line:line-1:remove",
    });
    expect(pane.cart.announcement).toBe("Cart: 1 lines, 1 gp spent, 9 gp remaining.");
    expect(pane.review.canReviewPurchases).toBe(true);
  });

  it("shows materialized stack quantity rather than the pricing request count", () => {
    const draft = createEmptyDraft(1);
    const stackedLine = acquisitionLine({ price: acquisitionPrice({ sourceQuantity: 12, requestedQuantity: 1 }) });
    draft.acquisition = acquisitionFixture({ lines: [stackedLine], disposition: "unreviewed" }).draft;

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.cart.lines[0]?.quantity).toBe(12);
    expect(pane.cart.lines[0]?.quantityStep).toBe(12);
    expect(pane.cart.lines[0]?.quantityFocusId).toBe("starting-equipment-line:line-1:quantity");
    expect(pane.cart.count).toBe(12);
  });

  it("shows Adventurer's Pack child rows while keeping the logical purchase quantity fixed", () => {
    const draft = createEmptyDraft(1);
    const kitLine = acquisitionLine({
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB",
      stackingIntent: "separate",
      kitExpansion: {
        version: 1,
        profile: "adventurers-pack-v1",
        requestedQuantity: 1,
        items: Array.from({ length: 9 }, (_, index) => ({
          expansionPath: index === 0 ? "mca3x" : `mca3x/child-${index}`,
          parentPath: index === 0 ? null : "mca3x",
          sourceUuid: `Compendium.pf2e.equipment-srd.Item.child-${index}`,
          documentFingerprint: `fingerprint-${index}`,
          name: index === 0 ? "Backpack" : `Child ${index}`,
          itemType: index === 0 ? ("backpack" as const) : ("equipment" as const),
          quantity: index === 3 ? 10 : 1,
          size: "medium" as const,
        })),
      },
    });
    draft.acquisition = acquisitionFixture({ lines: [kitLine], disposition: "unreviewed" }).draft;

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.cart.lines[0]).toMatchObject({
      quantity: 1,
      canChangeQuantity: false,
      children: expect.arrayContaining([
        { name: "Backpack", quantity: 1, nested: false },
        { name: "Child 3", quantity: 10, nested: true },
      ]),
    });
  });

  it("keeps permanent-item allowance quantities fixed in the cart", () => {
    const draft = createEmptyDraft(5);
    const allowanceLine = acquisitionLine({
      funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "allowance-5" } },
    });
    draft.acquisition = acquisitionFixture({ lines: [allowanceLine], disposition: "unreviewed" }).draft;

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.cart.lines[0]).toMatchObject({ quantity: 1, canChangeQuantity: false });
  });

  it("projects class-grant cart lines as fixed and policy-authorized by their grant", () => {
    const draft = createEmptyDraft(1);
    const nativeGrant = fixedNativeGrant();
    const nativeLine = acquisitionLine({
      lineId: "native-line",
      sourceUuid: nativeGrant.expected.sourceUuid,
      itemLevel: 0,
      funding: { lane: "class-grant", grant: { plannedGrantId: nativeGrant.grantId } },
      stackingIntent: "separate",
      policyDecision: {
        ...acquisitionLine().policyDecision,
        eligible: false,
        rarity: "uncommon",
      },
    });
    const titanLine = acquisitionLine({
      lineId: "titan-line",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      documentFingerprint: "titan-document",
      priceFingerprint: "titan-price",
      itemLevel: 0,
      funding: {
        lane: "class-grant",
        grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
      },
      stackingIntent: "separate",
    });
    const titanGrant = titanMaulerGrant(titanLine);
    draft.acquisition = acquisitionFixture({
      disposition: "unreviewed",
      lines: [nativeLine, titanLine],
      plannedClassGrants: [nativeGrant, titanGrant],
    }).draft;

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases or retain all", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: true, selectedSourceUuid: titanLine.sourceUuid },
      }
    );

    expect(pane.cart.lines[0]).toMatchObject({
      canRemove: false,
      canChangeQuantity: false,
      fundingLabel: "Granted by your build · free",
      unavailableReason: null,
    });
    expect(pane.cart.lines[1]).toMatchObject({ canRemove: true, canChangeQuantity: false });
    expect(pane.titanMauler).toEqual({ required: true, selected: true, selectedName: titanLine.sourceUuid });
  });

  it("requires an explicit eligible Titan Mauler choice before equipment review", () => {
    const draft = createEmptyDraft(1);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    const weapon: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
      name: "Longsword",
      itemType: "weapon",
      level: 0,
      rarity: "common",
      sourceLabel: "Player Core",
      priceCopper: 100,
      priceLabel: "1 gp",
      bulkLabel: "1",
      handsLabel: "1",
      traits: ["versatile-p"],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: true,
      exceptionRequestable: false,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Choose a Titan Mauler weapon", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 1,
        records: [weapon],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: true, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.items[0]).toMatchObject({
      canAdd: true,
      canChooseTitanMauler: true,
      traits: ["Versatile P"],
    });
    expect(pane.titanMauler).toEqual({ required: true, selected: false, selectedName: null });
    expect(pane.review).toMatchObject({ canReviewPurchases: false, canRetainAll: false });
  });

  it("preserves request rationale as audit content while localizing its shell", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    draft.equipmentPolicyRequests = [
      createEquipmentPolicyRequest({
        requestId: "request-1",
        facts: {
          kind: "higher-level-start",
          actorId: "actor-1",
          draftId: draft.acquisition.draftId,
          targetLevel: 5,
          startKind: "replacement-character",
        },
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: "2026-08-20T12:00:00.000Z",
        reason: "Keep this campaign-specific rationale verbatim.",
      }),
    ];

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      {
        state: "pending",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.setup.pendingRequests[0]).toMatchObject({
      kindLabel: "Level 5 higher-level start",
      reason: "Keep this campaign-specific rationale verbatim.",
    });
  });

  it("offers both GM decisions and removes a declined request from the pending projection", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    const request = createEquipmentPolicyRequest({
      requestId: "request-1",
      facts: {
        kind: "higher-level-start",
        actorId: "actor-1",
        draftId: draft.acquisition.draftId,
        targetLevel: 5,
        startKind: "replacement-character",
      },
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-20T12:00:00.000Z",
      reason: "Replacement character",
    });
    draft.equipmentPolicyRequests = [request];
    const catalogue = {
      state: "pending" as const,
      message: "",
      query: "",
      matchedRecordCount: 0,
      records: [],
      filters: [],
      activeFilters: {},
      previewSourceUuid: null,
      titanMauler: { required: false, selectedSourceUuid: null },
    };
    const gmPane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      catalogue,
      { worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY, judgments: [], isGm: true }
    );
    expect(gmPane.setup.pendingRequests).toEqual([
      expect.objectContaining({ requestId: "request-1", canApprove: true, canDecline: true }),
    ]);

    draft.equipmentPolicyRequests = [
      declineEquipmentPolicyRequest(request, {
        declinedByUserId: "gm-1",
        declinedByName: "Game Master",
        declinedAt: "2026-08-20T13:00:00.000Z",
        reason: "Declined",
      }),
    ];
    const playerPane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      catalogue,
      { worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY, judgments: [], isGm: false }
    );
    expect(playerPane.setup.pendingRequests).toEqual([]);
  });

  it("keeps an approved request repairable until its judgment is captured in the acquisition snapshot", () => {
    const draft = createEmptyDraft(5);
    const fixture = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    const request = createEquipmentPolicyRequest({
      requestId: "request-recovery",
      facts: {
        kind: "higher-level-start",
        actorId: "actor-1",
        draftId: fixture.draftId,
        targetLevel: 5,
        startKind: "replacement-character",
      },
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-20T12:00:00.000Z",
      reason: "Replacement character",
    });
    const judgment: EquipmentPolicyJudgmentRecord = {
      id: "approval:request-recovery",
      kind: request.facts.kind,
      actorId: request.facts.actorId,
      draftId: request.facts.draftId,
      targetLevel: request.facts.targetLevel,
      factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(request.facts),
      authorUserId: "gm-1",
      authorName: "Game Master",
      recordedAt: "2026-08-20T13:00:00.000Z",
      reason: "Approved",
      request: {
        requestId: request.requestId,
        requesterUserId: request.requesterUserId,
        requesterName: request.requesterName,
        requestedAt: request.requestedAt,
        reason: request.reason,
        facts: request.facts,
      },
      revocation: null,
    };
    const decision: EquipmentPolicyRequestDecisionV1 = {
      version: 1,
      outcome: "approved",
      factsFingerprint: judgment.factsFingerprint,
      request: judgment.request,
      decidedByUserId: judgment.authorUserId,
      decidedByName: judgment.authorName,
      decidedAt: judgment.recordedAt,
      reason: judgment.reason,
    };
    draft.acquisition = { ...fixture, policySnapshot: null };
    draft.equipmentPolicyRequests = [request];
    const catalogue = {
      state: "pending" as const,
      message: "",
      query: "",
      matchedRecordCount: 0,
      records: [],
      filters: [],
      activeFilters: {},
      previewSourceUuid: null,
      titanMauler: { required: false, selectedSourceUuid: null },
    };

    const repairPane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      catalogue,
      {
        worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
        judgments: [judgment],
        requestDecisions: [decision],
        isGm: true,
      }
    );
    expect(repairPane.setup.pendingRequests).toEqual([
      expect.objectContaining({
        requestId: request.requestId,
        approvalRecorded: true,
        canApprove: true,
        canDecline: false,
      }),
    ]);

    draft.acquisition = {
      ...fixture,
      policySnapshot: {
        ...fixture.policySnapshot!,
        material: { ...fixture.policySnapshot!.material, gmJudgments: [judgment] },
      },
    };
    const appliedPane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Approved", issue: null },
      catalogue,
      {
        worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
        judgments: [judgment],
        requestDecisions: [decision],
        isGm: true,
      }
    );
    expect(appliedPane.setup.pendingRequests).toEqual([]);

    draft.acquisition = { ...fixture, policySnapshot: null };
    const declinedPane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Declined", issue: null },
      catalogue,
      {
        worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
        judgments: [],
        requestDecisions: [{ ...decision, outcome: "declined" }],
        isGm: true,
      }
    );
    expect(declinedPane.setup.pendingRequests).toEqual([]);
    expect(declinedPane.setup.requestOutcomeMessage).toMatch(/player can revise/i);
  });

  it("maps Foundry's Chinese language id to a supported Intl timestamp locale", () => {
    const draft = createEmptyDraft(5);
    draft.acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    draft.equipmentPolicyRequests = [
      createEquipmentPolicyRequest({
        requestId: "request-cn",
        facts: {
          kind: "higher-level-start",
          actorId: "actor-1",
          draftId: draft.acquisition.draftId,
          targetLevel: 5,
          startKind: "replacement-character",
        },
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: "2026-08-20T12:00:00.000Z",
        reason: "Locale regression fixture.",
      }),
    ];

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(5),
      draft,
      { state: "incomplete", complete: false, status: "Awaiting approval", issue: null },
      {
        state: "pending",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      },
      {
        worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
        judgments: [],
        isGm: false,
        locale: "cn",
      }
    );

    expect(pane.setup.pendingRequests[0]?.requestedAtLabel).toMatch(/\d{4}年\d{1,2}月\d{1,2}日/u);
    expect(pane.policy.recipeSelectionLabel).toMatch(/\d{4}年\d{1,2}月\d{1,2}日/u);
  });

  it("localizes ABP-suppressed configured components at the pane boundary", () => {
    const draft = createEmptyDraft(1);
    const configuredLine = acquisitionLine({
      price: {
        ...acquisitionPrice(),
        configurationComponents: {
          version: 1,
          itemType: "armor",
          baseItem: "chain-mail",
          source: {
            runes: { potency: 1, fundamental: 1, property: ["fortification"] },
            material: { type: null, grade: null },
          },
          prepared: {
            runes: { potency: 0, fundamental: 0, property: [] },
            material: { type: null, grade: null },
            totalCopper: 100,
          },
          baselineAndFundamentalCopper: 100,
          propertyRuneCopper: 0,
          preciousMaterialCopper: 0,
          suppressedByAbp: ["fundamental", "resilient", "property:fortification"],
        },
      },
    });
    draft.acquisition = acquisitionFixture({ lines: [configuredLine], disposition: "unreviewed" }).draft;

    const pane = buildStartingEquipmentPaneLocalized(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      },
      (key, values) =>
        key === "PF2E.ArmorPropertyRuneFortification"
          ? "Localized Fortification"
          : localizeAcquisitionEnglish(key, values)
    );

    expect(pane.cart.lines[0]?.configurationLabel).toContain(
      "PF2E ABP suppresses fundamental runes, resilient rune, Localized Fortification property rune"
    );
  });

  it("explains configured-item handoff and suppresses further shopping", () => {
    const draft = createEmptyDraft(1);
    const acquisition = acquisitionFixture({ lines: [], disposition: "unreviewed" }).draft;
    draft.acquisition = {
      ...acquisition,
      disposition: {
        kind: "handoff",
        handoff: {
          version: 1,
          kind: "pf2e-sheet",
          baselineFingerprint: acquisition.baseline!.fingerprint,
          reasons: [
            {
              code: "unsafe-configured-item",
              sourceUuid: "Compendium.pf2e.equipment-srd.Item.specific",
              itemName: "Chained Mist",
              issue: "specific-magic-item",
            },
          ],
        },
        acknowledgedByUserId: null,
        acknowledgedAt: null,
      },
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Acknowledge handoff", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 0,
        records: [],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.handoff).toMatchObject({
      active: true,
      acknowledged: false,
      reasons: [expect.stringMatching(/Chained Mist.*inventory tab/i)],
    });
    expect(pane.catalogue.searchDisabled).toBe(true);
  });

  it("renders dedicated search, filter, quantity, cart, retain-all, handoff, and focus controls", () => {
    const template = [
      "starting-equipment-pane",
      "starting-equipment-policy",
      "starting-equipment-status",
      "starting-equipment-state",
      "starting-equipment-catalogue",
      "starting-equipment-detail",
      "starting-equipment-cart",
    ]
      .map((name) => readFileSync(resolve(`templates/wayfinder/${name}.hbs`), "utf8"))
      .join("\n");
    for (const token of [
      "data-wayfinder-equipment-search",
      'data-wayfinder-action="toggle-equipment-filter"',
      'data-wayfinder-action="change-equipment-quantity"',
      "data-wayfinder-equipment-quantity",
      'data-wayfinder-action="review-equipment-purchases"',
      'data-wayfinder-action="retain-all-equipment"',
      'data-wayfinder-action="acknowledge-equipment-handoff"',
      'data-wayfinder-action="choose-titan-mauler-equipment"',
      'data-wayfinder-action="request-equipment-item-exception"',
      'data-wayfinder-action="approve-equipment-item-exception"',
      "wayfinder-pf2e.StartingEquipment.TitanMauler.ChooseTitle",
      "data-wayfinder-focus-id",
      "data-equipment-source-diagnostic",
      "wayfinder-pf2e.StartingEquipment.Handoff.Acknowledged",
      'role="group"',
      'aria-live="polite"',
      'aria-atomic="true"',
      "buyAriaLabel",
      "decreaseAriaLabel",
      "requestExceptionAriaLabel",
      "titanMaulerAriaLabel",
    ]) {
      expect(template).toContain(token);
    }
    expect(template).not.toContain("<img");
  });

  it("fails closed when a stale caller supplies diagnostics together with actionable records", () => {
    const draft = createEmptyDraft(1);
    draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.stale",
      name: "Stale Dagger",
      itemType: "weapon",
      level: 0,
      rarity: "common",
      sourceLabel: "Player Core",
      priceCopper: 20,
      priceLabel: "2 sp",
      bulkLabel: "L",
      handsLabel: "1",
      traits: ["agile"],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: true,
      exceptionRequestable: true,
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "error",
        message: "Approved equipment sources are unavailable or inconsistent.",
        diagnostics: [
          {
            code: "duplicate-equipment-source-identity",
            packId: "pf2e.equipment-srd",
            sourceIdentity: record.sourceUuid,
            message: "Duplicate equipment source identity.",
          },
        ],
        query: "",
        matchedRecordCount: 0,
        records: [record],
        filters: [],
        activeFilters: {},
        previewSourceUuid: record.sourceUuid,
        titanMauler: { required: true, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue).toMatchObject({
      state: "error",
      searchDisabled: true,
      totalResultCount: 0,
      visibleResultCount: 0,
      items: [],
      preview: null,
    });
    expect(pane.review).toMatchObject({ canReviewPurchases: false, canRetainAll: false });
  });

  it("bounds the rendered result window while retaining the total match count", () => {
    const draft = createEmptyDraft(1);
    draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
    const records = Array.from(
      { length: 20 },
      (_, index): StartingEquipmentCatalogueRecord => ({
        sourceUuid: `Compendium.pf2e.equipment-srd.Item.item-${index}`,
        name: `Common item ${index}`,
        itemType: "equipment",
        level: 0,
        rarity: "common",
        sourceLabel: "Player Core",
        priceCopper: 10,
        priceLabel: "1 sp",
        bulkLabel: "L",
        handsLabel: null,
        traits: ["common"],
        available: true,
        unavailableReason: null,
        titanMaulerEligible: false,
        exceptionRequestable: false,
      })
    );

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases or retain all", issue: null },
      {
        state: "ready",
        message: "",
        query: "common",
        matchedRecordCount: 20,
        records,
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.totalResultCount).toBe(20);
    expect(pane.catalogue.visibleResultCount).toBe(12);
    expect(pane.catalogue.items).toHaveLength(MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS);
  });

  it("projects bounded production-shaped type and source controls without hiding active facets", () => {
    const draft = createEmptyDraft(1);
    draft.acquisition = acquisitionFixture({ disposition: "unreviewed" }).draft;
    const record: StartingEquipmentCatalogueRecord = {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.dagger",
      name: "Dagger",
      itemType: "kit",
      level: 0,
      rarity: "common",
      sourceLabel: "Source 19",
      priceCopper: 20,
      priceLabel: "2 sp",
      bulkLabel: "See item details",
      handsLabel: null,
      traits: ["agile"],
      available: true,
      unavailableReason: null,
      titanMaulerEligible: false,
      exceptionRequestable: false,
    };
    const typeValues = ["ammo", "armor", "backpack", "consumable", "equipment", "kit", "shield", "treasure", "weapon"];
    const sourceValues = Array.from({ length: 20 }, (_, index) => `Source ${index}`);

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        matchedRecordCount: 1,
        records: [record],
        filters: [
          ...typeValues.map((value) => ({ key: "type", label: value, value })),
          ...(["common", "uncommon", "rare", "unique"] as const).map((value) => ({
            key: "rarity",
            label: value,
            value,
          })),
          ...sourceValues.map((value) => ({ key: "source", label: value, value })),
        ],
        activeFilters: { type: ["kit"], rarity: ["common"], source: ["Source 19"] },
        previewSourceUuid: record.sourceUuid,
        preview: {
          sourceUuid: record.sourceUuid,
          description: "<p>Selected equipment rules.</p>",
          bulkLabel: "L",
          handsLabel: "1",
        },
        openFilterPanel: "source",
        sourceFilterQuery: "Source",
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.typeFilters).toHaveLength(8);
    expect(pane.catalogue.typeFilters).toContainEqual(expect.objectContaining({ value: "kit", selected: true }));
    expect(pane.catalogue.typeFilters.map((filter) => filter.value)).toContain("weapon");
    expect(pane.catalogue.typeFilters.map((filter) => filter.value)).not.toContain("treasure");
    expect(pane.catalogue.rarityFilters).toHaveLength(4);
    expect(pane.catalogue.sourceFilters).toHaveLength(12);
    expect(pane.catalogue.sourceFilters[0]).toMatchObject({ value: "Source 19", selected: true });
    expect(pane.catalogue).toMatchObject({
      hasSourceFilters: true,
      rarityFilterActive: true,
      rarityFilterLabel: "Rarity (1 selected)",
      sourceFilterActive: true,
      sourceFilterLabel: "Source (1 selected)",
      sourcePanelOpen: true,
      sourceSearch: "Source",
      sourceResultAnnouncement: "Showing 12 of 20 matching sources",
    });
    expect(pane.catalogue.items[0]?.resultLabel).toBe("Dagger · Level 0 · Common · Source 19 · 2 sp · Available");
    expect(pane.catalogue.items[0]).toMatchObject({ bulkLabel: "", handsLabel: null });
    expect(pane.catalogue.preview).toMatchObject({
      sourceUuid: record.sourceUuid,
      description: "<p>Selected equipment rules.</p>",
      bulkLabel: "L",
      handsLabel: "1",
      buyFocusId: `starting-equipment-item:${record.sourceUuid}:coin`,
      canChooseTitanMauler: false,
    });
  });

  it("keeps each bounded result one interactive control and mounts every item action only in selected detail", () => {
    const catalogue = readFileSync(resolve("templates/wayfinder/starting-equipment-catalogue.hbs"), "utf8");
    const detail = readFileSync(resolve("templates/wayfinder/starting-equipment-detail.hbs"), "utf8");
    const pane = readFileSync(resolve("templates/wayfinder/starting-equipment-pane.hbs"), "utf8");
    const styles = readFileSync(resolve("styles/wayfinder/starting-equipment.css"), "utf8");
    const loopStart = catalogue.indexOf("{{#each activePane.catalogue.items}}");
    const loopEnd = catalogue.indexOf("{{/each}}", loopStart);
    const resultLoop = catalogue.slice(loopStart, loopEnd);

    expect(loopStart).toBeGreaterThan(-1);
    // A row is a scannable record, not a mashed sentence, but it stays cheap: no images, one control.
    expect([...resultLoop.matchAll(/<[a-z]+\b/gu)].length).toBeLessThanOrEqual(MAX_RESULT_ROW_TEMPLATE_ELEMENTS);
    expect([...resultLoop.matchAll(/<button\b/gu)]).toHaveLength(1);
    expect(resultLoop).not.toContain("<img");
    expect(resultLoop).toContain('data-wayfinder-action="preview-equipment-item"');
    expect(resultLoop).toContain("data-wayfinder-focus-id");
    expect(resultLoop).toContain("data-source-uuid");
    expect(catalogue).not.toContain('data-wayfinder-action="add-equipment-item"');
    expect(catalogue).toContain('aria-expanded="{{#if activePane.catalogue.rarityPanelOpen}}true');
    expect(catalogue).toContain("{{activePane.catalogue.rarityFilterLabel}}");
    expect(catalogue).toContain('aria-expanded="{{#if activePane.catalogue.sourcePanelOpen}}true');
    expect(catalogue).toContain("{{activePane.catalogue.sourceFilterLabel}}");
    for (const action of [
      "add-equipment-item",
      "request-equipment-item-exception",
      "approve-equipment-item-exception",
      "choose-titan-mauler-equipment",
    ]) {
      expect(detail).toContain(`data-wayfinder-action="${action}"`);
    }
    expect(detail).toContain("{{#unless activePane.catalogue.preview}} is-empty{{/unless}}");
    expect(detail).toContain("{{#unless activePane.catalogue.preview}}aria-description=");
    expect(detail).toContain("{{#if description}}");
    expect(detail).toContain("{{{description}}}");
    expect(pane).not.toContain("is-detail-empty");
    expect(styles).toContain(".equipment-detail.is-empty");
    expect(styles).toContain(".equipment-detail-description");
  });

  it("keeps the equipment pane free of image requests and mounts the preview root once", () => {
    const detail = readFileSync(resolve("templates/wayfinder/starting-equipment-detail.hbs"), "utf8");
    const catalogue = readFileSync(resolve("templates/wayfinder/starting-equipment-catalogue.hbs"), "utf8");
    const cart = readFileSync(resolve("templates/wayfinder/starting-equipment-cart.hbs"), "utf8");
    const policy = readFileSync(resolve("templates/wayfinder/starting-equipment-policy.hbs"), "utf8");

    expect(policy).toContain('data-wayfinder-action="approve-equipment-policy-request"');
    expect(policy).toContain('data-wayfinder-action="decline-equipment-policy-request"');

    // The measured release envelope allows zero image requests per sample; type identity comes from icon glyphs.
    for (const template of [detail, catalogue, cart, policy]) {
      expect(template).not.toContain("<img");
    }

    const detailRootTag = detail.slice(0, detail.indexOf(">") + 1);
    expect(detailRootTag).toContain('data-application-part="equipment-detail"');
    expect(detailRootTag).toContain('data-equipment-preview="{{activePane.catalogue.preview.sourceUuid}}"');
    expect(detail.match(/data-equipment-preview=/gu)).toHaveLength(1);
    expect(detail.indexOf('data-wayfinder-action="add-equipment-item"')).toBeGreaterThan(detailRootTag.length);
  });
});

function fixedNativeGrant() {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:alchemist-formula-book:class-level-1",
    profileId: "alchemist-formula-book",
    origin: { sourceSlotId: "class-level-1", sourceUuid: u.alchemistClass },
    granterSourceUuid: u.formulaBookFeature,
    expected: { sourceUuid: u.formulaBookItem, quantity: 1, itemType: "equipment" },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: [u.formulaBookFeature, u.alchemyFeature, u.alchemistClass],
  });
}

function titanMaulerGrant(line: ReturnType<typeof acquisitionLine>) {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  return createPlannedClassGrant({
    grantId: "class-grant:titan-mauler:class-branch-instinct-level-1",
    profileId: "giant-instinct-titan-mauler",
    origin: { sourceSlotId: "class-branch-instinct-level-1", sourceUuid: u.giantInstinct },
    granterSourceUuid: u.giantInstinct,
    expected: { sourceUuid: line.sourceUuid, quantity: 1, itemType: "weapon" },
    materializer: "wayfinder-acquisition",
    eligibilityKind: "catalogue-choice",
    resaleRule: "zero-until-rune-investment",
    eligibilityEvidence: {
      kind: "titan-mauler",
      documentFingerprint: "titan-profile-document",
      lineId: line.lineId,
      lineDocumentFingerprint: line.documentFingerprint,
      linePriceFingerprint: line.priceFingerprint,
      policyFingerprint: "policy-diagnostic-1",
      actorSize: "medium",
      targetSize: "large",
      basePriceCopper: line.price.unitPriceCopper,
      weaponCategory: "martial",
      rangeIncrement: null,
      rarity: "common",
      characterAccessRef: null,
      sourceAllowed: true,
      quantity: 1,
      permanence: "permanent",
      componentKind: "baseline-item",
    },
    nativeGrantChainSourceUuids: [],
  });
}
