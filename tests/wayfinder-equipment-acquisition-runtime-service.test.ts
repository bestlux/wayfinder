import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import { projectPlannedClassGrants } from "../src/wayfinder/application/class-grant-projection-service";
import {
  ConfiguredItemHandoffRequiredError,
  commitTitanMaulerLineSynchronization,
  createEquipmentAcquisitionRuntime,
  type EquipmentAcquisitionRuntime,
  EquipmentSourceHealthError,
} from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import type { PrepareBrowsePhysicalItems } from "../src/wayfinder/application/equipment-browse-preparation-service";
import {
  ADVENTURERS_PACK_UUID,
  createEquipmentAccessRegistry,
  type EquipmentAccessRegistry,
  type EquipmentCataloguePackLike,
} from "../src/wayfinder/application/equipment-catalogue-service";
import type { EquipmentSourceDiagnostic } from "../src/wayfinder/application/equipment-source-policy";
import {
  createAcquisitionDraft,
  createAcquisitionPolicySnapshot,
  recordPlannedClassGrants,
} from "../src/wayfinder/domain/acquisition-draft";
import type { PreparedAcquisitionEntryV1 } from "../src/wayfinder/domain/acquisition-identity";
import { evaluateAcquisitionLedger, reviewRetainAll } from "../src/wayfinder/domain/acquisition-ledger";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import { createEconomicBaseline } from "../src/wayfinder/domain/economic-baseline";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
} from "../src/wayfinder/domain/equipment-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";
import { buildStartingEquipmentPane as buildStartingEquipmentPaneLocalized } from "../src/wayfinder/panes/starting-equipment-pane";
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

const PACK_ID = "pf2e.equipment-srd";
const DAGGER_ID = "rQWaJhI5Bko5x14Z";
const DAGGER_UUID = `Compendium.${PACK_ID}.Item.${DAGGER_ID}`;
const FORMULA_BOOK_ID = "qCEOZ6109Yo34tRx";
const ANCESTRY_UUID = "Compendium.pf2e.ancestries.Item.ancestry";

describe("equipment acquisition runtime", () => {
  it("persists and revalidates the exact Adventurer's Pack expansion as one 15 sp purchase", async () => {
    const kit = {
      _id: ADVENTURERS_PACK_UUID.split(".").at(-1),
      name: "Adventurer's Pack",
      type: "kit",
      system: {
        slug: "adventurers-pack",
        price: { value: { sp: 15 } },
        publication: { title: "Pathfinder Player Core" },
        rules: [],
      },
    };
    const items = Array.from({ length: 9 }, (_, index) => ({
      expansionPath: index === 0 ? "mca3x" : `mca3x/child-${index}`,
      parentPath: index === 0 ? null : "mca3x",
      sourceUuid: `Compendium.pf2e.equipment-srd.Item.child-${index}`,
      documentFingerprint: `child-fingerprint-${index}`,
      name: index === 0 ? "Backpack" : `Child ${index}`,
      itemType: index === 0 ? ("backpack" as const) : ("equipment" as const),
      quantity: index === 3 ? 10 : 1,
      size: "medium" as const,
    }));
    const prepareKitExpansion = vi.fn(async () => ({
      snapshot: { version: 1 as const, profile: "adventurers-pack-v1" as const, requestedQuantity: 1 as const, items },
      sources: new Map(items.map((item) => [item.expansionPath, { name: item.name, type: item.itemType }])),
    }));
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [kit]),
        getDocument: vi.fn(async () => document(kit)),
      },
      {
        prepareKitExpansion,
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID
            ? { type: "ancestry", system: { size: "sm" } }
            : uuid === ADVENTURERS_PACK_UUID
              ? { ...kit, createGrantedItems: vi.fn() }
              : null,
      }
    );

    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: ADVENTURERS_PACK_UUID });
    expect(line).toMatchObject({
      sourceUuid: ADVENTURERS_PACK_UUID,
      stackingIntent: "separate",
      price: { linePriceCopper: 150, requestedQuantity: 1, materializedQuantity: 1, size: "small" },
      kitExpansion: { profile: "adventurers-pack-v1" },
    });
    expect(line.kitExpansion?.items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Backpack" })]));
    const resolved = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: { ...request.draft, acquisition: { ...request.draft.acquisition!, lines: [line] } },
      acquisition: { ...request.draft.acquisition!, lines: [line] },
      entry: { ...preparedEntry(line), kitExpansion: line.kitExpansion },
    });
    expect(resolved.expandedSources).toHaveLength(9);
    expect(prepareKitExpansion).toHaveBeenCalledTimes(2);
  });

  it("projects the exact lump-sum boundary and rejects at-level purchases", async () => {
    const boundary = dagger({ id: "boundary", level: 4, priceGp: 1 });
    const atLevel = dagger({ id: "at-level", level: 5, priceGp: 1 });
    const boundaryUuid = `Compendium.${PACK_ID}.Item.boundary`;
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [boundary, atLevel]),
        getDocument: vi.fn(async (id) => document(id === "boundary" ? boundary : atLevel)),
      },
      { policy: higherLevelPolicy("lump-sum") }
    );

    const projection = await runtime.uiAdapter.project(request);
    expect(projection.records.map((record) => record.level)).toEqual([4]);
    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: boundaryUuid,
        funding: { lane: "currency" },
      })
    ).resolves.toMatchObject({ itemLevel: 4, funding: { lane: "currency" } });
    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: `Compendium.${PACK_ID}.Item.at-level`,
        funding: { lane: "currency" },
      })
    ).rejects.toThrow(/below.*target level/i);
  });

  it("prepares explicit permanent-item allowance assignments without consuming coin", async () => {
    const source = dagger({ level: 3, priceGp: 20 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { policy: higherLevelPolicy("permanent-items") }
    );

    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: DAGGER_UUID,
        funding: { lane: "allowance", allowanceId: "level-4-1" },
      })
    ).resolves.toMatchObject({
      itemLevel: 3,
      funding: { lane: "allowance", assignment: { mode: "player", allowanceId: "level-4-1" } },
    });
    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: DAGGER_UUID,
        funding: { lane: "allowance", allowanceId: "level-2-1" },
      })
    ).rejects.toThrow(/cannot fund/i);
  });

  it("prepares one non-specific configured weapon with exact PF2E component pricing", async () => {
    const configured = dagger({
      id: "configured",
      name: "Configured Blade",
      level: 14,
      priceGp: 4500,
      baseItem: "clean-blade",
      runes: { potency: 2, striking: 2, property: ["holy"] },
      materialType: "cold-iron",
      materialGrade: "standard",
      specific: null,
    });
    const base = dagger({ id: "base", name: "Clean Blade", baseItem: "clean-blade", priceGp: 4 });
    const prepareConfiguredItem = vi.fn((input: any) => {
      const property = Array.isArray(input.runes.property) ? input.runes.property : [];
      const fundamental = Number(input.runes.potency) > 0 || Number(input.runes.striking) > 0;
      const material = input.material.type && input.material.grade;
      const totalCopper = property.length
        ? material
          ? 445_600
          : 340_400
        : fundamental
          ? material
            ? 305_600
            : 200_400
          : material
            ? 105_600
            : 400;
      return {
        system: {
          runes: structuredClone(input.runes),
          material: structuredClone(input.material),
          price: { value: { copperValue: totalCopper } },
        },
      };
    });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [configured, { ...base, system: { ...base.system, slug: "clean-blade" } }]),
        getDocument: vi.fn(async (id) => document(id === "base" ? base : configured)),
      },
      { policy: configuredPolicy(), prepareConfiguredItem, ancestrySize: "lg" }
    );

    const line = await runtime.uiAdapter.prepareLine({
      ...request,
      sourceUuid: `Compendium.${PACK_ID}.Item.configured`,
      funding: { lane: "allowance", allowanceId: "level-14-1" },
    });
    expect(line.price).toMatchObject({
      unitPriceCopper: 445_600,
      configurationPriceCopper: 245_600,
      configurationComponents: {
        baseItem: "clean-blade",
        baselineAndFundamentalCopper: 200_000,
        propertyRuneCopper: 140_000,
        preciousMaterialCopper: 105_600,
        prepared: { totalCopper: 445_600 },
        suppressedByAbp: [],
      },
    });
    expect(line.priceFingerprint).toMatch(/^equipment-prepared-price-v1-/);
    expect(prepareConfiguredItem).toHaveBeenCalledTimes(5);
    expect(line.price.size).toBe("large");
    expect(prepareConfiguredItem).toHaveBeenCalledWith(expect.objectContaining({ targetSize: "large" }));
  });

  it("hands specific configured magic items to the PF2E inventory sheet", async () => {
    const specific = dagger({
      id: "specific",
      level: 13,
      baseItem: "clean-blade",
      runes: { potency: 1, striking: 1, property: ["shadow"] },
      specific: { value: true },
    });
    const prepareBrowsePhysicalItems = vi.fn(prepareTestBrowsePhysicalItems);
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [specific]),
        getDocument: vi.fn(async () => document(specific)),
      },
      { policy: configuredPolicy(), prepareBrowsePhysicalItems }
    );
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      records: [{ name: "Dagger" }],
    });
    expect(prepareBrowsePhysicalItems).not.toHaveBeenCalled();
    const prepared = runtime.uiAdapter.prepareLine({
      ...request,
      sourceUuid: `Compendium.${PACK_ID}.Item.specific`,
      funding: { lane: "allowance", allowanceId: "level-14-1" },
    });
    await expect(prepared).rejects.toBeInstanceOf(ConfiguredItemHandoffRequiredError);
    await expect(prepared).rejects.toMatchObject({
      reason: {
        code: "unsafe-configured-item",
        sourceUuid: `Compendium.${PACK_ID}.Item.specific`,
        itemName: "Dagger",
        issue: "specific-magic-item",
      },
    });
  });

  it("does not let an exact item exception override unsafe configured structure", async () => {
    const specific = dagger({
      id: "approved-specific",
      name: "Approved Specific Blade",
      level: 13,
      rarity: "uncommon",
      baseItem: "clean-blade",
      runes: { potency: 1, striking: 1, property: ["shadow"] },
      specific: { value: true },
    });
    const sourceUuid = `Compendium.${PACK_ID}.Item.approved-specific`;
    const facts: EquipmentPolicyJudgmentFacts = {
      kind: "rarity-source-exception",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 14,
      scope: "rarity",
      sourceUuid,
      packId: PACK_ID,
      publicationSlug: "pathfinder-player-core",
      rarity: "uncommon",
    };
    const judgment: EquipmentPolicyJudgmentRecord = {
      id: "approved-specific-judgment",
      kind: facts.kind,
      actorId: facts.actorId,
      draftId: facts.draftId,
      targetLevel: facts.targetLevel,
      factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
      authorUserId: "gm-1",
      authorName: "GM",
      recordedAt: "2026-08-20T20:00:00.000Z",
      reason: "Approved exact item",
      request: {
        requestId: "approved-specific-request",
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: "2026-08-20T19:00:00.000Z",
        reason: "Request exact item",
        facts,
      },
      revocation: null,
    };
    const approvedPolicy = { ...configuredPolicy(), gmJudgments: [judgment] };
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [specific]),
        getDocument: vi.fn(async () => document(specific)),
      },
      { policy: approvedPolicy }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      records: [expect.objectContaining({ sourceUuid, available: true })],
    });
    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid,
        funding: { lane: "allowance", allowanceId: "level-14-1" },
      })
    ).rejects.toMatchObject({
      reason: { code: "unsafe-configured-item", sourceUuid, issue: "specific-magic-item" },
    });
  });

  it("records PF2E ABP-suppressed rune components without changing the wealth recipe", async () => {
    const configured = dagger({
      id: "configured-abp",
      level: 14,
      baseItem: "clean-blade",
      runes: { potency: 2, striking: 2, property: ["holy"] },
      materialType: "cold-iron",
      materialGrade: "standard",
    });
    const base = dagger({ id: "base", baseItem: "clean-blade", priceGp: 4 });
    const prepareConfiguredItem = vi.fn((input: any) => ({
      system: {
        runes: { potency: 0, striking: 0, property: [] },
        material: structuredClone(input.material),
        price: { value: { copperValue: input.material.type && input.material.grade ? 105_600 : 400 } },
      },
    }));
    const abpPolicy = {
      ...configuredPolicy(),
      abp: { enabled: true, mode: "ABPRulesAsWritten", actorOverrideDisabled: false },
    };
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [configured, { ...base, system: { ...base.system, slug: "clean-blade" } }]),
        getDocument: vi.fn(async (id) => document(id === "base" ? base : configured)),
      },
      { policy: abpPolicy, prepareConfiguredItem }
    );
    const line = await runtime.uiAdapter.prepareLine({
      ...request,
      sourceUuid: `Compendium.${PACK_ID}.Item.configured-abp`,
      funding: { lane: "allowance", allowanceId: "level-14-1" },
    });
    expect(line.price).toMatchObject({
      unitPriceCopper: 105_600,
      configurationComponents: {
        baselineAndFundamentalCopper: 0,
        propertyRuneCopper: 0,
        preciousMaterialCopper: 105_600,
        suppressedByAbp: ["fundamental", "potency", "property:holy"],
      },
    });
    expect(abpPolicy.recipe).toEqual(configuredPolicy().recipe);
  });

  it("projects the bounded level-1 catalogue and prepares a hydrated Dagger line", async () => {
    const source = dagger();
    const getIndex = vi.fn(async () => [source]);
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture({ getIndex, getDocument });

    const projection = await runtime.uiAdapter.project(request);
    expect(projection).toMatchObject({
      state: "ready",
      records: [
        {
          sourceUuid: DAGGER_UUID,
          name: "Dagger",
          itemType: "weapon",
          level: 0,
          rarity: "common",
          sourceLabel: "Pathfinder Player Core",
          priceCopper: 20,
          priceLabel: "2 sp",
          available: true,
        },
      ],
    });
    expect(projection.records[0]).not.toHaveProperty("img");

    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    expect(line.priceFingerprint).toBe("equipment-price-v1-d6e565d1");
    expect(line).toMatchObject({
      schemaVersion: 1,
      lineId: "wf-line-test",
      sourceUuid: DAGGER_UUID,
      itemLevel: 0,
      permanence: "permanent",
      componentKind: "baseline-item",
      funding: { lane: "currency" },
      stackingIntent: "aggregate",
      price: {
        basePrice: { kind: "priced", value: { sp: 2 } },
        size: "medium",
        sizeSensitive: true,
        pricePer: 1,
        sourceQuantity: 1,
        requestedQuantity: 1,
        materializedQuantity: 1,
        unitPriceCopper: 20,
        linePriceCopper: 20,
      },
    });
    expect(getIndex).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("reports the uncapped matched level-qualified count while hydrating only the bounded page", async () => {
    const levelQualified = Array.from({ length: 20 }, (_, index) =>
      dagger({ id: `qualified-${index}`, name: `Common gear ${String(index).padStart(2, "0")}` })
    );
    const atLevel = dagger({ id: "at-level", name: "Common at-level gear", level: 1 });
    const sources = [...levelQualified, atLevel];
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => sources), getDocument });

    const projection = await runtime.uiAdapter.project({ ...request, query: "common" });
    const pane = buildStartingEquipmentPane(
      request.step,
      request.draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      projection
    );

    expect(projection.matchedRecordCount).toBe(levelQualified.length);
    expect(projection.records).toHaveLength(12);
    expect(pane.catalogue).toMatchObject({
      message: `${levelQualified.length} pieces of gear to browse.`,
      totalResultCount: levelQualified.length,
      visibleResultCount: 12,
    });
    expect(getDocument).toHaveBeenCalledTimes(12);
  });

  it("concurrently fetches the cold visible page and refetches it only after explicit pack invalidation", async () => {
    let sources = Array.from({ length: 12 }, (_, index) =>
      dagger({ id: `bulk-${index}`, name: `Bulk gear ${String(index).padStart(2, "0")}` })
    );
    let releaseReads!: () => void;
    let readGate = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const getDocument = vi.fn(async (documentId: string) => {
      await readGate;
      return document(sources.find((source) => source._id === documentId)!);
    });
    const getIndex = vi.fn(async () => sources);
    const { runtime, request } = fixture({ getIndex, getDocument });

    const coldProjection = runtime.uiAdapter.project(request);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(12));
    releaseReads();
    const cold = await coldProjection;
    await runtime.uiAdapter.project(request);

    expect(cold.records.map(({ sourceUuid }) => sourceUuid)).toEqual(
      sources.map(({ _id }) => `Compendium.${PACK_ID}.Item.${_id}`)
    );
    expect(getDocument).toHaveBeenCalledTimes(12);

    sources = sources.map((source, index) =>
      index === 0 ? dagger({ id: "bulk-0", name: "Bulk gear 00", priceSp: 3 }) : source
    );
    readGate = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    runtime.invalidatePack(PACK_ID);
    const invalidatedProjection = runtime.uiAdapter.project(request);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(24));
    releaseReads();
    const invalidated = await invalidatedProjection;

    expect(getIndex).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(24);
    expect(invalidated.records[0]).toMatchObject({ sourceUuid: `Compendium.${PACK_ID}.Item.bulk-0`, priceCopper: 30 });
  });

  it("reuses successful browse preparations while a newly selected preview hydrates once", async () => {
    const sources = Array.from({ length: 12 }, (_, index) =>
      dagger({ id: `browse-cache-${index}`, name: `Browse cache ${String(index).padStart(2, "0")}` })
    );
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => sources), getDocument });
    const previewSourceUuid = `Compendium.${PACK_ID}.Item.browse-cache-0`;

    await runtime.uiAdapter.project(request);
    expect(getDocument).toHaveBeenCalledTimes(12);
    await runtime.uiAdapter.project(request);
    expect(getDocument).toHaveBeenCalledTimes(12);

    const beforeFirstPreview = getDocument.mock.calls.length;
    await runtime.uiAdapter.project({ ...request, previewSourceUuid });
    const afterFirstPreview = getDocument.mock.calls.length;
    expect(afterFirstPreview - beforeFirstPreview).toBe(1);
    await runtime.uiAdapter.project({ ...request, previewSourceUuid });
    expect(getDocument.mock.calls.length - afterFirstPreview).toBe(0);
  });

  it("matches fresh prepare and Apply pricing while batching only browse preparation", async () => {
    const source = dagger({ priceGp: 1, sizeSensitive: true });
    const preparePhysicalItem = vi.fn(prepareTestPhysicalItem);
    const prepareBrowsePhysicalItems = vi.fn(prepareTestBrowsePhysicalItems);
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument },
      { ancestrySize: "lg", preparePhysicalItem, prepareBrowsePhysicalItems }
    );

    const projection = await runtime.uiAdapter.project(request);
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    const applied = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      entry: preparedEntry(line),
    });

    expect(projection.records[0]?.priceCopper).toBe(line.price.unitPriceCopper);
    expect(applied.resolvedPrice).toEqual(line.price);
    expect(prepareBrowsePhysicalItems).toHaveBeenCalledTimes(1);
    expect(prepareBrowsePhysicalItems.mock.calls[0]![0].entries).toHaveLength(1);
    expect(preparePhysicalItem).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it("keeps mixed browse outcomes ordered and makes a repeated facet document-free", async () => {
    const ordinary = dagger({ id: "batch-ordinary", name: "Alpha Ordinary", priceSp: 1 });
    const partial = dagger({
      id: "batch-partial",
      name: "Beta Partial Unit",
      itemType: "equipment",
      priceCp: 1,
      pricePer: 10,
      sourceQuantity: 1,
    });
    const sources = [ordinary, partial];
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const prepareBrowsePhysicalItems = vi.fn(prepareTestBrowsePhysicalItems);
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => sources), getDocument },
      { prepareBrowsePhysicalItems }
    );
    const facetRequest = { ...request, filters: { type: ["weapon", "equipment"] } };

    const first = await runtime.uiAdapter.project(facetRequest);
    expect(first.records).toMatchObject([
      { name: "Alpha Ordinary", available: true, priceCopper: 10 },
      {
        name: "Beta Partial Unit",
        available: false,
        priceCopper: null,
        unavailableReason: expect.stringMatching(/quantity.*nonzero exact PF2E charge/i),
      },
    ]);
    expect(prepareBrowsePhysicalItems.mock.calls[0]![0].entries.map((entry) => entry.key)).toEqual([
      `Compendium.${PACK_ID}.Item.batch-ordinary`,
      `Compendium.${PACK_ID}.Item.batch-partial`,
    ]);
    expect(getDocument).toHaveBeenCalledTimes(2);

    await expect(runtime.uiAdapter.project(facetRequest)).resolves.toMatchObject({ records: first.records });
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(prepareBrowsePhysicalItems).toHaveBeenCalledTimes(1);
  });

  it("keeps rule-bearing and nested browse items out of the shared preparation actor", async () => {
    const ordinary = dagger({ id: "ruleless", name: "Alpha Ruleless" });
    const ruleBearing = dagger({ id: "rule-bearing", name: "Beta Rule Bearing" });
    (ruleBearing.system.rules as unknown[]).push({ key: "FlatModifier", selector: "ac", value: 1 });
    const nested = dagger({ id: "nested", name: "Gamma Nested" });
    (nested.system as Record<string, unknown>).subitems = [{ system: { rules: [{ key: "GrantItem" }] } }];
    const sources = [ordinary, ruleBearing, nested];
    const prepareBrowsePhysicalItems = vi.fn(prepareTestBrowsePhysicalItems);
    const preparePhysicalItem = vi.fn(prepareTestPhysicalItem);
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => sources),
        getDocument: vi.fn(async (id) => document(sources.find((source) => source._id === id)!)),
      },
      { prepareBrowsePhysicalItems, preparePhysicalItem }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      records: [{ name: "Alpha Ruleless" }, { name: "Beta Rule Bearing" }, { name: "Gamma Nested" }],
    });
    expect(prepareBrowsePhysicalItems).toHaveBeenCalledTimes(1);
    expect(prepareBrowsePhysicalItems.mock.calls[0]![0].entries.map((entry) => entry.key)).toEqual([
      `Compendium.${PACK_ID}.Item.ruleless`,
    ]);
    expect(preparePhysicalItem).toHaveBeenCalledTimes(2);
  });

  it("retries a rejected browse batch without caching an unprepared record", async () => {
    let shouldFail = true;
    const source = dagger();
    const getDocument = vi.fn(async () => document(source));
    const prepareBrowsePhysicalItems = vi.fn<PrepareBrowsePhysicalItems>(async (input) => {
      if (shouldFail) throw new Error("temporary batch preparation failure");
      return prepareTestBrowsePhysicalItems(input);
    });
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument },
      { prepareBrowsePhysicalItems }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "error" });
    shouldFail = false;
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      records: [{ name: "Dagger" }],
    });
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "ready" });
    expect(prepareBrowsePhysicalItems).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("uses a bounded LRU for successful browse preparations", async () => {
    const sources = [
      dagger({ id: "lru-a", name: "LRU Alpha" }),
      dagger({ id: "lru-b", name: "LRU Bravo" }),
      dagger({ id: "lru-c", name: "LRU Charlie" }),
    ];
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => sources), getDocument },
      { browsePreparedRecordCacheLimit: 2 }
    );

    for (const query of ["alpha", "bravo", "alpha", "charlie", "bravo"]) {
      await runtime.uiAdapter.project({ ...request, query });
    }

    expect(getDocument.mock.calls.map(([id]) => id)).toEqual(["lru-a", "lru-b", "lru-c", "lru-b"]);
  });

  it("does not cache failed browse preparation", async () => {
    let shouldFail = true;
    const source = dagger();
    const getDocument = vi.fn(async () => document(source));
    const preparePhysicalItem = vi.fn((input: Parameters<typeof prepareTestPhysicalItem>[0]) => {
      if (shouldFail) throw new Error("transient PF2E preparation failure");
      return prepareTestPhysicalItem(input);
    });
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument },
      { preparePhysicalItem }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "error",
      matchedRecordCount: 0,
    });
    shouldFail = false;
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      matchedRecordCount: 1,
      records: [{ name: "Dagger" }],
    });
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("reuses drafted equipment size until actor or ancestry and heritage material changes", async () => {
    const actorSource = {
      type: "character",
      system: { pricingRevision: 1 },
      items: [],
      effects: [],
      flags: {},
    };
    const actor = {
      id: "actor-1",
      toObject: vi.fn(() => structuredClone(actorSource)),
    };
    const prepareDraftedActor = vi.fn(async () => ({ system: { traits: { size: { value: "med" } } } }));
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { actor, prepareDraftedActor: prepareDraftedActor as never }
    );
    request.draft.selections["ancestry-level-1"]!.slug = "automaton";
    request.draft.selections["heritage-level-1"] = {
      slotId: "heritage-level-1",
      packId: "pf2e.heritages",
      documentId: "versatile-heritage",
      uuid: "Compendium.pf2e.heritages.Item.versatile-heritage",
      itemType: "heritage",
      featType: null,
      name: "Versatile Heritage",
      level: 0,
      slug: "versatile-heritage",
    };

    await runtime.uiAdapter.project(request);
    await runtime.uiAdapter.project(request);
    request.draft.classChoices.unrelated = "ignored";
    request.draft.singletonChoices["singleton-choice-class-wizard-thesis-level-1"] = "spell-blending";
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(1);

    request.draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"] = "small";
    await runtime.uiAdapter.project(request);
    request.draft.singletonChoices["singleton-choice-heritage-versatile-heritage-size-level-1"] = "large";
    await runtime.uiAdapter.project(request);
    actorSource.system.pricingRevision = 2;
    await runtime.uiAdapter.project(request);
    request.draft.targetLevel = 2;
    await runtime.uiAdapter.project(request);
    request.draft.selections["ancestry-level-1"]!.uuid = "Compendium.pf2e.ancestries.Item.changed";
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(6);
  });

  it("coalesces concurrent drafted equipment size preparation", async () => {
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const prepareDraftedActor = vi.fn(async ({ draft: _draft }: { draft: ReturnType<typeof createEmptyDraft> }) => {
      await preparationGate;
      return { system: { traits: { size: { value: "med" } } } };
    });
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { prepareDraftedActor: prepareDraftedActor as never }
    );
    const sizeChoiceSlotId = "singleton-choice-ancestry-automaton-size-level-1";
    request.draft.singletonChoices[sizeChoiceSlotId] = "small";

    const first = runtime.uiAdapter.project(request);
    const second = runtime.uiAdapter.project(request);
    await vi.waitFor(() => expect(prepareDraftedActor).toHaveBeenCalledTimes(1));
    request.draft.singletonChoices[sizeChoiceSlotId] = "large";
    releasePreparation();

    await expect(Promise.all([first, second])).resolves.toMatchObject([{ state: "ready" }, { state: "ready" }]);
    expect(prepareDraftedActor.mock.calls[0]![0].draft.singletonChoices[sizeChoiceSlotId]).toBe("small");
    expect(prepareDraftedActor).toHaveBeenCalledTimes(1);
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(2);
  });

  it("does not retain drafted size under an actor fingerprint that changed during preparation", async () => {
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const actorSource = {
      type: "character",
      system: { pricingRevision: 1 },
      items: [],
      effects: [],
      flags: {},
    };
    const actor = {
      id: "actor-1",
      toObject: vi.fn(() => structuredClone(actorSource)),
    };
    let preparationCount = 0;
    const prepareDraftedActor = vi.fn(async () => {
      preparationCount += 1;
      if (preparationCount === 1) await preparationGate;
      return { system: { traits: { size: { value: "med" } } } };
    });
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { actor, prepareDraftedActor: prepareDraftedActor as never }
    );

    const first = runtime.uiAdapter.project(request);
    await vi.waitFor(() => expect(prepareDraftedActor).toHaveBeenCalledTimes(1));
    actorSource.system.pricingRevision = 2;
    releasePreparation();
    await expect(first).resolves.toMatchObject({ state: "ready" });

    actorSource.system.pricingRevision = 1;
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected drafted equipment size preparation", async () => {
    let shouldFail = true;
    const prepareDraftedActor = vi.fn(async () => {
      if (shouldFail) throw new Error("drafted size preparation failure");
      return { system: { traits: { size: { value: "med" } } } };
    });
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { prepareDraftedActor: prepareDraftedActor as never }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "error" });
    shouldFail = false;
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "ready" });
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "ready" });
    expect(prepareDraftedActor).toHaveBeenCalledTimes(2);
  });

  it("bounds drafted equipment size results with LRU reuse", async () => {
    const prepareDraftedActor = vi.fn(async () => ({ system: { traits: { size: { value: "med" } } } }));
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { prepareDraftedActor: prepareDraftedActor as never, draftedEquipmentSizeCacheLimit: 2 }
    );
    request.draft.selections["ancestry-level-1"]!.slug = "automaton";

    for (const value of ["small", "medium", "small", "large", "medium"]) {
      request.draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"] = value;
      await runtime.uiAdapter.project(request);
    }

    expect(prepareDraftedActor).toHaveBeenCalledTimes(4);
  });

  it("invalidates drafted equipment size on pack source invalidation", async () => {
    const prepareDraftedActor = vi.fn(async () => ({ system: { traits: { size: { value: "med" } } } }));
    const source = dagger();
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument: vi.fn(async () => document(source)) },
      { prepareDraftedActor: prepareDraftedActor as never }
    );

    await runtime.uiAdapter.project(request);
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(1);
    runtime.invalidatePack(PACK_ID);
    await runtime.uiAdapter.project(request);
    expect(prepareDraftedActor).toHaveBeenCalledTimes(2);
  });

  it("invalidates browse preparations on actor, access, size, policy, and pack drift", async () => {
    let ancestrySize: "med" | "lg" = "med";
    const actorSource = {
      type: "character",
      system: { pricingRevision: 1 },
      items: [],
      effects: [],
      flags: { "wayfinder-pf2e": { draftRevision: 1 }, pf2e: { pricingRevision: 1 } },
    };
    const actor = {
      id: "actor-1",
      toObject: vi.fn((source: boolean) => {
        expect(source).toBe(true);
        return structuredClone(actorSource);
      }),
    };
    let source = dagger();
    const currentPolicy = policy();
    const getIndex = vi.fn(async () => [source]);
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture(
      { getIndex, getDocument },
      {
        actor,
        policy: currentPolicy,
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: ancestrySize } } : null,
      }
    );
    request.draft.selections["ancestry-level-1"]!.slug = "test-ancestry";

    await runtime.uiAdapter.project(request);
    await runtime.uiAdapter.project(request);
    expect(getDocument).toHaveBeenCalledTimes(1);

    actorSource.flags["wayfinder-pf2e"].draftRevision = 2;
    await runtime.uiAdapter.project(request);
    expect(getDocument).toHaveBeenCalledTimes(1);
    actorSource.flags.pf2e.pricingRevision = 2;
    await runtime.uiAdapter.project(request);
    actorSource.system.pricingRevision = 2;
    await runtime.uiAdapter.project(request);
    request.draft.classChoices.cacheProbe = "changed-access-facts";
    await runtime.uiAdapter.project(request);
    ancestrySize = "lg";
    request.draft.singletonChoices["singleton-choice-ancestry-test-ancestry-size-level-1"] = "large";
    await runtime.uiAdapter.project(request);
    (currentPolicy as { fingerprint: string }).fingerprint = "policy-v2";
    request.draft.acquisition = {
      ...request.draft.acquisition!,
      policySnapshot: createAcquisitionPolicySnapshot(currentPolicy, request.draft.acquisition!.recipe),
    };
    await runtime.uiAdapter.project(request);
    expect(getDocument).toHaveBeenCalledTimes(6);

    source = dagger({ priceSp: 3 });
    runtime.invalidatePack(PACK_ID);
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ records: [{ priceCopper: 60 }] });
    expect(getIndex).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(7);
  });

  it("keeps prepare and Apply hydration fresh after warming the browse cache", async () => {
    let currentSource = dagger();
    const getDocument = vi.fn(async () => document(currentSource));
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => [dagger()]), getDocument });

    await runtime.uiAdapter.project(request);
    currentSource = dagger({ priceSp: 3 });
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    expect(line.price).toMatchObject({ unitPriceCopper: 30, linePriceCopper: 30 });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };

    await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      entry: preparedEntry(line),
    });
    await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      entry: preparedEntry(line),
    });
    expect(getDocument).toHaveBeenCalledTimes(4);
  });

  it("projects reviewed metadata for an ordinary cart line outside the bounded browse page", async () => {
    const browseSources = Array.from({ length: 12 }, (_, index) =>
      dagger({ id: `browse-${index}`, name: `Browse item ${String(index).padStart(2, "0")}` })
    );
    const offPage = dagger({ id: "off-page", name: "Zed Off-Page Gear", priceGp: 1 });
    const sources = [...browseSources, offPage];
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => sources), getDocument });
    const line = await runtime.uiAdapter.prepareLine({
      ...request,
      sourceUuid: `Compendium.${PACK_ID}.Item.off-page`,
    });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    getDocument.mockClear();

    const projection = await runtime.uiAdapter.project(request);

    expect(projection.records).toHaveLength(12);
    expect(projection.matchedRecordCount).toBe(sources.length);
    expect(projection.records).not.toContainEqual(expect.objectContaining({ name: "Zed Off-Page Gear" }));
    expect(projection.lineRecords).toEqual([
      expect.objectContaining({
        sourceUuid: `Compendium.${PACK_ID}.Item.off-page`,
        name: "Zed Off-Page Gear",
        priceCopper: 100,
      }),
    ]);
    expect(getDocument).toHaveBeenCalledTimes(12);
    expect(getDocument).not.toHaveBeenCalledWith("off-page");

    const pane = buildStartingEquipmentPane(
      request.step,
      request.draft,
      { state: "complete", complete: true, status: "Ready", issue: null },
      projection
    );
    expect(pane.catalogue.items).toHaveLength(12);
    expect(pane.catalogue.items).not.toContainEqual(expect.objectContaining({ name: "Zed Off-Page Gear" }));
    expect(pane.cart.lines).toEqual([expect.objectContaining({ name: "Zed Off-Page Gear" })]);
  });

  it.each([
    ["Dwarf Clan Dagger", "dwarf-clan-dagger" as const, "Clan Dagger"],
    ["Sarangay Head Gem", "sarangay-head-gem" as const, "Head Gem"],
  ])("keeps the reviewed %s native recovery line named outside the browse page", async (_label, profileId, name) => {
    const grant = nativeAncestryGrant(profileId);
    const nativeSourceId = grant.expected.sourceUuid.split(".").at(-1)!;
    const browseSources = Array.from({ length: 12 }, (_, index) =>
      dagger({ id: `browse-${index}`, name: `Browse item ${String(index).padStart(2, "0")}` })
    );
    const nativeSource = dagger({
      id: nativeSourceId,
      name,
      itemType: grant.expected.itemType === "weapon" ? "weapon" : "equipment",
    });
    const sources = [...browseSources, nativeSource];
    const getDocument = vi.fn(async (id) => document(sources.find((source) => source._id === id)!));
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => sources), getDocument });
    let acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    request.draft.acquisition = acquisition;
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: acquisition.draftId,
      batchId: acquisition.batchId,
      targetLevel: acquisition.targetLevel,
      grants: [grant],
    });
    const lines = await runtime.prepareNativeClassGrantLines({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition,
      classGrantPlan,
    });
    acquisition = {
      ...acquisition,
      lines: [...lines],
      baseline: createEconomicBaseline({
        actorId: "actor-1",
        capturedAt: "2026-08-21T08:00:00.000Z",
        currencyCopper: 0,
        physicalItems: [],
      }),
    };
    const reviewed = reviewRetainAll(acquisition, evaluateAcquisitionLedger(acquisition, classGrantPlan), {
      userId: "owner-1",
      reviewedAt: "2026-08-21T08:01:00.000Z",
    });
    request.draft.acquisition = reviewed;
    getDocument.mockClear();

    const projection = await runtime.uiAdapter.project(request);
    const pane = buildStartingEquipmentPane(
      request.step,
      request.draft,
      { state: "complete", complete: true, status: "Keeping all your coin", issue: null },
      projection
    );

    expect(projection.records).toHaveLength(12);
    expect(projection.records).not.toContainEqual(expect.objectContaining({ sourceUuid: grant.expected.sourceUuid }));
    expect(projection.lineRecords).toEqual([expect.objectContaining({ sourceUuid: grant.expected.sourceUuid, name })]);
    expect(getDocument).toHaveBeenCalledTimes(12);
    expect(getDocument).not.toHaveBeenCalledWith(nativeSourceId);
    expect(pane.catalogue.items).toHaveLength(12);
    expect(pane.catalogue.items).not.toContainEqual(expect.objectContaining({ name }));
    expect(pane.review).toMatchObject({ disposition: "retain-all", label: "Keeping all your coin" });
    expect(pane.cart.lines).toEqual([
      expect.objectContaining({ name, canRemove: false, fundingLabel: "Granted by your build · free" }),
    ]);
  });

  it("blocks a missing approved source with its typed diagnostic and no acquisition mutation", async () => {
    const source = dagger();
    const getDocument = vi.fn(async () => document(source));
    const missingDiagnostic: EquipmentSourceDiagnostic = {
      code: "equipment-pack-missing",
      packId: "supplemental.missing-equipment",
      sourceIdentity: null,
      message:
        "Enabled equipment pack supplemental.missing-equipment is not installed or is unavailable to the current user.",
    };
    const { runtime, request } = fixture(
      { getIndex: vi.fn(async () => [source]), getDocument },
      { sourceDiagnostics: [missingDiagnostic] }
    );
    const beforeDraft = structuredClone(request.draft);
    const beforeActor = structuredClone(request.actor);

    const projection = await runtime.uiAdapter.project(request);
    expect(projection).toMatchObject({
      state: "error",
      records: [],
      diagnostics: [missingDiagnostic],
      message: expect.stringMatching(/ask your GM/i),
    });
    const pane = buildStartingEquipmentPane(
      request.step,
      request.draft,
      { state: "incomplete", complete: false, status: "Review purchases", issue: null },
      projection
    );
    expect(pane.catalogue).toMatchObject({
      state: "error",
      searchDisabled: true,
      diagnostics: [missingDiagnostic],
      items: [],
    });
    expect(pane.review).toMatchObject({ canReviewPurchases: false, canRetainAll: false });
    expect(getDocument).not.toHaveBeenCalled();
    expect(request.draft).toEqual(beforeDraft);
    expect(request.actor).toEqual(beforeActor);
  });

  it("blocks a corrupt approved pack index with its deterministic typed diagnostic", async () => {
    const getDocument = vi.fn(async () => null);
    const { runtime, request } = fixture({ getIndex: vi.fn(async () => null), getDocument });
    const beforeDraft = structuredClone(request.draft);

    const projection = await runtime.uiAdapter.project(request);

    expect(projection).toMatchObject({
      state: "error",
      records: [],
      diagnostics: [{ code: "equipment-pack-index-corrupt", packId: PACK_ID, sourceIdentity: null }],
    });
    expect(getDocument).not.toHaveBeenCalled();
    expect(request.draft).toEqual(beforeDraft);
  });

  it("blocks duplicate source identity projection before document hydration or mutation", async () => {
    const source = dagger();
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [source, dagger({ name: "Duplicate Dagger" })]),
      getDocument,
    });
    const beforeDraft = structuredClone(request.draft);

    const projection = await runtime.uiAdapter.project(request);

    expect(projection).toMatchObject({
      state: "error",
      records: [],
      diagnostics: [
        {
          code: "duplicate-equipment-source-identity",
          packId: PACK_ID,
          sourceIdentity: DAGGER_UUID,
        },
      ],
    });
    expect(getDocument).not.toHaveBeenCalled();
    expect(request.draft).toEqual(beforeDraft);
  });

  it("rejects a stale add after a clean projection becomes corrupt", async () => {
    const source = dagger();
    let currentIndex: readonly ReturnType<typeof dagger>[] | null = [source];
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => currentIndex),
      getDocument,
    });
    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({ state: "ready" });
    const beforeDraft = structuredClone(request.draft);
    const documentReads = getDocument.mock.calls.length;

    currentIndex = null;
    runtime.invalidatePack(PACK_ID);

    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).rejects.toMatchObject({
      name: "EquipmentSourceHealthError",
      diagnostics: [{ code: "equipment-pack-index-corrupt", packId: PACK_ID }],
    });
    expect(getDocument).toHaveBeenCalledTimes(documentReads);
    expect(request.draft).toEqual(beforeDraft);
  });

  it("rejects Apply preflight before hydration when a reviewed source identity becomes duplicated", async () => {
    const source = dagger();
    let currentIndex: readonly ReturnType<typeof dagger>[] = [source];
    const getDocument = vi.fn(async () => document(source));
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => currentIndex),
      getDocument,
    });
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    const beforeDraft = structuredClone(request.draft);
    const documentReads = getDocument.mock.calls.length;

    currentIndex = [source, dagger({ name: "Duplicate Dagger" })];
    runtime.invalidatePack(PACK_ID);

    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: preparedEntry(line),
      })
    ).rejects.toBeInstanceOf(EquipmentSourceHealthError);
    expect(getDocument).toHaveBeenCalledTimes(documentReads);
    expect(request.draft).toEqual(beforeDraft);
  });

  it.each([
    "ammo",
    "armor",
    "backpack",
    "consumable",
    "equipment",
    "shield",
    "weapon",
  ] as const)("materializes one actor-sized %s stack from price.per and source quantity", async (itemType) => {
    const source = dagger({ itemType, priceCp: 10, pricePer: 10, sourceQuantity: 12, sizeSensitive: true });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { ancestrySize: "lg" }
    );

    const projection = await runtime.uiAdapter.project(request);
    expect(projection.records[0]).toMatchObject({
      priceLabel: "2 sp 4 cp",
      priceContext: { materializedQuantity: 12, pricePer: 10 },
    });
    expect(
      buildStartingEquipmentPane(
        request.step,
        request.draft,
        { state: "incomplete", complete: false, status: "Review purchases", issue: null },
        projection
      ).catalogue.items[0]?.priceLabel
    ).toBe("2 sp 4 cp for 12 (priced per 10)");

    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    expect(line).toMatchObject({
      permanence: itemType === "ammo" || itemType === "consumable" ? "consumable" : "permanent",
      stackingIntent: "aggregate",
      price: {
        size: "large",
        pricePer: 10,
        sourceQuantity: 12,
        requestedQuantity: 1,
        materializedQuantity: 12,
        unitPriceCopper: 20,
        linePriceCopper: 24,
      },
    });
    expect(preparedEntry(line)).toMatchObject({ quantity: 12, plannedItems: [{ quantity: 12 }] });
  });

  it("diagnoses Candle-shaped partial-unit pricing instead of silently adding a free item", async () => {
    const source = dagger({ itemType: "equipment", priceCp: 1, pricePer: 10, sourceQuantity: 1 });
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [source]),
      getDocument: vi.fn(async () => document(source)),
    });

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      records: [
        {
          available: false,
          priceCopper: null,
          unavailableReason: expect.stringMatching(/quantity.*nonzero exact PF2E charge/i),
        },
      ],
    });
    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).rejects.toThrow(
      /quantity.*nonzero exact PF2E charge/i
    );
  });

  it("preserves PF2E denomination conversion when Spray Pellets-shaped pricing resolves to one copper", async () => {
    const source = dagger({ itemType: "ammo", priceSp: 1, pricePer: 10, sourceQuantity: 1 });
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [source]),
      getDocument: vi.fn(async () => document(source)),
    });

    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).resolves.toMatchObject({
      price: { pricePer: 10, materializedQuantity: 1, unitPriceCopper: 10, linePriceCopper: 1 },
    });
  });

  it("uses listed magic-item pricing while ordinary larger gear scales exactly once", async () => {
    const ordinary = dagger({ id: "ordinary", priceGp: 10, sizeSensitive: true });
    const listedMagic = dagger({ id: "listed-magic", priceGp: 100, sizeSensitive: false });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [ordinary, listedMagic]),
        getDocument: vi.fn(async (id) => document(id === "ordinary" ? ordinary : listedMagic)),
      },
      { ancestrySize: "lg" }
    );

    await expect(
      runtime.uiAdapter.prepareLine({ ...request, sourceUuid: `Compendium.${PACK_ID}.Item.ordinary` })
    ).resolves.toMatchObject({ price: { size: "large", unitPriceCopper: 2_000, linePriceCopper: 2_000 } });
    await expect(
      runtime.uiAdapter.prepareLine({ ...request, sourceUuid: `Compendium.${PACK_ID}.Item.listed-magic` })
    ).resolves.toMatchObject({ price: { size: "large", unitPriceCopper: 10_000, linePriceCopper: 10_000 } });
  });

  it.each([
    "lg",
    "huge",
  ] as const)("uses PF2E prepared size sensitivity for live-shaped %s magic-item pricing and catalogue admission", async (ancestrySize) => {
    const source = dagger({ priceGp: 10 });
    const preparePhysicalItem = vi.fn(() => ({
      system: {
        material: { type: null, grade: null },
        price: {
          sizeSensitive: false,
          value: { pp: 0, gp: 10, sp: 0, cp: 0, credits: 0, upb: 0, copperValue: 1_000 },
        },
      },
    }));
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { ancestrySize, preparePhysicalItem }
    );

    const projection = await runtime.uiAdapter.project(request);
    expect(projection).toMatchObject({
      state: "ready",
      records: [{ priceCopper: 1_000, priceLabel: "10 gp" }],
    });
    expect(
      buildStartingEquipmentPane(
        request.step,
        request.draft,
        { state: "incomplete", complete: false, status: "Review purchases", issue: null },
        projection
      ).catalogue.items[0]
    ).toMatchObject({ affordable: true, canBuyWithCurrency: true, canAdd: true });
    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).resolves.toMatchObject({
      price: { sizeSensitive: false, unitPriceCopper: 1_000, linePriceCopper: 1_000 },
    });
    expect(preparePhysicalItem).toHaveBeenCalledWith(
      expect.objectContaining({ targetSize: ancestrySize === "lg" ? "large" : "huge" })
    );
  });

  it("uses PF2E prepared precious-material shield pricing once and rederives it at Apply", async () => {
    let preparedCopper = 3_500;
    const source = dagger({ itemType: "shield", priceGp: 2, materialType: "dawnsilver", materialGrade: "low" });
    const preparePhysicalItem = vi.fn(() => ({
      system: {
        material: { type: "dawnsilver", grade: "low" },
        price: { sizeSensitive: true, value: { copperValue: preparedCopper } },
      },
    }));
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { ancestrySize: "huge", policy: higherLevelPolicy("lump-sum"), preparePhysicalItem }
    );

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      records: [{ itemType: "shield", priceCopper: 3_500 }],
    });
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    expect(line.price).toMatchObject({
      size: "huge",
      sizeSensitive: true,
      preciousMaterial: true,
      adjustedBulkPriceCopper: 3_500,
      unitPriceCopper: 3_500,
      linePriceCopper: 3_500,
    });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    preparedCopper = 3_600;
    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: preparedEntry(line),
      })
    ).resolves.toMatchObject({ resolvedPrice: { adjustedBulkPriceCopper: 3_600, unitPriceCopper: 3_600 } });
  });

  it.each([
    ["singleton ancestry size", "tiny"],
    ["heritage override", "medium"],
  ] as const)("uses prepared drafted actor size for %s", async (_case, preparedSize) => {
    const source = dagger({ priceGp: 1, sizeSensitive: true });
    const prepareDraftedActor = vi.fn(async ({ draft }: { draft: ReturnType<typeof createEmptyDraft> }) => {
      expect(draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"]).toBe("small");
      return { system: { traits: { size: { value: preparedSize } } } };
    });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { prepareDraftedActor: prepareDraftedActor as never }
    );
    request.draft.singletonChoices["singleton-choice-ancestry-automaton-size-level-1"] = "small";

    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).resolves.toMatchObject({
      price: { size: preparedSize, unitPriceCopper: 100 },
    });
    expect(prepareDraftedActor).toHaveBeenCalled();
  });

  it("projects actor-sized gear for an existing character whose current ancestry is not copied into the draft", async () => {
    const source = dagger({ priceGp: 1, sizeSensitive: true });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { actor: preparedExistingActor("lg") }
    );
    delete request.draft.selections["ancestry-level-1"];

    await expect(runtime.uiAdapter.project(request)).resolves.toMatchObject({
      state: "ready",
      records: [{ name: "Dagger", priceCopper: 200 }],
    });
  });

  it.each([
    ["tiny", "tiny", 1_000],
    ["sm", "small", 1_000],
    ["med", "medium", 1_000],
    ["lg", "large", 2_000],
    ["huge", "huge", 4_000],
    ["grg", "gargantuan", 8_000],
  ] as const)("derives %s ancestry equipment as %s at %i copper", async (ancestrySize, targetSize, expectedCopper) => {
    const source = dagger({ priceGp: 10, sizeSensitive: true });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { ancestrySize }
    );

    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).resolves.toMatchObject({
      price: { size: targetSize, unitPriceCopper: expectedCopper, linePriceCopper: expectedCopper },
    });
  });

  it("fails closed without authoritative drafted ancestry size and detects size drift at Apply", async () => {
    let ancestrySize: unknown = "lg";
    const source = dagger({ priceGp: 1 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: ancestrySize } } : null,
      }
    );
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };

    ancestrySize = "med";
    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: preparedEntry(line),
      })
    ).rejects.toThrow(/size no longer matches.*ancestry/i);

    ancestrySize = "unsupported";
    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).rejects.toThrow(
      /supported authoritative size/i
    );
    delete request.draft.selections["ancestry-level-1"];
    await expect(runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID })).rejects.toThrow(
      /exactly one effective ancestry/i
    );
  });

  it("derives exact exception facts from the hydrated document and rejects structural failures", async () => {
    const uncommon = dagger({ rarity: "uncommon" });
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [uncommon]),
      getDocument: vi.fn(async () => document(uncommon)),
    });
    await expect(
      runtime.resolveItemExceptionFacts({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition!,
        sourceUuid: DAGGER_UUID,
      })
    ).resolves.toEqual({
      kind: "rarity-source-exception",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 1,
      scope: "rarity",
      sourceUuid: DAGGER_UUID,
      packId: PACK_ID,
      publicationSlug: "pathfinder-player-core",
      rarity: "uncommon",
    });

    const precious = dagger({ materialType: "silver" });
    const structural = fixture({
      getIndex: vi.fn(async () => [precious]),
      getDocument: vi.fn(async () => document(precious)),
    });
    await expect(
      structural.runtime.resolveItemExceptionFacts({
        actor: structural.request.actor,
        characterDraft: structural.request.draft,
        acquisition: structural.request.draft.acquisition!,
        sourceUuid: DAGGER_UUID,
      })
    ).rejects.toThrow(/otherwise supported item/i);
  });

  it("rebuilds current price material for Apply instead of trusting the reviewed line", async () => {
    let currentSource = dagger();
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [dagger()]),
      getDocument: vi.fn(async () => document(currentSource)),
    });
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    const entry = preparedEntry(line);

    const first = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition!,
      entry,
    });
    expect(first.resolvedPrice.linePriceCopper).toBe(20);

    currentSource = dagger({ priceSp: 3 });
    runtime.invalidatePack(PACK_ID);
    const drifted = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition!,
      entry,
    });
    expect(drifted.priceFingerprint).not.toBe(line.priceFingerprint);
    expect(drifted.resolvedPrice).toMatchObject({ unitPriceCopper: 30, linePriceCopper: 30 });
  });

  it("fails closed for at-level currency purchases and configured material sources", async () => {
    const leveled = fixture({
      getIndex: vi.fn(async () => [dagger({ level: 1 })]),
      getDocument: vi.fn(async () => document(dagger({ level: 1 }))),
    });
    await expect(
      leveled.runtime.uiAdapter.prepareLine({ ...leveled.request, sourceUuid: DAGGER_UUID })
    ).rejects.toThrow(/below.*target level/i);

    const material = dagger({ materialType: "cold-iron" });
    const configured = fixture({
      getIndex: vi.fn(async () => [material]),
      getDocument: vi.fn(async () => document(material)),
    });
    await expect(
      configured.runtime.uiAdapter.prepareLine({ ...configured.request, sourceUuid: DAGGER_UUID })
    ).rejects.toThrow(/base-item identity|inventory sheet/i);
  });

  it.each([
    ["sm", "large"],
    ["med", "large"],
  ] as const)("prepares and Apply-revalidates an explicit %s-ancestry Titan Mauler line at %s size", async (ancestrySize, targetSize) => {
    const source = dagger({ priceGp: 9 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID
            ? {
                type: "ancestry",
                _stats: { compendiumSource: ANCESTRY_UUID },
                system: { size: ancestrySize },
              }
            : null,
      }
    );
    selectGiantInstinct(request.draft);

    const projection = await runtime.uiAdapter.project(request);
    expect(projection).toMatchObject({
      titanMauler: { required: true, selectedSourceUuid: null },
      records: [{ priceCopper: 900, titanMaulerEligible: true }],
    });

    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    expect(line).toMatchObject({
      funding: {
        lane: "class-grant",
        grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
      },
      stackingIntent: "separate",
      price: {
        basePrice: { kind: "priced", value: { gp: 9 } },
        size: targetSize,
        requestedQuantity: 1,
        materializedQuantity: 1,
        unitPriceCopper: 1_800,
        linePriceCopper: 1_800,
      },
    });

    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    expect(await runtime.uiAdapter.project(request)).toMatchObject({
      titanMauler: { required: true, selectedSourceUuid: DAGGER_UUID },
      records: [{ titanMaulerEligible: true }],
    });
    const strictProjection = await projectPlannedClassGrants({
      draft: request.draft,
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      activeSteps: [
        { slotId: "ancestry-level-1" },
        { slotId: "class-level-1" },
        { slotId: "class-branch-instinct-level-1" },
      ] as never,
      observedActorItems: [],
      currentEquipmentPolicy: policy(),
      actorSize: ancestrySize === "sm" ? "small" : "medium",
      fetchDocumentByUuid: async (uuid) => titanProjectionDocument(uuid, source),
    });
    expect(strictProjection).toMatchObject({
      blockers: [],
      preparedPlan: { grants: [{ profileId: "giant-instinct-titan-mauler" }] },
    });
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition, strictProjection.grants);
    const resolved = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      entry: preparedEntry(line),
    });
    expect(resolved.resolvedPrice).toMatchObject({
      basePrice: { kind: "priced", value: { gp: 9 } },
      size: targetSize,
      linePriceCopper: 1_800,
    });

    const wrongSize = {
      ...preparedEntry(line),
      price: { ...line.price, size: "medium" as const, unitPriceCopper: 900, linePriceCopper: 900 },
    };
    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: wrongSize,
      })
    ).rejects.toThrow(/drafted ancestry/i);
  });

  it("uses pre-size base Price for Titan eligibility and accepts only exact registered Access", async () => {
    const source = dagger({ priceGp: 9, rarity: "uncommon" });
    const accessRegistry = createEquipmentAccessRegistry([
      {
        sourceUuid: DAGGER_UUID,
        accessRef: "feature:test-weapon-access",
        profileVersion: "test-v1",
        resolve: () => true,
      },
    ]);
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        accessRegistry,
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID
            ? {
                type: "ancestry",
                _stats: { compendiumSource: ANCESTRY_UUID },
                system: { size: "med" },
              }
            : null,
      }
    );
    selectGiantInstinct(request.draft);
    const accessRequest = { ...request, previewSourceUuid: DAGGER_UUID };

    const projection = await runtime.uiAdapter.project(accessRequest);
    expect(projection.records[0]).toMatchObject({
      priceCopper: 900,
      rarity: "uncommon",
      available: true,
      titanMaulerEligible: true,
    });
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...accessRequest, sourceUuid: DAGGER_UUID });
    expect(line).toMatchObject({
      policyDecision: {
        rarityBasis: "specific-character-access",
        characterAccessRef: "feature:test-weapon-access",
      },
      price: { size: "large", linePriceCopper: 1_800 },
    });
    await expect(
      runtime.resolveCurrentCharacterAccessRef({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition!,
        sourceUuid: DAGGER_UUID,
      })
    ).resolves.toBe("feature:test-weapon-access");

    const overPrice = dagger({ priceGp: 10 });
    const over = fixture(
      {
        getIndex: vi.fn(async () => [overPrice]),
        getDocument: vi.fn(async () => document(overPrice)),
      },
      {
        fetchDocumentByUuid: async () => ({ type: "ancestry", system: { size: "med" } }),
      }
    );
    selectGiantInstinct(over.request.draft);
    expect((await over.runtime.uiAdapter.project(over.request)).records[0]?.titanMaulerEligible).toBe(false);
    await expect(
      over.runtime.uiAdapter.prepareTitanMaulerLine({ ...over.request, sourceUuid: DAGGER_UUID })
    ).rejects.toThrow(/9 gp or less/i);
  });

  it.each([
    "class",
    "instinct",
  ] as const)("removes and invalidates a reviewed Titan line when the drafted %s changes away", async (changedSelection) => {
    const source = dagger({ priceGp: 9 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: "med" } } : null,
      }
    );
    selectGiantInstinct(request.draft);
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = await reviewedTitanAcquisitionWithLine(request.draft, line, source);

    if (changedSelection === "class") {
      request.draft.selections["class-level-1"] = {
        ...request.draft.selections["class-level-1"]!,
        documentId: "other-class",
        uuid: "Compendium.pf2e.classes.Item.other-class",
        name: "Fighter",
      };
    } else {
      request.draft.branchSelections.instinct = {
        ...request.draft.branchSelections.instinct!,
        documentId: "other-instinct",
        uuid: "Compendium.pf2e.classfeatures.Item.other-instinct",
        name: "Animal Instinct",
      };
    }

    const result = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
    });
    expect(result).toMatchObject({ changed: true, reason: "build-changed" });
    expect(result.acquisition.lines).toEqual([]);
    expect(result.acquisition.disposition).toMatchObject({ kind: "unreviewed", reasons: ["document"] });
  });

  it("removes a reviewed Large Titan line when the ancestry changes from Medium to Large", async () => {
    let ancestrySize = "med";
    const source = dagger({ priceGp: 9 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: ancestrySize } } : null,
      }
    );
    selectGiantInstinct(request.draft);
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = await reviewedTitanAcquisitionWithLine(request.draft, line, source);
    ancestrySize = "lg";

    const result = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
    });
    expect(result).toMatchObject({ changed: true, reason: "size-changed" });
    expect(result.acquisition.lines).toEqual([]);
    expect(result.acquisition.disposition).toMatchObject({ kind: "unreviewed", reasons: ["document"] });
  });

  it("preserves a reviewed Titan line byte-for-byte after an unrelated draft choice", async () => {
    const source = dagger({ priceGp: 9 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) =>
          uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: "med" } } : null,
      }
    );
    selectGiantInstinct(request.draft);
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = await reviewedTitanAcquisitionWithLine(request.draft, line, source);
    const reviewed = request.draft.acquisition;
    request.draft.selections["background-level-1"] = {
      slotId: "background-level-1",
      packId: "pf2e.backgrounds",
      documentId: "background",
      uuid: "Compendium.pf2e.backgrounds.Item.background",
      itemType: "background",
      featType: null,
      name: "Scholar",
      level: 0,
    };

    const result = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: reviewed,
    });
    expect(result).toEqual({ acquisition: reviewed, changed: false, reason: null });
  });

  it("removes deterministic Titan source drift but preserves and invalidates on transient hydration failure", async () => {
    let currentSource = dagger({ priceGp: 9 });
    let ancestryHydrationFails = false;
    let ancestryHydrationMissing = false;
    let hydrationFails = false;
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [currentSource]),
        getDocument: vi.fn(async () => {
          if (hydrationFails) throw new Error("temporary pack failure");
          return document(currentSource);
        }),
      },
      {
        fetchDocumentByUuid: async (uuid) => {
          if (ancestryHydrationFails) throw new Error("temporary ancestry pack failure");
          if (ancestryHydrationMissing) return null;
          return uuid === ANCESTRY_UUID ? { type: "ancestry", system: { size: "med" } } : null;
        },
      }
    );
    selectGiantInstinct(request.draft);
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = await reviewedTitanAcquisitionWithLine(request.draft, line, currentSource);

    ancestryHydrationFails = true;
    const ancestryTransient = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
    });
    expect(ancestryTransient).toMatchObject({
      changed: true,
      reason: "verification-failed",
      acquisition: {
        lines: [{ lineId: line.lineId }],
        disposition: { kind: "unreviewed", reasons: ["document"] },
      },
    });
    ancestryHydrationFails = false;
    ancestryHydrationMissing = true;
    const ancestryMissing = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
    });
    expect(ancestryMissing).toMatchObject({
      reason: "verification-failed",
      acquisition: { lines: [{ lineId: line.lineId }] },
    });
    ancestryHydrationMissing = false;

    currentSource = dagger({ priceGp: 10 });
    const drift = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
    });
    expect(drift).toMatchObject({ changed: true, reason: "source-changed", acquisition: { lines: [] } });

    currentSource = dagger({ priceGp: 9 });
    hydrationFails = true;
    const transient = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: await reviewedTitanAcquisitionWithLine(request.draft, line, currentSource),
    });
    expect(transient).toMatchObject({
      changed: true,
      reason: "verification-failed",
      acquisition: {
        lines: [{ lineId: line.lineId }],
        disposition: { kind: "unreviewed", reasons: ["document"] },
      },
    });
  });

  it("discards a stale transient sync result after a newer class-away removal", async () => {
    let blockAncestryHydration = false;
    let rejectAncestryHydration: ((reason?: unknown) => void) | null = null;
    const source = dagger({ priceGp: 9 });
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      {
        fetchDocumentByUuid: async (uuid) => {
          if (uuid !== ANCESTRY_UUID) return null;
          if (!blockAncestryHydration) return { type: "ancestry", system: { size: "med" } };
          return new Promise<never>((_resolve, reject) => {
            rejectAncestryHydration = reject;
          });
        },
      }
    );
    selectGiantInstinct(request.draft);
    const line = await runtime.uiAdapter.prepareTitanMaulerLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = await reviewedTitanAcquisitionWithLine(request.draft, line, source);

    const staleAcquisition = request.draft.acquisition;
    const staleDraftFingerprint = JSON.stringify(request.draft);
    blockAncestryHydration = true;
    const stalePending = runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: staleAcquisition,
    });
    await Promise.resolve();

    request.draft.selections["class-level-1"] = {
      ...request.draft.selections["class-level-1"]!,
      documentId: "other-class",
      uuid: "Compendium.pf2e.classes.Item.other-class",
      name: "Fighter",
    };
    const currentAcquisition = request.draft.acquisition;
    const currentDraftFingerprint = JSON.stringify(request.draft);
    const currentResult = await runtime.synchronizeTitanMaulerLine({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: currentAcquisition,
    });
    expect(
      commitTitanMaulerLineSynchronization({
        draft: request.draft,
        expectedAcquisition: currentAcquisition,
        expectedDraftFingerprint: currentDraftFingerprint,
        currentDraftFingerprint: JSON.stringify(request.draft),
        result: currentResult,
      })
    ).toBe(true);
    expect(request.draft.acquisition?.lines).toEqual([]);

    const rejectPending = rejectAncestryHydration;
    if (!rejectPending) throw new Error("The ancestry hydration did not reach the controlled interleaving point.");
    rejectPending(new Error("temporary ancestry pack failure"));
    const staleResult = await stalePending;
    expect(staleResult).toMatchObject({ changed: true, reason: "verification-failed" });
    expect(
      commitTitanMaulerLineSynchronization({
        draft: request.draft,
        expectedAcquisition: staleAcquisition,
        expectedDraftFingerprint: staleDraftFingerprint,
        currentDraftFingerprint: JSON.stringify(request.draft),
        result: staleResult,
      })
    ).toBe(false);
    expect(request.draft.acquisition?.lines).toEqual([]);
  });

  it("prepares and freshly validates an exact fixed native grant without granting blanket Access", async () => {
    let currentSource = formulaBook();
    const getDocument = vi.fn(async () => document(currentSource));
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [currentSource]),
      getDocument,
    });
    const grant = fixedNativeGrant();
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const nativeRequest = {
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition!,
      classGrantPlan,
    } as const;

    const lines = await runtime.prepareNativeClassGrantLines(nativeRequest);

    expect(lines).toMatchObject([
      {
        lineId: "wf-line-test",
        sourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem,
        itemLevel: 0,
        permanence: "permanent",
        componentKind: "baseline-item",
        stackingIntent: "separate",
        funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
        policyDecision: {
          eligible: false,
          rarity: "uncommon",
          characterAccessRef: null,
        },
        price: { requestedQuantity: 1, materializedQuantity: 1, linePriceCopper: 10 },
      },
    ]);
    expect(lines[0]?.documentFingerprint).toMatch(/^equipment-document-v1-/u);
    expect(lines[0]?.priceFingerprint).toMatch(/^equipment-price-v1-/u);
    expect(getDocument).toHaveBeenCalledTimes(1);

    request.draft.acquisition = { ...request.draft.acquisition!, lines: [...lines] };
    const validated = await runtime.prepareNativeClassGrantLines({
      ...nativeRequest,
      acquisition: request.draft.acquisition,
    });
    expect(validated).toEqual(lines);
    expect(validated[0]).toBe(lines[0]);
    expect(getDocument).toHaveBeenCalledTimes(2);

    const applied = await runtime.resolveSourceForApply({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      entry: preparedEntry(lines[0]!),
    });
    expect(applied).toMatchObject({
      sourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem,
      documentFingerprint: lines[0]!.documentFingerprint,
      priceFingerprint: lines[0]!.priceFingerprint,
      policyDecision: lines[0]!.policyDecision,
      resolvedPrice: lines[0]!.price,
    });
    expect(getDocument).toHaveBeenCalledTimes(3);

    currentSource = formulaBook({ priceSp: 2 });
    await expect(
      runtime.prepareNativeClassGrantLines({
        ...nativeRequest,
        acquisition: request.draft.acquisition,
      })
    ).rejects.toThrow(/source material drifted/i);
    expect(getDocument).toHaveBeenCalledTimes(4);
  });

  it("does not require ancestry size when a healthy prepared plan has no native physical grants", async () => {
    const source = dagger();
    const prepareDraftedActor = vi.fn(async () => {
      throw new Error("size preparation must not run");
    });
    const getIndex = vi.fn(async () => [source]);
    const { runtime, request } = fixture(
      { getIndex, getDocument: vi.fn(async () => document(source)) },
      { prepareDraftedActor: prepareDraftedActor as never }
    );
    delete request.draft.selections["ancestry-level-1"];
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [],
    });

    await expect(
      runtime.prepareNativeClassGrantLines({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition!,
        classGrantPlan,
      })
    ).resolves.toEqual([]);
    expect(getIndex).toHaveBeenCalledTimes(1);
    expect(prepareDraftedActor).not.toHaveBeenCalled();
  });

  it("does not treat an unavailable ordinary purchase as a fixed native grant", async () => {
    let currentSource = dagger();
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [currentSource]),
      getDocument: vi.fn(async () => document(currentSource)),
    });
    const line = await runtime.uiAdapter.prepareLine({ ...request, sourceUuid: DAGGER_UUID });
    request.draft.acquisition = { ...request.draft.acquisition!, lines: [line] };
    currentSource = dagger({ rarity: "uncommon" });
    runtime.invalidatePack(PACK_ID);

    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: preparedEntry(line),
      })
    ).rejects.toThrow(/rarity|unavailable/i);
  });

  it("requires fixed native Apply authority to match the exact persisted line and source provenance", async () => {
    let currentSource = formulaBook();
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [currentSource]),
      getDocument: vi.fn(async () => document(currentSource)),
    });
    const grant = fixedNativeGrant();
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const lines = await runtime.prepareNativeClassGrantLines({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      classGrantPlan,
    });
    const line = lines[0]!;
    request.draft.acquisition = { ...request.draft.acquisition, lines: [line] };
    const entry = preparedEntry(line);

    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: {
          ...entry,
          policyDecision: { ...entry.policyDecision, rarityBasis: "specific-character-access" },
        },
      })
    ).rejects.toThrow(/persisted acquisition authority/i);

    currentSource = formulaBook({ compendiumSource: DAGGER_UUID });
    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry,
      })
    ).rejects.toThrow(/mismatched source provenance/i);
  });

  it("rejects same-ID divergent persisted native authority and duplicate grant-funded lines", async () => {
    const source = formulaBook();
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [source]),
      getDocument: vi.fn(async () => document(source)),
    });
    const grant = fixedNativeGrant();
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const lines = await runtime.prepareNativeClassGrantLines({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      classGrantPlan,
    });
    const line = lines[0]!;
    const reviewedAcquisition = { ...request.draft.acquisition, lines: [line] };
    request.draft.acquisition = { ...reviewedAcquisition, lines: [] };

    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: reviewedAcquisition,
        entry: preparedEntry(line),
      })
    ).rejects.toThrow(/persisted acquisition state/i);

    const duplicate = { ...line, lineId: "wf-line-native-duplicate" };
    const duplicateAcquisition = { ...reviewedAcquisition, lines: [line, duplicate] };
    request.draft.acquisition = duplicateAcquisition;
    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: duplicateAcquisition,
        entry: preparedEntry(line),
      })
    ).rejects.toThrow(/not persisted exactly once/i);
  });

  it("hydrates an exact fixed native source outside catalogue packs without widening ordinary access", async () => {
    const source = formulaBook();
    const excludedPolicy: EffectiveEquipmentPolicySnapshotV1 = {
      ...policy(),
      sourcePolicy: { ...policy().sourcePolicy, effectivePackIds: [] },
    };
    const { runtime, request } = fixture(
      {
        getIndex: vi.fn(async () => [source]),
        getDocument: vi.fn(async () => document(source)),
      },
      { policy: excludedPolicy }
    );
    expect(await runtime.uiAdapter.project(request)).toMatchObject({ state: "ready", records: [] });
    await expect(
      runtime.uiAdapter.prepareLine({
        ...request,
        sourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem,
      })
    ).rejects.toThrow(/outside the current effective pack set/i);

    const grant = fixedNativeGrant();
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });
    const lines = await runtime.prepareNativeClassGrantLines({
      actor: request.actor,
      characterDraft: request.draft,
      acquisition: request.draft.acquisition,
      classGrantPlan,
    });
    expect(lines[0]?.policyDecision).toMatchObject({
      eligible: false,
      sourceBasis: "source-not-allowed",
    });
    request.draft.acquisition = { ...request.draft.acquisition, lines: [...lines] };

    await expect(
      runtime.resolveSourceForApply({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        entry: preparedEntry(lines[0]!),
      })
    ).resolves.toMatchObject({
      sourceUuid: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem,
      policyDecision: { eligible: false, sourceBasis: "source-not-allowed" },
    });
  });

  it("rejects a hydrated native grant document with a different exact identity", async () => {
    const source = formulaBook({ id: "different-item" });
    const { runtime, request } = fixture({
      getIndex: vi.fn(async () => [source]),
      getDocument: vi.fn(async () => document(source)),
    });
    const grant = fixedNativeGrant();
    request.draft.acquisition = recordPlannedClassGrants(request.draft.acquisition!, [grant]);
    const classGrantPlan = createPreparedClassGrantPlan({
      actorId: "actor-1",
      draftId: "draft-1",
      batchId: "batch-1",
      targetLevel: 1,
      grants: [grant],
    });

    await expect(
      runtime.prepareNativeClassGrantLines({
        actor: request.actor,
        characterDraft: request.draft,
        acquisition: request.draft.acquisition,
        classGrantPlan,
      })
    ).rejects.toThrow(/different document identity/i);
  });
});

async function reviewedTitanAcquisitionWithLine(
  characterDraft: ReturnType<typeof createEmptyDraft>,
  line: AcquisitionLineDraft,
  source: ReturnType<typeof dagger>
): Promise<AcquisitionDraftState> {
  let acquisition: AcquisitionDraftState = {
    ...characterDraft.acquisition!,
    lines: [line],
    plannedClassGrants: [],
    classGrantReconciliations: [],
    disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    baseline: createEconomicBaseline({
      actorId: "actor-1",
      capturedAt: "2026-08-19T20:00:00.000Z",
      currencyCopper: 0,
      physicalItems: [],
    }),
  };
  characterDraft.acquisition = acquisition;
  const projection = await projectPlannedClassGrants({
    draft: characterDraft,
    actorId: "actor-1",
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    activeSteps: [
      { slotId: "ancestry-level-1" },
      { slotId: "class-level-1" },
      { slotId: "class-branch-instinct-level-1" },
    ] as never,
    observedActorItems: [],
    currentEquipmentPolicy: policy(),
    actorSize: "medium",
    fetchDocumentByUuid: async (uuid) => titanProjectionDocument(uuid, source),
  });
  if (!projection.preparedPlan || projection.blockers.length > 0) {
    throw new Error(projection.blockers[0]?.message ?? "Titan test projection failed.");
  }
  acquisition = recordPlannedClassGrants(acquisition, projection.grants);
  characterDraft.acquisition = acquisition;
  const ledger = evaluateAcquisitionLedger(acquisition, projection.preparedPlan);
  const reviewed = reviewRetainAll(acquisition, ledger, {
    userId: "owner-1",
    reviewedAt: "2026-08-19T20:01:00.000Z",
  });
  characterDraft.acquisition = reviewed;
  return reviewed;
}

function fixture(
  pack: Pick<EquipmentCataloguePackLike, "getIndex" | "getDocument">,
  options: {
    readonly accessRegistry?: EquipmentAccessRegistry;
    readonly fetchDocumentByUuid?: (uuid: string) => Promise<unknown | null>;
    readonly policy?: EffectiveEquipmentPolicySnapshotV1;
    readonly prepareConfiguredItem?: NonNullable<
      Parameters<typeof createEquipmentAcquisitionRuntime>[0]["prepareConfiguredItem"]
    >;
    readonly preparePhysicalItem?: NonNullable<
      Parameters<typeof createEquipmentAcquisitionRuntime>[0]["preparePhysicalItem"]
    >;
    readonly prepareBrowsePhysicalItems?: PrepareBrowsePhysicalItems;
    readonly prepareDraftedActor?: NonNullable<
      Parameters<typeof createEquipmentAcquisitionRuntime>[0]["prepareDraftedActor"]
    >;
    readonly prepareKitExpansion?: NonNullable<
      Parameters<typeof createEquipmentAcquisitionRuntime>[0]["prepareKitExpansion"]
    >;
    readonly actor?: unknown;
    readonly ancestrySize?: "tiny" | "sm" | "med" | "lg" | "huge" | "grg";
    readonly sourceDiagnostics?: readonly EquipmentSourceDiagnostic[];
    readonly browsePreparedRecordCacheLimit?: number;
    readonly draftedEquipmentSizeCacheLimit?: number;
  } = {}
): {
  runtime: EquipmentAcquisitionRuntime;
  request: Parameters<EquipmentAcquisitionRuntime["uiAdapter"]["project"]>[0];
} {
  const currentPolicy = options.policy ?? policy();
  const recipe =
    currentPolicy.recipe.kind === "lump-sum" ? ({ kind: "lump-sum" } as const) : ({ kind: "permanent-items" } as const);
  const acquisition = {
    ...createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: currentPolicy.targetLevel,
      recipe,
    }),
    policySnapshot: createAcquisitionPolicySnapshot(currentPolicy, recipe),
  };
  const draft = createEmptyDraft(currentPolicy.targetLevel);
  draft.acquisition = acquisition;
  selectAncestry(draft);
  const packs = new Map<string, EquipmentCataloguePackLike>([
    [PACK_ID, { documentName: "Item", getIndex: pack.getIndex, getDocument: pack.getDocument }],
  ]);
  return {
    runtime: createEquipmentAcquisitionRuntime({
      packs,
      accessRegistry: options.accessRegistry,
      fetchDocumentByUuid:
        options.fetchDocumentByUuid ??
        (async (uuid) =>
          uuid === ANCESTRY_UUID
            ? {
                type: "ancestry",
                _stats: { compendiumSource: ANCESTRY_UUID },
                system: { size: options.ancestrySize ?? "med" },
              }
            : null),
      resolveEffectivePolicy: () => currentPolicy,
      resolveSourceDiagnostics: () => options.sourceDiagnostics ?? [],
      prepareConfiguredItem: options.prepareConfiguredItem,
      preparePhysicalItem: options.preparePhysicalItem ?? prepareTestPhysicalItem,
      prepareBrowsePhysicalItems: options.prepareBrowsePhysicalItems,
      prepareDraftedActor: options.prepareDraftedActor ?? prepareTestDraftedActor,
      prepareKitExpansion: options.prepareKitExpansion,
      browsePreparedRecordCacheLimit: options.browsePreparedRecordCacheLimit,
      draftedEquipmentSizeCacheLimit: options.draftedEquipmentSizeCacheLimit,
      mintLineId: () => "wf-line-test",
    }),
    request: {
      actor: options.actor ?? { id: "actor-1" },
      draft,
      step: {
        id: `starting-equipment-level-${currentPolicy.targetLevel}`,
        slotId: `starting-equipment-level-${currentPolicy.targetLevel}`,
        kind: "starting-equipment",
        slotKind: "starting-equipment",
        level: currentPolicy.targetLevel,
        title: "Starting Equipment",
        description: "Choose equipment.",
        required: true,
      },
      query: "",
      filters: {},
      previewSourceUuid: null,
    },
  };
}

function prepareTestPhysicalItem(
  input: Parameters<NonNullable<Parameters<typeof createEquipmentAcquisitionRuntime>[0]["preparePhysicalItem"]>>[0]
) {
  const source = structuredClone(input.source) as Record<string, any>;
  const price = source.system?.price ?? {};
  const value = price.value ?? {};
  const baseCopper =
    Number(value.pp ?? 0) * 1_000 + Number(value.gp ?? 0) * 100 + Number(value.sp ?? 0) * 10 + Number(value.cp ?? 0);
  const sizeSensitive = price.sizeSensitive === undefined ? true : price.sizeSensitive;
  const multiplier =
    sizeSensitive === true
      ? input.targetSize === "large"
        ? 2
        : input.targetSize === "huge"
          ? 4
          : input.targetSize === "gargantuan"
            ? 8
            : 1
      : 1;
  source.system = {
    ...source.system,
    price: { ...price, sizeSensitive, value: { copperValue: baseCopper * multiplier } },
  };
  return source;
}

const prepareTestBrowsePhysicalItems: PrepareBrowsePhysicalItems = async (input) =>
  input.entries.map((entry) => {
    try {
      return {
        key: entry.key,
        prepared: prepareTestPhysicalItem({
          actor: input.actor,
          targetLevel: input.targetLevel,
          targetSize: input.targetSize,
          source: entry.source,
        }),
        error: null,
      };
    } catch (error) {
      return { key: entry.key, prepared: null, error };
    }
  });

async function prepareTestDraftedActor(
  input: Parameters<NonNullable<Parameters<typeof createEquipmentAcquisitionRuntime>[0]["prepareDraftedActor"]>>[0]
) {
  const ancestry = input.draft.selections["ancestry-level-1"];
  const document = ancestry ? ((await input.fetchDocumentByUuid(ancestry.uuid)) as Record<string, any> | null) : null;
  return { system: { traits: { size: { value: document?.system?.size ?? null } } } };
}

function preparedExistingActor(size: string, items: readonly Record<string, unknown>[] = [{ type: "ancestry" }]) {
  return {
    id: "actor-1",
    items: { contents: items },
    system: { traits: { size: { value: size } } },
  };
}

function policy(): EffectiveEquipmentPolicySnapshotV1 {
  return {
    version: 1,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 1,
    rules: { wealth: CHARACTER_WEALTH_POLICY_REF, semantics: SEMANTIC_WEALTH_POLICY_REF },
    recipe: { kind: "level-1-equivalent", budgetCopper: 1_500 },
    worldRecipePolicy: { enabledRecipes: ["permanent-items", "lump-sum"], defaultRecipe: "permanent-items" },
    sourcePolicy: {
      configuredPackFamilies: ["pf2e"],
      effectivePackIds: [PACK_ID],
      enabledSourceSlugs: ["pathfinder-player-core"],
      knownSourceSlugs: ["pathfinder-player-core"],
      showEmptySources: false,
      showUnknownSources: false,
    },
    rarityPolicy: { blanketCeiling: "common" },
    authorityPolicy: {
      recipeChoice: "actor-owner",
      higherLevelStart: "gm-confirmation",
      apply: "actor-owner",
    },
    higherLevelStartEvidence: { kind: "not-required" },
    abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
    gmJudgments: [],
    fingerprint: "policy-v1",
    explanations: [],
  };
}

function higherLevelPolicy(recipe: "permanent-items" | "lump-sum"): EffectiveEquipmentPolicySnapshotV1 {
  const targetLevel = 5;
  return {
    ...policy(),
    targetLevel,
    recipe:
      recipe === "lump-sum"
        ? { kind: "lump-sum", budgetCopper: 27_000, maxItemLevel: 4 }
        : {
            kind: "permanent-items",
            currencyCopper: 5_000,
            allowances: [
              { allowanceId: "level-1-1", itemLevel: 1 },
              { allowanceId: "level-1-2", itemLevel: 1 },
              { allowanceId: "level-2-1", itemLevel: 2 },
              { allowanceId: "level-3-1", itemLevel: 3 },
              { allowanceId: "level-3-2", itemLevel: 3 },
              { allowanceId: "level-4-1", itemLevel: 4 },
            ],
          },
    higherLevelStartEvidence: {
      kind: "actor-owner-attestation",
      startKind: "replacement-character",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel,
      authorUserId: "owner-1",
      authorName: "Owner",
      recordedAt: "2026-08-20T20:00:00.000Z",
      reason: "Replacement character",
    },
    authorityPolicy: {
      recipeChoice: "actor-owner",
      higherLevelStart: "actor-owner-attestation",
      apply: "actor-owner",
    },
    fingerprint: `policy-level-5-${recipe}`,
  };
}

function configuredPolicy(): EffectiveEquipmentPolicySnapshotV1 {
  const targetLevel = 14;
  return {
    ...policy(),
    targetLevel,
    recipe: { kind: "permanent-items", currencyCopper: 0, allowances: [{ allowanceId: "level-14-1", itemLevel: 14 }] },
    higherLevelStartEvidence: {
      kind: "actor-owner-attestation",
      startKind: "replacement-character",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel,
      authorUserId: "owner-1",
      authorName: "Owner",
      recordedAt: "2026-08-20T20:00:00.000Z",
      reason: "Replacement character",
    },
    authorityPolicy: { ...policy().authorityPolicy, higherLevelStart: "actor-owner-attestation" },
    fingerprint: "policy-configured-level-14",
  };
}

function dagger(
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly priceSp?: number;
    readonly priceGp?: number;
    readonly priceCp?: number;
    readonly pricePer?: number;
    readonly sourceQuantity?: number;
    readonly sizeSensitive?: boolean;
    readonly itemType?: "ammo" | "armor" | "backpack" | "consumable" | "equipment" | "shield" | "weapon";
    readonly level?: number;
    readonly materialType?: string | null;
    readonly materialGrade?: string | null;
    readonly rarity?: "common" | "uncommon";
    readonly baseItem?: string | null;
    readonly runes?: Record<string, unknown>;
    readonly specific?: unknown;
  } = {}
) {
  return {
    _id: options.id ?? DAGGER_ID,
    name: options.name ?? "Dagger",
    img: "icons/weapons/daggers/dagger-straight-blue.webp",
    type: options.itemType ?? "weapon",
    system: {
      level: { value: options.level ?? 0 },
      category: "simple",
      range: null,
      traits: { rarity: options.rarity ?? "common", value: ["agile", "finesse"] },
      publication: { title: "Pathfinder Player Core" },
      price: {
        value:
          options.priceGp !== undefined
            ? { gp: options.priceGp }
            : options.priceCp !== undefined
              ? { cp: options.priceCp }
              : { sp: options.priceSp ?? 2 },
        ...(options.pricePer === undefined ? {} : { per: options.pricePer }),
        ...(options.sizeSensitive === undefined ? {} : { sizeSensitive: options.sizeSensitive }),
      },
      quantity: options.sourceQuantity ?? 1,
      rules: [],
      size: "med",
      baseItem: options.baseItem ?? null,
      specific: options.specific ?? null,
      runes: options.runes ?? { potency: 0, striking: 0, property: [] },
      material: { type: options.materialType ?? null, grade: options.materialGrade ?? null },
    },
  };
}

function selectGiantInstinct(draft: ReturnType<typeof createEmptyDraft>): void {
  selectAncestry(draft);
  draft.selections["class-level-1"] = {
    slotId: "class-level-1",
    packId: "pf2e.classes",
    documentId: "YDRiP7uVvr9WRhOI",
    uuid: CLASS_GRANT_PROFILE_UUIDS.barbarianClass,
    itemType: "class",
    featType: null,
    name: "Barbarian",
    level: 1,
  };
  draft.branchSelections.instinct = {
    slotId: "class-branch-instinct-level-1",
    packId: "pf2e.classfeatures",
    documentId: "JuKD6k7nDwfO0Ckv",
    uuid: CLASS_GRANT_PROFILE_UUIDS.giantInstinct,
    itemType: "feat",
    featType: "classfeature",
    name: "Giant Instinct",
    level: 1,
  };
}

function selectAncestry(draft: ReturnType<typeof createEmptyDraft>): void {
  draft.selections["ancestry-level-1"] = {
    slotId: "ancestry-level-1",
    packId: "pf2e.ancestries",
    documentId: "ancestry",
    uuid: ANCESTRY_UUID,
    itemType: "ancestry",
    featType: null,
    name: "Test Ancestry",
    level: 0,
  };
}

function titanProjectionDocument(uuid: string, weapon: ReturnType<typeof dagger>): unknown | null {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  if (uuid === u.barbarianClass) {
    return { system: { items: { instinct: { level: 1, uuid: u.instinctFeature } } } };
  }
  if (uuid === u.instinctFeature) {
    return {
      system: {
        rules: [
          {
            key: "ChoiceSet",
            flag: "instinct",
            choices: { filter: ["item:tag:barbarian-instinct"] },
          },
          { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.instinct}" },
        ],
      },
    };
  }
  if (uuid === u.giantInstinct) {
    return {
      system: {
        description: {
          value:
            "Choose a weapon with a Price of 9 gp or less. Small or Medium characters use a Large weapon; otherwise choose one size larger. It has no value if sold.",
        },
        rules: [],
        traits: { otherTags: ["barbarian-instinct"] },
      },
    };
  }
  if (uuid === DAGGER_UUID) return weapon;
  return null;
}

function document<T>(source: T) {
  return { toObject: () => structuredClone(source) };
}

function formulaBook(
  options: { readonly id?: string; readonly priceSp?: number; readonly compendiumSource?: string } = {}
) {
  return {
    _id: options.id ?? FORMULA_BOOK_ID,
    name: "Formula Book",
    img: "icons/sundries/books/book-embossed-gold-red.webp",
    type: "equipment",
    _stats: { compendiumSource: options.compendiumSource ?? CLASS_GRANT_PROFILE_UUIDS.formulaBookItem },
    system: {
      level: { value: 0 },
      traits: { rarity: "uncommon", value: [] },
      publication: { title: "Pathfinder Player Core" },
      price: { value: { sp: options.priceSp ?? 1 } },
      quantity: 1,
      rules: [],
      size: "med",
      material: { type: null, grade: null },
    },
  };
}

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

function nativeAncestryGrant(profileId: "dwarf-clan-dagger" | "sarangay-head-gem") {
  const u = CLASS_GRANT_PROFILE_UUIDS;
  const dwarf = profileId === "dwarf-clan-dagger";
  return createPlannedClassGrant({
    grantId: dwarf
      ? "class-grant:dwarf-clan-dagger:ancestry-level-1"
      : "class-grant:sarangay-head-gem:ancestry-level-1",
    profileId,
    origin: {
      sourceSlotId: "ancestry-level-1",
      sourceUuid: dwarf ? u.dwarfAncestry : u.sarangayAncestry,
    },
    granterSourceUuid: dwarf ? u.clanDaggerFeature : u.headGemFeature,
    expected: {
      sourceUuid: dwarf ? u.clanDaggerItem : u.headGemItem,
      quantity: 1,
      itemType: dwarf ? "weapon" : "equipment",
    },
    materializer: "pf2e-native",
    eligibilityKind: "fixed-class-grant",
    resaleRule: "normal",
    eligibilityEvidence: { kind: "fixed-native-profile" },
    nativeGrantChainSourceUuids: dwarf
      ? [u.clanDaggerFeature, u.dwarfAncestry]
      : [u.headGemFeature, u.sarangayAncestry],
  });
}

function preparedEntry(
  line: NonNullable<ReturnType<typeof fixture>["request"]["draft"]["acquisition"]>["lines"][number]
): PreparedAcquisitionEntryV1 {
  return {
    entryId: "entry-1",
    preAggregationKey: "preagg-1",
    lineIds: [line.lineId],
    sourceUuid: line.sourceUuid,
    documentFingerprint: line.documentFingerprint,
    priceFingerprint: line.priceFingerprint,
    quantity: line.price.materializedQuantity,
    stackingIntent: line.stackingIntent,
    funding: line.funding,
    resolvedAllowanceId: null,
    policyDecision: line.policyDecision,
    price: line.price,
    plannedItems: [
      {
        plannedItemId: "planned-1",
        ownedContainerId: null,
        sourceUuid: line.sourceUuid,
        quantity: line.price.materializedQuantity,
        plannedContainerId: null,
      },
    ],
  };
}
