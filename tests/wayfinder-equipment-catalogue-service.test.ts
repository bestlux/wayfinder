import { describe, expect, it, vi } from "vitest";
import {
  createEquipmentAccessRegistry,
  createEquipmentCatalogueDraftContext,
  createEquipmentCatalogueService,
  type EquipmentCatalogueContext,
  type EquipmentCataloguePackLike,
  type EquipmentSourceAccessRecord,
  WF_080_21_DAGGER_UUID,
} from "../src/wayfinder/application/equipment-catalogue-service";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import type { EffectiveEquipmentPolicySnapshotV1 } from "../src/wayfinder/domain/equipment-policy";
import { SEMANTIC_WEALTH_POLICY_REF } from "../src/wayfinder/domain/semantic-wealth-rule-ledger";

const PACK_ID = "pf2e.equipment-srd";
const DAGGER_ID = "rQWaJhI5Bko5x14Z";
const UNCOMMON_ID = "uncommon-item";
const UNCOMMON_UUID = `Compendium.${PACK_ID}.Item.${UNCOMMON_ID}`;

describe("minimal equipment catalogue", () => {
  it("deduplicates in-flight indexes and caches by policy projection until pack invalidation", async () => {
    let releaseIndex: ((entries: readonly unknown[]) => void) | null = null;
    let entries = [dagger()];
    const getIndex = vi.fn(
      () =>
        new Promise<readonly unknown[]>((resolve) => {
          releaseIndex = resolve;
        })
    );
    const service = createEquipmentCatalogueService({
      packs: packMap({ getIndex }),
      equipmentPackIds: [PACK_ID],
    });

    const first = service.project(context());
    const concurrent = service.project(context());
    await vi.waitFor(() => expect(getIndex).toHaveBeenCalledTimes(1));
    releaseIndex?.(entries);
    const [firstProjection, concurrentProjection] = await Promise.all([first, concurrent]);
    expect(concurrentProjection.cacheKey).toBe(firstProjection.cacheKey);

    await service.project(context());
    expect(getIndex).toHaveBeenCalledTimes(1);

    const changedPolicyProjection = await service.project(
      context({ policy: policy({ fingerprint: "equipment-policy-v1-changed" }) })
    );
    expect(changedPolicyProjection.cacheKey).not.toBe(firstProjection.cacheKey);
    expect(getIndex).toHaveBeenCalledTimes(1);

    service.invalidatePack(PACK_ID);
    entries = [dagger({ img: "icons/weapons/daggers/dagger-new.webp" })];
    const invalidated = service.project(context());
    await vi.waitFor(() => expect(getIndex).toHaveBeenCalledTimes(2));
    releaseIndex?.(entries);
    expect((await invalidated).cacheKey).not.toBe(changedPolicyProjection.cacheKey);
  });

  it("retries an index projection invalidated while its pack read is in flight", async () => {
    const indexResolvers: Array<(entries: readonly unknown[]) => void> = [];
    const getIndex = vi.fn(
      () =>
        new Promise<readonly unknown[]>((resolve) => {
          indexResolvers.push(resolve);
        })
    );
    const service = createEquipmentCatalogueService({
      packs: packMap({ getIndex }),
      equipmentPackIds: [PACK_ID],
    });

    const stale = service.project(context());
    await vi.waitFor(() => expect(getIndex).toHaveBeenCalledTimes(1));
    service.invalidatePack(PACK_ID);
    const current = service.project(context());
    await vi.waitFor(() => expect(getIndex).toHaveBeenCalledTimes(2));
    indexResolvers[0]?.([dagger({ img: "icons/weapons/daggers/stale.webp" })]);
    indexResolvers[1]?.([dagger({ img: "icons/weapons/daggers/current.webp" })]);

    expect((await stale).entries[0]?.img).toBe("icons/weapons/daggers/current.webp");
    expect((await current).entries[0]?.img).toBe("icons/weapons/daggers/current.webp");
  });

  it("keeps the frozen Dagger tracer searchable, Common, priced, and available", async () => {
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [dagger()] }),
      equipmentPackIds: [PACK_ID],
    });

    const results = await service.search(context(), {
      query: "dagger finesse",
      itemTypes: ["weapon"],
      maximumLevel: 0,
      availability: "available",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceUuid: WF_080_21_DAGGER_UUID,
      name: "Dagger",
      img: "icons/weapons/daggers/dagger-straight-blue.webp",
      itemType: "weapon",
      level: 0,
      rarity: "common",
      publicationSlug: "pathfinder-player-core",
      price: { kind: "priced", value: { sp: 2 }, copperValue: 20, per: 1, sourceQuantity: 1 },
      traits: ["agile", "finesse", "thrown-10", "versatile-s"],
      ruleKeys: [],
      available: true,
      unavailableReasons: [],
      policyDecision: {
        eligible: true,
        packId: PACK_ID,
        rarityBasis: "common",
        characterAccessRef: null,
      },
    });
  });

  it("keeps unsupported records visible with explicit treasure, container, price, and rule reasons", async () => {
    const service = createEquipmentCatalogueService({
      packs: packMap({
        entries: [
          dagger({ _id: "treasure", name: "Gem", type: "treasure" }),
          dagger({ _id: "kit", name: "Adventurer Kit", type: "kit" }),
          dagger({ _id: "missing-price", name: "Priceless", system: { price: null } }),
          dagger({ _id: "bad-price", name: "Bad Price", system: { price: { value: { gp: -1 } } } }),
          dagger({ _id: "bad-level", name: "Bad Level", system: { level: { value: "unknown" } } }),
          dagger({ _id: "bad-rarity", name: "Bad Rarity", system: { traits: { rarity: "mythic" } } }),
          dagger({ _id: "bad-rules", name: "Bad Rules", system: { rules: null } }),
          dagger({ _id: "book", name: "Unsupported Book", type: "book" }),
          dagger({
            _id: "choice",
            name: "Choice Item",
            system: { rules: [{ key: "ChoiceSet", flag: "selection" }] },
          }),
        ],
      }),
      equipmentPackIds: [PACK_ID],
    });

    const projection = await service.project(context());
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Gem"))).toContain("treasure-excluded");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Adventurer Kit"))).toContain(
      "container-or-kit-excluded"
    );
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Priceless"))).toContain("price-missing");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Price"))).toContain("price-unparseable");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Level"))).toContain("level-unparseable");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Rarity"))).toContain(
      "rarity-unparseable"
    );
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Rules"))).toContain("rules-unparseable");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Unsupported Book"))).toContain(
      "item-type-unsupported"
    );
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Choice Item"))).toContain(
      "interactive-rule-unsupported"
    );
    expect(projection.entries.every((entry) => !entry.available)).toBe(true);
  });

  it("intersects policy packs with the explicit equipment-tab projection", async () => {
    const equipmentIndex = vi.fn(async () => [dagger()]);
    const unrelatedIndex = vi.fn(async () => [dagger({ _id: "not-equipment" })]);
    const unrelatedPackId = "pf2e.feats-srd";
    const packs = new Map<string, EquipmentCataloguePackLike>([
      [PACK_ID, { documentName: "Item", getIndex: equipmentIndex, getDocument: vi.fn(async () => null) }],
      [unrelatedPackId, { documentName: "Item", getIndex: unrelatedIndex, getDocument: vi.fn(async () => null) }],
    ]);
    const service = createEquipmentCatalogueService({ packs, equipmentPackIds: [PACK_ID] });
    const currentPolicy = policy();
    const current = context({
      policy: policy({
        sourcePolicy: {
          ...currentPolicy.sourcePolicy,
          effectivePackIds: [PACK_ID, unrelatedPackId],
        },
      }),
    });

    expect((await service.project(current)).entries.map((entry) => entry.sourceUuid)).toEqual([WF_080_21_DAGGER_UUID]);
    expect(equipmentIndex).toHaveBeenCalledTimes(1);
    expect(unrelatedIndex).not.toHaveBeenCalled();
  });

  it("reuses unchanged equipment-pack indexes when another equipment pack is invalidated", async () => {
    const otherPackId = "pf2e.equipment-extra";
    const primaryIndex = vi.fn(async () => [dagger()]);
    const otherIndex = vi.fn(async () => [dagger({ _id: "other-dagger", name: "Other Dagger" })]);
    const packs = new Map<string, EquipmentCataloguePackLike>([
      [PACK_ID, { documentName: "Item", getIndex: primaryIndex, getDocument: vi.fn(async () => null) }],
      [otherPackId, { documentName: "Item", getIndex: otherIndex, getDocument: vi.fn(async () => null) }],
    ]);
    const service = createEquipmentCatalogueService({
      packs,
      equipmentPackIds: [PACK_ID, otherPackId],
    });
    const currentPolicy = policy();
    const current = context({
      policy: policy({
        sourcePolicy: {
          ...currentPolicy.sourcePolicy,
          effectivePackIds: [PACK_ID, otherPackId],
        },
      }),
    });

    expect((await service.project(current)).entries).toHaveLength(2);
    service.invalidatePack(PACK_ID);
    expect((await service.project(current)).entries).toHaveLength(2);
    expect(primaryIndex).toHaveBeenCalledTimes(2);
    expect(otherIndex).toHaveBeenCalledTimes(1);
  });

  it("hydrates previews lazily, reuses current identity, and drops hydrated detail on pack invalidation", async () => {
    let entries = [dagger()];
    let source = daggerSource();
    const getIndex = vi.fn(async () => entries);
    const getDocument = vi.fn(async () => source);
    const service = createEquipmentCatalogueService({
      packs: packMap({ getIndex, getDocument }),
      equipmentPackIds: [PACK_ID],
    });

    await service.project(context());
    expect(getDocument).not.toHaveBeenCalled();
    const first = await service.hydratePreview(WF_080_21_DAGGER_UUID);
    const cached = await service.hydratePreview(WF_080_21_DAGGER_UUID);
    expect(first?.source).toMatchObject({ name: "Dagger" });
    expect(cached?.previewIdentity).toBe(first?.previewIdentity);
    expect(getDocument).toHaveBeenCalledTimes(1);

    source = daggerSource({ system: { description: { value: "Current compendium detail" } } });
    service.invalidatePack(PACK_ID);
    await service.project(context());
    const sameIndexIdentity = await service.hydratePreview(WF_080_21_DAGGER_UUID);
    expect(sameIndexIdentity?.previewIdentity).toBe(first?.previewIdentity);
    expect(sameIndexIdentity?.source).toMatchObject({
      system: { description: { value: "Current compendium detail" } },
    });
    expect(getDocument).toHaveBeenCalledTimes(2);

    entries = [dagger({ img: "icons/weapons/daggers/dagger-new.webp" })];
    service.invalidatePack(PACK_ID);
    await service.project(context());
    const changed = await service.hydratePreview(WF_080_21_DAGGER_UUID);
    expect(changed?.previewIdentity).not.toBe(first?.previewIdentity);
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it("deduplicates concurrent preview reads and quarantines an invalidated request that resolves late", async () => {
    const documentResolvers: Array<(document: unknown) => void> = [];
    const getDocument = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          documentResolvers.push(resolve);
        })
    );
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [dagger()], getDocument }),
      equipmentPackIds: [PACK_ID],
    });
    await service.project(context());

    const first = service.hydratePreview(WF_080_21_DAGGER_UUID);
    const concurrent = service.hydratePreview(WF_080_21_DAGGER_UUID);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    documentResolvers[0]?.(daggerSource({ system: { description: { value: "Initial" } } }));
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
    expect(firstResult?.source).toMatchObject({ system: { description: { value: "Initial" } } });
    expect(concurrentResult?.source).toEqual(firstResult?.source);

    service.invalidatePack(PACK_ID);
    await service.project(context());
    const stale = service.hydratePreview(WF_080_21_DAGGER_UUID);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));

    service.invalidatePack(PACK_ID);
    await service.project(context());
    const current = service.hydratePreview(WF_080_21_DAGGER_UUID);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(3));
    documentResolvers[2]?.(daggerSource({ system: { description: { value: "Current" } } }));
    expect((await current)?.source).toMatchObject({ system: { description: { value: "Current" } } });

    documentResolvers[1]?.(daggerSource({ system: { description: { value: "Stale" } } }));
    expect((await stale)?.source).toMatchObject({ system: { description: { value: "Current" } } });
    expect((await service.hydratePreview(WF_080_21_DAGGER_UUID))?.source).toMatchObject({
      system: { description: { value: "Current" } },
    });
    expect(getDocument).toHaveBeenCalledTimes(3);
  });

  it("fails restricted items closed unless an exact registered Access profile resolves current facts", async () => {
    const entries = [dagger(), uncommonItem()];
    const unregistered = createEquipmentCatalogueService({
      packs: packMap({ entries }),
      equipmentPackIds: [PACK_ID],
    });
    const unavailable = (await unregistered.project(context())).entries.find(
      (entry) => entry.sourceUuid === UNCOMMON_UUID
    );
    expect(unavailable).toMatchObject({ available: false, policyDecision: { characterAccessRef: null } });
    expect(reasonCodes(unavailable)).toContain("rarity-not-available");

    const resolveAccess = vi.fn((input: Parameters<EquipmentSourceAccessRecord["resolve"]>[0]) => {
      return (
        (input.actor as { id?: string }).id === "actor-1" &&
        input.draft.draftId === "draft-1" &&
        input.draft.targetLevel === 1 &&
        input.draft.version === 4 &&
        Object.isFrozen(input.draft.accessFacts) &&
        (input.draft.accessFacts.selections as { ancestry?: { uuid?: string } }).ancestry?.uuid ===
          "Compendium.pf2e.ancestries.Item.ancestry" &&
        input.candidate.sourceUuid === UNCOMMON_UUID &&
        input.candidate.rarity === "uncommon"
      );
    });
    const accessRegistry = createEquipmentAccessRegistry([
      {
        sourceUuid: UNCOMMON_UUID,
        accessRef: "feature:ancestral-weapon-access",
        profileVersion: "1",
        resolve: resolveAccess,
      },
    ]);
    const registered = createEquipmentCatalogueService({
      packs: packMap({ entries, getDocument: vi.fn(async () => uncommonSource()) }),
      equipmentPackIds: [PACK_ID],
      accessRegistry,
    });
    const projection = await registered.project(context());
    const common = projection.entries.find((entry) => entry.sourceUuid === WF_080_21_DAGGER_UUID);
    const restricted = projection.entries.find((entry) => entry.sourceUuid === UNCOMMON_UUID);
    expect(common?.policyDecision.characterAccessRef).toBeNull();
    expect(restricted).toMatchObject({
      available: false,
      policyDecision: {
        eligible: false,
        characterAccessRef: null,
      },
    });
    expect(resolveAccess).not.toHaveBeenCalled();
    const preview = await registered.hydratePreview(UNCOMMON_UUID, context());
    expect(preview?.entry).toMatchObject({
      available: true,
      policyDecision: { characterAccessRef: "feature:ancestral-weapon-access" },
    });
    expect(resolveAccess).toHaveBeenCalledTimes(1);
    expect(resolveAccess.mock.calls[0]?.[0].source).toMatchObject({ name: "Ancestral Blade" });

    const blanketContext = context({ policy: policy({ rarityPolicy: { blanketCeiling: "uncommon" } }) });
    const blanketEntry = (await registered.project(blanketContext)).entries.find(
      (entry) => entry.sourceUuid === UNCOMMON_UUID
    );
    expect(blanketEntry).toMatchObject({
      available: true,
      policyDecision: { rarityBasis: "blanket-uncommon", characterAccessRef: null },
    });
    expect((await registered.hydratePreview(UNCOMMON_UUID, blanketContext))?.entry?.policyDecision).toMatchObject({
      characterAccessRef: null,
    });
    expect(resolveAccess).toHaveBeenCalledTimes(1);

    expect(() =>
      createEquipmentAccessRegistry([
        {
          sourceUuid: UNCOMMON_UUID,
          accessRef: "duplicate-1",
          profileVersion: "1",
          resolve: () => true,
        },
        {
          sourceUuid: UNCOMMON_UUID,
          accessRef: "duplicate-2",
          profileVersion: "1",
          resolve: () => true,
        },
      ])
    ).toThrow(/more than once/i);
  });

  it("force-hydrates Apply resolution and surfaces stable document and price fingerprint drift", async () => {
    let source = uncommonSource();
    const getDocument = vi.fn(async () => source);
    const accessRegistry = createEquipmentAccessRegistry([
      {
        sourceUuid: UNCOMMON_UUID,
        accessRef: "feature:ancestral-weapon-access",
        profileVersion: "1",
        resolve: ({ actor, draft, candidate, source: currentSource }) =>
          (actor as { id?: string }).id === "actor-1" &&
          draft.draftId === "draft-1" &&
          candidate.sourceUuid === UNCOMMON_UUID &&
          currentSource?.name === "Ancestral Blade",
      },
    ]);
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [uncommonItem()], getDocument }),
      equipmentPackIds: [PACK_ID],
      accessRegistry,
    });

    const first = await service.resolveForApply(context(), UNCOMMON_UUID);
    const unchanged = await service.resolveForApply(context(), UNCOMMON_UUID);
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(unchanged.documentFingerprint).toBe(first.documentFingerprint);
    expect(unchanged.priceFingerprint).toBe(first.priceFingerprint);
    expect(first).toMatchObject({
      source: { name: "Ancestral Blade" },
      available: true,
      policyDecision: { characterAccessRef: "feature:ancestral-weapon-access" },
    });

    source = uncommonSource({ system: { price: { value: { sp: 3 } } } });
    const drifted = await service.resolveForApply(context(), UNCOMMON_UUID);
    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(drifted.documentFingerprint).not.toBe(first.documentFingerprint);
    expect(drifted.priceFingerprint).not.toBe(first.priceFingerprint);
    expect(drifted.candidate.price).toMatchObject({ value: { sp: 3 }, copperValue: 30 });
  });
});

function packMap(options: {
  readonly entries?: readonly unknown[];
  readonly getIndex?: EquipmentCataloguePackLike["getIndex"];
  readonly getDocument?: EquipmentCataloguePackLike["getDocument"];
}): ReadonlyMap<string, EquipmentCataloguePackLike> {
  const getIndex = options.getIndex ?? vi.fn(async () => options.entries ?? []);
  const getDocument = options.getDocument ?? vi.fn(async () => null);
  return new Map([[PACK_ID, { documentName: "Item", getIndex, getDocument }]]);
}

function context(overrides: Partial<EquipmentCatalogueContext> = {}): EquipmentCatalogueContext {
  return {
    actor: { id: "actor-1" },
    draft: createEquipmentCatalogueDraftContext({
      draftId: "draft-1",
      targetLevel: 1,
      version: 4,
      accessFacts: {
        selections: { ancestry: { uuid: "Compendium.pf2e.ancestries.Item.ancestry" } },
        branchSelections: {},
        classChoices: {},
        singletonChoices: {},
      },
    }),
    policy: policy(),
    ...overrides,
  };
}

function policy(overrides: Partial<EffectiveEquipmentPolicySnapshotV1> = {}): EffectiveEquipmentPolicySnapshotV1 {
  return {
    version: 1,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 1,
    rules: {
      wealth: CHARACTER_WEALTH_POLICY_REF,
      semantics: SEMANTIC_WEALTH_POLICY_REF,
    },
    recipe: { kind: "level-1-equivalent", budgetCopper: 1500 },
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
    abp: { enabled: false, mode: null, actorOverrideDisabled: false },
    gmJudgments: [],
    fingerprint: "equipment-policy-v1-test",
    explanations: [],
    ...overrides,
  };
}

function dagger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const system = mergeSystem(daggerSystem(), overrides.system);
  return {
    _id: DAGGER_ID,
    name: "Dagger",
    img: "icons/weapons/daggers/dagger-straight-blue.webp",
    type: "weapon",
    ...overrides,
    system,
  };
}

function daggerSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return dagger(overrides);
}

function uncommonItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const system = mergeSystem(daggerSystem(), {
    traits: { rarity: "uncommon", value: ["finesse"] },
    ...record(overrides.system),
  });
  return {
    _id: UNCOMMON_ID,
    name: "Ancestral Blade",
    img: "icons/weapons/swords/sword-guard.webp",
    type: "weapon",
    ...overrides,
    system,
  };
}

function uncommonSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return uncommonItem(overrides);
}

function daggerSystem(): Record<string, unknown> {
  return {
    level: { value: 0 },
    traits: { rarity: "common", value: ["agile", "finesse", "thrown-10", "versatile-s"] },
    publication: { title: "Pathfinder Player Core" },
    price: { value: { sp: 2 } },
    quantity: 1,
    rules: [],
  };
}

function mergeSystem(base: Record<string, unknown>, override: unknown): Record<string, unknown> {
  const patch = record(override);
  return {
    ...base,
    ...patch,
    level: { ...record(base.level), ...record(patch.level) },
    traits: { ...record(base.traits), ...record(patch.traits) },
    publication: { ...record(base.publication), ...record(patch.publication) },
    price: patch.price === undefined ? base.price : patch.price,
  };
}

function reasonCodes(
  entry:
    | {
        readonly unavailableReasons: readonly { readonly code: string }[];
      }
    | undefined
): string[] {
  return entry?.unavailableReasons.map((reason) => reason.code) ?? [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
