import { describe, expect, it } from "vitest";
import { getCharacterWealthRow } from "../src/wayfinder/domain/character-wealth-policy";
import {
  buildEquipmentPolicyJudgmentFactsFingerprint,
  compareEffectiveEquipmentPolicyMaterial,
  createEquipmentPolicyRequest,
  createEquipmentPolicyResolver,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
  declineEquipmentPolicyRequest,
  type EquipmentPolicyAuthorityPort,
  type EquipmentPolicyJudgmentFacts,
  type EquipmentPolicyJudgmentRecord,
  type EquipmentPolicyResolutionInput,
  evaluateEquipmentItemAuthority,
  normalizeEquipmentPolicyJudgment,
  normalizeEquipmentPolicyJudgmentStore,
  normalizeEquipmentPolicyRequest,
  normalizeEquipmentWorldPolicy,
} from "../src/wayfinder/domain/equipment-policy";

describe("equipment world policy", () => {
  it("normalizes malformed policy while preserving a valid explicit configuration", () => {
    expect(normalizeEquipmentWorldPolicy(null)).toEqual(DEFAULT_EQUIPMENT_WORLD_POLICY);
    expect(
      normalizeEquipmentWorldPolicy({
        version: 1,
        enabledRecipes: [],
        defaultRecipe: "invalid",
        recipeChoiceAuthority: "gm-fixed",
        higherLevelStartAuthority: "actor-owner-attestation",
        blanketRarity: "rare",
        allowedEquipmentPackFamilies: ["BattleZoo", "battlezoo", "pf2e"],
        applyAuthority: "gm-review",
      })
    ).toEqual({
      version: 1,
      enabledRecipes: ["permanent-items", "lump-sum"],
      defaultRecipe: "permanent-items",
      recipeChoiceAuthority: "gm-fixed",
      higherLevelStartAuthority: "actor-owner-attestation",
      blanketRarity: "rare",
      allowedEquipmentPackFamilies: ["battlezoo", "pf2e"],
      applyAuthority: "gm-review",
      recipeDecision: { version: 1 },
    });
  });

  it("guarantees the default recipe belongs to the enabled set", () => {
    expect(
      normalizeEquipmentWorldPolicy({
        ...DEFAULT_EQUIPMENT_WORLD_POLICY,
        enabledRecipes: ["lump-sum"],
        defaultRecipe: "permanent-items",
      })
    ).toMatchObject({ enabledRecipes: ["lump-sum"], defaultRecipe: "lump-sum" });
  });
});

describe("equipment policy requests", () => {
  const facts = {
    kind: "higher-level-start" as const,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 5,
    startKind: "replacement-character" as const,
  };

  it("normalizes pre-0.8.1 requests as open and preserves an attributed decline", () => {
    const legacyJudgment = judgment(facts);
    expect(normalizeEquipmentPolicyJudgmentStore({ version: 1, judgments: [legacyJudgment] })).toEqual({
      version: 1,
      judgments: [legacyJudgment],
      requestDecisions: [],
    });
    const legacy = createEquipmentPolicyRequest({
      requestId: "request-1",
      facts,
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-18T19:00:00.000Z",
      reason: "Replacement character",
    });
    const normalizedLegacy = normalizeEquipmentPolicyRequest(
      Object.fromEntries(Object.entries(legacy).filter(([key]) => key !== "decline"))
    );
    expect(normalizedLegacy?.decline).toBeNull();

    const declined = declineEquipmentPolicyRequest(normalizedLegacy!, {
      declinedByUserId: "gm-1",
      declinedByName: "Game Master",
      declinedAt: "2026-08-18T20:00:00.000Z",
      reason: "Use the standard level-one budget",
    });
    expect(normalizeEquipmentPolicyRequest(declined)).toEqual(declined);
    expect(declined.decline).toEqual({
      declinedByUserId: "gm-1",
      declinedByName: "Game Master",
      declinedAt: "2026-08-18T20:00:00.000Z",
      reason: "Use the standard level-one budget",
    });
  });

  it("fails closed on contradictory or temporally impossible request resolution", () => {
    const request = createEquipmentPolicyRequest({
      requestId: "request-1",
      facts,
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-18T19:00:00.000Z",
      reason: "Replacement character",
    });
    expect(
      normalizeEquipmentPolicyRequest({
        ...request,
        withdrawnAt: "2026-08-18T19:30:00.000Z",
        decline: {
          declinedByUserId: "gm-1",
          declinedByName: "Game Master",
          declinedAt: "2026-08-18T20:00:00.000Z",
          reason: "Declined",
        },
      })
    ).toBeNull();
    expect(() =>
      declineEquipmentPolicyRequest(request, {
        declinedByUserId: "gm-1",
        declinedByName: "Game Master",
        declinedAt: "2026-08-18T18:59:59.000Z",
        reason: "Declined",
      })
    ).toThrow(/cannot predate/i);
  });
});

describe("effective equipment policy", () => {
  it("rejects a judgment envelope that contradicts its exact request facts", () => {
    const valid = judgment({
      kind: "extra-current-level-allowance",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
    });
    expect(normalizeEquipmentPolicyJudgment(valid)).toEqual(valid);
    expect(normalizeEquipmentPolicyJudgment({ ...valid, actorId: "actor-2" })).toBeNull();
    expect(normalizeEquipmentPolicyJudgment({ ...valid, draftId: "draft-2" })).toBeNull();
    expect(normalizeEquipmentPolicyJudgment({ ...valid, targetLevel: 6 })).toBeNull();
  });

  it("resolves every official higher-level wealth row exactly", () => {
    for (let targetLevel = 2; targetLevel <= 20; targetLevel += 1) {
      const row = getCharacterWealthRow(targetLevel);
      const permanent = resolve(policyInput({ targetLevel, selectedRecipe: "permanent-items" }));
      const lump = resolve(policyInput({ targetLevel, selectedRecipe: "lump-sum" }));
      expect(permanent.recipe).toEqual({
        kind: "permanent-items",
        currencyCopper: row.permanentRecipeCurrencyCopper,
        allowances: row.permanentItemAllowances
          .flatMap((bucket) =>
            Array.from({ length: bucket.count }, (_, index) => ({
              allowanceId: `level-${bucket.itemLevel}-${index + 1}`,
              itemLevel: bucket.itemLevel,
            }))
          )
          .sort((left, right) => left.itemLevel - right.itemLevel || left.allowanceId.localeCompare(right.allowanceId)),
      });
      expect(lump.recipe).toEqual({
        kind: "lump-sum",
        budgetCopper: row.lumpSumCopper,
        maxItemLevel: targetLevel - 1,
      });
    }
  });

  it("pins the level-5 permanent-item canary", () => {
    expect(resolve(policyInput()).recipe).toEqual({
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
    });
  });

  it("collapses level 1 to the shared 15 gp result without start evidence", () => {
    const permanent = resolve(policyInput({ targetLevel: 1, selectedRecipe: "permanent-items" }));
    const lump = resolve(policyInput({ targetLevel: 1, selectedRecipe: "lump-sum" }));
    expect(permanent.recipe).toEqual({ kind: "level-1-equivalent", budgetCopper: 1500 });
    expect(lump.recipe).toEqual(permanent.recipe);
    expect(permanent.higherLevelStartEvidence).toEqual({ kind: "not-required" });
  });

  it("requires genuine higher-level authority under either configured mode", () => {
    expect(() => resolve(policyInput(), [])).toThrow(/trusted higher-level-start judgment/i);
    const start = judgment(
      {
        kind: "higher-level-start",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
        startKind: "replacement-character",
      },
      "start-1"
    );
    expect(resolve(policyInput(), [start]).higherLevelStartEvidence).toMatchObject({
      kind: "gm-confirmation",
      judgment: { authorUserId: "gm-1", reason: "Approved campaign start" },
    });
    expect(() =>
      resolve(policyInput(), [
        {
          ...start,
          revocation: {
            revokedByUserId: "gm-2",
            revokedByName: "Other GM",
            revokedAt: "2026-08-18T21:00:00.000Z",
            reason: "Campaign facts changed",
          },
        },
      ])
    ).toThrow(/trusted higher-level-start judgment/i);

    const delegatedInput = policyInput({
      worldPolicy: { ...DEFAULT_EQUIPMENT_WORLD_POLICY, higherLevelStartAuthority: "actor-owner-attestation" },
      higherLevelStartClaim: ownerAttestation(),
    });
    expect(() => resolve(delegatedInput, [], false)).toThrow(/actor-owner attestation/i);
    expect(resolve(delegatedInput, [], true).higherLevelStartEvidence).toMatchObject({
      kind: "actor-owner-attestation",
      authorUserId: "owner-1",
    });
  });

  it("allows only delegated enabled recipe choices", () => {
    expect(resolve(policyInput({ selectedRecipe: "lump-sum" })).recipe.kind).toBe("lump-sum");
    expect(
      resolve(
        policyInput({
          selectedRecipe: "lump-sum",
          worldPolicy: { ...DEFAULT_EQUIPMENT_WORLD_POLICY, recipeChoiceAuthority: "gm-fixed" },
        })
      ).recipe.kind
    ).toBe("permanent-items");
  });

  it("uses trusted exact-fact GM judgments for custom sums and extra allowances", () => {
    const customFacts = {
      kind: "custom-lump-sum",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      amountCopper: 1234,
    } as const;
    const custom = judgment(customFacts, "custom-1");
    const customInput = policyInput({
      selectedRecipe: "lump-sum",
      customLumpSum: { amountCopper: 1234, judgmentId: custom.id },
    });
    expect(resolve(customInput, authorized(customInput, custom)).recipe).toMatchObject({
      kind: "custom-lump-sum",
      budgetCopper: 1234,
      maxItemLevel: 4,
      judgment: { authorUserId: "gm-1", recordedAt: "2026-08-18T20:00:00.000Z" },
    });
    expect(() =>
      resolve(
        { ...customInput, customLumpSum: { amountCopper: 1235, judgmentId: custom.id } },
        authorized(customInput, custom)
      )
    ).toThrow(/trusted custom-lump-sum judgment/i);
    const wrongRecipe = policyInput({ customLumpSum: { amountCopper: 1234, judgmentId: custom.id } });
    expect(() => resolve(wrongRecipe, authorized(wrongRecipe, custom))).toThrow(/effective official lump-sum recipe/i);

    const extra = judgment({
      kind: "extra-current-level-allowance",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
    });
    const extraInput = policyInput({ extraCurrentLevelAllowanceIds: [extra.id] });
    expect(resolve(extraInput, authorized(extraInput, extra)).recipe).toMatchObject({
      kind: "permanent-items",
      allowances: expect.arrayContaining([{ allowanceId: `gm-extra:${extra.id}`, itemLevel: 5 }]),
    });
    expect(() =>
      resolve(
        policyInput({ selectedRecipe: "lump-sum", extraCurrentLevelAllowanceIds: [extra.id] }),
        authorized(extraInput, extra)
      )
    ).toThrow(/permanent-items recipe/i);
    const secondExtra = judgment(
      {
        kind: "extra-current-level-allowance",
        actorId: "actor-1",
        draftId: "draft-1",
        targetLevel: 5,
      },
      "extra-2"
    );
    const multipleExtraInput = policyInput({ extraCurrentLevelAllowanceIds: [extra.id, secondExtra.id] });
    expect(() => resolve(multipleExtraInput, authorized(multipleExtraInput, extra, secondExtra))).toThrow(
      /only one extra current-level/i
    );
  });

  it("binds source and rarity exceptions to exact item facts", () => {
    const facts = {
      kind: "rarity-source-exception",
      actorId: "actor-1",
      draftId: "draft-1",
      targetLevel: 5,
      scope: "source-and-rarity",
      sourceUuid: "Compendium.third.items.Item.one",
      packId: "third.items",
      publicationSlug: "third-book",
      rarity: "unique",
    } as const;
    const exception = judgment(facts, "exception-1");
    const exceptionInput = policyInput({ exceptionJudgmentIds: [exception.id] });
    const policy = resolve(exceptionInput, authorized(exceptionInput, exception));
    expect(
      evaluateEquipmentItemAuthority({
        policy,
        sourceUuid: facts.sourceUuid,
        packId: facts.packId,
        publicationSlug: facts.publicationSlug,
        rarity: facts.rarity,
        hasCharacterAccess: false,
        sourceExceptionJudgmentId: exception.id,
        rarityExceptionJudgmentId: exception.id,
      })
    ).toEqual({ eligible: true, reasons: [] });
    expect(
      evaluateEquipmentItemAuthority({
        policy,
        sourceUuid: "Compendium.third.items.Item.two",
        packId: facts.packId,
        publicationSlug: facts.publicationSlug,
        rarity: facts.rarity,
        hasCharacterAccess: false,
        sourceExceptionJudgmentId: exception.id,
        rarityExceptionJudgmentId: exception.id,
      })
    ).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(["source-not-allowed", "rarity-not-available"]),
    });
  });

  it("distinguishes known, unknown, empty, and unfiltered PF2E sources", () => {
    const filtered = resolve(
      policyInput({
        enabledSourceSlugs: ["player-core"],
        knownSourceSlugs: ["player-core", "gm-core"],
        showUnknownSources: true,
        showEmptySources: false,
      })
    );
    expect(itemEligibility(filtered, "third-book")).toBe(true);
    expect(itemEligibility(filtered, "gm-core")).toBe(false);
    expect(itemEligibility(filtered, "")).toBe(false);

    const unfiltered = resolve(
      policyInput({ enabledSourceSlugs: [], showUnknownSources: false, showEmptySources: false })
    );
    expect(itemEligibility(unfiltered, "")).toBe(true);
    expect(itemEligibility(unfiltered, null)).toBe(true);
  });

  it("fingerprints canonical material and invalidates only selected source drift", () => {
    const reviewed = resolve(policyInput());
    const reordered = resolve(policyInput({ effectivePackIds: ["pf2e.extra", "pf2e.equipment-srd"] }));
    expect(reviewed.fingerprint).not.toBe(reordered.fingerprint);
    expect(compareEffectiveEquipmentPolicyMaterial(reviewed, reordered)).toEqual([]);
    expect(
      compareEffectiveEquipmentPolicyMaterial(reviewed, reordered, [
        { packId: "pf2e.extra", publicationSlug: "player-core" },
      ])
    ).toEqual(["selected-source"]);
  });
});

function policyInput(overrides: Partial<EquipmentPolicyResolutionInput> = {}): EquipmentPolicyResolutionInput {
  return {
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 5,
    worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
    selectedRecipe: "permanent-items",
    effectivePackIds: ["pf2e.equipment-srd"],
    enabledSourceSlugs: ["player-core"],
    knownSourceSlugs: ["player-core"],
    showEmptySources: false,
    showUnknownSources: false,
    abp: { enabled: false, mode: null, actorOverrideDisabled: false },
    higherLevelStartClaim: { kind: "gm-confirmation", judgmentId: "start-1", startKind: "replacement-character" },
    ...overrides,
  };
}

function resolve(input: EquipmentPolicyResolutionInput, records?: EquipmentPolicyJudgmentRecord[], ownerValid = false) {
  const start = judgment(
    {
      kind: "higher-level-start",
      actorId: input.actorId,
      draftId: input.draftId,
      targetLevel: input.targetLevel,
      startKind: "replacement-character",
    },
    "start-1"
  );
  const available = records ?? (input.targetLevel === 1 ? [] : [start]);
  const byId = new Map(available.map((record) => [record.id, record]));
  const authority: EquipmentPolicyAuthorityPort = {
    resolveGmJudgment: (id) => byId.get(id) ?? null,
    verifyOwnerStartAttestation: () => ownerValid,
  };
  return createEquipmentPolicyResolver(authority).resolve(input);
}

function judgment(facts: EquipmentPolicyJudgmentFacts, id = "judgment-1"): EquipmentPolicyJudgmentRecord {
  return {
    id,
    kind: facts.kind,
    actorId: facts.actorId,
    draftId: facts.draftId,
    targetLevel: facts.targetLevel,
    factsFingerprint: buildEquipmentPolicyJudgmentFactsFingerprint(facts),
    authorUserId: "gm-1",
    authorName: "Game Master",
    recordedAt: "2026-08-18T20:00:00.000Z",
    reason: "Approved campaign start",
    request: {
      requestId: `request:${id}`,
      requesterUserId: "owner-1",
      requesterName: "Owner",
      requestedAt: "2026-08-18T19:00:00.000Z",
      reason: "Requested campaign start",
      facts: structuredClone(facts),
    },
    revocation: null,
  };
}

function authorized(input: EquipmentPolicyResolutionInput, ...records: EquipmentPolicyJudgmentRecord[]) {
  return [
    judgment(
      {
        kind: "higher-level-start",
        actorId: input.actorId,
        draftId: input.draftId,
        targetLevel: input.targetLevel,
        startKind: "replacement-character",
      },
      "start-1"
    ),
    ...records,
  ];
}

function ownerAttestation() {
  return {
    kind: "actor-owner-attestation" as const,
    startKind: "replacement-character" as const,
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 5,
    authorUserId: "owner-1",
    authorName: "Owner",
    recordedAt: "2026-08-18T20:00:00.000Z",
    reason: "Replacement character",
  };
}

function itemEligibility(policy: ReturnType<typeof resolve>, publicationSlug: string | null): boolean {
  return evaluateEquipmentItemAuthority({
    policy,
    sourceUuid: "Compendium.pf2e.equipment-srd.Item.one",
    packId: "pf2e.equipment-srd",
    publicationSlug,
    rarity: "common",
    hasCharacterAccess: false,
  }).eligible;
}
