import { describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../src/draft-service";
import {
  createEquipmentAcquisitionRuntime,
  type EquipmentAcquisitionRuntime,
} from "../src/wayfinder/application/equipment-acquisition-runtime-service";
import type { EquipmentCataloguePackLike } from "../src/wayfinder/application/equipment-catalogue-service";
import {
  createAcquisitionDraft,
  createAcquisitionPolicySnapshot,
  recordPlannedClassGrants,
} from "../src/wayfinder/domain/acquisition-draft";
import type { PreparedAcquisitionEntryV1 } from "../src/wayfinder/domain/acquisition-identity";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
} from "../src/wayfinder/domain/class-grant-reconciliation";
import type { EffectiveEquipmentPolicySnapshotV1 } from "../src/wayfinder/domain/equipment-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

const PACK_ID = "pf2e.equipment-srd";
const DAGGER_ID = "rQWaJhI5Bko5x14Z";
const DAGGER_UUID = `Compendium.${PACK_ID}.Item.${DAGGER_ID}`;
const FORMULA_BOOK_ID = "qCEOZ6109Yo34tRx";

describe("equipment acquisition runtime", () => {
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
    expect(getDocument).toHaveBeenCalledTimes(1);
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

  it("fails closed for non-level-zero and configured material sources", async () => {
    const leveled = fixture({
      getIndex: vi.fn(async () => [dagger({ level: 1 })]),
      getDocument: vi.fn(async () => document(dagger({ level: 1 }))),
    });
    await expect(
      leveled.runtime.uiAdapter.prepareLine({ ...leveled.request, sourceUuid: DAGGER_UUID })
    ).rejects.toThrow(/level-0/i);

    const material = dagger({ materialType: "cold-iron" });
    const configured = fixture({
      getIndex: vi.fn(async () => [material]),
      getDocument: vi.fn(async () => document(material)),
    });
    await expect(
      configured.runtime.uiAdapter.prepareLine({ ...configured.request, sourceUuid: DAGGER_UUID })
    ).rejects.toThrow(/precious-material|graded/i);
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

    currentSource = formulaBook({ priceSp: 2 });
    await expect(
      runtime.prepareNativeClassGrantLines({
        ...nativeRequest,
        acquisition: request.draft.acquisition,
      })
    ).rejects.toThrow(/source material drifted/i);
    expect(getDocument).toHaveBeenCalledTimes(3);
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

function fixture(pack: Pick<EquipmentCataloguePackLike, "getIndex" | "getDocument">): {
  runtime: EquipmentAcquisitionRuntime;
  request: Parameters<EquipmentAcquisitionRuntime["uiAdapter"]["project"]>[0];
} {
  const currentPolicy = policy();
  const acquisition = {
    ...createAcquisitionDraft({
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
    }),
    policySnapshot: createAcquisitionPolicySnapshot(currentPolicy, { kind: "permanent-items" }),
  };
  const draft = createEmptyDraft(1);
  draft.acquisition = acquisition;
  const packs = new Map<string, EquipmentCataloguePackLike>([
    [PACK_ID, { documentName: "Item", getIndex: pack.getIndex, getDocument: pack.getDocument }],
  ]);
  return {
    runtime: createEquipmentAcquisitionRuntime({
      packs,
      resolveEffectivePolicy: () => currentPolicy,
      mintLineId: () => "wf-line-test",
    }),
    request: {
      actor: { id: "actor-1" },
      draft,
      step: {
        id: "starting-equipment-level-1",
        slotId: "starting-equipment-level-1",
        kind: "starting-equipment",
        slotKind: "starting-equipment",
        level: 1,
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

function dagger(
  options: { readonly priceSp?: number; readonly level?: number; readonly materialType?: string | null } = {}
) {
  return {
    _id: DAGGER_ID,
    name: "Dagger",
    img: "icons/weapons/daggers/dagger-straight-blue.webp",
    type: "weapon",
    system: {
      level: { value: options.level ?? 0 },
      traits: { rarity: "common", value: ["agile", "finesse"] },
      publication: { title: "Pathfinder Player Core" },
      price: { value: { sp: options.priceSp ?? 2 } },
      quantity: 1,
      rules: [],
      size: "med",
      material: { type: options.materialType ?? null, grade: null },
    },
  };
}

function document(source: ReturnType<typeof dagger>) {
  return { toObject: () => structuredClone(source) };
}

function formulaBook(options: { readonly id?: string; readonly priceSp?: number } = {}) {
  return {
    _id: options.id ?? FORMULA_BOOK_ID,
    name: "Formula Book",
    img: "icons/sundries/books/book-embossed-gold-red.webp",
    type: "equipment",
    _stats: { compendiumSource: CLASS_GRANT_PROFILE_UUIDS.formulaBookItem },
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
