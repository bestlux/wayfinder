import { wave4EquipmentCases } from "./wave4-equipment-cases.mjs";

export function qualifyWave4EquipmentResult(result, definitions = wave4EquipmentCases) {
  const failures = [];
  if (result?.schemaVersion !== 1) failures.push("Wave 4 equipment evidence schema is not version 1.");
  for (const key of ["foundryVersion", "pf2eVersion", "moduleVersion", "worldId"]) {
    if (typeof result?.runtime?.[key] !== "string" || !result.runtime[key]) failures.push(`Wave 4 equipment evidence is missing runtime.${key}.`);
  }
  if (result?.users?.gm?.isGM !== true || result?.users?.player?.isGM !== false) failures.push("Wave 4 equipment evidence lacks exact GM/non-GM roles.");
  if (result?.users?.gm?.id === result?.users?.player?.id) failures.push("Wave 4 equipment evidence used the same GM and player.");
  if (result?.zeroWrite?.denied !== true || result?.zeroWrite?.unchanged !== true) {
    failures.push("The non-GM settings attempt did not prove an exact zero-write denial.");
  }
  const observed = new Map((result?.cases ?? []).map((entry) => [entry.id, entry]));
  for (const definition of definitions) {
    const entry = observed.get(definition.id);
    if (!entry) {
      failures.push(`Missing Wave 4 equipment case ${definition.id}.`);
      continue;
    }
    if (entry.status !== "pass") failures.push(`${definition.id}: browser result did not pass.`);
    if (entry.definitionFingerprint !== definition.definitionFingerprint) failures.push(`${definition.id}: definition fingerprint differs from the executed fixture.`);
  }
  qualifyPhysical(observed.get("physical-prepared-boundaries"), definitions.find((entry) => entry.id === "physical-prepared-boundaries"), failures);
  qualifyKit(observed.get("adventurers-pack-retry"), definitions.find((entry) => entry.id === "adventurers-pack-retry"), failures);
  qualifySources(observed.get("supplemental-source-isolation"), definitions.find((entry) => entry.id === "supplemental-source-isolation"), failures);
  if (
    result?.cleanup?.actorsDeleted !== 2 ||
    result?.cleanup?.actorsMissingAfterCleanup !== true ||
    result?.cleanup?.policyRestored !== true ||
    result?.cleanup?.packsRestored !== true ||
    result?.cleanup?.sourcesRestored !== true
  ) {
    failures.push("Wave 4 cleanup did not delete exactly two actors and restore all exact settings snapshots.");
  }
  return { ok: failures.length === 0, failures };
}

function qualifyPhysical(observed, definition, failures) {
  const evidence = observed?.evidence;
  const lines = evidence?.lines ?? [];
  if (lines.length !== 7) failures.push("Physical breadth evidence does not contain exactly seven supported types.");
  for (const expected of definition?.physicalItems ?? []) {
    const item = lines.find((entry) => entry.expected?.sourceUuid === expected.sourceUuid);
    const line = item?.line;
    if (!line || line.sourceUuid !== expected.sourceUuid || item.expected.itemType !== expected.itemType) {
      failures.push(`Physical breadth is missing exact ${expected.itemType} source ${expected.sourceUuid}.`);
      continue;
    }
    if (line.price?.size !== "large" || !Number.isSafeInteger(line.price?.unitPriceCopper) || line.price.unitPriceCopper < 0) {
      failures.push(`${expected.name}: Large prepared price evidence is invalid.`);
    }
    if (line.price?.materializedQuantity !== (expected.expectedMaterializedQuantity ?? 1)) {
      failures.push(`${expected.name}: physical stack quantity differs from its exact definition.`);
    }
    if (expected.expectedPricePer !== undefined && (line.price?.pricePer !== expected.expectedPricePer || line.price?.sourceQuantity !== expected.expectedSourceQuantity)) {
      failures.push(`${expected.name}: price.per/source quantity evidence drifted.`);
    }
  }
  if (
    evidence?.stackLine?.sourceUuid !== definition?.stackProbe?.sourceUuid ||
    evidence.stackLine.price?.requestedQuantity !== definition.stackProbe.requestedQuantity ||
    evidence.stackLine.price?.materializedQuantity !== definition.stackProbe.expectedMaterializedQuantity ||
    evidence.stackLine.stackingIntent !== "aggregate"
  ) {
    failures.push("Requested-quantity stack probe did not converge to one exact aggregated Arrows stack.");
  }
  if (
    evidence?.listedMagic?.sourceUuid !== definition?.listedMagic?.sourceUuid ||
    evidence.listedMagic.price?.size !== "large" ||
    evidence.listedMagic.price?.sizeSensitive !== definition.listedMagic.expectedSizeSensitive ||
    evidence.listedMagic.price?.unitPriceCopper !== definition.listedMagic.expectedUnitPriceCopper ||
    evidence.listedMagic.price?.linePriceCopper !== definition.listedMagic.expectedUnitPriceCopper
  ) {
    failures.push("Candlecap did not prove the exact listed magic-item price without a Large size multiplier.");
  }
  const created = evidence?.execution?.inventory?.items?.filter((item) => item.acquisition) ?? [];
  const createdTypes = created.map((item) => item.type).sort();
  const expectedTypes = definition?.physicalItems?.map((item) => item.itemType).sort() ?? [];
  const arrow = created.find((item) => item.sourceUuid === definition?.stackProbe?.sourceUuid);
  if (
    evidence?.execution?.beforeCreateOrdinals?.length !== 7 ||
    created.length !== 7 ||
    JSON.stringify(createdTypes) !== JSON.stringify(expectedTypes) ||
    arrow?.quantity !== definition?.stackProbe?.expectedMaterializedQuantity ||
    evidence?.execution?.manifest?.entries?.length !== 7 ||
    evidence.execution.manifest.entries.flatMap((entry) => entry.observedItems ?? []).length !== 7
  ) {
    failures.push("Physical breadth Apply did not materialize exactly one item per supported type and one quantity-20 Arrows stack.");
  }
  if (
    evidence?.treasure?.sourceUuid !== definition?.treasure?.sourceUuid ||
    evidence.treasure.available !== false ||
    evidence.treasure.unavailableReason !== definition.treasure.expectedDiagnostic
  ) {
    failures.push("Treasure exclusion differs from the exact Gold Pieces diagnostic.");
  }
  const overlay = evidence?.overlay;
  const price = overlay?.line?.price;
  if (
    overlay?.definition?.label !== definition?.preciousMaterialOverlay?.label ||
    overlay?.line?.sourceUuid !== definition?.preciousMaterialOverlay?.sourceUuid ||
    price?.preciousMaterial !== true ||
    price?.size !== "large" ||
    !Number.isSafeInteger(price?.adjustedBulkPriceCopper) ||
    price.adjustedBulkPriceCopper <= 0 ||
    price.unitPriceCopper !== price.adjustedBulkPriceCopper ||
    price.linePriceCopper !== price.adjustedBulkPriceCopper
  ) {
    failures.push("The labelled Buckler silver overlay did not prove one exact PF2E adjusted-Bulk price without doubling.");
  }
}

function qualifyKit(observed, definition, failures) {
  const evidence = observed?.evidence;
  if (evidence?.spray?.sourceUuid !== definition?.smallDiagnostics?.exact?.sourceUuid || evidence.spray.price?.linePriceCopper !== 1) {
    failures.push("Small Spray Pellets did not retain its exact one-copper price.");
  }
  if (evidence?.candleMessage !== definition?.smallDiagnostics?.unavailable?.expectedMessage) failures.push("Small Candle did not produce the exact partial-unit diagnostic.");
  const kitLine = evidence?.kitLine;
  if (kitLine?.sourceUuid !== definition?.kit?.sourceUuid || kitLine?.price?.linePriceCopper !== 150 || kitLine?.kitExpansion?.items?.length !== 9) {
    failures.push("Adventurer's Pack reviewed line does not contain the exact 15 sp nine-child graph.");
  } else {
    const actual = kitLine.kitExpansion.items.map((item) => ({
      expansionPath: item.expansionPath,
      parentPath: item.parentPath,
      name: item.name,
      sourceUuid: item.sourceUuid,
      itemType: item.itemType,
      quantity: item.quantity,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(definition.kit.children)) failures.push("Adventurer's Pack child graph differs from the exact PF2E profile.");
  }
  if (
    evidence?.initial?.childDrift?.message !==
      `Acquisition kit child ${definition?.kit?.faultChildExpansionPath} drifted before Apply.` ||
    evidence?.initial?.childDrift?.sourceUuid !== definition?.kit?.faultChildSourceUuid ||
    evidence?.initial?.childDrift?.replacementSourceUuid !== definition?.kit?.faultChildReplacementSourceUuid ||
    evidence?.initial?.childDrift?.createdItemCount !== 0 ||
    evidence?.initial?.childDrift?.currencyCopper !== 0 ||
    JSON.stringify(evidence?.initial?.beforeCreateOrdinals) !== JSON.stringify([1, 2, 3, 4, 5]) ||
    evidence?.initial?.failure !==
      `Wave 4 forced partial kit write failure before child ${definition?.kit?.faultChildSourceUuid} create ordinal ${definition?.kit?.failBeforeCreateOrdinal}.` ||
    evidence?.initial?.createdItemCount !== definition?.kit?.expectedCreatedBeforeFailure ||
    evidence?.initial?.currencyCopper !== 0 ||
    evidence?.initial?.manifest !== null
  ) {
    failures.push("Adventurer's Pack child drift or forced partial failure did not fail closed with zero currency.");
  }
  if (
    evidence?.retry?.beforeCreateOrdinals?.length !== definition?.kit?.expectedCreatedOnRetry ||
    evidence?.retry?.createdItemCount !== 9 ||
    evidence?.retry?.currencyCopper !== 1_350 ||
    evidence?.retry?.manifest?.entries?.[0]?.observedItems?.length !== 9
  ) {
    failures.push("Fresh-reload Adventurer's Pack retry did not create only the remaining five items and converge currency/manifest.");
  }
  const inventory = evidence?.final?.inventory?.items ?? [];
  const acquisitions = inventory.filter((item) => item.acquisition);
  const backpack = acquisitions.find((item) => item.type === "backpack");
  const plannedIds = acquisitions.map((item) => item.acquisition?.plannedItemId);
  if (
    acquisitions.length !== 9 ||
    new Set(plannedIds).size !== 9 ||
    !backpack ||
    acquisitions.filter((item) => item.id !== backpack.id).some((item) => item.containerId !== backpack.id)
  ) {
    failures.push("Adventurer's Pack final inventory has duplicates or incorrect actual containment.");
  }
  if (
    evidence?.final?.noopUnchanged !== true ||
    !evidence?.final?.durableManifest ||
    JSON.stringify(evidence.final.durableManifest) !== JSON.stringify(evidence.final.recoveredManifest)
  ) {
    failures.push("Adventurer's Pack completed manifest was not durable or its rerun was not an exact no-op.");
  }
}

function qualifySources(observed, definition, failures) {
  const evidence = observed?.evidence;
  const player = evidence?.playerSources;
  const gm = evidence?.gmSources;
  if (!player || !gm || JSON.stringify(player) !== JSON.stringify(gm)) failures.push("GM and player effective equipment source projections differ.");
  for (const projection of [player, gm]) {
    if (!projection) continue;
    if (
      projection.ignoreAsGM !== true ||
      projection.defaultLoadAbsent !== definition?.pf2eSettings?.defaultLoadWhenAbsent ||
      !projection.effectivePackIds.includes(definition?.supplemental?.packId) ||
      !projection.effectivePackIds.includes("pf2e.equipment-srd") ||
      projection.effectivePackIds.includes(definition?.adjacent?.packId)
    ) {
      failures.push("Supplemental source projection inherited role visibility or admitted the adjacent feat pack.");
    }
  }
  if (
    evidence?.saltStake?.sourceUuid !== definition?.supplemental?.sourceUuid ||
    evidence?.saltStake?.itemType !== definition?.supplemental?.itemType ||
    evidence?.saltStake?.unavailableReason !== definition?.supplemental?.expectedUnavailableReason ||
    evidence?.saltAuthority?.eligible !== false ||
    evidence?.saltAuthority?.sourceBasis !== definition?.supplemental?.expectedSourceBasis ||
    !evidence?.saltAuthority?.unavailableReasonCodes?.includes(definition?.supplemental?.expectedUnavailableReasonCode) ||
    evidence?.saltAuthority?.unavailableReasonCodes?.includes("source-not-allowed")
  ) {
    failures.push("Salt Stake did not prove the allowed supplemental pack with its exact zero-price diagnostic.");
  }
}
