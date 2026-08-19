import { createHash } from "node:crypto";

export const ACQUISITION_CASE_SCHEMA_VERSION = 2;
export const LEVEL_ONE_BUDGET_COPPER = 1500;
export const LEVEL_ONE_DAGGER = Object.freeze({
  sourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
  name: "Dagger",
  itemType: "weapon",
  level: 0,
  rarity: "common",
  publication: "Pathfinder Player Core",
  unitPriceCopper: 20,
  sourceQuantity: 1,
  rulesCount: 0,
  containerId: null,
  stackingIntent: "aggregate",
});

const COMMON_COMPLETE_DRAFT = Object.freeze({
  kind: "complete-draft",
  background: Object.freeze({
    name: "Acolyte",
    sourceUuid: "Compendium.pf2e.backgrounds.Item.CAjQrHZZbALE7Qjy",
  }),
  class: Object.freeze({
    name: "Fighter",
    sourceUuid: "Compendium.pf2e.classes.Item.8zn3cD6GSmoo1LW4",
  }),
  classFeat: Object.freeze({
    name: "Sudden Charge",
    sourceUuid: "Compendium.pf2e.feats-srd.Item.qQt3CMrhLkUV1wCv",
  }),
  keyAbility: "str",
  levelOneBoosts: Object.freeze(["str", "dex", "con", "wis"]),
  preferredSkills: Object.freeze(["athletics", "crafting", "medicine", "stealth"]),
  ruleSelections: Object.freeze({ fighterSkill: "athletics" }),
});

export const LEVEL_ONE_NATIVE_GRANTS = Object.freeze({
  dwarfClanDagger: Object.freeze({
    kind: "fixed-native-grant",
    profileId: "dwarf-clan-dagger",
    grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
    materializer: "pf2e-native",
    fundingLane: "class-grant",
    originSlotId: "ancestry-level-1",
    ancestry: Object.freeze({
      name: "Dwarf",
      sourceUuid: "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
    }),
    heritage: Object.freeze({
      name: "Forge Dwarf",
      sourceUuid: "Compendium.pf2e.heritages.Item.5CqsBKCZuGON53Hk",
    }),
    ancestryFeat: Object.freeze({
      name: "Dwarven Doughtiness",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.UJ8AqzkkDqRCMNFW",
    }),
    granter: Object.freeze({
      name: "Clan Dagger",
      sourceUuid: "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
    }),
    target: Object.freeze({
      name: "Clan Dagger",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.kJJvKm80KwWXPukV",
      itemType: "weapon",
      level: 0,
      rarity: "uncommon",
      publication: "Pathfinder Player Core",
      quantity: 1,
      sourceQuantity: 1,
      rulesCount: 0,
      containerId: null,
      unitPriceCopper: 200,
    }),
    nativeGrantChainSourceUuids: Object.freeze([
      "Compendium.pf2e.ancestryfeatures.Item.Eyuqu6eIaoGCjnMv",
      "Compendium.pf2e.ancestries.Item.BYj5ZvlXZdpaEgA6",
    ]),
    requiredRuleSelection: Object.freeze({ key: "clanWeapon", value: "clan-dagger" }),
    fixture: Object.freeze({
      ...COMMON_COMPLETE_DRAFT,
      ancestryBoosts: Object.freeze({ 0: "con", 1: "wis", 2: "dex" }),
      backgroundBoosts: Object.freeze({ 0: "wis", 1: "cha" }),
    }),
  }),
  sarangayHeadGem: Object.freeze({
    kind: "fixed-native-grant",
    profileId: "sarangay-head-gem",
    grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
    materializer: "pf2e-native",
    fundingLane: "class-grant",
    originSlotId: "ancestry-level-1",
    ancestry: Object.freeze({
      name: "Sarangay",
      sourceUuid: "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
    }),
    heritage: Object.freeze({
      name: "Waxing Moon Sarangay",
      sourceUuid: "Compendium.pf2e.heritages.Item.BHiOV3ETYSv6k7kF",
    }),
    ancestryFeat: Object.freeze({
      name: "Crown of Bone",
      sourceUuid: "Compendium.pf2e.feats-srd.Item.pC9sGxKBOGWQLOuw",
    }),
    granter: Object.freeze({
      name: "Head Gem",
      sourceUuid: "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
    }),
    target: Object.freeze({
      name: "Head Gem",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.FA1mAc7rEyC9vzZa",
      itemType: "equipment",
      level: 0,
      rarity: "common",
      publication: "Pathfinder Lost Omens Tian Xia Character Guide",
      quantity: 1,
      sourceQuantity: 1,
      rulesCount: 1,
      containerId: null,
      unitPriceCopper: 0,
    }),
    nativeGrantChainSourceUuids: Object.freeze([
      "Compendium.pf2e.ancestryfeatures.Item.HYefFkddD9lOhFM8",
      "Compendium.pf2e.ancestries.Item.7mpMGhVoaPANJnZ8",
    ]),
    requiredRuleSelection: null,
    fixture: Object.freeze({
      ...COMMON_COMPLETE_DRAFT,
      ancestryBoosts: Object.freeze({ 0: "str", 1: "cha", 2: "dex" }),
      backgroundBoosts: Object.freeze({ 0: "wis", 1: "con" }),
    }),
  }),
});

const NATIVE_GRANTS_BY_PROFILE_ID = new Map(
  Object.values(LEVEL_ONE_NATIVE_GRANTS).map((profile) => [profile.profileId, profile]),
);

function acquisitionCase({
  id,
  label,
  disposition,
  quantity = 0,
  failure = null,
  executorRole = "non-gm-owner",
  policyReviewRequired = false,
  nativeGrant = null,
}) {
  const expectedEntries =
    nativeGrant !== null
      ? [nativeGrantExpectedEntry(nativeGrant)]
      : disposition === "purchase-ledger"
      ? [
          {
            sourceUuid: LEVEL_ONE_DAGGER.sourceUuid,
            name: LEVEL_ONE_DAGGER.name,
            itemType: LEVEL_ONE_DAGGER.itemType,
            level: LEVEL_ONE_DAGGER.level,
            rarity: LEVEL_ONE_DAGGER.rarity,
            publication: LEVEL_ONE_DAGGER.publication,
            quantity,
            sourceQuantity: LEVEL_ONE_DAGGER.sourceQuantity,
            rulesCount: LEVEL_ONE_DAGGER.rulesCount,
            containerId: LEVEL_ONE_DAGGER.containerId,
            stackingIntent: LEVEL_ONE_DAGGER.stackingIntent,
            unitPriceCopper: LEVEL_ONE_DAGGER.unitPriceCopper,
          },
        ]
      : [];
  const spentCopper = nativeGrant === null ? quantity * LEVEL_ONE_DAGGER.unitPriceCopper : 0;
  const acquisition = {
    schemaVersion: ACQUISITION_CASE_SCHEMA_VERSION,
    executorRole,
    targetLevel: 1,
    disposition,
    expectedBudgetCopper: LEVEL_ONE_BUDGET_COPPER,
    expectedSpentCopper: spentCopper,
    expectedRemainingCopper: LEVEL_ONE_BUDGET_COPPER - spentCopper,
    expectedEntries,
    nativeGrant,
    expectedAcquisitionItemCreateCheckpoints: nativeGrant === null ? null : 0,
    policyReview: {
      required: policyReviewRequired,
      reviewerRole: "gm",
    },
    failure,
  };
  const material = { id, caseKind: "acquisition", targetLevel: 1, acquisition };
  return Object.freeze({
    id,
    label,
    caseKind: "acquisition",
    targetLevel: 1,
    acquisitionCase: Object.freeze(acquisition),
    definitionFingerprint: acquisitionDefinitionFingerprint(material),
  });
}

function nativeGrantExpectedEntry(nativeGrant) {
  return {
    sourceUuid: nativeGrant.target.sourceUuid,
    name: nativeGrant.target.name,
    itemType: nativeGrant.target.itemType,
    level: nativeGrant.target.level,
    rarity: nativeGrant.target.rarity,
    publication: nativeGrant.target.publication,
    quantity: nativeGrant.target.quantity,
    sourceQuantity: nativeGrant.target.sourceQuantity,
    rulesCount: nativeGrant.target.rulesCount,
    containerId: nativeGrant.target.containerId,
    stackingIntent: "separate",
    unitPriceCopper: nativeGrant.target.unitPriceCopper,
    fundingLane: nativeGrant.fundingLane,
    plannedGrantId: nativeGrant.grantId,
    materializer: nativeGrant.materializer,
  };
}

export const acquisitionSmokeCases = Object.freeze([
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase",
    label: "Non-GM owner buys one Common level-0 Dagger",
    disposition: "purchase-ledger",
    quantity: 1,
  }),
  acquisitionCase({
    id: "equipment-l1-owner-retain-all",
    label: "Non-GM owner explicitly retains all level-1 currency",
    disposition: "retain-all",
  }),
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase-retry",
    label: "Non-GM owner retries a pre-aggregated Dagger purchase after item creation",
    disposition: "purchase-ledger",
    quantity: 2,
    failure: {
      checkpointId: "write:embedded-item-create:after",
      occurrence: 1,
      expectedPoint: "item-after",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase-currency-before-retry",
    label: "Non-GM owner retries a Dagger purchase before currency convergence",
    disposition: "purchase-ledger",
    quantity: 2,
    failure: {
      checkpointId: "write:currency-convergence:before",
      occurrence: 1,
      expectedPoint: "currency-before",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase-currency-after-retry",
    label: "Non-GM owner retries a Dagger purchase after currency convergence",
    disposition: "purchase-ledger",
    quantity: 2,
    failure: {
      checkpointId: "write:currency-convergence:after",
      occurrence: 1,
      expectedPoint: "currency-after",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase-final-before-retry",
    label: "Non-GM owner retries a Dagger purchase before final actor persistence",
    disposition: "purchase-ledger",
    quantity: 2,
    failure: {
      checkpointId: "write:final-actor-update:before",
      occurrence: 1,
      expectedPoint: "final-state-before",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-common-purchase-final-after-ack",
    label: "Non-GM owner observes durable convergence after a lost final acknowledgement",
    disposition: "purchase-ledger",
    quantity: 2,
    failure: {
      checkpointId: "write:final-actor-update:after",
      occurrence: 1,
      expectedPoint: "final-state-after",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-dwarf-clan-dagger-native-retry",
    label: "Non-GM owner retains all wealth with one native Dwarf Clan Dagger after recovery",
    disposition: "retain-all",
    nativeGrant: LEVEL_ONE_NATIVE_GRANTS.dwarfClanDagger,
    failure: {
      checkpointId: "write:currency-convergence:before",
      occurrence: 1,
      expectedPoint: "currency-before",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-owner-sarangay-head-gem-native-retry",
    label: "Non-GM owner retains all wealth with one native Sarangay Head Gem after recovery",
    disposition: "retain-all",
    nativeGrant: LEVEL_ONE_NATIVE_GRANTS.sarangayHeadGem,
    failure: {
      checkpointId: "write:currency-convergence:before",
      occurrence: 1,
      expectedPoint: "currency-before",
    },
  }),
  acquisitionCase({
    id: "equipment-l1-gm-review-common-purchase",
    label: "Current GM reviews and applies one Common level-0 Dagger purchase",
    disposition: "purchase-ledger",
    quantity: 1,
    executorRole: "gm-reviewer",
    policyReviewRequired: true,
  }),
]);

export function acquisitionDefinitionFingerprint(value) {
  const material =
    value?.acquisitionCase === undefined
      ? value
      : {
          id: value.id,
          caseKind: value.caseKind,
          targetLevel: value.targetLevel,
          acquisition: value.acquisitionCase,
        };
  return `wf-acquisition-case-v2-${createHash("sha256")
    .update(canonicalJson(material))
    .digest("hex")}`;
}

export function validateAcquisitionSmokeCaseDefinition(value) {
  const failures = [];
  const acquisition = value?.acquisitionCase;
  if (!nonEmptyString(value?.id) || value?.caseKind !== "acquisition" || value?.targetLevel !== 1) {
    failures.push("Acquisition smoke cases require a stable id, acquisition kind, and target level 1.");
  }
  if (!acquisition || acquisition.schemaVersion !== ACQUISITION_CASE_SCHEMA_VERSION) {
    failures.push("Acquisition smoke cases require the current acquisition case schema.");
    return failures;
  }
  if (
    !["non-gm-owner", "gm-reviewer"].includes(acquisition.executorRole) ||
    !["purchase-ledger", "retain-all"].includes(acquisition.disposition) ||
    acquisition.expectedBudgetCopper !== LEVEL_ONE_BUDGET_COPPER
  ) {
    failures.push("Acquisition smoke cases require a supported level-1 executor policy boundary.");
  }
  if (
    !Number.isSafeInteger(acquisition.expectedSpentCopper) ||
    !Number.isSafeInteger(acquisition.expectedRemainingCopper) ||
    acquisition.expectedSpentCopper < 0 ||
    acquisition.expectedRemainingCopper < 0 ||
    acquisition.expectedSpentCopper + acquisition.expectedRemainingCopper !== acquisition.expectedBudgetCopper
  ) {
    failures.push("Acquisition smoke case currency expectations do not reconcile.");
  }
  if (!Array.isArray(acquisition.expectedEntries)) {
    failures.push("Acquisition smoke cases require exact expected entries.");
  } else if (
    acquisition.disposition === "retain-all" &&
    acquisition.nativeGrant === null &&
    acquisition.expectedEntries.length !== 0
  ) {
    failures.push("Ordinary retain-all smoke cases cannot expect purchased entries.");
  } else if (
    acquisition.disposition === "purchase-ledger" &&
    (acquisition.expectedEntries.length !== 1 ||
      acquisition.expectedEntries.some(
        (entry) =>
          entry.sourceUuid !== LEVEL_ONE_DAGGER.sourceUuid ||
          entry.name !== LEVEL_ONE_DAGGER.name ||
          entry.itemType !== LEVEL_ONE_DAGGER.itemType ||
          entry.level !== LEVEL_ONE_DAGGER.level ||
          entry.rarity !== LEVEL_ONE_DAGGER.rarity ||
          entry.publication !== LEVEL_ONE_DAGGER.publication ||
          !Number.isSafeInteger(entry.quantity) ||
          entry.quantity < 1 ||
          entry.sourceQuantity !== LEVEL_ONE_DAGGER.sourceQuantity ||
          entry.rulesCount !== LEVEL_ONE_DAGGER.rulesCount ||
          entry.containerId !== null ||
          entry.stackingIntent !== "aggregate" ||
          entry.unitPriceCopper !== LEVEL_ONE_DAGGER.unitPriceCopper,
      ))
  ) {
    failures.push("Purchase smoke cases require one exact pre-aggregated Dagger entry.");
  }
  if (acquisition.nativeGrant === null) {
    if (acquisition.expectedAcquisitionItemCreateCheckpoints !== null) {
      failures.push("Ordinary acquisition smoke cases cannot declare a native item-create expectation.");
    }
  } else {
    const native = acquisition.nativeGrant;
    const expectedProfile = NATIVE_GRANTS_BY_PROFILE_ID.get(native?.profileId);
    const expectedEntry = expectedProfile ? nativeGrantExpectedEntry(expectedProfile) : null;
    const nativeEntries = Array.isArray(acquisition.expectedEntries) ? acquisition.expectedEntries : [];
    if (
      native?.kind !== "fixed-native-grant" ||
      !expectedProfile ||
      !sameCanonical(native, expectedProfile) ||
      acquisition.disposition !== "retain-all" ||
      acquisition.executorRole !== "non-gm-owner" ||
      acquisition.expectedSpentCopper !== 0 ||
      acquisition.expectedRemainingCopper !== LEVEL_ONE_BUDGET_COPPER ||
      acquisition.expectedAcquisitionItemCreateCheckpoints !== 0 ||
      nativeEntries.length !== 1 ||
      !sameCanonical(nativeEntries[0], expectedEntry) ||
      acquisition.failure?.checkpointId !== "write:currency-convergence:before" ||
      acquisition.failure?.occurrence !== 1 ||
      acquisition.failure?.expectedPoint !== "currency-before"
    ) {
      failures.push(
        "Native-grant smoke cases require one exact fixed profile, locked zero-cost grant line, and before-currency retry.",
      );
    }
  }
  if (
    acquisition.policyReview?.reviewerRole !== "gm" ||
    typeof acquisition.policyReview?.required !== "boolean" ||
    (acquisition.executorRole === "non-gm-owner" && acquisition.policyReview.required !== false) ||
    (acquisition.executorRole === "gm-reviewer" && acquisition.policyReview.required !== true)
  ) {
    failures.push("Acquisition smoke cases require an explicit GM policy-review session shape.");
  }
  if (acquisition.failure !== null) {
    const failure = acquisition.failure;
    const supported = new Map([
      ["write:embedded-item-create:after", { point: "item-after", repeated: true }],
      ["write:currency-convergence:before", { point: "currency-before", repeated: false }],
      ["write:currency-convergence:after", { point: "currency-after", repeated: false }],
      ["write:final-actor-update:before", { point: "final-state-before", repeated: false }],
      ["write:final-actor-update:after", { point: "final-state-after", repeated: false }],
    ]);
    const boundary = supported.get(failure?.checkpointId);
    if (
      !boundary ||
      !Number.isSafeInteger(failure?.occurrence) ||
      failure.occurrence < 1 ||
      (!boundary.repeated && failure.occurrence !== 1) ||
      failure.expectedPoint !== boundary.point
    ) {
      failures.push("Acquisition smoke failure configuration does not name a supported exact write boundary.");
    }
  }
  if (value?.definitionFingerprint !== acquisitionDefinitionFingerprint(value)) {
    failures.push("Acquisition smoke case fingerprint does not match its exact configuration.");
  }
  return failures;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Acquisition case fingerprints require finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError("Acquisition case fingerprints require structured data.");
}

function sameCanonical(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
