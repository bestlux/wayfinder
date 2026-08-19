import { describe, expect, it, vi } from "vitest";
import { MODULE_ID, SETTINGS } from "../src/constants";
import { createEmptyDraft } from "../src/draft-service";
import type { PendingStep } from "../src/types";
import {
  captureObservedClassGrantItems,
  prepareCurrentClassGrantPlan,
  projectCurrentClassGrants,
  projectPlannedClassGrants,
} from "../src/wayfinder/application/class-grant-projection-service";
import { createAcquisitionPolicySnapshot } from "../src/wayfinder/domain/acquisition-draft";
import type { AcquisitionDraftState, AcquisitionLineDraft } from "../src/wayfinder/domain/acquisition-types";
import {
  createEquipmentPolicyResolver,
  DEFAULT_EQUIPMENT_WORLD_POLICY,
} from "../src/wayfinder/domain/equipment-policy";

const UUID = {
  alchemist: "Compendium.pf2e.classes.Item.XwfcJuskrhI9GIjX",
  alchemy: "Compendium.pf2e.classfeatures.Item.w3aS3tsvH2Ub6XMn",
  formulaFeature: "Compendium.pf2e.classfeatures.Item.XPPG7nN9pxt0sjMg",
  formulaItem: "Compendium.pf2e.equipment-srd.Item.qCEOZ6109Yo34tRx",
  investigator: "Compendium.pf2e.classes.Item.4wrSCyX6akmyo7Wj",
  methodology: "Compendium.pf2e.classfeatures.Item.uhHg9BXBiHpL5ndS",
  alchemicalSciences: "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX",
  barbarian: "Compendium.pf2e.classes.Item.YDRiP7uVvr9WRhOI",
  instinct: "Compendium.pf2e.classfeatures.Item.dU7xRpg4kFd01hwZ",
  giant: "Compendium.pf2e.classfeatures.Item.JuKD6k7nDwfO0Ckv",
  dwarf: "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
  clanDaggerFeature: "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
  clanDaggerItem: "Compendium.pf2e.equipment-srd.Item.kJJvKm80KwWXPukV",
  clanPistolFeature: "Compendium.pf2e.feats-srd.Item.LvVg83ZDj8mabcWF",
  sarangay: "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
  headGemFeature: "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
  headGemItem: "Compendium.pf2e.equipment-srd.Item.FA1mAc7rEyC9vzZa",
} as const;

const SUBJECT = {
  actorId: "actor-1",
  draftId: "draft-1",
  batchId: "batch-1",
  targetLevel: 1,
  activeSteps: [
    { slotId: "ancestry-level-1" },
    { slotId: "class-level-1" },
    { slotId: "class-branch-methodology-level-1" },
    { slotId: "class-branch-instinct-level-1" },
  ] as PendingStep[],
  observedActorItems: [],
} as const;

describe("class-grant projection service", () => {
  it("captures PF2E granted-by and Wayfinder acquisition identities from actor documents", () => {
    const actor = {
      id: "actor-1",
      items: {
        contents: [
          {
            id: "formula",
            type: "feat",
            quantity: 1,
            sourceId: UUID.formulaFeature,
            flags: { pf2e: { grantedBy: { id: "alchemy" } } },
            system: { quantity: 1, location: "class" },
          },
          {
            id: "weapon",
            type: "weapon",
            quantity: 1,
            sourceId: "Compendium.pf2e.equipment-srd.Item.weapon",
            flags: {
              [MODULE_ID]: {
                acquisition: {
                  version: 1,
                  draftId: "draft-1",
                  batchId: "batch-1",
                  manifestId: "manifest-1",
                  lineId: "line-1",
                  entryId: "entry-1",
                  plannedItemId: "planned-item-1",
                  plannedContainerId: null,
                  plannedGrantId: "grant-titan",
                  stackingIntent: "separate",
                },
              },
            },
            system: { quantity: 1 },
          },
        ],
      },
    };
    expect(captureObservedClassGrantItems(actor)).toEqual([
      expect.objectContaining({ itemId: "formula", grantedByItemId: "alchemy", locationItemId: "class" }),
      expect.objectContaining({
        itemId: "weapon",
        acquisitionIdentity: expect.objectContaining({ plannedGrantId: "grant-titan" }),
      }),
    ]);
  });

  it("projects the exact Alchemist native Formula Book chain", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    const documents = new Map<string, unknown>([
      [UUID.alchemist, classDocument(UUID.alchemy)],
      [UUID.alchemy, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaFeature }] })],
      [UUID.formulaFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] })],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    const result = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
    });
    expect(result.blockers).toEqual([]);
    expect(result.grants).toMatchObject([
      {
        profileId: "alchemist-formula-book",
        origin: { sourceSlotId: "class-level-1", sourceUuid: UUID.alchemist },
        expected: { sourceUuid: UUID.formulaItem, quantity: 1 },
        nativeGrantChainSourceUuids: [UUID.formulaFeature, UUID.alchemy, UUID.alchemist],
      },
    ]);
  });

  it("projects the deterministic Dwarf Clan Dagger native chain without inferring Clan Pistol", async () => {
    const draft = ancestryDraft(UUID.dwarf, "Dwarf");
    const documents = new Map<string, unknown>([
      [UUID.dwarf, rootDocument(UUID.clanDaggerFeature, 0)],
      [UUID.clanDaggerFeature, clanDaggerFeatureDocument()],
      [UUID.clanDaggerItem, clanDaggerDocument()],
    ]);

    const result = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
    });

    expect(result.blockers).toEqual([]);
    expect(result.grants).toMatchObject([
      {
        grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
        profileId: "dwarf-clan-dagger",
        origin: { sourceSlotId: "ancestry-level-1", sourceUuid: UUID.dwarf },
        granterSourceUuid: UUID.clanDaggerFeature,
        expected: { sourceUuid: UUID.clanDaggerItem, quantity: 1, itemType: "weapon" },
        materializer: "pf2e-native",
        nativeGrantChainSourceUuids: [UUID.clanDaggerFeature, UUID.dwarf],
      },
    ]);
  });

  it("blocks Clan Pistol before projecting or resolving the default Dwarf Clan Dagger", async () => {
    const draft = ancestryDraft(UUID.dwarf, "Dwarf");
    draft.selections["ancestry-feat-level-1"] = selection(
      "ancestry-feat-level-1",
      UUID.clanPistolFeature,
      "Clan Pistol"
    );
    const fetchDocumentByUuid = vi.fn(async () => null);

    await expect(
      projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        activeSteps: [...SUBJECT.activeSteps, { slotId: "ancestry-feat-level-1" } as PendingStep],
        fetchDocumentByUuid,
      })
    ).resolves.toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [
        {
          code: "unsupported-physical-grant",
          routeId: "clan-pistol",
          reasonCode: "unprofiled-native-grant",
          sourceSlotId: "ancestry-feat-level-1",
          sourceUuid: UUID.clanPistolFeature,
        },
      ],
    });
    expect(fetchDocumentByUuid).not.toHaveBeenCalled();
  });

  it("projects the exact Sarangay Head Gem native chain", async () => {
    const draft = ancestryDraft(UUID.sarangay, "Sarangay");
    const documents = new Map<string, unknown>([
      [UUID.sarangay, rootDocument(UUID.headGemFeature, 1)],
      [UUID.headGemFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.headGemItem }] })],
      [UUID.headGemItem, headGemDocument()],
    ]);

    const result = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
    });

    expect(result.blockers).toEqual([]);
    expect(result.grants).toMatchObject([
      {
        grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
        profileId: "sarangay-head-gem",
        origin: { sourceSlotId: "ancestry-level-1", sourceUuid: UUID.sarangay },
        expected: { sourceUuid: UUID.headGemItem, quantity: 1, itemType: "equipment" },
        nativeGrantChainSourceUuids: [UUID.headGemFeature, UUID.sarangay],
      },
    ]);
  });

  it("fails closed when the deterministic Dwarf choice or reviewed ancestry target drifts", async () => {
    const draft = ancestryDraft(UUID.dwarf, "Dwarf");
    const feature = clanDaggerFeatureDocument();
    const documents = new Map<string, unknown>([
      [UUID.dwarf, rootDocument(UUID.clanDaggerFeature, 0)],
      [UUID.clanDaggerFeature, feature],
      [UUID.clanDaggerItem, clanDaggerDocument()],
    ]);
    const execute = () =>
      projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
      });

    feature.system.rules[2] = { key: "GrantItem", predicate: ["clan-pistol"], uuid: UUID.clanDaggerItem };
    await expect(execute()).resolves.toMatchObject({ grants: [], blockers: [{ code: "source-drift" }] });

    documents.set(UUID.clanDaggerFeature, clanDaggerFeatureDocument());
    documents.set(UUID.clanDaggerItem, clanDaggerDocument({ price: { gp: 3 } }));
    await expect(execute()).resolves.toMatchObject({ grants: [], blockers: [{ code: "source-drift" }] });
  });

  it("projects Alchemical Sciences only from the exact selected methodology relationship", async () => {
    const draft = classDraft(UUID.investigator, "Investigator");
    draft.branchSelections.methodology = selection(
      "class-branch-methodology-level-1",
      UUID.alchemicalSciences,
      "Alchemical Sciences"
    );
    const documents = new Map<string, unknown>([
      [UUID.investigator, classDocument(UUID.methodology)],
      [UUID.methodology, dynamicSelector("methodology", "investigator-methodology")],
      [
        UUID.alchemicalSciences,
        document({
          tags: ["investigator-methodology"],
          rules: [{ key: "GrantItem", uuid: UUID.formulaItem }],
        }),
      ],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    const result = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
    });
    expect(result.blockers).toEqual([]);
    expect(result.grants).toMatchObject([
      {
        profileId: "investigator-alchemical-sciences-formula-book",
        origin: { sourceSlotId: "class-branch-methodology-level-1", sourceUuid: UUID.alchemicalSciences },
        expected: { sourceUuid: UUID.formulaItem },
      },
    ]);

    draft.branchSelections.methodology = selection(
      "class-branch-methodology-level-1",
      "Compendium.pf2e.classfeatures.Item.other",
      "Other Methodology"
    );
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
      })
    ).toMatchObject({ grants: [], blockers: [] });
  });

  it("binds Giant Instinct to one reviewed eligible Titan Mauler weapon", async () => {
    const draft = classDraft(UUID.barbarian, "Barbarian");
    draft.branchSelections.instinct = selection("class-branch-instinct-level-1", UUID.giant, "Giant Instinct");
    const documents = new Map<string, unknown>([
      [UUID.barbarian, classDocument(UUID.instinct)],
      [UUID.instinct, dynamicSelector("instinct", "barbarian-instinct")],
      [UUID.giant, giantInstinctDocument()],
      ["Compendium.pf2e.equipment-srd.Item.weapon", weaponDocument()],
    ]);
    const base = {
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid: string) => documents.get(uuid) ?? null,
    };
    expect(await projectPlannedClassGrants(base)).toMatchObject({
      grants: [],
      blockers: [{ code: "titan-selection-required" }],
    });
    draft.acquisition = titanAcquisition();
    const result = await projectPlannedClassGrants({
      ...base,
      currentEquipmentPolicy: equipmentPolicy(),
      actorSize: "medium",
    });
    expect(result.blockers).toEqual([]);
    expect(result.grants).toMatchObject([
      {
        profileId: "giant-instinct-titan-mauler",
        expected: { sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon", itemType: "weapon" },
        materializer: "wayfinder-acquisition",
        resaleRule: "zero-until-rune-investment",
      },
    ]);
  });

  it("fails closed when an installed authoritative chain drifts", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    const result = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) =>
        uuid === UUID.alchemist
          ? classDocument(UUID.alchemy)
          : uuid === UUID.alchemy
            ? document({ rules: [] })
            : document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] }),
    });
    expect(result).toMatchObject({ grants: [], blockers: [{ code: "source-drift" }] });
  });

  it("fails closed when an active profile source or fixed target is missing or duplicated", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async () => null,
      })
    ).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-missing" }] });

    const documents = new Map<string, unknown>([
      [UUID.alchemist, classDocument(UUID.alchemy)],
      [
        UUID.alchemy,
        document({
          rules: [
            { key: "GrantItem", uuid: UUID.formulaFeature },
            { key: "GrantItem", uuid: UUID.formulaFeature },
          ],
        }),
      ],
      [UUID.formulaFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] })],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
      })
    ).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-drift" }] });

    documents.set(UUID.alchemy, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaFeature }] }));
    documents.delete(UUID.formulaItem);
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
      })
    ).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-missing" }] });
  });

  it("reprojects Titan Mauler from the current line, document, policy, and actor size", async () => {
    const draft = classDraft(UUID.barbarian, "Barbarian");
    draft.branchSelections.instinct = selection("class-branch-instinct-level-1", UUID.giant, "Giant Instinct");
    draft.acquisition = titanAcquisition();
    const documents = new Map<string, unknown>([
      [UUID.barbarian, classDocument(UUID.instinct)],
      [UUID.instinct, dynamicSelector("instinct", "barbarian-instinct")],
      [UUID.giant, giantInstinctDocument()],
      ["Compendium.pf2e.equipment-srd.Item.weapon", weaponDocument()],
    ]);
    const execute = () =>
      projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        currentEquipmentPolicy: equipmentPolicy(),
        actorSize: "medium",
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
      });
    const first = await execute();
    expect(first).toMatchObject({
      blockers: [],
      preparedPlan: {
        subject: { actorId: "actor-1", draftId: "draft-1", batchId: "batch-1", targetLevel: 1 },
      },
    });
    const mutableLine = draft.acquisition.lines[0] as { documentFingerprint: string };
    mutableLine.documentFingerprint = "weapon-document-2";
    const changedDocumentIdentity = await execute();
    expect(changedDocumentIdentity.preparedPlan?.fingerprint).not.toBe(first.preparedPlan?.fingerprint);

    documents.set("Compendium.pf2e.equipment-srd.Item.weapon", {
      ...weaponDocument(),
      system: {
        ...weaponDocument().system,
        publication: { title: "Pathfinder GM Core" },
      },
    });
    expect(await execute()).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-drift" }] });

    const line = draft.acquisition.lines[0] as { price: AcquisitionLineDraft["price"] };
    line.price = { ...line.price, basePrice: { kind: "priced", value: { gp: 9, cp: 1 } } };
    documents.set("Compendium.pf2e.equipment-srd.Item.weapon", {
      ...weaponDocument(),
      system: { ...weaponDocument().system, price: { value: { gp: 9, cp: 1 } } },
    });
    expect(await execute()).toMatchObject({ preparedPlan: null, blockers: [{ code: "titan-ineligible" }] });
  });

  it("requires an exact active or already-applied origin slot before granting authority", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    const documents = new Map<string, unknown>([
      [UUID.alchemist, classDocument(UUID.alchemy)],
      [UUID.alchemy, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaFeature }] })],
      [UUID.formulaFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] })],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    const base = {
      ...SUBJECT,
      draft,
      activeSteps: [],
      fetchDocumentByUuid: async (uuid: string) => documents.get(uuid) ?? null,
    };

    expect(await projectPlannedClassGrants(base)).toMatchObject({ grants: [], blockers: [] });
    expect(
      await projectPlannedClassGrants({
        ...base,
        observedActorItems: [
          {
            itemId: "class",
            sourceUuid: UUID.alchemist,
            itemType: "class",
            quantity: 1,
            grantedByItemId: null,
            locationItemId: null,
            wayfinderSlotId: "class-level-1",
            acquisitionIdentity: null,
          },
        ],
      })
    ).toMatchObject({ blockers: [], grants: [{ profileId: "alchemist-formula-book" }] });
  });

  it("fails closed on ambiguous selectors and non-exact Formula Book prices", async () => {
    const investigator = classDraft(UUID.investigator, "Investigator");
    investigator.branchSelections.methodology = selection(
      "class-branch-methodology-level-1",
      UUID.alchemicalSciences,
      "Alchemical Sciences"
    );
    const ambiguousSelector = dynamicSelector("methodology", "investigator-methodology");
    ambiguousSelector.system.rules.push({
      key: "ChoiceSet",
      flag: "methodology",
      choices: { filter: ["item:tag:different-methodology"] },
    });
    const investigatorDocuments = new Map<string, unknown>([
      [UUID.investigator, classDocument(UUID.methodology)],
      [UUID.methodology, ambiguousSelector],
      [
        UUID.alchemicalSciences,
        document({
          tags: ["investigator-methodology"],
          rules: [{ key: "GrantItem", uuid: UUID.formulaItem }],
        }),
      ],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft: investigator,
        fetchDocumentByUuid: async (uuid) => investigatorDocuments.get(uuid) ?? null,
      })
    ).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-drift" }] });

    const alchemist = classDraft(UUID.alchemist, "Alchemist");
    const alchemistDocuments = new Map<string, unknown>([
      [UUID.alchemist, classDocument(UUID.alchemy)],
      [UUID.alchemy, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaFeature }] })],
      [UUID.formulaFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] })],
      [UUID.formulaItem, formulaBookDocument({ gp: 1, cp: 1 })],
    ]);
    expect(
      await projectPlannedClassGrants({
        ...SUBJECT,
        draft: alchemist,
        fetchDocumentByUuid: async (uuid) => alchemistDocuments.get(uuid) ?? null,
      })
    ).toMatchObject({ preparedPlan: null, blockers: [{ code: "source-drift" }] });
  });

  it("prepares the production plan from live settings, documents, and actor facts", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    const documents = new Map<string, unknown>([
      [UUID.alchemist, classDocument(UUID.alchemy)],
      [UUID.alchemy, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaFeature }] })],
      [UUID.formulaFeature, document({ rules: [{ key: "GrantItem", uuid: UUID.formulaItem }] })],
      [UUID.formulaItem, formulaBookDocument()],
    ]);
    const projected = await projectPlannedClassGrants({
      ...SUBJECT,
      draft,
      fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
    });
    const policy = equipmentPolicy();
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: createAcquisitionPolicySnapshot(policy, { kind: "permanent-items" }),
      baseline: null,
      plannedClassGrants: projected.grants,
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    vi.stubGlobal("game", {
      user: { id: "owner-1", isGM: false },
      system: { id: "pf2e", version: "8.4.1" },
      settings: {
        get: (moduleId: string, key: string) => {
          if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicy) return DEFAULT_EQUIPMENT_WORLD_POLICY;
          if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) {
            return { version: 1, judgments: [] };
          }
          if (moduleId === "pf2e" && key === "compendiumBrowserPacks") {
            return { equipment: { "pf2e.equipment-srd": { load: true } } };
          }
          if (moduleId === "pf2e" && key === "compendiumBrowserSources") {
            return { sources: { "pathfinder-player-core": { load: true } } };
          }
          return null;
        },
      },
      packs: {
        values: () =>
          [{ collection: "pf2e.equipment-srd", metadata: { type: "Item" }, documentName: "Item" }][Symbol.iterator](),
      },
      pf2e: {
        settings: { variants: { abp: "noABP" } },
        variantRules: { AutomaticBonusProgression: { isEnabled: () => false } },
      },
    });
    vi.stubGlobal("foundry", { utils: { fromUuid: async (uuid: string) => documents.get(uuid) ?? null } });
    const actor = {
      id: "actor-1",
      flags: {},
      system: { traits: { size: { value: "med" } } },
      items: { contents: [] },
    };
    try {
      await expect(prepareCurrentClassGrantPlan(actor, draft, SUBJECT.activeSteps)).resolves.toMatchObject({
        subject: { actorId: "actor-1", draftId: "draft-1", batchId: "batch-1", targetLevel: 1 },
        grants: [{ profileId: "alchemist-formula-book" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks production projection before source resolution when the PF2E runtime is not pinned", async () => {
    const draft = classDraft(UUID.alchemist, "Alchemist");
    const policy = equipmentPolicy();
    draft.acquisition = {
      schemaVersion: 3,
      draftId: "draft-1",
      batchId: "batch-1",
      manifestId: "manifest-1",
      targetLevel: 1,
      recipe: { kind: "permanent-items" },
      policySnapshot: createAcquisitionPolicySnapshot(policy, { kind: "permanent-items" }),
      baseline: null,
      plannedClassGrants: [],
      classGrantReconciliations: [],
      currencyConvergenceWitness: null,
      lines: [],
      disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
    };
    const fetchDocumentByUuid = vi.fn(async () => null);
    const actor = { id: "actor-1", items: { contents: [] } };

    await expect(
      projectCurrentClassGrants(actor, draft, SUBJECT.activeSteps, {
        fetchDocumentByUuid,
        pf2eVersion: "8.4.2",
      })
    ).resolves.toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }],
    });
    expect(fetchDocumentByUuid).not.toHaveBeenCalled();

    draft.targetLevel = 2;
    draft.acquisition = { ...draft.acquisition, targetLevel: 2 };
    await expect(
      projectCurrentClassGrants(actor, draft, SUBJECT.activeSteps, {
        fetchDocumentByUuid,
        pf2eVersion: "8.4.2",
      })
    ).resolves.toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }],
    });

    draft.applyCompletedStepIds = ["class-level-1"];
    await expect(
      projectCurrentClassGrants(actor, draft, [], {
        fetchDocumentByUuid,
        pf2eVersion: "8.4.2",
      })
    ).resolves.toMatchObject({
      grants: [],
      preparedPlan: null,
      blockers: [{ code: "coverage-version-mismatch", routeId: "pf2e-version-pin" }],
    });
    expect(fetchDocumentByUuid).not.toHaveBeenCalled();
  });

  it("uses drafted ancestry size and keeps production Titan Access fail-closed without a registered resolver", async () => {
    const draft = classDraft(UUID.barbarian, "Barbarian");
    draft.selections["ancestry-level-1"] = {
      ...selection("ancestry-level-1", "Compendium.pf2e.ancestries.Item.test-ancestry", "Test Ancestry"),
      itemType: "ancestry",
      featType: null,
    };
    draft.branchSelections.instinct = selection("class-branch-instinct-level-1", UUID.giant, "Giant Instinct");
    const acquisition = titanAcquisition();
    const policy = equipmentPolicy();
    (acquisition as any).policySnapshot = createAcquisitionPolicySnapshot(policy, acquisition.recipe);
    draft.acquisition = acquisition;
    const documents = new Map<string, unknown>([
      [UUID.barbarian, classDocument(UUID.instinct)],
      [UUID.instinct, dynamicSelector("instinct", "barbarian-instinct")],
      [UUID.giant, giantInstinctDocument()],
      ["Compendium.pf2e.ancestries.Item.test-ancestry", { type: "ancestry", system: { size: "med" } }],
      [acquisition.lines[0]!.sourceUuid, weaponDocument()],
    ]);
    const actor = {
      id: "actor-1",
      type: "character",
      isOwner: true,
      flags: {},
      system: { traits: { size: { value: "tiny" } } },
      items: { contents: [] },
    };
    const project = (resolveCharacterAccessRef?: () => string | null) =>
      projectPlannedClassGrants({
        ...SUBJECT,
        draft,
        fetchDocumentByUuid: async (uuid) => documents.get(uuid) ?? null,
        currentEquipmentPolicy: policy,
        actorSize: "medium",
        resolveCharacterAccessRef,
      });
    (acquisition as any).plannedClassGrants = [...(await project()).grants];

    vi.stubGlobal("game", productionGame());
    vi.stubGlobal("foundry", { utils: { fromUuid: async (uuid: string) => documents.get(uuid) ?? null } });
    try {
      const selectedLine = acquisition.lines[0]!;
      (acquisition as any).lines = [];
      await expect(projectCurrentClassGrants(actor, draft, SUBJECT.activeSteps)).resolves.toMatchObject({
        grants: [],
        preparedPlan: null,
        blockers: [{ code: "titan-selection-required" }],
      });
      (acquisition as any).lines = [selectedLine];

      await expect(prepareCurrentClassGrantPlan(actor, draft, SUBJECT.activeSteps)).resolves.toMatchObject({
        grants: [{ profileId: "giant-instinct-titan-mauler" }],
      });

      const line = acquisition.lines[0] as any;
      line.policyDecision.rarity = "uncommon";
      line.policyDecision.rarityBasis = "specific-character-access";
      line.policyDecision.characterAccessRef = "registry:test-access";
      documents.set(line.sourceUuid, weaponDocument("uncommon"));
      (acquisition as any).plannedClassGrants = [...(await project(() => "registry:test-access")).grants];

      await expect(prepareCurrentClassGrantPlan(actor, draft, SUBJECT.activeSteps)).rejects.toThrow();
      await expect(
        prepareCurrentClassGrantPlan(actor, draft, SUBJECT.activeSteps, {
          resolveCharacterAccessRef: async () => "registry:test-access",
        })
      ).resolves.toMatchObject({ grants: [{ profileId: "giant-instinct-titan-mauler" }] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function classDraft(uuid: string, name: string) {
  const draft = createEmptyDraft(1);
  draft.selections["class-level-1"] = {
    ...selection("class-level-1", uuid, name),
    itemType: "class",
    featType: null,
  };
  return draft;
}

function ancestryDraft(uuid: string, name: string) {
  const draft = createEmptyDraft(1);
  draft.selections["ancestry-level-1"] = {
    ...selection("ancestry-level-1", uuid, name),
    itemType: "ancestry",
    featType: null,
  };
  return draft;
}

function selection(slotId: string, uuid: string, name: string) {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.(.+)$/u.exec(uuid);
  return {
    slotId,
    packId: match?.[1] ?? "pf2e.classfeatures",
    documentId: match?.[2] ?? name,
    uuid,
    itemType: "feat",
    featType: "classfeature",
    name,
    level: 1,
  };
}

function classDocument(featureUuid: string) {
  return rootDocument(featureUuid, 1);
}

function rootDocument(featureUuid: string, level: number) {
  return { system: { items: { feature: { level, uuid: featureUuid } } } };
}

function document(options: { rules?: unknown[]; tags?: string[] } = {}) {
  return {
    system: {
      rules: options.rules ?? [],
      traits: { otherTags: options.tags ?? [] },
    },
  };
}

function formulaBookDocument(price: Record<string, number> = { gp: 1 }) {
  return {
    type: "equipment",
    system: {
      slug: "formula-book-blank",
      quantity: 1,
      level: { value: 0 },
      traits: { rarity: "common", otherTags: [] },
      price: { value: price },
      rules: [],
    },
  };
}

function clanDaggerFeatureDocument() {
  return document({
    rules: [
      {
        key: "ChoiceSet",
        flag: "clanWeapon",
        choices: [{ value: "clan-dagger" }, { value: "clan-pistol" }],
      },
      {
        key: "RollOption",
        option: "{item|flags.system.rulesSelections.clanWeapon}",
        removeUponCreate: true,
      },
      { key: "GrantItem", predicate: ["clan-dagger"], uuid: UUID.clanDaggerItem },
      { key: "GrantItem", predicate: ["clan-pistol"], uuid: UUID.clanPistolFeature },
    ],
  });
}

function clanDaggerDocument(options: { price?: Record<string, number> } = {}) {
  return {
    type: "weapon",
    system: {
      slug: "clan-dagger",
      baseItem: "clan-dagger",
      category: "simple",
      quantity: 1,
      level: { value: 0 },
      traits: { rarity: "uncommon" },
      price: { value: options.price ?? { gp: 2 } },
    },
  };
}

function headGemDocument() {
  return {
    type: "equipment",
    system: {
      slug: "head-gem",
      quantity: 1,
      level: { value: 0 },
      traits: { rarity: "common" },
      price: { value: {} },
    },
  };
}

function giantInstinctDocument() {
  return {
    ...document({ tags: ["barbarian-instinct"] }),
    system: {
      ...document({ tags: ["barbarian-instinct"] }).system,
      description: {
        value: "Choose a weapon with a Price of 9 gp or less sized one size larger. It has no value if sold.",
      },
    },
  };
}

function dynamicSelector(flag: string, tag: string) {
  return document({
    rules: [
      { key: "ChoiceSet", flag, choices: { filter: [`item:tag:${tag}`] } },
      { key: "GrantItem", uuid: `{item|flags.system.rulesSelections.${flag}}` },
    ],
  });
}

function titanLine(): AcquisitionLineDraft {
  return {
    schemaVersion: 1,
    lineId: "line-titan",
    sourceUuid: "Compendium.pf2e.equipment-srd.Item.weapon",
    documentFingerprint: "weapon-document-1",
    priceFingerprint: "weapon-price-1",
    itemLevel: 0,
    permanence: "permanent",
    componentKind: "baseline-item",
    policyDecision: {
      eligible: true,
      packId: "pf2e.equipment-srd",
      publicationSlug: "pathfinder-player-core",
      rarity: "common",
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      characterAccessRef: null,
      sourceExceptionJudgmentId: null,
      rarityExceptionJudgmentId: null,
      abpTreatment: "unchanged",
    },
    funding: {
      lane: "class-grant",
      grant: { plannedGrantId: "class-grant:titan-mauler:class-branch-instinct-level-1" },
    },
    stackingIntent: "separate",
    price: {
      basePrice: { kind: "priced", value: { gp: 9 } },
      size: "large",
      sizeSensitive: true,
      preciousMaterial: false,
      adjustedBulkPriceCopper: null,
      configurationPriceCopper: 0,
      pricePer: 1,
      sourceQuantity: 1,
      requestedQuantity: 1,
      materializedQuantity: 1,
      unitPriceCopper: 1800,
      linePriceCopper: 1800,
    },
  };
}

function titanAcquisition(): AcquisitionDraftState {
  return {
    schemaVersion: 3,
    draftId: "draft-1",
    batchId: "batch-1",
    manifestId: "manifest-1",
    targetLevel: 1,
    recipe: { kind: "permanent-items" },
    policySnapshot: null,
    baseline: null,
    plannedClassGrants: [],
    classGrantReconciliations: [],
    currencyConvergenceWitness: null,
    lines: [titanLine()],
    disposition: { kind: "unreviewed", invalidatedFrom: null, reasons: [] },
  };
}

function equipmentPolicy() {
  return createEquipmentPolicyResolver({
    resolveGmJudgment: () => null,
    verifyOwnerStartAttestation: () => false,
  }).resolve({
    actorId: "actor-1",
    draftId: "draft-1",
    targetLevel: 1,
    worldPolicy: DEFAULT_EQUIPMENT_WORLD_POLICY,
    selectedRecipe: "permanent-items",
    effectivePackIds: ["pf2e.equipment-srd"],
    enabledSourceSlugs: ["pathfinder-player-core"],
    knownSourceSlugs: ["pathfinder-player-core"],
    showEmptySources: false,
    showUnknownSources: false,
    abp: { enabled: false, mode: "noABP", actorOverrideDisabled: false },
  });
}

function weaponDocument(rarity = "common") {
  return {
    type: "weapon",
    sourceId: "Compendium.pf2e.equipment-srd.Item.weapon",
    system: {
      category: "martial",
      range: null,
      traits: { rarity },
      publication: { title: "Pathfinder Player Core" },
      price: { value: { gp: 9 } },
    },
  };
}

function productionGame() {
  return {
    user: { id: "owner-1", isGM: false },
    system: { id: "pf2e", version: "8.4.1" },
    settings: {
      get: (moduleId: string, key: string) => {
        if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicy) return DEFAULT_EQUIPMENT_WORLD_POLICY;
        if (moduleId === MODULE_ID && key === SETTINGS.equipmentPolicyJudgments) {
          return { version: 1, judgments: [] };
        }
        if (moduleId === "pf2e" && key === "compendiumBrowserPacks") {
          return { equipment: { "pf2e.equipment-srd": { load: true } } };
        }
        if (moduleId === "pf2e" && key === "compendiumBrowserSources") {
          return { sources: { "pathfinder-player-core": { load: true } } };
        }
        return null;
      },
    },
    packs: {
      values: () =>
        [{ collection: "pf2e.equipment-srd", metadata: { type: "Item" }, documentName: "Item" }][Symbol.iterator](),
    },
    pf2e: {
      settings: { variants: { abp: "noABP" } },
      variantRules: { AutomaticBonusProgression: { isEnabled: () => false } },
    },
  };
}
