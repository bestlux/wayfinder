import type { DraftState } from "../../types.js";
import { resolveAcquisitionPrice } from "../domain/acquisition-ledger.js";
import type { EconomicHandoffReason } from "../domain/economic-baseline.js";
import type { EquipmentPolicyJudgmentRecord, EquipmentWorldPolicyV1 } from "../domain/equipment-policy.js";
import type { WayfinderStepEvaluation } from "../domain/step-evaluation.js";
import type { StartingEquipmentStep } from "../domain/step-types.js";
import type { StartingEquipmentCatalogueRecord, StartingEquipmentStepPane } from "../view-models.js";

export interface StartingEquipmentCatalogueProjection {
  readonly state: "pending" | "ready" | "error";
  readonly message: string;
  readonly query: string;
  readonly records: readonly StartingEquipmentCatalogueRecord[];
  readonly filters: readonly { key: string; label: string; value: string }[];
  readonly activeFilters: Readonly<Record<string, readonly string[]>>;
  readonly previewSourceUuid: string | null;
  readonly titanMauler: {
    readonly required: boolean;
    readonly selectedSourceUuid: string | null;
  };
}

export const MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS = 12;

export function buildStartingEquipmentPane(
  step: StartingEquipmentStep,
  draft: DraftState,
  evaluation: WayfinderStepEvaluation,
  catalogue: StartingEquipmentCatalogueProjection,
  setupOptions?: {
    readonly worldPolicy: EquipmentWorldPolicyV1;
    readonly judgments: readonly EquipmentPolicyJudgmentRecord[];
    readonly isGm: boolean;
  }
): StartingEquipmentStepPane {
  const acquisition = draft.acquisition;
  const policy = acquisition?.policySnapshot?.material ?? null;
  const budgetCopper = policy?.budgetCopper ?? 1_500;
  const spentCopper = acquisition?.lines.reduce((sum, line) => sum + chargedCopper(line), 0) ?? 0;
  const reviewedRemaining =
    acquisition?.disposition.kind === "purchase-ledger" || acquisition?.disposition.kind === "retain-all"
      ? acquisition.disposition.review.remainingCopper
      : null;
  const remainingCopper = reviewedRemaining ?? Math.max(0, budgetCopper - spentCopper);
  const usedAllowanceIds = new Set(
    acquisition?.lines.flatMap((line) => {
      const funding = line.funding;
      if (funding.lane !== "allowance") return [];
      const assignment = funding.assignment;
      return assignment.mode === "player" ? [assignment.allowanceId] : [];
    }) ?? []
  );
  const availableAllowances =
    policy?.allowances.filter((allowance) => !usedAllowanceIds.has(allowance.allowanceId)) ?? [];
  const matchingRecords = catalogue.records.filter(
    (record) => matchesQuery(record, catalogue.query) && matchesFilters(record, catalogue.activeFilters)
  );
  const records = matchingRecords.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS).map((record) => {
    const affordable = record.priceCopper !== null && record.priceCopper <= remainingCopper;
    const canBuyWithCurrency = record.available && record.level < step.level && affordable;
    const allowanceOptions =
      policy?.resolvedRecipe.kind === "permanent-items" && isPermanentItemType(record.itemType)
        ? availableAllowances
            .filter((allowance) => allowance.itemLevel >= record.level)
            .map((allowance) => ({
              allowanceId: allowance.allowanceId,
              label: `Use level ${allowance.itemLevel} allowance`,
            }))
        : [];
    const exceptionPending = draft.equipmentPolicyRequests.some(
      (request) =>
        request.withdrawnAt === null &&
        request.facts.kind === "rarity-source-exception" &&
        request.facts.draftId === acquisition?.draftId &&
        request.facts.sourceUuid === record.sourceUuid
    );
    return {
      ...record,
      affordable,
      previewing: record.sourceUuid === catalogue.previewSourceUuid,
      canAdd: canBuyWithCurrency || allowanceOptions.length > 0,
      canBuyWithCurrency,
      allowanceOptions,
      canRequestException: record.exceptionRequestable && setupOptions?.isGm !== true && !exceptionPending,
      canApproveException: record.exceptionRequestable && setupOptions?.isGm === true,
      canChooseTitanMauler:
        catalogue.titanMauler.required &&
        catalogue.titanMauler.selectedSourceUuid === null &&
        record.titanMaulerEligible,
    };
  });
  const recordByUuid = new Map(catalogue.records.map((record) => [record.sourceUuid, record]));
  const plannedGrantById = new Map(acquisition?.plannedClassGrants.map((grant) => [grant.grantId, grant]) ?? []);
  const preview = records.find((record) => record.previewing) ?? null;
  const selectedTitanMaulerRecord = catalogue.titanMauler.selectedSourceUuid
    ? recordByUuid.get(catalogue.titanMauler.selectedSourceUuid)
    : null;
  const cartLines =
    acquisition?.lines.map((line) => {
      const record = recordByUuid.get(line.sourceUuid);
      return {
        lineId: line.lineId,
        sourceUuid: line.sourceUuid,
        name: record?.name ?? line.sourceUuid,
        quantity: line.price.materializedQuantity,
        priceLabel: formatCopper(line.price.linePriceCopper),
        configurationLabel: configuredPriceLabel(line.price),
        fundingLabel: fundingLabel(line.funding, policy?.allowances ?? []),
        canRemove:
          line.funding.lane !== "class-grant" ||
          plannedGrantById.get(line.funding.grant.plannedGrantId)?.materializer !== "pf2e-native",
        canChangeQuantity: line.funding.lane !== "class-grant" && !line.price.configurationComponents,
        unavailableReason:
          line.funding.lane === "class-grant" || line.policyDecision.eligible
            ? null
            : "Your world's rules no longer allow this item.",
        focusId: `starting-equipment-line:${line.lineId}`,
      };
    }) ?? [];
  const disposition = acquisition?.disposition.kind ?? "not-started";
  const currencyLines = acquisition?.lines.filter((line) => line.funding.lane !== "class-grant") ?? [];
  const handoff = acquisition?.disposition.kind === "handoff" ? acquisition.disposition : null;
  const worldPolicy = setupOptions?.worldPolicy ?? null;
  const awaitingAuthority = !!acquisition && !policy;
  const selectedRecipe =
    acquisition?.recipe.kind === "permanent-items" || acquisition?.recipe.kind === "lump-sum"
      ? acquisition.recipe.kind
      : null;
  const judgments = setupOptions?.judgments ?? [];
  const pendingRequests = draft.equipmentPolicyRequests.filter(
    (request) =>
      request.withdrawnAt === null &&
      request.facts.draftId === acquisition?.draftId &&
      request.facts.targetLevel === acquisition?.targetLevel &&
      !judgments.some((judgment) => judgment.request.requestId === request.requestId && judgment.revocation === null)
  );
  const reviewedStartJudgment = policy?.gmJudgments.find((judgment) => judgment.kind === "higher-level-start") ?? null;
  const activeJudgment = reviewedStartJudgment
    ? (judgments.find((judgment) => judgment.id === reviewedStartJudgment.id && judgment.revocation === null) ?? null)
    : null;
  const startAuthorityInvalid = reviewedStartJudgment !== null && activeJudgment === null;

  return {
    kind: "starting-equipment",
    templateKind: "starting-equipment",
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: "Equipment",
    title: step.title,
    description: step.description,
    initialized: !!acquisition,
    corrupt: draft.acquisitionCorrupt,
    setup: {
      awaitingAuthority: awaitingAuthority || startAuthorityInvalid,
      canChooseRecipe: awaitingAuthority && worldPolicy?.recipeChoiceAuthority === "actor-owner",
      selectedRecipe,
      recipeOptions: (worldPolicy?.enabledRecipes ?? []).map((value) => ({
        value,
        label: value === "permanent-items" ? "Permanent items and coin" : "Lump sum of coin",
        selected: value === selectedRecipe,
      })),
      authorityMessage: startAuthorityInvalid
        ? "The prior GM approval is no longer current. Request a new approval before Apply."
        : awaitingAuthority
          ? worldPolicy?.higherLevelStartAuthority === "actor-owner-attestation"
            ? "As an owner, you can attest that this is a new or replacement higher-level character."
            : setupOptions?.isGm
              ? "Confirm whether this is a new-campaign or replacement-character start before shopping."
              : "A GM must confirm this higher-level start before shopping."
          : null,
      canActivate:
        (awaitingAuthority || startAuthorityInvalid) &&
        (worldPolicy?.higherLevelStartAuthority === "actor-owner-attestation" || setupOptions?.isGm === true),
      canRequest:
        (awaitingAuthority || startAuthorityInvalid) &&
        worldPolicy?.higherLevelStartAuthority === "gm-confirmation" &&
        setupOptions?.isGm !== true &&
        pendingRequests.length === 0,
      pendingRequests: pendingRequests.map((request) => ({
        requestId: request.requestId,
        requesterName: request.requesterName,
        requestedAt: request.requestedAt,
        reason: request.reason,
        kindLabel:
          request.facts.kind === "higher-level-start"
            ? `Level ${request.facts.targetLevel} higher-level start`
            : request.facts.kind === "rarity-source-exception"
              ? `Exact item exception: ${request.facts.sourceUuid}`
              : request.facts.kind,
        canApprove: setupOptions?.isGm === true,
      })),
      activeJudgmentId: activeJudgment?.id ?? null,
      canRevoke: setupOptions?.isGm === true && activeJudgment !== null,
      canSetCustomLumpSum:
        setupOptions?.isGm === true &&
        !!policy &&
        (policy.resolvedRecipe.kind === "lump-sum" || policy.resolvedRecipe.kind === "custom-lump-sum") &&
        !acquisition?.lines.some((line) => line.funding.lane === "allowance"),
      canGrantExtraAllowance:
        setupOptions?.isGm === true &&
        policy?.resolvedRecipe.kind === "permanent-items" &&
        !policy.allowances.some((allowance) => allowance.allowanceId.startsWith("gm-extra:")),
    },
    policy: {
      recipeLabel: policy ? recipeLabel(policy.resolvedRecipe.kind) : "Set once you start shopping",
      budgetLabel: formatCopper(budgetCopper),
      automaticEligibilityLabel: policy
        ? `${capitalize(policy.rarityPolicy.blanketCeiling)} gear from ${policy.sourcePolicy.effectivePackIds.length} approved pack${policy.sourcePolicy.effectivePackIds.length === 1 ? "" : "s"}`
        : "Common gear from approved PF2E sources",
      authorityLabel: policy
        ? authoritySentence(policy.authorityPolicy.recipeChoice, policy.authorityPolicy.apply)
        : "From your GM's settings",
      recipeSelectionLabel: recipeSelectionLabel(acquisition?.recipeSelection),
      handoffLabel: "Coin and gear your character already has stay put. Handle those on the PF2E inventory tab.",
      explanations: policy && acquisition ? policyExplanations(acquisition) : [],
      allowances:
        policy?.allowances.map((allowance) => ({
          ...allowance,
          label: `Level ${allowance.itemLevel} permanent item`,
          used: usedAllowanceIds.has(allowance.allowanceId),
        })) ?? [],
    },
    catalogue: {
      state: catalogue.state,
      message: catalogue.message,
      search: catalogue.query,
      searchDisabled: !acquisition || catalogue.state !== "ready" || !!handoff,
      filters: catalogue.filters.map((filter) => ({
        ...filter,
        selected: catalogue.activeFilters[filter.key]?.includes(filter.value) ?? false,
      })),
      totalResultCount: matchingRecords.length,
      visibleResultCount: records.length,
      items: records,
      preview,
    },
    cart: {
      lines: cartLines,
      empty: cartLines.length === 0,
      spentLabel: formatCopper(spentCopper),
      remainingLabel: formatCopper(remainingCopper),
    },
    titanMauler: {
      required: catalogue.titanMauler.required,
      selected: catalogue.titanMauler.selectedSourceUuid !== null,
      selectedName: selectedTitanMaulerRecord?.name ?? catalogue.titanMauler.selectedSourceUuid,
    },
    review: {
      disposition,
      label: evaluation.status,
      canReviewPurchases:
        !!acquisition &&
        !handoff &&
        currencyLines.length > 0 &&
        (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
      canRetainAll:
        !!acquisition &&
        !handoff &&
        currencyLines.length === 0 &&
        (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
    },
    handoff: {
      active: !!handoff,
      acknowledged: !!handoff?.acknowledgedByUserId && !!handoff.acknowledgedAt,
      reasons: handoff?.handoff.reasons.map(handoffReason) ?? [],
    },
  };
}

function recipeSelectionLabel(selection: NonNullable<DraftState["acquisition"]>["recipeSelection"]): string {
  if (!selection) return "Recorded when funding is selected";
  if (selection.selector.kind === "unattributed-world-policy") {
    return `Fixed by legacy world policy at ${selection.selectedAt}`;
  }
  return `${selection.selector.userName} selected this at ${selection.selectedAt}`;
}

function matchesQuery(record: StartingEquipmentCatalogueRecord, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [record.name, record.sourceLabel, record.rarity, record.itemType, ...record.traits]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalized);
}

function matchesFilters(
  record: StartingEquipmentCatalogueRecord,
  filters: Readonly<Record<string, readonly string[]>>
): boolean {
  return Object.entries(filters).every(([key, values]) => {
    if (values.length === 0) return true;
    const actual =
      key === "rarity"
        ? record.rarity
        : key === "source"
          ? record.sourceLabel
          : key === "type"
            ? record.itemType
            : null;
    return actual !== null && values.includes(actual);
  });
}

function policyExplanations(acquisition: NonNullable<DraftState["acquisition"]>): readonly string[] {
  const material = acquisition.policySnapshot?.material;
  if (!material) return [];
  const fundingExplanation =
    material.resolvedRecipe.kind === "permanent-items"
      ? `Your permanent-item allowances are separate from ${formatCopper(material.budgetCopper)} in starting coin. Unused allowances never become cash.`
      : `You have ${formatCopper(material.budgetCopper)} in starting coin for Common items below level ${material.subject.targetLevel}.`;
  return [
    fundingExplanation,
    material.rarityPolicy.blanketCeiling === "common"
      ? "Anything Common is fair game, as long as its pack is approved."
      : `Your GM has opened this up to ${material.rarityPolicy.blanketCeiling} gear.`,
    ...(material.abp.enabled
      ? [
          material.abp.actorOverrideDisabled
            ? `PF2E's ${material.abp.mode ?? "ABP"} mode is enabled, but this actor's ABP override is disabled.`
            : `PF2E's ${material.abp.mode ?? "ABP"} mode is active. Configured gear uses PF2E's prepared rune state without changing starting currency.`,
        ]
      : []),
  ];
}

function configuredPriceLabel(price: NonNullable<DraftState["acquisition"]>["lines"][number]["price"]): string | null {
  const components = price.configurationComponents;
  if (!components) return null;
  return [
    `baseline/fundamental ${formatCopper(components.baselineAndFundamentalCopper)}`,
    components.propertyRuneCopper > 0 ? `property runes ${formatCopper(components.propertyRuneCopper)}` : null,
    components.preciousMaterialCopper > 0
      ? `precious material ${formatCopper(components.preciousMaterialCopper)}`
      : null,
    components.suppressedByAbp.length > 0 ? `PF2E ABP suppresses ${components.suppressedByAbp.join(", ")}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function recipeLabel(kind: string): string {
  switch (kind) {
    case "level-1-equivalent":
      return "Level 1 starting wealth";
    case "permanent-items":
      return "Permanent items and coin";
    case "lump-sum":
      return "Lump sum of coin";
    default:
      return "Lump sum set by your GM";
  }
}

function isGmAuthority(value: string): boolean {
  return value === "gm-fixed" || value === "gm-review" || value === "gm-confirmation";
}

function authoritySentence(recipeChoice: string, apply: string): string {
  const gmChooses = isGmAuthority(recipeChoice);
  const gmApplies = isGmAuthority(apply);
  if (gmChooses && gmApplies) return "Your GM chooses the funding and applies it";
  if (gmChooses) return "Your GM chooses the funding, you apply it";
  if (gmApplies) return "You choose the funding, your GM applies it";
  return "You choose the funding and apply it";
}

function fundingLabel(
  funding: NonNullable<DraftState["acquisition"]>["lines"][number]["funding"],
  allowances: readonly { readonly allowanceId: string; readonly itemLevel: number }[]
): string {
  if (funding.lane === "class-grant") return "Granted by your build · free";
  if (funding.lane === "allowance") {
    const assignment = funding.assignment;
    if (assignment.mode === "automatic") return "Permanent item allowance";
    const allowance = allowances.find((candidate) => candidate.allowanceId === assignment.allowanceId);
    return allowance ? `Level ${allowance.itemLevel} permanent item allowance` : "Permanent item allowance";
  }
  return "Paid from starting wealth";
}

function chargedCopper(line: NonNullable<DraftState["acquisition"]>["lines"][number]): number {
  if (line.funding.lane === "class-grant") return 0;
  const resolved = resolveAcquisitionPrice(line.price);
  if (resolved.ok === false) return line.price.linePriceCopper;
  return line.funding.lane === "allowance" ? resolved.value.supplementalCopper : resolved.value.totalCopper;
}

function isPermanentItemType(itemType: string): boolean {
  return itemType !== "ammo" && itemType !== "consumable";
}

function handoffReason(reason: EconomicHandoffReason): string {
  switch (reason.code) {
    case "unsafe-configured-item":
      return `${reason.itemName} has PF2E pricing or magic-item structure Wayfinder cannot reproduce safely. Add it on the PF2E inventory tab instead.`;
    case "foreign-physical-items":
      return "Your character already owns gear. Wayfinder leaves it alone, so pick up the rest on the PF2E inventory tab.";
    case "nonzero-currency":
      return "Your character already has coin. Wayfinder won't touch it, so spend it from the PF2E inventory tab.";
    case "unresolved-class-grant":
      return "Your build grants an item Wayfinder couldn't match to anything in your inventory.";
    default:
      return "Your build grants an item that matches more than one thing in your inventory.";
  }
}

function formatCopper(copper: number): string {
  if (!Number.isSafeInteger(copper) || copper < 0) return "Unavailable";
  if (copper === 0) return "0 gp";
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  return [gp > 0 ? `${gp} gp` : "", sp > 0 ? `${sp} sp` : "", cp > 0 ? `${cp} cp` : ""].filter(Boolean).join(" ");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
