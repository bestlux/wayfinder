import { createHash } from "node:crypto";

export const PF2E_EQUIPMENT_PACK_ID = "pf2e.equipment-srd";
export const BATTLEZOO_EQUIPMENT_PACK_ID =
  "battlezoo-bestiary-pf2e.pf2e-battlezoo-equipment";
export const BATTLEZOO_ADJACENT_PACK_ID =
  "battlezoo-bestiary-pf2e.pf2e-battlezoo-feats-and-actions";

const RAW_CASES = [
  {
    id: "physical-prepared-boundaries",
    label: "Prepared physical types, stacks, size, and precious-material price",
    actor: {
      targetLevel: 2,
      ancestry: {
        sourceUuid: "Compendium.pf2e.ancestries.Item.3wQ49DoWFYQgVsq6",
        name: "Minotaur",
        expectedSize: "large",
      },
    },
    listedMagic: {
      name: "Candlecap",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.UwGcNJS5jjjUssPb",
      itemType: "equipment",
      expectedUnitPriceCopper: 1_200,
      expectedSizeSensitive: false,
    },
    physicalItems: [
      {
        itemType: "ammo",
        name: "Arrows",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.w2ENw2VMPcsbif8g",
        expectedPricePer: 10,
        expectedSourceQuantity: 10,
        expectedMaterializedQuantity: 10,
      },
      {
        itemType: "armor",
        name: "Leather Armor",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.4tIVTg9wj56RrveA",
      },
      {
        itemType: "backpack",
        name: "Backpack",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.3lgwjrFEsQVKzhh7",
      },
      {
        itemType: "consumable",
        name: "Spray Pellets",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.qaAQnuLVia6vS1LU",
        expectedPricePer: 10,
        expectedSourceQuantity: 1,
        expectedMaterializedQuantity: 1,
      },
      {
        itemType: "equipment",
        name: "Rope",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.fyYnQf1NAx9fWFaS",
      },
      {
        itemType: "shield",
        name: "Buckler",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.1k3AsSW7lpU0kEpY",
      },
      {
        itemType: "weapon",
        name: "Dagger",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
      },
    ],
    stackProbe: {
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.w2ENw2VMPcsbif8g",
      requestedQuantity: 2,
      expectedMaterializedQuantity: 20,
    },
    treasure: {
      name: "Gold Pieces",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.B6B7tBWJSqOBz5zz",
      expectedDiagnostic: "Treasure is excluded from equipment acquisition.",
    },
    preciousMaterialOverlay: {
      label: "Buckler with low-grade silver overlay (harness-only prepared boundary)",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.1k3AsSW7lpU0kEpY",
      itemType: "shield",
      material: { type: "silver", grade: "low" },
    },
  },
  {
    id: "adventurers-pack-retry",
    label: "Small Adventurer's Pack expansion, partial failure, retry, and manifest",
    actor: {
      targetLevel: 1,
      ancestry: {
        sourceUuid: "Compendium.pf2e.ancestries.Item.GgZAHbrjnzWOZy2v",
        name: "Halfling",
        expectedSize: "medium",
        sourceSize: "small",
      },
    },
    kit: {
      name: "Adventurer's Pack",
      sourceUuid: "Compendium.pf2e.equipment-srd.Item.2req0jGaxz8hScdB",
      expectedPriceCopper: 150,
      failBeforeCreateOrdinal: 5,
      expectedCreatedBeforeFailure: 4,
      expectedCreatedOnRetry: 5,
      faultChildExpansionPath: "mca3x/fabyb",
      faultChildSourceUuid: "Compendium.pf2e.equipment-srd.Item.UlIxxLm71UdRgCFE",
      faultChildReplacementSourceUuid: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
      children: [
        child("mca3x", null, "Backpack", "3lgwjrFEsQVKzhh7", "backpack", 1),
        child("mca3x/02xhi", "mca3x", "Rope", "fyYnQf1NAx9fWFaS", "equipment", 1),
        child("mca3x/30xet", "mca3x", "Waterskin", "VnPh324pKwd2ZB66", "equipment", 1),
        child("mca3x/afbn4", "mca3x", "Chalk", "xShIDyydOMkGvGNb", "consumable", 10),
        child("mca3x/fabyb", "mca3x", "Flint and Steel", "UlIxxLm71UdRgCFE", "equipment", 1),
        child("mca3x/jtagt", "mca3x", "Rations", "L9ZV076913otGtiB", "consumable", 2),
        child("mca3x/lems2", "mca3x", "Torch", "8Jdw4yAzWYylGePS", "equipment", 5),
        child("mca3x/lpl11", "mca3x", "Bedroll", "fagzYdmfYyMQ6J77", "equipment", 1),
        child("mca3x/z9tim", "mca3x", "Soap", "81aHsD27HFGnq1Nt", "equipment", 1),
      ],
    },
    smallDiagnostics: {
      exact: {
        name: "Spray Pellets",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.qaAQnuLVia6vS1LU",
        expectedLinePriceCopper: 1,
      },
      unavailable: {
        name: "Candle",
        sourceUuid: "Compendium.pf2e.equipment-srd.Item.Ti4gWILk69LPxKuU",
        expectedMessage: "This item must be purchased in a quantity that produces a nonzero exact PF2E charge.",
      },
    },
  },
  {
    id: "supplemental-source-isolation",
    label: "Battlezoo equipment source isolation across GM and player roles",
    allowedFamilies: ["battlezoo-bestiary-pf2e", "pf2e"],
    supplemental: {
      packId: BATTLEZOO_EQUIPMENT_PACK_ID,
      sourceUuid: `Compendium.${BATTLEZOO_EQUIPMENT_PACK_ID}.Item.rDPuZvrFUZhjpDif`,
      name: "Salt Stake",
      itemType: "weapon",
      expectedAvailable: true,
      expectedPriceCopper: 0,
      expectedSourceBasis: "approved-pack",
      expectedEligible: true,
      expectedUnavailableReasonCodes: [],
    },
    adjacent: {
      packId: BATTLEZOO_ADJACENT_PACK_ID,
      expectedExcluded: true,
    },
    pf2eSettings: {
      defaultLoadWhenAbsent: true,
      ignoreAsGM: true,
      sourceSlug: "battlezoo-bestiary",
    },
  },
];

export const wave4EquipmentCases = Object.freeze(
  RAW_CASES.map((entry) =>
    Object.freeze({
      ...entry,
      definitionFingerprint: fingerprint(entry),
    }),
  ),
);

export function validateWave4EquipmentCaseDefinition(value) {
  const failures = [];
  if (!value || typeof value !== "object") return ["Wave 4 equipment case must be an object."];
  if (typeof value.id !== "string" || !value.id) failures.push("Wave 4 equipment case requires an id.");
  if (value.definitionFingerprint !== fingerprint(withoutFingerprint(value))) {
    failures.push(`${value.id || "<unknown>"}: definition fingerprint drifted.`);
  }
  if (value.id === "physical-prepared-boundaries") {
    const types = value.physicalItems?.map((item) => item.itemType) ?? [];
    if (JSON.stringify(types) !== JSON.stringify(["ammo", "armor", "backpack", "consumable", "equipment", "shield", "weapon"])) {
      failures.push(`${value.id}: exact seven-type physical matrix drifted.`);
    }
    if (value.actor?.targetLevel !== 2 || value.listedMagic?.sourceUuid !== "Compendium.pf2e.equipment-srd.Item.UwGcNJS5jjjUssPb") {
      failures.push(`${value.id}: exact level-2 listed-magic boundary drifted.`);
    }
  }
  if (value.id === "adventurers-pack-retry") {
    if (value.kit?.children?.length !== 9) failures.push(`${value.id}: exact nine-child Adventurer's Pack graph drifted.`);
    const faultChild = value.kit?.children?.[value.kit.failBeforeCreateOrdinal - 1];
    if (
      faultChild?.sourceUuid !== value.kit?.faultChildSourceUuid ||
      faultChild?.expansionPath !== value.kit?.faultChildExpansionPath ||
      value.kit?.faultChildReplacementSourceUuid === value.kit?.faultChildSourceUuid
    ) {
      failures.push(`${value.id}: forced-failure child does not match the exact create ordinal.`);
    }
  }
  if (value.id === "supplemental-source-isolation") {
    if (value.supplemental?.packId === value.adjacent?.packId) {
      failures.push(`${value.id}: supplemental equipment and adjacent packs must be distinct.`);
    }
    if (value.supplemental?.expectedSourceBasis !== "approved-pack") {
      failures.push(`${value.id}: supplemental source authority must be approved-pack.`);
    }
    if (
      value.supplemental?.expectedAvailable !== true ||
      value.supplemental?.expectedEligible !== true ||
      value.supplemental?.expectedPriceCopper !== 0 ||
      value.supplemental?.expectedUnavailableReasonCodes?.length !== 0
    ) {
      failures.push(`${value.id}: Salt Stake must pin the explicit-zero allowed-item route.`);
    }
  }
  return failures;
}

function child(expansionPath, parentPath, name, documentId, itemType, quantity) {
  return {
    expansionPath,
    parentPath,
    name,
    sourceUuid: `Compendium.${PF2E_EQUIPMENT_PACK_ID}.Item.${documentId}`,
    itemType,
    quantity,
  };
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
