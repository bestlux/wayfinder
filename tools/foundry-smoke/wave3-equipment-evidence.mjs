import { wave3EquipmentCases } from "./wave3-equipment-cases.mjs";

export function qualifyWave3EquipmentResult(result, definitions = wave3EquipmentCases) {
  const failures = [];
  if (result?.schemaVersion !== 1) failures.push("Wave 3 equipment evidence schema is not version 1.");
  for (const key of ["foundryVersion", "pf2eVersion", "moduleVersion", "worldId"]) {
    if (typeof result?.runtime?.[key] !== "string" || !result.runtime[key]) {
      failures.push(`Wave 3 equipment evidence is missing runtime.${key}.`);
    }
  }
  if (result?.users?.player?.isGM !== false) failures.push("Player evidence was not collected by a non-GM.");
  if (result?.users?.gm?.isGM !== true) failures.push("GM evidence was not collected by a GM.");
  if (result?.users?.player?.id === result?.users?.gm?.id) failures.push("Player and GM evidence used the same user.");
  if (result?.zeroWrite?.denied !== true || result?.zeroWrite?.unchanged !== true) {
    failures.push("The non-GM authority denial did not prove zero actor, draft, currency, item, and judgment writes.");
  }

  const observedById = new Map((result?.cases ?? []).map((entry) => [entry.id, entry]));
  for (const definition of definitions) {
    const observed = observedById.get(definition.id);
    if (!observed) {
      failures.push(`Missing Wave 3 equipment case ${definition.id}.`);
      continue;
    }
    if (observed.definitionFingerprint !== definition.definitionFingerprint) {
      failures.push(`${definition.id}: definition fingerprint differs from the executed fixture.`);
    }
    if (observed.actorId !== observed.subject?.actorId || observed.targetLevel !== definition.targetLevel) {
      failures.push(`${definition.id}: actor/level subject binding is invalid.`);
    }
    if (observed.startEvidence?.kind !== "gm-confirmation") {
      failures.push(`${definition.id}: higher-level start lacks durable GM confirmation.`);
    }
    if (observed.status !== "pass") failures.push(`${definition.id}: browser result did not pass.`);
    if (definition.expected && !sameExpectedRecipe(observed.recipe, definition.expected)) {
      failures.push(`${definition.id}: exact recipe evidence differs from the case definition.`);
    }
  }

  const configuredDefinition = definitions.find((entry) => entry.configuredItem);
  const configured = configuredDefinition ? observedById.get(configuredDefinition.id) : null;
  const components = configured?.configuredLine?.price?.configurationComponents;
  if (!components || components.version !== 1) {
    failures.push("Configured equipment evidence is missing PF2E component version 1.");
  } else {
    const componentTotal =
      components.baselineAndFundamentalCopper + components.propertyRuneCopper + components.preciousMaterialCopper;
    if (componentTotal !== components.prepared?.totalCopper) {
      failures.push("Configured equipment component sum differs from PF2E's prepared total.");
    }
    if (configured.configuredLine.price.unitPriceCopper !== components.prepared.totalCopper) {
      failures.push("Configured equipment acquisition price differs from PF2E's prepared total.");
    }
    if (
      components.itemType !== configuredDefinition.configuredItem.itemType ||
      components.baseItem !== configuredDefinition.configuredItem.baseItem
    ) {
      failures.push("Configured equipment base identity differs from the exact case definition.");
    }
    failures.push(...qualifyMorningGlowAbp(components, configured?.abp));
  }
  if (configured?.configuredLine?.sourceUuid !== configuredDefinition?.configuredItem?.sourceUuid) {
    failures.push("Configured equipment line is not the exact Morning Glow source.");
  }
  if (configured?.handoff?.message !== configuredDefinition?.handoffItem?.message) {
    failures.push("Specific configured item diagnostic differs from the exact PF2E inventory-sheet handoff.");
  }
  if (
    configured?.handoff?.typedDisposition?.kind !== "handoff" ||
    configured?.handoff?.typedDisposition?.handoff?.kind !== "pf2e-sheet" ||
    configured?.handoff?.typedDisposition?.acknowledgedByUserId !== null ||
    configured?.handoff?.typedDisposition?.acknowledgedAt !== null
  ) {
    failures.push("Specific configured item lacks an exact typed handoff disposition.");
  } else {
    const reasons = configured.handoff.typedDisposition.handoff.reasons;
    const expectedReason = {
      code: "unsafe-configured-item",
      sourceUuid: configuredDefinition.handoffItem.sourceUuid,
      itemName: configuredDefinition.handoffItem.name,
      issue: "specific-magic-item",
    };
    if (
      !configured.handoff.typedDisposition.handoff.baselineFingerprint ||
      JSON.stringify(reasons) !== JSON.stringify([expectedReason])
    ) {
      failures.push("Specific configured item typed handoff reason differs from the exact structural boundary.");
    }
  }
  if (configured?.handoff?.economicWritesUnchanged !== true) {
    failures.push("Specific configured item handoff changed actor inventory or currency.");
  }
  if (!Array.isArray(configured?.approvedExceptionSourceUuids)) {
    failures.push("Configured equipment evidence lacks exact approved exception sources.");
  } else if (
    configured.approvedExceptionSourceUuids.length !== 1 ||
    configured.approvedExceptionSourceUuids[0] !== configuredDefinition?.configuredItem?.sourceUuid
  ) {
    failures.push("Configured equipment evidence did not limit exact exception approval to Morning Glow.");
  }
  if (configured?.handoff?.persistedExceptionApproved !== false) {
    failures.push("The structurally unsupported specific item must not receive a persisted authority exception.");
  }

  return { ok: failures.length === 0, failures };
}

function sameExpectedRecipe(actual, expected) {
  if (!actual || actual.kind !== expected.kind) return false;
  if (expected.kind === "lump-sum" || expected.kind === "custom-lump-sum") {
    return actual.budgetCopper === expected.budgetCopper && actual.maxItemLevel === expected.maxItemLevel;
  }
  const levels = (actual.allowances ?? []).map((entry) => entry.itemLevel).sort((a, b) => a - b);
  return actual.currencyCopper === expected.currencyCopper && JSON.stringify(levels) === JSON.stringify(expected.allowanceLevels);
}

function qualifyMorningGlowAbp(components, abp) {
  const mode = abp?.mode ?? "noABP";
  const expected = {
    noABP: [200_000, 140_000, 105_600, 445_600, []],
    ABPFundamentalPotency: [0, 140_000, 105_600, 245_600, ["fundamental-runes"]],
    ABPRulesAsWritten: [0, 0, 105_600, 105_600, ["fundamental-runes", "property-runes"]],
  }[mode];
  if (!expected) return [`Configured equipment evidence used unsupported ABP mode ${mode}.`];
  const actual = [
    components.baselineAndFundamentalCopper,
    components.propertyRuneCopper,
    components.preciousMaterialCopper,
    components.prepared.totalCopper,
    [...components.suppressedByAbp],
  ];
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [`Morning Glow PF2E prepared components drifted under ABP mode ${mode}.`];
}
