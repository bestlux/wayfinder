import type { DraftState } from "../../types.js";
import {
  type AcquisitionLocalize,
  localizeEquipmentSourceDiagnostic,
} from "../application/acquisition-localization.js";
import {
  equipmentAllowanceFocusId,
  equipmentFilterFocusId,
  equipmentItemFocusId,
  equipmentLineControlFocusId,
  equipmentLineFocusId,
} from "../application/equipment-accessibility.js";
import type { EquipmentSourceDiagnostic } from "../application/equipment-source-policy.js";
import { resolveAcquisitionPrice } from "../domain/acquisition-ledger.js";
import type { EconomicHandoffReason } from "../domain/economic-baseline.js";
import type {
  EquipmentPolicyJudgmentRecord,
  EquipmentPolicyRequestDecisionV1,
  EquipmentPolicyRequestV1,
  EquipmentWorldPolicyV1,
} from "../domain/equipment-policy.js";
import { equipmentPolicyJudgmentFactsEqual } from "../domain/equipment-policy.js";
import type { WayfinderStepEvaluation } from "../domain/step-evaluation.js";
import type { StartingEquipmentStep } from "../domain/step-types.js";
import type { StartingEquipmentCatalogueRecord, StartingEquipmentStepPane } from "../view-models.js";

export interface StartingEquipmentCatalogueProjection {
  readonly state: "pending" | "ready" | "error";
  readonly message: string;
  readonly diagnostics?: readonly EquipmentSourceDiagnostic[];
  readonly query: string;
  /** Uncapped query/facet matches after the active recipe's level boundary is applied. */
  readonly matchedRecordCount: number;
  readonly records: readonly StartingEquipmentCatalogueRecord[];
  /** Stable metadata for reviewed cart lines that are outside the bounded browse page. */
  readonly lineRecords?: readonly StartingEquipmentCatalogueRecord[];
  readonly filters: readonly { key: string; label: string; value: string }[];
  readonly activeFilters: Readonly<Record<string, readonly string[]>>;
  readonly previewSourceUuid: string | null;
  readonly openFilterPanel?: "rarity" | "source" | null;
  readonly sourceFilterQuery?: string;
  readonly titanMauler: {
    readonly required: boolean;
    readonly selectedSourceUuid: string | null;
  };
}

export const MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS = 12;

const FOUNDRY_INTL_LOCALE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  cn: "zh-CN",
});
const INLINE_STARTING_EQUIPMENT_TYPE_FILTERS = [
  "ammo",
  "armor",
  "backpack",
  "consumable",
  "equipment",
  "kit",
  "shield",
  "weapon",
] as const;
export const MAX_INLINE_STARTING_EQUIPMENT_TYPE_FILTERS = INLINE_STARTING_EQUIPMENT_TYPE_FILTERS.length;
export const MAX_VISIBLE_STARTING_EQUIPMENT_SOURCE_FILTERS = 12;

export function buildStartingEquipmentPane(
  step: StartingEquipmentStep,
  draft: DraftState,
  _evaluation: WayfinderStepEvaluation,
  catalogue: StartingEquipmentCatalogueProjection,
  localize: AcquisitionLocalize,
  setupOptions?: {
    readonly worldPolicy: EquipmentWorldPolicyV1;
    readonly judgments: readonly EquipmentPolicyJudgmentRecord[];
    readonly requestDecisions?: readonly EquipmentPolicyRequestDecisionV1[];
    readonly isGm: boolean;
    /** Foundry's selected language, so recorded instants read in the session's locale. */
    readonly locale?: string;
  }
): StartingEquipmentStepPane {
  const acquisition = draft.acquisition;
  const sourceDiagnostics = catalogue.diagnostics ?? [];
  const catalogueReady = catalogue.state === "ready" && sourceDiagnostics.length === 0;
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
  const matchingRecords = catalogueReady
    ? catalogue.records.filter(
        (record) => matchesQuery(record, catalogue.query) && matchesFilters(record, catalogue.activeFilters)
      )
    : [];
  const matchedRecordCount = catalogueReady ? catalogue.matchedRecordCount : 0;
  const requestDecisions = setupOptions?.requestDecisions ?? [];
  const requestDecisionById = new Map(requestDecisions.map((decision) => [decision.request.requestId, decision]));
  const records = matchingRecords.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS).map((record) => {
    const currencyAffordable = record.priceCopper !== null && record.priceCopper <= remainingCopper;
    const canBuyWithCurrency = record.available && record.level < step.level && currencyAffordable;
    const allowanceOptions =
      record.available && policy?.resolvedRecipe.kind === "permanent-items" && isPermanentItemType(record.itemType)
        ? dedupeAllowanceLevels(availableAllowances.filter((allowance) => allowance.itemLevel >= record.level)).map(
            (allowance) => ({
              allowanceId: allowance.allowanceId,
              label:
                allowance.remaining > 1
                  ? localize("wayfinder-pf2e.StartingEquipment.Allowance.UseWithCount", {
                      level: allowance.itemLevel,
                      count: allowance.remaining,
                    })
                  : localize("wayfinder-pf2e.StartingEquipment.Allowance.Use", { level: allowance.itemLevel }),
              ariaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.UseAllowanceForItem", {
                level: allowance.itemLevel,
                name: record.name,
              }),
              focusId: equipmentAllowanceFocusId(record.sourceUuid, allowance.allowanceId),
            })
          )
        : [];
    const exceptionPending = draft.equipmentPolicyRequests.some(
      (request) =>
        request.withdrawnAt === null &&
        request.decline === null &&
        requestDecisionFor(request, requestDecisionById)?.outcome !== "declined" &&
        request.facts.kind === "rarity-source-exception" &&
        request.facts.draftId === acquisition?.draftId &&
        request.facts.sourceUuid === record.sourceUuid
    );
    const unavailableReason = record.unavailableReason
      ? localize(
          record.exceptionRequestable
            ? "wayfinder-pf2e.StartingEquipment.Catalogue.ExceptionRequired"
            : "wayfinder-pf2e.StartingEquipment.Catalogue.ItemUnavailable"
        )
      : null;
    const noFundingReason =
      unavailableReason ??
      (!canBuyWithCurrency && allowanceOptions.length === 0
        ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.NoFunding")
        : null);
    const resultAvailability = noFundingReason ?? localize("wayfinder-pf2e.StartingEquipment.Catalogue.Available");
    const priceLabel = cataloguePriceLabel(record, localize);
    const localizedRarity = rarityLabel(record.rarity, localize);
    const resultLabel = localize("wayfinder-pf2e.StartingEquipment.Catalogue.ResultLabel", {
      name: record.name,
      meta: localize("wayfinder-pf2e.StartingEquipment.Catalogue.ItemMeta", {
        level: record.level,
        rarity: localizedRarity,
        source: record.sourceLabel,
      }),
      price: priceLabel,
      availability: resultAvailability,
    });
    return {
      ...record,
      priceLabel,
      rarityLabel: localizedRarity,
      typeIcon: itemTypeIcon(record.itemType),
      itemTypeLabel: itemTypeLabel(record.itemType, localize),
      traits: record.traits.map((trait) => pf2eTraitLabel(trait, localize)),
      // The compendium index carries no bulk, so the placeholder is dropped rather than shown as a non-answer.
      bulkLabel: record.bulkLabel === "See item details" ? "" : record.bulkLabel,
      unavailableReason,
      currencyAffordable,
      previewing: record.sourceUuid === catalogue.previewSourceUuid,
      canAdd: canBuyWithCurrency || allowanceOptions.length > 0,
      resultLabel,
      canBuyWithCurrency,
      previewAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.PreviewItem", {
        name: resultLabel,
      }),
      previewFocusId: equipmentItemFocusId(record.sourceUuid, "preview"),
      buyAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.BuyItemWithCoin", {
        name: record.name,
      }),
      buyFocusId: equipmentItemFocusId(record.sourceUuid, "coin"),
      unavailableAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.CannotAddItem", {
        name: record.name,
      }),
      allowanceOptions,
      canRequestException: record.exceptionRequestable && setupOptions?.isGm !== true && !exceptionPending,
      requestExceptionAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.RequestExceptionForItem", {
        name: record.name,
      }),
      requestExceptionFocusId: equipmentItemFocusId(record.sourceUuid, "request-exception"),
      canApproveException: record.exceptionRequestable && setupOptions?.isGm === true,
      approveExceptionAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.ApproveExceptionForItem", {
        name: record.name,
      }),
      approveExceptionFocusId: equipmentItemFocusId(record.sourceUuid, "approve-exception"),
      canChooseTitanMauler:
        catalogue.titanMauler.required &&
        catalogue.titanMauler.selectedSourceUuid === null &&
        record.titanMaulerEligible,
      titanMaulerAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.ChooseTitanForItem", {
        name: record.name,
      }),
      titanMaulerFocusId: equipmentItemFocusId(record.sourceUuid, "titan"),
    };
  });
  const recordByUuid = new Map(
    [...catalogue.records, ...(catalogue.lineRecords ?? [])].map((record) => [record.sourceUuid, record])
  );
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
        priceLabel: formatCopper(line.price.linePriceCopper, localize),
        configurationLabel: configuredPriceLabel(line.price, localize),
        fundingLabel: fundingLabel(line.funding, policy?.allowances ?? [], localize),
        canRemove:
          line.funding.lane !== "class-grant" ||
          plannedGrantById.get(line.funding.grant.plannedGrantId)?.materializer !== "pf2e-native",
        canChangeQuantity:
          line.funding.lane === "currency" && !line.price.configurationComponents && !line.kitExpansion,
        unavailableReason:
          line.funding.lane === "class-grant" || line.policyDecision.eligible
            ? null
            : localize("wayfinder-pf2e.StartingEquipment.Cart.PolicyChanged"),
        focusId: equipmentLineFocusId(line.lineId),
        quantityAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Cart.QuantityAria", {
          name: record?.name ?? line.sourceUuid,
        }),
        decreaseAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.DecreaseItemQuantity", {
          name: record?.name ?? line.sourceUuid,
        }),
        decreaseFocusId: equipmentLineControlFocusId(line.lineId, "decrease"),
        increaseAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.IncreaseItemQuantity", {
          name: record?.name ?? line.sourceUuid,
        }),
        increaseFocusId: equipmentLineControlFocusId(line.lineId, "increase"),
        removeAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Cart.RemoveAria", {
          name: record?.name ?? line.sourceUuid,
        }),
        removeFocusId: equipmentLineControlFocusId(line.lineId, "remove"),
        children:
          line.kitExpansion?.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            nested: item.parentPath !== null,
          })) ?? [],
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
  const appliedJudgmentIds = new Set(policy?.gmJudgments.map((judgment) => judgment.id) ?? []);
  const matchingRequests = draft.equipmentPolicyRequests.filter(
    (request) =>
      request.withdrawnAt === null &&
      request.facts.draftId === acquisition?.draftId &&
      request.facts.targetLevel === acquisition?.targetLevel
  );
  const hasAuthoritativeDecline = matchingRequests.some(
    (request) => requestDecisionFor(request, requestDecisionById)?.outcome === "declined"
  );
  const pendingRequests = draft.equipmentPolicyRequests.filter((request) => {
    const decision = requestDecisionFor(request, requestDecisionById);
    return (
      request.withdrawnAt === null &&
      request.decline === null &&
      decision?.outcome !== "declined" &&
      request.facts.draftId === acquisition?.draftId &&
      request.facts.targetLevel === acquisition?.targetLevel &&
      !judgments.some(
        (judgment) =>
          judgment.request.requestId === request.requestId &&
          judgment.revocation === null &&
          appliedJudgmentIds.has(judgment.id)
      )
    );
  });
  const reviewedStartJudgment = policy?.gmJudgments.find((judgment) => judgment.kind === "higher-level-start") ?? null;
  const activeJudgment = reviewedStartJudgment
    ? (judgments.find((judgment) => judgment.id === reviewedStartJudgment.id && judgment.revocation === null) ?? null)
    : null;
  const startAuthorityInvalid = reviewedStartJudgment !== null && activeJudgment === null;
  const canSetCustomLumpSum =
    setupOptions?.isGm === true &&
    !!policy &&
    (policy.resolvedRecipe.kind === "lump-sum" || policy.resolvedRecipe.kind === "custom-lump-sum") &&
    !acquisition?.lines.some((line) => line.funding.lane === "allowance");
  const recipeSelection = recipeSelectionLabel(acquisition?.recipeSelection, localize, setupOptions?.locale);
  const localizedFilters = catalogue.filters.map((filter) => ({
    ...filter,
    label: catalogueFilterLabel(filter.key, filter.value, filter.label, localize),
    selected: catalogue.activeFilters[filter.key]?.includes(filter.value) ?? false,
    focusId: equipmentFilterFocusId(filter.key, filter.value),
  }));
  const typeFilterByValue = new Map(localizedFilters.filter(isTypeFilter).map((filter) => [filter.value, filter]));
  const typeFilters = INLINE_STARTING_EQUIPMENT_TYPE_FILTERS.flatMap((value) => {
    const filter = typeFilterByValue.get(value);
    return filter ? [{ ...filter, icon: itemTypeIcon(value) }] : [];
  });
  const rarityFilters = selectedFirst(localizedFilters.filter(isRarityFilter));
  const selectedRarityFilterCount = rarityFilters.filter((filter) => filter.selected).length;
  const sourceSearch = catalogue.sourceFilterQuery?.trim() ?? "";
  const normalizedSourceSearch = sourceSearch.toLocaleLowerCase();
  const matchingSourceFilters = selectedFirst(localizedFilters.filter(isSourceFilter)).filter(
    (filter) => !normalizedSourceSearch || filter.label.toLocaleLowerCase().includes(normalizedSourceSearch)
  );
  const sourceFilters = matchingSourceFilters.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_SOURCE_FILTERS);
  const selectedSourceFilterCount = localizedFilters.filter(
    (filter) => isSourceFilter(filter) && filter.selected
  ).length;

  return {
    kind: "starting-equipment",
    templateKind: "starting-equipment",
    stepId: step.id,
    slotId: step.slotId,
    level: step.level,
    modeLabel: localize("wayfinder-pf2e.StartingEquipment.Mode"),
    title: localize("wayfinder-pf2e.StartingEquipment.Title"),
    description: localize("wayfinder-pf2e.StartingEquipment.Description"),
    initialized: !!acquisition,
    corrupt: draft.acquisitionCorrupt,
    setup: {
      awaitingAuthority: awaitingAuthority || startAuthorityInvalid,
      canChooseRecipe: awaitingAuthority && worldPolicy?.recipeChoiceAuthority === "actor-owner",
      selectedRecipe,
      recipeOptions: (worldPolicy?.enabledRecipes ?? []).map((value) => ({
        value,
        label: localize(
          value === "permanent-items"
            ? "wayfinder-pf2e.StartingEquipment.Recipe.PermanentItems"
            : "wayfinder-pf2e.StartingEquipment.Recipe.LumpSum"
        ),
        selected: value === selectedRecipe,
      })),
      authorityMessage: startAuthorityInvalid
        ? localize("wayfinder-pf2e.StartingEquipment.Authority.StaleApproval")
        : awaitingAuthority
          ? worldPolicy?.higherLevelStartAuthority === "actor-owner-attestation"
            ? localize("wayfinder-pf2e.StartingEquipment.Authority.OwnerAttestation")
            : setupOptions?.isGm
              ? localize("wayfinder-pf2e.StartingEquipment.Authority.GmConfirmation")
              : localize("wayfinder-pf2e.StartingEquipment.Authority.AwaitingGm")
          : null,
      canActivate:
        (awaitingAuthority || startAuthorityInvalid) &&
        (worldPolicy?.higherLevelStartAuthority === "actor-owner-attestation" || setupOptions?.isGm === true),
      canRequest:
        (awaitingAuthority || startAuthorityInvalid) &&
        worldPolicy?.higherLevelStartAuthority === "gm-confirmation" &&
        setupOptions?.isGm !== true &&
        pendingRequests.length === 0,
      requestOutcomeMessage: hasAuthoritativeDecline
        ? localize("wayfinder-pf2e.StartingEquipment.Status.PolicyRequestDeclined")
        : null,
      pendingRequests: pendingRequests.map((request) => ({
        approvalRecorded: requestDecisionFor(request, requestDecisionById)?.outcome === "approved",
        requestId: request.requestId,
        requesterName: request.requesterName,
        requestedAt: request.requestedAt,
        reason: request.reason,
        requestedAtLabel: readableTimestamp(request.requestedAt, setupOptions?.locale),
        kindLabel:
          request.facts.kind === "higher-level-start"
            ? localize("wayfinder-pf2e.StartingEquipment.Request.HigherLevelStart", {
                level: request.facts.targetLevel,
              })
            : request.facts.kind === "rarity-source-exception"
              ? localize("wayfinder-pf2e.StartingEquipment.Request.ItemException", {
                  sourceUuid: request.facts.sourceUuid,
                })
              : request.facts.kind,
        canApprove:
          setupOptions?.isGm === true && requestDecisionFor(request, requestDecisionById)?.outcome !== "declined",
        canDecline: setupOptions?.isGm === true && !requestDecisionFor(request, requestDecisionById),
      })),
      activeJudgmentId: activeJudgment?.id ?? null,
      canRevoke: setupOptions?.isGm === true && activeJudgment !== null,
      canSetCustomLumpSum,
      canGrantExtraAllowance:
        setupOptions?.isGm === true &&
        policy?.resolvedRecipe.kind === "permanent-items" &&
        !policy.allowances.some((allowance) => allowance.allowanceId.startsWith("gm-extra:")),
    },
    policy: {
      recipeLabel: policy
        ? recipeLabel(policy.resolvedRecipe.kind, localize)
        : localize("wayfinder-pf2e.StartingEquipment.Recipe.SetOnStart"),
      budgetLabel: formatCopper(budgetCopper, localize),
      automaticEligibilityLabel: policy
        ? localize(
            policy.sourcePolicy.effectivePackIds.length === 1
              ? "wayfinder-pf2e.StartingEquipment.Policy.AutomaticEligibilityOne"
              : "wayfinder-pf2e.StartingEquipment.Policy.AutomaticEligibilityMany",
            {
              rarity: rarityLabel(policy.rarityPolicy.blanketCeiling, localize),
              count: policy.sourcePolicy.effectivePackIds.length,
            }
          )
        : localize("wayfinder-pf2e.StartingEquipment.Policy.DefaultEligibility"),
      authorityLabel: policy
        ? authoritySentence(policy.authorityPolicy.recipeChoice, policy.authorityPolicy.apply, localize)
        : localize("wayfinder-pf2e.StartingEquipment.Policy.FromGmSettings"),
      recipeSelectionLabel: recipeSelection,
      handoffLabel: localize("wayfinder-pf2e.StartingEquipment.Policy.ExistingGearHandoff"),
      explanations: policy && acquisition ? policyExplanations(acquisition, localize) : [],
      allowances:
        policy?.allowances.map((allowance) => ({
          ...allowance,
          label: localize("wayfinder-pf2e.StartingEquipment.Allowance.LevelItem", {
            level: allowance.itemLevel,
          }),
          statusLabel: localize(
            usedAllowanceIds.has(allowance.allowanceId)
              ? "wayfinder-pf2e.StartingEquipment.Allowance.Assigned"
              : "wayfinder-pf2e.StartingEquipment.Allowance.Available"
          ),
          used: usedAllowanceIds.has(allowance.allowanceId),
        })) ?? [],
      gmToolsAvailable:
        setupOptions?.isGm === true &&
        (activeJudgment !== null ||
          canSetCustomLumpSum ||
          (policy?.resolvedRecipe.kind === "permanent-items" &&
            !policy.allowances.some((allowance) => allowance.allowanceId.startsWith("gm-extra:")))),
    },
    catalogue: {
      state: catalogue.state,
      message: catalogueMessage(catalogue.state, acquisition !== null, matchedRecordCount, localize),
      diagnostics: sourceDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        message: localizeEquipmentSourceDiagnostic(localize, diagnostic),
      })),
      search: catalogue.query,
      searchDisabled: !acquisition || !catalogueReady || !!handoff,
      filters: localizedFilters,
      typeFilters,
      rarityFilters,
      sourceFilters,
      hasSourceFilters: localizedFilters.some(isSourceFilter),
      rarityFilterActive: selectedRarityFilterCount > 0,
      rarityFilterLabel:
        selectedRarityFilterCount > 0
          ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ActiveFilterLabel", {
              label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.RarityFilters"),
              count: selectedRarityFilterCount,
            })
          : localize("wayfinder-pf2e.StartingEquipment.Catalogue.RarityFilters"),
      sourceFilterActive: selectedSourceFilterCount > 0,
      sourceFilterLabel:
        selectedSourceFilterCount > 0
          ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ActiveFilterLabel", {
              label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceFilters"),
              count: selectedSourceFilterCount,
            })
          : localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceFilters"),
      openFilterPanel: catalogue.openFilterPanel ?? null,
      rarityPanelOpen: catalogue.openFilterPanel === "rarity",
      sourcePanelOpen: catalogue.openFilterPanel === "source",
      sourceSearch,
      sourceResultAnnouncement: localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceResultCount", {
        visible: sourceFilters.length,
        total: matchingSourceFilters.length,
      }),
      totalResultCount: matchedRecordCount,
      visibleResultCount: records.length,
      resultAnnouncement: localize("wayfinder-pf2e.StartingEquipment.Catalogue.ResultCount", {
        visible: records.length,
        total: matchedRecordCount,
      }),
      hiddenResultCount: Math.max(0, matchedRecordCount - records.length),
      narrowSearchHint:
        matchedRecordCount > records.length
          ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.NarrowSearch", {
              hidden: matchedRecordCount - records.length,
            })
          : null,
      items: records,
      preview,
    },
    cart: {
      lines: cartLines,
      empty: cartLines.length === 0,
      count: cartLines.reduce((total, line) => total + line.quantity, 0),
      budgetLabel: formatCopper(budgetCopper, localize),
      spentLabel: formatCopper(spentCopper, localize),
      remainingLabel: formatCopper(remainingCopper, localize),
      spentPercent: budgetCopper > 0 ? Math.min(100, Math.round((spentCopper / budgetCopper) * 100)) : 0,
      overspent: spentCopper > budgetCopper,
      announcement: localize("wayfinder-pf2e.StartingEquipment.Accessibility.CartSummary", {
        count: cartLines.length,
        spent: formatCopper(spentCopper, localize),
        remaining: formatCopper(remainingCopper, localize),
      }),
    },
    titanMauler: {
      required: catalogue.titanMauler.required,
      selected: catalogue.titanMauler.selectedSourceUuid !== null,
      selectedName: selectedTitanMaulerRecord?.name ?? catalogue.titanMauler.selectedSourceUuid,
    },
    review: {
      disposition,
      label: reviewLabel(draft, localize),
      settled: disposition === "purchase-ledger" || disposition === "retain-all",
      canReviewPurchases:
        !!acquisition &&
        catalogueReady &&
        !handoff &&
        currencyLines.length > 0 &&
        (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
      canRetainAll:
        !!acquisition &&
        catalogueReady &&
        !handoff &&
        currencyLines.length === 0 &&
        (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
    },
    handoff: {
      active: !!handoff,
      acknowledged: !!handoff?.acknowledgedByUserId && !!handoff.acknowledgedAt,
      reasons: handoff?.handoff.reasons.map((reason) => handoffReason(reason, localize)) ?? [],
    },
  };
}

function requestDecisionFor(
  request: EquipmentPolicyRequestV1,
  decisions: ReadonlyMap<string, EquipmentPolicyRequestDecisionV1>
): EquipmentPolicyRequestDecisionV1 | null {
  const decision = decisions.get(request.requestId);
  if (!decision || decision.factsFingerprint !== request.factsFingerprint) return null;
  return decision.request.requestId === request.requestId &&
    decision.request.requesterUserId === request.requesterUserId &&
    decision.request.requesterName === request.requesterName &&
    decision.request.requestedAt === request.requestedAt &&
    decision.request.reason === request.reason &&
    equipmentPolicyJudgmentFactsEqual(decision.request.facts, request.facts)
    ? decision
    : null;
}

type EquipmentFilterPane = StartingEquipmentStepPane["catalogue"]["filters"][number];

function isTypeFilter(filter: EquipmentFilterPane): filter is EquipmentFilterPane & { key: "type" } {
  return filter.key === "type";
}

function isRarityFilter(filter: EquipmentFilterPane): filter is EquipmentFilterPane & { key: "rarity" } {
  return filter.key === "rarity";
}

function isSourceFilter(filter: EquipmentFilterPane): filter is EquipmentFilterPane & { key: "source" } {
  return filter.key === "source";
}

function selectedFirst<T extends { readonly selected: boolean }>(filters: readonly T[]): T[] {
  return [...filters].sort((left, right) => Number(right.selected) - Number(left.selected));
}

function recipeSelectionLabel(
  selection: NonNullable<DraftState["acquisition"]>["recipeSelection"],
  localize: AcquisitionLocalize,
  locale: string | undefined
): string {
  if (!selection) return localize("wayfinder-pf2e.StartingEquipment.Policy.SelectionRecordedOnChoice");
  if (selection.selector.kind === "unattributed-world-policy") {
    return localize("wayfinder-pf2e.StartingEquipment.Policy.SelectionLegacy", {
      selectedAt: readableTimestamp(selection.selectedAt, locale),
    });
  }
  return localize("wayfinder-pf2e.StartingEquipment.Policy.SelectionByUser", {
    userName: selection.selector.userName,
    selectedAt: readableTimestamp(selection.selectedAt, locale),
  });
}

/** ISO instants are storage detail; the pane shows a local, human-legible stamp instead. */
function readableTimestamp(value: string, locale: string | undefined): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(foundryIntlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

function foundryIntlLocale(locale: string | undefined): string | undefined {
  const foundryLocale = locale?.trim().replaceAll("_", "-");
  if (!foundryLocale) return undefined;
  const candidate = FOUNDRY_INTL_LOCALE_ALIASES[foundryLocale.toLowerCase()] ?? foundryLocale;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([candidate]).length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
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

function policyExplanations(
  acquisition: NonNullable<DraftState["acquisition"]>,
  localize: AcquisitionLocalize
): readonly string[] {
  const material = acquisition.policySnapshot?.material;
  if (!material) return [];
  const fundingExplanation =
    material.resolvedRecipe.kind === "permanent-items"
      ? localize("wayfinder-pf2e.StartingEquipment.Policy.PermanentItemsExplanation", {
          budget: formatCopper(material.budgetCopper, localize),
        })
      : localize("wayfinder-pf2e.StartingEquipment.Policy.LumpSumExplanation", {
          budget: formatCopper(material.budgetCopper, localize),
          level: material.subject.targetLevel,
        });
  return [
    fundingExplanation,
    material.rarityPolicy.blanketCeiling === "common"
      ? localize("wayfinder-pf2e.StartingEquipment.Policy.CommonExplanation")
      : localize("wayfinder-pf2e.StartingEquipment.Policy.RarityExplanation", {
          rarity: rarityLabel(material.rarityPolicy.blanketCeiling, localize),
        }),
    ...(material.abp.enabled
      ? [
          material.abp.actorOverrideDisabled
            ? localize("wayfinder-pf2e.StartingEquipment.Policy.AbpOverrideDisabled", {
                mode: material.abp.mode ?? "ABP",
              })
            : localize("wayfinder-pf2e.StartingEquipment.Policy.AbpActive", {
                mode: material.abp.mode ?? "ABP",
              }),
        ]
      : []),
  ];
}

function configuredPriceLabel(
  price: NonNullable<DraftState["acquisition"]>["lines"][number]["price"],
  localize: AcquisitionLocalize
): string | null {
  const components = price.configurationComponents;
  if (!components) return null;
  return [
    localize("wayfinder-pf2e.StartingEquipment.Price.Baseline", {
      price: formatCopper(components.baselineAndFundamentalCopper, localize),
    }),
    components.propertyRuneCopper > 0
      ? localize("wayfinder-pf2e.StartingEquipment.Price.PropertyRunes", {
          price: formatCopper(components.propertyRuneCopper, localize),
        })
      : null,
    components.preciousMaterialCopper > 0
      ? localize("wayfinder-pf2e.StartingEquipment.Price.PreciousMaterial", {
          price: formatCopper(components.preciousMaterialCopper, localize),
        })
      : null,
    components.suppressedByAbp.length > 0
      ? localize("wayfinder-pf2e.StartingEquipment.Price.AbpSuppresses", {
          components: components.suppressedByAbp
            .map((component) => suppressedComponentLabel(component, components.itemType, localize))
            .join(", "),
        })
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
}

function recipeLabel(kind: string, localize: AcquisitionLocalize): string {
  switch (kind) {
    case "level-1-equivalent":
      return localize("wayfinder-pf2e.StartingEquipment.Recipe.LevelOne");
    case "permanent-items":
      return localize("wayfinder-pf2e.StartingEquipment.Recipe.PermanentItems");
    case "lump-sum":
      return localize("wayfinder-pf2e.StartingEquipment.Recipe.LumpSum");
    default:
      return localize("wayfinder-pf2e.StartingEquipment.Recipe.CustomLumpSum");
  }
}

function isGmAuthority(value: string): boolean {
  return value === "gm-fixed" || value === "gm-review" || value === "gm-confirmation";
}

function authoritySentence(recipeChoice: string, apply: string, localize: AcquisitionLocalize): string {
  const gmChooses = isGmAuthority(recipeChoice);
  const gmApplies = isGmAuthority(apply);
  if (gmChooses && gmApplies) return localize("wayfinder-pf2e.StartingEquipment.Authority.GmChoosesApplies");
  if (gmChooses) return localize("wayfinder-pf2e.StartingEquipment.Authority.GmChoosesOwnerApplies");
  if (gmApplies) return localize("wayfinder-pf2e.StartingEquipment.Authority.OwnerChoosesGmApplies");
  return localize("wayfinder-pf2e.StartingEquipment.Authority.OwnerChoosesApplies");
}

function fundingLabel(
  funding: NonNullable<DraftState["acquisition"]>["lines"][number]["funding"],
  allowances: readonly { readonly allowanceId: string; readonly itemLevel: number }[],
  localize: AcquisitionLocalize
): string {
  if (funding.lane === "class-grant") return localize("wayfinder-pf2e.StartingEquipment.Funding.ClassGrant");
  if (funding.lane === "allowance") {
    const assignment = funding.assignment;
    if (assignment.mode === "automatic") return localize("wayfinder-pf2e.StartingEquipment.Funding.Allowance");
    const allowance = allowances.find((candidate) => candidate.allowanceId === assignment.allowanceId);
    return allowance
      ? localize("wayfinder-pf2e.StartingEquipment.Funding.LevelAllowance", { level: allowance.itemLevel })
      : localize("wayfinder-pf2e.StartingEquipment.Funding.Allowance");
  }
  return localize("wayfinder-pf2e.StartingEquipment.Funding.Currency");
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

const EQUIPMENT_TYPE_ICONS: Readonly<Record<string, string>> = Object.freeze({
  ammo: "fa-bolt",
  armor: "fa-shirt",
  backpack: "fa-suitcase",
  consumable: "fa-flask",
  equipment: "fa-toolbox",
  kit: "fa-box-open",
  shield: "fa-shield-halved",
  treasure: "fa-gem",
  weapon: "fa-hammer",
});

function itemTypeIcon(itemType: string): string {
  return EQUIPMENT_TYPE_ICONS[itemType] ?? "fa-cube";
}

/** One button per allowance level, so repeated levels read as a count instead of duplicate controls. */
function dedupeAllowanceLevels<T extends { readonly allowanceId: string; readonly itemLevel: number }>(
  allowances: readonly T[]
): { allowanceId: string; itemLevel: number; remaining: number }[] {
  const byLevel = new Map<number, { allowanceId: string; itemLevel: number; remaining: number }>();
  for (const allowance of allowances) {
    const existing = byLevel.get(allowance.itemLevel);
    if (existing) {
      existing.remaining += 1;
      continue;
    }
    byLevel.set(allowance.itemLevel, {
      allowanceId: allowance.allowanceId,
      itemLevel: allowance.itemLevel,
      remaining: 1,
    });
  }
  return [...byLevel.values()].sort((left, right) => left.itemLevel - right.itemLevel);
}

function handoffReason(reason: EconomicHandoffReason, localize: AcquisitionLocalize): string {
  switch (reason.code) {
    case "unsafe-configured-item":
      return localize("wayfinder-pf2e.StartingEquipment.Handoff.UnsafeConfiguredItem", {
        itemName: reason.itemName,
      });
    case "foreign-physical-items":
      return localize("wayfinder-pf2e.StartingEquipment.Handoff.ForeignItems");
    case "nonzero-currency":
      return localize("wayfinder-pf2e.StartingEquipment.Handoff.NonzeroCurrency");
    case "unresolved-class-grant":
      return localize("wayfinder-pf2e.StartingEquipment.Handoff.UnresolvedGrant");
    default:
      return localize("wayfinder-pf2e.StartingEquipment.Handoff.AmbiguousGrant");
  }
}

function formatCopper(copper: number, localize: AcquisitionLocalize): string {
  if (!Number.isSafeInteger(copper) || copper < 0) {
    return localize("wayfinder-pf2e.StartingEquipment.Currency.Unavailable");
  }
  if (copper === 0) return localize("wayfinder-pf2e.StartingEquipment.Currency.Gold", { value: 0 });
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  return [
    gp > 0 ? localize("wayfinder-pf2e.StartingEquipment.Currency.Gold", { value: gp }) : "",
    sp > 0 ? localize("wayfinder-pf2e.StartingEquipment.Currency.Silver", { value: sp }) : "",
    cp > 0 ? localize("wayfinder-pf2e.StartingEquipment.Currency.Copper", { value: cp }) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function cataloguePriceLabel(record: StartingEquipmentCatalogueRecord, localize: AcquisitionLocalize): string {
  const price = formatCopper(record.priceCopper ?? -1, localize);
  const context = record.priceContext;
  if (!context) return price;
  if (context.pricePer === context.materializedQuantity) {
    return localize("wayfinder-pf2e.StartingEquipment.Catalogue.PriceFor", {
      price,
      quantity: context.materializedQuantity,
    });
  }
  return localize("wayfinder-pf2e.StartingEquipment.Catalogue.PriceForPer", {
    price,
    quantity: context.materializedQuantity,
    pricePer: context.pricePer,
  });
}

function pf2eTraitLabel(trait: string, localize: AcquisitionLocalize): string {
  const key = `PF2E.Trait${pascalIdentifier(trait)}`;
  return localizeExternalKey(key, trait, localize);
}

function suppressedComponentLabel(
  component: string,
  itemType: "weapon" | "armor",
  localize: AcquisitionLocalize
): string {
  if (component === "fundamental") {
    return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Fundamental");
  }
  if (component === "potency") return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Potency");
  if (component === "striking") return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Striking");
  if (component === "resilient") return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Resilient");
  if (component.startsWith("property:")) {
    const rune = component.slice("property:".length);
    return localize("wayfinder-pf2e.StartingEquipment.Price.Component.PropertyRune", {
      rune: localizeExternalKey(
        itemType === "weapon"
          ? `PF2E.WeaponPropertyRune.${rune}.Name`
          : `PF2E.ArmorPropertyRune${pascalIdentifier(rune)}`,
        rune,
        localize
      ),
    });
  }
  return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Other", {
    component: humanizeIdentifier(component),
  });
}

function localizeExternalKey(key: string, fallback: string, localize: AcquisitionLocalize): string {
  try {
    const label = localize(key);
    return label === key ? humanizeIdentifier(fallback) : label;
  } catch {
    return humanizeIdentifier(fallback);
  }
}

function pascalIdentifier(value: string): string {
  return value
    .split(/[-_:]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_:]/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function catalogueMessage(
  state: StartingEquipmentCatalogueProjection["state"],
  initialized: boolean,
  count: number,
  localize: AcquisitionLocalize
): string {
  if (state === "ready") {
    return localize("wayfinder-pf2e.StartingEquipment.Catalogue.Ready", { count });
  }
  if (state === "error") return localize("wayfinder-pf2e.StartingEquipment.Catalogue.LoadFailed");
  return localize(
    initialized
      ? "wayfinder-pf2e.StartingEquipment.Catalogue.NotLoaded"
      : "wayfinder-pf2e.StartingEquipment.Catalogue.StartToLoad"
  );
}

function catalogueFilterLabel(key: string, value: string, fallback: string, localize: AcquisitionLocalize): string {
  if (key === "rarity" && isRarity(value)) return rarityLabel(value, localize);
  if (key === "type") return itemTypeLabel(value, localize);
  return fallback;
}

function rarityLabel(rarity: "common" | "uncommon" | "rare" | "unique", localize: AcquisitionLocalize): string {
  switch (rarity) {
    case "common":
      return localize("wayfinder-pf2e.StartingEquipment.Rarity.Common");
    case "uncommon":
      return localize("wayfinder-pf2e.StartingEquipment.Rarity.Uncommon");
    case "rare":
      return localize("wayfinder-pf2e.StartingEquipment.Rarity.Rare");
    case "unique":
      return localize("wayfinder-pf2e.StartingEquipment.Rarity.Unique");
  }
}

function isRarity(value: string): value is "common" | "uncommon" | "rare" | "unique" {
  return value === "common" || value === "uncommon" || value === "rare" || value === "unique";
}

function itemTypeLabel(itemType: string, localize: AcquisitionLocalize): string {
  switch (itemType) {
    case "ammo":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Ammo");
    case "armor":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Armor");
    case "backpack":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Backpack");
    case "consumable":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Consumable");
    case "equipment":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Equipment");
    case "shield":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Shield");
    case "weapon":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Weapon");
    case "kit":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Kit");
    case "treasure":
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Treasure");
    default:
      return localize("wayfinder-pf2e.StartingEquipment.ItemType.Other", { itemType });
  }
}

function reviewLabel(draft: DraftState, localize: AcquisitionLocalize): string {
  if (draft.acquisitionCorrupt) return localize("wayfinder-pf2e.StartingEquipment.Review.Damaged");
  const acquisition = draft.acquisition;
  if (!acquisition) return localize("wayfinder-pf2e.StartingEquipment.Review.NotStarted");
  switch (acquisition.disposition.kind) {
    case "purchase-ledger":
      return localize("wayfinder-pf2e.StartingEquipment.Review.KitConfirmed");
    case "retain-all":
      return localize("wayfinder-pf2e.StartingEquipment.Review.KeepingCoin");
    case "handoff":
      return localize(
        acquisition.disposition.acknowledgedByUserId && acquisition.disposition.acknowledgedAt
          ? "wayfinder-pf2e.StartingEquipment.Review.HandledOnSheet"
          : "wayfinder-pf2e.StartingEquipment.Review.NeedsAcknowledgement"
      );
    case "unreviewed":
      return localize(
        acquisition.disposition.invalidatedFrom
          ? "wayfinder-pf2e.StartingEquipment.Review.Changed"
          : "wayfinder-pf2e.StartingEquipment.Review.ChooseGear"
      );
  }
}
