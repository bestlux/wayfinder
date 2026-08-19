import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { CLASS_GRANT_PROFILE_UUIDS, createPlannedClassGrant } from "../src/wayfinder/domain/class-grant-reconciliation";
import { createStartingEquipmentStep } from "../src/wayfinder/domain/step-types";
import { buildStartingEquipmentPane } from "../src/wayfinder/panes/starting-equipment-pane";
import type { StartingEquipmentCatalogueRecord } from "../src/wayfinder/view-models";
import { acquisitionFixture, acquisitionLine } from "./fixtures/acquisition-fixture";

describe("starting equipment pane", () => {
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
      automaticEligibilityLabel: "Common items from 1 approved pack",
    });
    expect(pane.catalogue.items[0]).toMatchObject({ name: "Adventurer's Pack", affordable: true, canAdd: true });
    expect(pane.catalogue.filters[0]).toMatchObject({ value: "equipment", selected: true });
    expect(pane.cart.lines[0]).toMatchObject({ quantity: 1, focusId: "starting-equipment-line:line-1" });
    expect(pane.review.canReviewPurchases).toBe(true);
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
      fundingLabel: "Automatic build grant · not charged",
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
    };

    const pane = buildStartingEquipmentPane(
      createStartingEquipmentStep(1),
      draft,
      { state: "incomplete", complete: false, status: "Choose a Titan Mauler weapon", issue: null },
      {
        state: "ready",
        message: "",
        query: "",
        records: [weapon],
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: true, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.items[0]).toMatchObject({ canAdd: true, canChooseTitanMauler: true });
    expect(pane.titanMauler).toEqual({ required: true, selected: false, selectedName: null });
    expect(pane.review).toMatchObject({ canReviewPurchases: false, canRetainAll: false });
  });

  it("renders dedicated search, filter, quantity, cart, retain-all, handoff, and focus controls", () => {
    const template = readFileSync(resolve("templates/wayfinder/starting-equipment-pane.hbs"), "utf8");
    for (const token of [
      "data-wayfinder-equipment-search",
      'data-wayfinder-action="toggle-equipment-filter"',
      'data-wayfinder-action="change-equipment-quantity"',
      'data-wayfinder-action="review-equipment-purchases"',
      'data-wayfinder-action="retain-all-equipment"',
      'data-wayfinder-action="acknowledge-equipment-handoff"',
      'data-wayfinder-action="choose-titan-mauler-equipment"',
      "Choose your Titan Mauler weapon",
      "data-wayfinder-focus-id",
    ]) {
      expect(template).toContain(token);
    }
    expect(template).not.toContain("<img");
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
        records,
        filters: [],
        activeFilters: {},
        previewSourceUuid: null,
        titanMauler: { required: false, selectedSourceUuid: null },
      }
    );

    expect(pane.catalogue.totalResultCount).toBe(20);
    expect(pane.catalogue.visibleResultCount).toBe(12);
    expect(pane.catalogue.items).toHaveLength(12);
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
