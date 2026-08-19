import { createHash } from "node:crypto";

export const ACQUISITION_CASE_SCHEMA_VERSION = 1;
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

function acquisitionCase({
  id,
  label,
  disposition,
  quantity = 0,
  failure = null,
  executorRole = "non-gm-owner",
  policyReviewRequired = false,
}) {
  const expectedEntries =
    disposition === "purchase-ledger"
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
  const spentCopper = quantity * LEVEL_ONE_DAGGER.unitPriceCopper;
  const acquisition = {
    schemaVersion: ACQUISITION_CASE_SCHEMA_VERSION,
    executorRole,
    targetLevel: 1,
    disposition,
    expectedBudgetCopper: LEVEL_ONE_BUDGET_COPPER,
    expectedSpentCopper: spentCopper,
    expectedRemainingCopper: LEVEL_ONE_BUDGET_COPPER - spentCopper,
    expectedEntries,
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
  return `wf-acquisition-case-v1-${createHash("sha256")
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
  } else if (acquisition.disposition === "retain-all" && acquisition.expectedEntries.length !== 0) {
    failures.push("Retain-all smoke cases cannot expect purchased entries.");
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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
