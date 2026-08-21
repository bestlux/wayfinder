import { describe, expect, it, vi } from "vitest";
import {
  ADVENTURERS_PACK_UUID,
  createEquipmentAccessRegistry,
  createEquipmentCatalogueDraftContext,
  createEquipmentCatalogueService,
  type EquipmentCatalogueContext,
  type EquipmentCataloguePackLike,
  type EquipmentSourceAccessRecord,
  WF_080_21_DAGGER_UUID,
} from "../src/wayfinder/application/equipment-catalogue-service";
import { CHARACTER_WEALTH_POLICY_REF } from "../src/wayfinder/domain/character-wealth-policy";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentPolicyJudgmentRecord,
} from "../src/wayfinder/domain/equipment-policy";
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

  it.each([
    "ammo",
    "armor",
    "backpack",
    "consumable",
    "equipment",
    "shield",
    "weapon",
  ])("qualifies %s records with price.per and source quantity", async (itemType) => {
    const source = dagger({
      _id: `physical-${itemType}`,
      name: `Physical ${itemType}`,
      type: itemType,
      system: { price: { value: { cp: 10 }, per: 10 }, quantity: 12 },
    });
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [source] }),
      equipmentPackIds: [PACK_ID],
    });

    expect((await service.project(context())).entries[0]).toMatchObject({
      itemType,
      available: true,
      unavailableReasons: [],
      price: { kind: "priced", value: { cp: 10 }, copperValue: 10, per: 10, sourceQuantity: 12 },
    });
  });

  it("qualifies only the exact Adventurer's Pack kit profile and leaves adjacent kits unavailable", async () => {
    const service = createEquipmentCatalogueService({
      packs: packMap({
        entries: [
          {
            _id: ADVENTURERS_PACK_UUID.split(".").at(-1),
            name: "Adventurer's Pack",
            type: "kit",
            system: {
              slug: "adventurers-pack",
              price: { value: { sp: 15 } },
              publication: { title: "Pathfinder Player Core" },
              rules: [],
            },
          },
          {
            _id: "YQLWR9cCXQY5xaaG",
            name: "Cartographer's Kit",
            type: "kit",
            system: { slug: "cartographers-kit", price: { value: { gp: 3 } }, rules: [] },
          },
        ],
      }),
      equipmentPackIds: [PACK_ID],
    });

    const projection = await service.project(context());
    expect(projection.entries.find((entry) => entry.sourceUuid === ADVENTURERS_PACK_UUID)).toMatchObject({
      available: true,
      level: 0,
      rarity: "common",
      price: { copperValue: 150 },
      unavailableReasons: [],
    });
    const cartographersKit = projection.entries.find((entry) => entry.name === "Cartographer's Kit");
    expect(cartographersKit?.available).toBe(false);
    expect(reasonCodes(cartographersKit)).toContain("container-or-kit-excluded");
  });

  it("keeps explicit zero purchasable and diagnoses malformed unit pricing", async () => {
    const service = createEquipmentCatalogueService({
      packs: packMap({
        entries: [
          dagger({ _id: "explicit-zero", name: "Free Item", system: { price: { value: { gp: 0 } } } }),
          dagger({ _id: "bad-per", name: "Bad Per", system: { price: { value: { gp: 1 }, per: 0 } } }),
          dagger({ _id: "bad-quantity", name: "Bad Quantity", system: { quantity: 0 } }),
        ],
      }),
      equipmentPackIds: [PACK_ID],
    });

    const projection = await service.project(context());
    expect(projection.entries.find((entry) => entry.name === "Free Item")).toMatchObject({
      available: true,
      unavailableReasons: [],
      price: { kind: "priced", copperValue: 0 },
    });
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Per"))).toContain("price-unparseable");
    expect(reasonCodes(projection.entries.find((entry) => entry.name === "Bad Quantity"))).toContain(
      "price-unparseable"
    );
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

  it("returns stable typed diagnostics for unreadable packs and indexes", async () => {
    const missingPackId = "broken.missing";
    const journalPackId = "broken.journals";
    const failedPackId = "broken.failed";
    const corruptPackId = "broken.corrupt";
    const packs = new Map<string, EquipmentCataloguePackLike>([
      [
        journalPackId,
        {
          documentName: "JournalEntry",
          getIndex: vi.fn(async () => []),
          getDocument: vi.fn(async () => null),
        },
      ],
      [
        failedPackId,
        {
          documentName: "Item",
          getIndex: vi.fn(async () => {
            throw new Error("unstable raw exception text");
          }),
          getDocument: vi.fn(async () => null),
        },
      ],
      [
        corruptPackId,
        {
          documentName: "Item",
          getIndex: vi.fn(async () => null),
          getDocument: vi.fn(async () => null),
        },
      ],
    ]);
    const equipmentPackIds = [missingPackId, journalPackId, failedPackId, corruptPackId].sort();
    const service = createEquipmentCatalogueService({ packs, equipmentPackIds });
    const currentPolicy = policy();
    const projection = await service.project(
      context({
        policy: policy({
          sourcePolicy: { ...currentPolicy.sourcePolicy, effectivePackIds: equipmentPackIds },
        }),
      })
    );

    expect(projection.entries).toEqual([]);
    expect(projection.diagnostics.map(({ code, packId }) => ({ code, packId }))).toEqual([
      { code: "equipment-pack-index-corrupt", packId: corruptPackId },
      { code: "equipment-pack-index-failed", packId: failedPackId },
      { code: "equipment-pack-not-item", packId: journalPackId },
      { code: "equipment-pack-missing", packId: missingPackId },
    ]);
    expect(projection.diagnostics.map((diagnostic) => diagnostic.message).join(" ")).not.toContain(
      "unstable raw exception text"
    );
  });

  it("skips corrupt and duplicate source identities with deterministic diagnostics", async () => {
    const service = createEquipmentCatalogueService({
      packs: packMap({
        entries: [
          dagger(),
          dagger({ name: "Duplicate Dagger" }),
          dagger({ _id: "contradiction", uuid: `Compendium.${PACK_ID}.Item.other-id` }),
          { name: "Missing Identity", type: "weapon", system: daggerSystem() },
        ],
      }),
      equipmentPackIds: [PACK_ID],
    });

    const projection = await service.project(context());
    expect(projection.entries.map((entry) => entry.name)).toEqual(["Dagger"]);
    expect(projection.diagnostics.map(({ code, sourceIdentity }) => ({ code, sourceIdentity }))).toEqual([
      {
        code: "equipment-source-identity-corrupt",
        sourceIdentity: `Compendium.${PACK_ID}.Item.other-id`,
      },
      { code: "duplicate-equipment-source-identity", sourceIdentity: WF_080_21_DAGGER_UUID },
      { code: "equipment-source-identity-corrupt", sourceIdentity: `${PACK_ID}#index-3` },
    ]);
  });

  it("retries a transient equipment index failure without retaining raw exception state", async () => {
    const getIndex = vi
      .fn<EquipmentCataloguePackLike["getIndex"]>()
      .mockRejectedValueOnce(new Error("temporary backend detail"))
      .mockResolvedValueOnce([dagger()]);
    const service = createEquipmentCatalogueService({
      packs: packMap({ getIndex }),
      equipmentPackIds: [PACK_ID],
    });

    expect((await service.project(context())).diagnostics).toMatchObject([
      { code: "equipment-pack-index-failed", packId: PACK_ID },
    ]);
    expect((await service.project(context())).entries.map((entry) => entry.name)).toEqual(["Dagger"]);
    expect(getIndex).toHaveBeenCalledTimes(2);
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

  it("automatically applies only an exact dormant GM item exception", async () => {
    const facts = {
      kind: "rarity-source-exception" as const,
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 1,
      scope: "rarity" as const,
      sourceUuid: UNCOMMON_UUID,
      packId: PACK_ID,
      publicationSlug: "pathfinder-player-core",
      rarity: "uncommon" as const,
    };
    const exception: EquipmentPolicyJudgmentRecord = {
      id: "exception-1",
      kind: facts.kind,
      actorId: facts.actorId,
      draftId: facts.draftId,
      targetLevel: facts.targetLevel,
      factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
      authorUserId: "gm-1",
      authorName: "GM",
      recordedAt: "2026-08-20T20:00:00.000Z",
      reason: "Approved exact uncommon item",
      request: {
        requestId: "request-1",
        requesterUserId: "owner-1",
        requesterName: "Owner",
        requestedAt: "2026-08-20T19:00:00.000Z",
        reason: "Requested exact uncommon item",
        facts,
      },
      revocation: null,
    };
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [uncommonItem(), uncommonItem({ _id: "adjacent" })] }),
      equipmentPackIds: [PACK_ID],
    });
    const projection = await service.project(context({ policy: policy({ gmJudgments: [exception] }) }));
    expect(projection.entries.find((entry) => entry.sourceUuid === UNCOMMON_UUID)).toMatchObject({
      available: true,
      policyDecision: {
        rarityBasis: "gm-rarity-exception",
        rarityExceptionJudgmentId: exception.id,
      },
    });
    expect(projection.entries.find((entry) => entry.sourceUuid.endsWith(".adjacent"))).toMatchObject({
      available: false,
      policyDecision: { rarityExceptionJudgmentId: null },
    });
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

  it("concurrently hydrates a visible page, restores request order, and matches fresh single-source resolution", async () => {
    const sources = new Map([
      [DAGGER_ID, daggerSource()],
      [UNCOMMON_ID, uncommonSource()],
    ]);
    const resolvers = new Map<string, (document: unknown) => void>();
    const getDocument = vi.fn(
      (documentId: string) =>
        new Promise<unknown>((resolve) => {
          resolvers.set(documentId, resolve);
        })
    );
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [...sources.values()], getDocument }),
      equipmentPackIds: [PACK_ID],
    });

    const concurrent = service.resolveManyForBrowse(context(), [WF_080_21_DAGGER_UUID, UNCOMMON_UUID]);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));
    resolvers.get(UNCOMMON_ID)?.(uncommonSource());
    resolvers.get(DAGGER_ID)?.(daggerSource());
    const results = await concurrent;
    getDocument.mockImplementation(async (documentId: string) => sources.get(documentId) ?? null);
    const singles = await Promise.all([
      service.resolveForApply(context(), WF_080_21_DAGGER_UUID),
      service.resolveForApply(context(), UNCOMMON_UUID),
    ]);

    expect(getDocument).toHaveBeenCalledTimes(4);
    expect(getDocument.mock.calls.map(([documentId]) => documentId)).toEqual([
      DAGGER_ID,
      UNCOMMON_ID,
      DAGGER_ID,
      UNCOMMON_ID,
    ]);
    expect(results.map(({ sourceUuid }) => sourceUuid)).toEqual([WF_080_21_DAGGER_UUID, UNCOMMON_UUID]);
    expect(results.map(({ resolution }) => resolution)).toEqual(singles);
    expect(results.every(({ error }) => error === null)).toBe(true);
  });

  it("force-refreshes and repairs a stale pack cache after invalidated concurrent browse reads", async () => {
    let resolveOld!: (document: unknown) => void;
    let cachedDocument: unknown = null;
    const getDocument = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveOld = (document) => {
            cachedDocument = document;
            resolve(document);
          };
        })
    );
    const freshDocument = daggerSource({ system: { price: { value: { sp: 3 } } } });
    const getDocuments = vi.fn(async () => [freshDocument]);
    const set = vi.fn((_documentId: string, document: unknown) => {
      cachedDocument = document;
    });
    const deleteDocument = vi.fn(() => {
      cachedDocument = null;
    });
    const service = createEquipmentCatalogueService({
      packs: new Map([
        [
          PACK_ID,
          {
            documentName: "Item",
            getIndex: vi.fn(async () => [dagger()]),
            getDocument,
            getDocuments,
            set,
            delete: deleteDocument,
          },
        ],
      ]),
      equipmentPackIds: [PACK_ID],
    });

    const pending = service.resolveManyForBrowse(context(), [WF_080_21_DAGGER_UUID]);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
    service.invalidatePack(PACK_ID);
    resolveOld(daggerSource({ system: { price: { value: { sp: 2 } } } }));

    await expect(pending).resolves.toMatchObject([
      { sourceUuid: WF_080_21_DAGGER_UUID, resolution: { candidate: { price: { copperValue: 30 } } }, error: null },
    ]);
    expect(getDocument).toHaveBeenCalledOnce();
    expect(getDocuments).toHaveBeenCalledWith({ _id: DAGGER_ID });
    expect(set).toHaveBeenCalledWith(DAGGER_ID, freshDocument);
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(cachedDocument).toBe(freshDocument);
  });

  it("evicts a deleted source repopulated by an invalidated concurrent browse read", async () => {
    let resolveOld!: (document: unknown) => void;
    let cachedDocument: unknown = null;
    const getDocument = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveOld = (document) => {
            cachedDocument = document;
            resolve(document);
          };
        })
    );
    const getDocuments = vi.fn(async () => []);
    const set = vi.fn();
    const deleteDocument = vi.fn(() => {
      cachedDocument = null;
    });
    const service = createEquipmentCatalogueService({
      packs: new Map([
        [
          PACK_ID,
          {
            documentName: "Item",
            getIndex: vi.fn(async () => [dagger()]),
            getDocument,
            getDocuments,
            set,
            delete: deleteDocument,
          },
        ],
      ]),
      equipmentPackIds: [PACK_ID],
    });

    const pending = service.resolveManyForBrowse(context(), [WF_080_21_DAGGER_UUID]);
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
    service.invalidatePack(PACK_ID);
    resolveOld(daggerSource());

    await expect(pending).resolves.toMatchObject([
      { sourceUuid: WF_080_21_DAGGER_UUID, resolution: null, error: { message: expect.stringMatching(/no longer/) } },
    ]);
    expect(getDocuments).toHaveBeenCalledWith({ _id: DAGGER_ID });
    expect(deleteDocument).toHaveBeenCalledWith(DAGGER_ID);
    expect(set).not.toHaveBeenCalled();
    expect(cachedDocument).toBeNull();
  });

  it("preserves successful entries beside exact missing and corrupt concurrent diagnostics", async () => {
    const corrupt = { id: UNCOMMON_ID, toObject: () => null };
    const missingUuid = `Compendium.${PACK_ID}.Item.missing-item`;
    const getDocument = vi.fn(async (documentId: string) => {
      if (documentId === DAGGER_ID) return daggerSource();
      if (documentId === UNCOMMON_ID) return corrupt;
      return null;
    });
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [dagger(), uncommonItem()], getDocument }),
      equipmentPackIds: [PACK_ID],
    });

    const results = await service.resolveManyForBrowse(context(), [WF_080_21_DAGGER_UUID, UNCOMMON_UUID, missingUuid]);

    expect(getDocument).toHaveBeenCalledTimes(3);
    expect(results[0]).toMatchObject({ sourceUuid: WF_080_21_DAGGER_UUID, error: null });
    expect(results[0]?.resolution?.source).toMatchObject({ _id: DAGGER_ID });
    expect(results[1]?.resolution).toBeNull();
    expect(results[1]?.error?.message).toContain(UNCOMMON_UUID);
    expect(results[1]?.error?.message).toMatch(/malformed|serializable/i);
    expect(results[2]?.resolution).toBeNull();
    expect(results[2]?.error?.message).toBe(`Equipment source ${missingUuid} is no longer available.`);
  });

  it("issues one concurrent read per source across packs while retaining interleaved source order", async () => {
    const otherPackId = "supplemental.equipment";
    const otherIds = ["other-a", "other-b"] as const;
    const otherUuids = otherIds.map((id) => `Compendium.${otherPackId}.Item.${id}`);
    const primaryGetDocument = vi.fn(async () => daggerSource());
    const otherGetDocument = vi.fn(async (documentId: string) =>
      daggerSource({ _id: documentId, name: documentId === otherIds[0] ? "Other A" : "Other B" })
    );
    const packs = new Map<string, EquipmentCataloguePackLike>([
      [PACK_ID, { documentName: "Item", getIndex: vi.fn(async () => []), getDocument: primaryGetDocument }],
      [otherPackId, { documentName: "Item", getIndex: vi.fn(async () => []), getDocument: otherGetDocument }],
    ]);
    const service = createEquipmentCatalogueService({ packs, equipmentPackIds: [PACK_ID, otherPackId] });
    const current = context({
      policy: policy({
        sourcePolicy: { ...policy().sourcePolicy, effectivePackIds: [PACK_ID, otherPackId] },
      }),
    });

    const results = await service.resolveManyForBrowse(current, [
      otherUuids[0]!,
      WF_080_21_DAGGER_UUID,
      otherUuids[1]!,
    ]);

    expect(primaryGetDocument).toHaveBeenCalledOnce();
    expect(otherGetDocument.mock.calls.map(([documentId]) => documentId)).toEqual(otherIds);
    expect(results.map(({ sourceUuid }) => sourceUuid)).toEqual([otherUuids[0], WF_080_21_DAGGER_UUID, otherUuids[1]]);
    expect(results.map(({ resolution }) => resolution?.candidate.name)).toEqual(["Other A", "Dagger", "Other B"]);
  });

  it("requires exact fixed-native source and pack authority outside the effective catalogue", async () => {
    const source = uncommonSource();
    const service = createEquipmentCatalogueService({
      packs: packMap({ entries: [uncommonItem()], getDocument: vi.fn(async () => source) }),
      equipmentPackIds: [],
    });
    const excludedContext = context({
      policy: policy({
        sourcePolicy: { ...policy().sourcePolicy, effectivePackIds: [] },
      }),
    });

    await expect(service.resolveForApply(excludedContext, UNCOMMON_UUID)).rejects.toThrow(/effective pack set/i);
    await expect(
      service.resolveFixedNativeSourceForApply(excludedContext, UNCOMMON_UUID, {
        kind: "fixed-native-grant",
        expectedSourceUuid: WF_080_21_DAGGER_UUID,
        expectedPackId: PACK_ID,
      })
    ).rejects.toThrow(/exact source authority/i);
    await expect(
      service.resolveFixedNativeSourceForApply(excludedContext, UNCOMMON_UUID, {
        kind: "fixed-native-grant",
        expectedSourceUuid: UNCOMMON_UUID,
        expectedPackId: "pf2e.wrong-pack",
      })
    ).rejects.toThrow(/exact pack authority/i);

    await expect(
      service.resolveFixedNativeSourceForApply(excludedContext, UNCOMMON_UUID, {
        kind: "fixed-native-grant",
        expectedSourceUuid: UNCOMMON_UUID,
        expectedPackId: PACK_ID,
      })
    ).resolves.toMatchObject({
      source: { _id: UNCOMMON_ID },
      available: false,
      policyDecision: { eligible: false, sourceBasis: "source-not-allowed" },
    });
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
