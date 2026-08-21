import { createHash } from "node:crypto";

const RAW_CASES = [
  {
    id: "level-5-lump-sum",
    label: "Level 5 official lump-sum recipe",
    targetLevel: 5,
    selectedRecipe: "lump-sum",
    expected: { kind: "lump-sum", budgetCopper: 27_000, maxItemLevel: 4 },
  },
  {
    id: "level-20-permanent-items",
    label: "Level 20 official permanent-item recipe",
    targetLevel: 20,
    selectedRecipe: "permanent-items",
    expected: {
      kind: "permanent-items",
      currencyCopper: 2_000_000,
      allowanceLevels: [16, 16, 17, 18, 18, 19],
    },
  },
  {
    id: "level-5-custom-lump-sum",
    label: "GM-approved custom lump sum",
    targetLevel: 5,
    selectedRecipe: "lump-sum",
    customAmountCopper: 123_456,
    expected: { kind: "custom-lump-sum", budgetCopper: 123_456, maxItemLevel: 4 },
  },
  {
    id: "level-5-extra-allowance",
    label: "GM-approved extra current-level allowance",
    targetLevel: 5,
    selectedRecipe: "permanent-items",
    grantExtraAllowance: true,
    expected: {
      kind: "permanent-items",
      currencyCopper: 5_000,
      allowanceLevels: [1, 1, 2, 3, 3, 4, 5],
    },
  },
  {
    id: "configured-item-exception",
    label: "Exact item exception and configured PF2E price",
    targetLevel: 14,
    selectedRecipe: "permanent-items",
    grantExtraAllowance: true,
    configuredItem: {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.JosogwNGybTSrH03",
      name: "Morning Glow",
      itemType: "weapon",
      baseItem: "elven-curve-blade",
    },
    handoffItem: {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.cGgN41q4Qo9taiOR",
      name: "Chained Mist",
      message: "Chained Mist requires an explicit PF2E inventory-sheet handoff.",
    },
  },
];

const DRAFT_ANCESTRY = Object.freeze({
  slotId: "ancestry-level-1",
  packId: "pf2e.ancestries",
  documentId: "IiG7DgeLWYrSNXuX",
  uuid: "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX",
  itemType: "ancestry",
  featType: null,
  name: "Human",
  level: 0,
});

export const wave3EquipmentCases = Object.freeze(
  RAW_CASES.map((entry) => {
    const definition = {
      ...entry,
      draftAncestry: DRAFT_ANCESTRY,
    };
    return Object.freeze({
      ...definition,
      definitionFingerprint: fingerprint(definition),
    });
  }),
);

export function validateWave3EquipmentCaseDefinition(value) {
  const failures = [];
  if (!value || typeof value !== "object") return ["Wave 3 equipment case must be an object."];
  if (typeof value.id !== "string" || !value.id) failures.push("Wave 3 equipment case requires an id.");
  if (!Number.isInteger(value.targetLevel) || value.targetLevel < 2 || value.targetLevel > 20) {
    failures.push(`${value.id || "<unknown>"}: targetLevel must be 2 through 20.`);
  }
  if (!['permanent-items', 'lump-sum'].includes(value.selectedRecipe)) {
    failures.push(`${value.id || "<unknown>"}: selectedRecipe is invalid.`);
  }
  if (
    value.draftAncestry?.slotId !== "ancestry-level-1" ||
    value.draftAncestry?.itemType !== "ancestry" ||
    value.draftAncestry?.uuid !== "Compendium.pf2e.ancestries.Item.IiG7DgeLWYrSNXuX" ||
    value.draftAncestry?.name !== "Human"
  ) {
    failures.push(`${value.id || "<unknown>"}: exact drafted ancestry fixture is invalid.`);
  }
  if (value.definitionFingerprint !== fingerprint(withoutFingerprint(value))) {
    failures.push(`${value.id || "<unknown>"}: definition fingerprint drifted.`);
  }
  return failures;
}

function withoutFingerprint(value) {
  const rest = { ...value };
  delete rest.definitionFingerprint;
  return rest;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
