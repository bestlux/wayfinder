import { localizeEquipmentSourceDiagnostic, } from "../application/acquisition-localization.js";
import { equipmentAllowanceFocusId, equipmentFilterFocusId, equipmentItemFocusId, equipmentLineControlFocusId, equipmentLineFocusId, } from "../application/equipment-accessibility.js";
import { resolveAcquisitionPrice } from "../domain/acquisition-ledger.js";
import { equipmentPolicyJudgmentFactsEqual } from "../domain/equipment-policy.js";
import { clampStartingEquipmentResultWindow, STARTING_EQUIPMENT_RESULT_WINDOW, } from "../starting-equipment-result-window.js";
const FOUNDRY_INTL_LOCALE_ALIASES = Object.freeze({
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
];
export const MAX_INLINE_STARTING_EQUIPMENT_TYPE_FILTERS = INLINE_STARTING_EQUIPMENT_TYPE_FILTERS.length;
export const MAX_VISIBLE_STARTING_EQUIPMENT_SOURCE_FILTERS = 12;
const localizedCatalogueInvariantCache = new WeakMap();
const cataloguePaneRowCache = new WeakMap();
export function buildStartingEquipmentPane(step, draft, _evaluation, catalogue, localize, setupOptions) {
    const acquisition = draft.acquisition;
    const sourceDiagnostics = catalogue.diagnostics ?? [];
    const catalogueReady = catalogue.state === "ready" && sourceDiagnostics.length === 0;
    const policy = acquisition?.policySnapshot?.material ?? null;
    const budgetCopper = policy?.budgetCopper ?? 1_500;
    const spentCopper = acquisition?.lines.reduce((sum, line) => sum + chargedCopper(line), 0) ?? 0;
    const reviewedRemaining = acquisition?.disposition.kind === "purchase-ledger" || acquisition?.disposition.kind === "retain-all"
        ? acquisition.disposition.review.remainingCopper
        : null;
    const remainingCopper = reviewedRemaining ?? Math.max(0, budgetCopper - spentCopper);
    const usedAllowanceIds = new Set(acquisition?.lines.flatMap((line) => {
        const funding = line.funding;
        if (funding.lane !== "allowance")
            return [];
        const assignment = funding.assignment;
        return assignment.mode === "player" ? [assignment.allowanceId] : [];
    }) ?? []);
    const availableAllowances = policy?.allowances.filter((allowance) => !usedAllowanceIds.has(allowance.allowanceId)) ?? [];
    const browseRecords = catalogueReady ? catalogue.records : [];
    const projectedRecords = [
        ...browseRecords,
        ...(catalogue.previewRecord &&
            !browseRecords.some((record) => record.sourceUuid === catalogue.previewRecord?.sourceUuid)
            ? [catalogue.previewRecord]
            : []),
    ];
    const matchedRecordCount = catalogueReady ? catalogue.matchedRecordCount : 0;
    const resultWindow = clampStartingEquipmentResultWindow({
        offset: catalogue.offset ?? 0,
        limit: catalogue.limit ?? STARTING_EQUIPMENT_RESULT_WINDOW.baselineSize,
    }, matchedRecordCount);
    const requestDecisions = setupOptions?.requestDecisions ?? [];
    const locale = setupOptions?.locale ?? "";
    const requestDecisionById = new Map(requestDecisions.map((decision) => [decision.request.requestId, decision]));
    const pendingExceptionSourceUuids = new Set(draft.equipmentPolicyRequests.flatMap((request) => request.withdrawnAt === null &&
        request.decline === null &&
        requestDecisionFor(request, requestDecisionById)?.outcome !== "declined" &&
        request.facts.kind === "rarity-source-exception" &&
        request.facts.draftId === acquisition?.draftId
        ? [request.facts.sourceUuid]
        : []));
    const paneRecords = projectedRecords.map((record, index) => {
        const currencyAffordable = record.priceCopper !== null && record.priceCopper <= remainingCopper;
        const canBuyWithCurrency = record.available && record.level < step.level && currencyAffordable;
        const eligibleAllowances = record.available && policy?.resolvedRecipe.kind === "permanent-items" && isPermanentItemType(record.itemType)
            ? dedupeAllowanceLevels(availableAllowances.filter((allowance) => allowance.itemLevel >= record.level))
            : [];
        const exceptionPending = pendingExceptionSourceUuids.has(record.sourceUuid);
        const previewing = record.sourceUuid === catalogue.previewSourceUuid;
        const volatileKey = JSON.stringify([
            resultWindow.offset + Math.min(index, Math.max(0, browseRecords.length - 1)),
            currencyAffordable,
            canBuyWithCurrency,
            eligibleAllowances.map((allowance) => [allowance.allowanceId, allowance.itemLevel, allowance.remaining]),
            exceptionPending,
            setupOptions?.isGm === true,
            catalogue.titanMauler.required,
            catalogue.titanMauler.selectedSourceUuid,
            previewing,
            step.level,
        ]);
        const cachedRow = cataloguePaneRowCache.get(record)?.get(localize)?.get(locale);
        if (cachedRow?.volatileKey === volatileKey)
            return cachedRow.row;
        const allowanceOptions = eligibleAllowances.map((allowance) => ({
            allowanceId: allowance.allowanceId,
            label: allowance.remaining > 1
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
        }));
        const invariant = localizedCatalogueInvariant(record, localize, locale);
        const unavailableReason = invariant.unavailableReason;
        const noFundingReason = (record.pricePending ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ViewForPrice") : unavailableReason) ??
            (!canBuyWithCurrency && allowanceOptions.length === 0
                ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.NoFunding")
                : null);
        const resultAvailability = noFundingReason ?? localize("wayfinder-pf2e.StartingEquipment.Catalogue.Available");
        const priceLabel = invariant.priceLabel;
        const localizedRarity = invariant.rarityLabel;
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
        const row = {
            ...record,
            resultIndex: resultWindow.offset + Math.min(index, Math.max(0, browseRecords.length - 1)),
            resultPosition: resultWindow.offset + Math.min(index, Math.max(0, browseRecords.length - 1)) + 1,
            levelLabel: invariant.levelLabel,
            priceLabel,
            rarityLabel: localizedRarity,
            typeIcon: invariant.typeIcon,
            itemTypeLabel: invariant.itemTypeLabel,
            traits: invariant.traits,
            bulkLabel: invariant.bulkLabel,
            unavailableReason: invariant.unavailableReason,
            currencyAffordable,
            previewing,
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
            canChooseTitanMauler: catalogue.titanMauler.required &&
                catalogue.titanMauler.selectedSourceUuid === null &&
                record.titanMaulerEligible,
            titanMaulerAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Accessibility.ChooseTitanForItem", {
                name: record.name,
            }),
            titanMaulerFocusId: equipmentItemFocusId(record.sourceUuid, "titan"),
        };
        let localizedRows = cataloguePaneRowCache.get(record);
        if (!localizedRows) {
            localizedRows = new WeakMap();
            cataloguePaneRowCache.set(record, localizedRows);
        }
        let rowsByLocale = localizedRows.get(localize);
        if (!rowsByLocale) {
            rowsByLocale = new Map();
            localizedRows.set(localize, rowsByLocale);
        }
        rowsByLocale.set(locale, { volatileKey, row });
        return row;
    });
    const records = paneRecords.slice(0, browseRecords.length);
    const recordByUuid = new Map([
        ...catalogue.records,
        ...(catalogue.previewRecord ? [catalogue.previewRecord] : []),
        ...(catalogue.lineRecords ?? []),
    ].map((record) => [record.sourceUuid, record]));
    const plannedGrantById = new Map(acquisition?.plannedClassGrants.map((grant) => [grant.grantId, grant]) ?? []);
    const previewRecord = paneRecords.find((record) => record.previewing) ?? null;
    const previewDetails = previewRecord && catalogue.preview?.sourceUuid === previewRecord.sourceUuid ? catalogue.preview : null;
    const preview = previewRecord
        ? {
            ...previewRecord,
            description: previewDetails?.description ?? "",
            bulkLabel: previewDetails?.bulkLabel ?? "",
            handsLabel: previewDetails?.handsLabel ?? null,
        }
        : null;
    const selectedTitanMaulerRecord = catalogue.titanMauler.selectedSourceUuid
        ? recordByUuid.get(catalogue.titanMauler.selectedSourceUuid)
        : null;
    const cartLines = acquisition?.lines.map((line) => {
        const record = recordByUuid.get(line.sourceUuid);
        return {
            lineId: line.lineId,
            sourceUuid: line.sourceUuid,
            name: record?.name ?? line.sourceUuid,
            quantity: line.price.materializedQuantity,
            priceLabel: formatCopper(line.price.linePriceCopper, localize),
            configurationLabel: configuredPriceLabel(line.price, localize),
            fundingLabel: fundingLabel(line.funding, policy?.allowances ?? [], localize),
            canRemove: line.funding.lane !== "class-grant" ||
                plannedGrantById.get(line.funding.grant.plannedGrantId)?.materializer !== "pf2e-native",
            canChangeQuantity: line.funding.lane === "currency" && !line.price.configurationComponents && !line.kitExpansion,
            unavailableReason: line.funding.lane === "class-grant" || line.policyDecision.eligible
                ? null
                : localize("wayfinder-pf2e.StartingEquipment.Cart.PolicyChanged"),
            focusId: equipmentLineFocusId(line.lineId),
            quantityAriaLabel: localize("wayfinder-pf2e.StartingEquipment.Cart.QuantityAria", {
                name: record?.name ?? line.sourceUuid,
            }),
            quantityStep: line.price.sourceQuantity,
            quantityFocusId: equipmentLineControlFocusId(line.lineId, "quantity"),
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
            children: line.kitExpansion?.items.map((item) => ({
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
    const selectedRecipe = acquisition?.recipe.kind === "permanent-items" || acquisition?.recipe.kind === "lump-sum"
        ? acquisition.recipe.kind
        : null;
    const judgments = setupOptions?.judgments ?? [];
    const appliedJudgmentIds = new Set(policy?.gmJudgments.map((judgment) => judgment.id) ?? []);
    const matchingRequests = draft.equipmentPolicyRequests.filter((request) => request.withdrawnAt === null &&
        request.facts.draftId === acquisition?.draftId &&
        request.facts.targetLevel === acquisition?.targetLevel);
    const hasAuthoritativeDecline = matchingRequests.some((request) => requestDecisionFor(request, requestDecisionById)?.outcome === "declined");
    const pendingRequests = draft.equipmentPolicyRequests.filter((request) => {
        const decision = requestDecisionFor(request, requestDecisionById);
        return (request.withdrawnAt === null &&
            request.decline === null &&
            decision?.outcome !== "declined" &&
            request.facts.draftId === acquisition?.draftId &&
            request.facts.targetLevel === acquisition?.targetLevel &&
            !judgments.some((judgment) => judgment.request.requestId === request.requestId &&
                judgment.revocation === null &&
                appliedJudgmentIds.has(judgment.id)));
    });
    const reviewedStartJudgment = policy?.gmJudgments.find((judgment) => judgment.kind === "higher-level-start") ?? null;
    const activeJudgment = reviewedStartJudgment
        ? (judgments.find((judgment) => judgment.id === reviewedStartJudgment.id && judgment.revocation === null) ?? null)
        : null;
    const startAuthorityInvalid = reviewedStartJudgment !== null && activeJudgment === null;
    const canSetCustomLumpSum = setupOptions?.isGm === true &&
        !!policy &&
        (policy.resolvedRecipe.kind === "lump-sum" || policy.resolvedRecipe.kind === "custom-lump-sum") &&
        !acquisition?.lines.some((line) => line.funding.lane === "allowance");
    const recipeSelection = recipeSelectionLabel(acquisition?.recipeSelection, localize, setupOptions?.locale);
    const localizedFilters = catalogue.filters.map((filter) => ({
        ...filter,
        count: filter.count ?? 0,
        label: catalogueFilterLabel(filter.key, filter.value, filter.label, localize),
        selected: catalogue.activeFilters[filter.key]?.includes(filter.value) ?? false,
        focusId: equipmentFilterFocusId(filter.key, filter.value),
    }));
    const typeFilterByValue = new Map(localizedFilters.filter(isTypeFilter).map((filter) => [filter.value, filter]));
    const typeFilters = INLINE_STARTING_EQUIPMENT_TYPE_FILTERS.flatMap((value) => {
        const filter = typeFilterByValue.get(value);
        return filter ? [{ ...filter, icon: itemTypeIcon(value) }] : [];
    });
    const availabilityFilter = localizedFilters.find(isAvailabilityFilter) ?? null;
    const titanMaulerFilter = localizedFilters.find(isTitanMaulerFilter) ?? null;
    const rarityFilters = selectedFirst(localizedFilters.filter(isRarityFilter));
    const selectedRarityFilterCount = rarityFilters.filter((filter) => filter.selected).length;
    const sourceSearch = catalogue.facetFilterQueries?.source?.trim() ?? "";
    const normalizedSourceSearch = sourceSearch.toLocaleLowerCase();
    const matchingSourceFilters = selectedFirst(localizedFilters.filter(isSourceFilter)).filter((filter) => !normalizedSourceSearch || filter.label.toLocaleLowerCase().includes(normalizedSourceSearch));
    const sourceFilters = matchingSourceFilters.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_SOURCE_FILTERS);
    const selectedSourceFilterCount = localizedFilters.filter((filter) => isSourceFilter(filter) && filter.selected).length;
    const traitFiltersAll = selectedFirst(localizedFilters.filter(isTraitFilter));
    const traitSearch = catalogue.facetFilterQueries?.trait?.trim() ?? "";
    const normalizedTraitSearch = traitSearch.toLocaleLowerCase();
    const matchingTraitFilters = traitFiltersAll.filter((filter) => !normalizedTraitSearch || filter.label.toLocaleLowerCase().includes(normalizedTraitSearch));
    const traitFilters = matchingTraitFilters.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_SOURCE_FILTERS);
    const selectedTraitFilterCount = traitFiltersAll.filter((filter) => filter.selected).length;
    const levelFilter = catalogue.levelFilter
        ? {
            active: catalogue.levelFilter.active,
            label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.LevelFilters"),
            summaryLabel: catalogue.levelFilter.active
                ? catalogue.levelFilter.minimum === catalogue.levelFilter.maximum
                    ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.LevelValue", {
                        level: catalogue.levelFilter.minimum,
                    })
                    : localize("wayfinder-pf2e.StartingEquipment.Catalogue.LevelRange", {
                        minimum: catalogue.levelFilter.minimum,
                        maximum: catalogue.levelFilter.maximum,
                    })
                : localize("wayfinder-pf2e.StartingEquipment.Catalogue.AllLevels"),
            values: catalogue.levelFilter.values.map((value) => ({
                value,
                label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.LevelValue", { level: value }),
                minimumSelected: value === catalogue.levelFilter.minimum,
                maximumSelected: value === catalogue.levelFilter.maximum,
                minimumRangeStart: value,
                minimumRangeEnd: Math.max(value, catalogue.levelFilter.maximum),
                maximumRangeStart: Math.min(value, catalogue.levelFilter.minimum),
                maximumRangeEnd: value,
            })),
        }
        : null;
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
                label: localize(value === "permanent-items"
                    ? "wayfinder-pf2e.StartingEquipment.Recipe.PermanentItems"
                    : "wayfinder-pf2e.StartingEquipment.Recipe.LumpSum"),
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
            canActivate: (awaitingAuthority || startAuthorityInvalid) &&
                (worldPolicy?.higherLevelStartAuthority === "actor-owner-attestation" || setupOptions?.isGm === true),
            canRequest: (awaitingAuthority || startAuthorityInvalid) &&
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
                kindLabel: request.facts.kind === "higher-level-start"
                    ? localize("wayfinder-pf2e.StartingEquipment.Request.HigherLevelStart", {
                        level: request.facts.targetLevel,
                    })
                    : request.facts.kind === "rarity-source-exception"
                        ? localize("wayfinder-pf2e.StartingEquipment.Request.ItemException", {
                            sourceUuid: request.facts.sourceUuid,
                        })
                        : request.facts.kind,
                canApprove: setupOptions?.isGm === true && requestDecisionFor(request, requestDecisionById)?.outcome !== "declined",
                canDecline: setupOptions?.isGm === true && !requestDecisionFor(request, requestDecisionById),
            })),
            activeJudgmentId: activeJudgment?.id ?? null,
            canRevoke: setupOptions?.isGm === true && activeJudgment !== null,
            canSetCustomLumpSum,
            canGrantExtraAllowance: setupOptions?.isGm === true &&
                policy?.resolvedRecipe.kind === "permanent-items" &&
                !policy.allowances.some((allowance) => allowance.allowanceId.startsWith("gm-extra:")),
        },
        policy: {
            recipeLabel: policy
                ? recipeLabel(policy.resolvedRecipe.kind, localize)
                : localize("wayfinder-pf2e.StartingEquipment.Recipe.SetOnStart"),
            budgetLabel: formatCopper(budgetCopper, localize),
            automaticEligibilityLabel: policy
                ? localize(policy.sourcePolicy.effectivePackIds.length === 1
                    ? "wayfinder-pf2e.StartingEquipment.Policy.AutomaticEligibilityOne"
                    : "wayfinder-pf2e.StartingEquipment.Policy.AutomaticEligibilityMany", {
                    rarity: rarityLabel(policy.rarityPolicy.blanketCeiling, localize),
                    count: policy.sourcePolicy.effectivePackIds.length,
                })
                : localize("wayfinder-pf2e.StartingEquipment.Policy.DefaultEligibility"),
            authorityLabel: policy
                ? authoritySentence(policy.authorityPolicy.recipeChoice, policy.authorityPolicy.apply, localize)
                : localize("wayfinder-pf2e.StartingEquipment.Policy.FromGmSettings"),
            recipeSelectionLabel: recipeSelection,
            handoffLabel: localize("wayfinder-pf2e.StartingEquipment.Policy.ExistingGearHandoff"),
            explanations: policy && acquisition ? policyExplanations(acquisition, localize) : [],
            allowances: policy?.allowances.map((allowance) => ({
                ...allowance,
                label: localize("wayfinder-pf2e.StartingEquipment.Allowance.LevelItem", {
                    level: allowance.itemLevel,
                }),
                statusLabel: localize(usedAllowanceIds.has(allowance.allowanceId)
                    ? "wayfinder-pf2e.StartingEquipment.Allowance.Assigned"
                    : "wayfinder-pf2e.StartingEquipment.Allowance.Available"),
                used: usedAllowanceIds.has(allowance.allowanceId),
            })) ?? [],
            gmToolsAvailable: setupOptions?.isGm === true &&
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
            traitFilters,
            availabilityFilter,
            titanMaulerFilter,
            levelFilter,
            hasSourceFilters: localizedFilters.some(isSourceFilter),
            hasTraitFilters: localizedFilters.some(isTraitFilter),
            rarityFilterActive: selectedRarityFilterCount > 0,
            rarityFilterLabel: selectedRarityFilterCount > 0
                ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ActiveFilterLabel", {
                    label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.RarityFilters"),
                    count: selectedRarityFilterCount,
                })
                : localize("wayfinder-pf2e.StartingEquipment.Catalogue.RarityFilters"),
            sourceFilterActive: selectedSourceFilterCount > 0,
            sourceFilterLabel: selectedSourceFilterCount > 0
                ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ActiveFilterLabel", {
                    label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceFilters"),
                    count: selectedSourceFilterCount,
                })
                : localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceFilters"),
            traitFilterActive: selectedTraitFilterCount > 0,
            traitFilterLabel: selectedTraitFilterCount > 0
                ? localize("wayfinder-pf2e.StartingEquipment.Catalogue.ActiveFilterLabel", {
                    label: localize("wayfinder-pf2e.StartingEquipment.Catalogue.TraitFilters"),
                    count: selectedTraitFilterCount,
                })
                : localize("wayfinder-pf2e.StartingEquipment.Catalogue.TraitFilters"),
            openFilterPanel: catalogue.openFilterPanel ?? null,
            levelPanelOpen: catalogue.openFilterPanel === "level",
            rarityPanelOpen: catalogue.openFilterPanel === "rarity",
            sourcePanelOpen: catalogue.openFilterPanel === "source",
            traitPanelOpen: catalogue.openFilterPanel === "trait",
            sourceSearch,
            sourceResultAnnouncement: localize("wayfinder-pf2e.StartingEquipment.Catalogue.SourceResultCount", {
                visible: sourceFilters.length,
                total: matchingSourceFilters.length,
            }),
            traitSearch,
            traitResultAnnouncement: localize("wayfinder-pf2e.StartingEquipment.Catalogue.TraitResultCount", {
                visible: traitFilters.length,
                total: matchingTraitFilters.length,
            }),
            totalResultCount: matchedRecordCount,
            visibleResultCount: records.length,
            resultOffset: resultWindow.offset,
            resultLimit: resultWindow.limit,
            leadingSpacerPx: resultWindow.offset * STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx,
            trailingSpacerPx: Math.max(0, matchedRecordCount - resultWindow.offset - records.length) *
                STARTING_EQUIPMENT_RESULT_WINDOW.initialRowHeightPx,
            hasPreviousWindow: resultWindow.offset > 0,
            hasNextWindow: resultWindow.offset + records.length < matchedRecordCount,
            previousWindowOffset: Math.max(0, resultWindow.offset - STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize),
            nextWindowOffset: Math.min(Math.max(0, matchedRecordCount - resultWindow.limit), resultWindow.offset + STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize),
            resultAnnouncement: localize("wayfinder-pf2e.StartingEquipment.Catalogue.ResultCount", {
                start: records.length > 0 ? resultWindow.offset + 1 : 0,
                end: resultWindow.offset + records.length,
                total: matchedRecordCount,
            }),
            hiddenResultCount: Math.max(0, matchedRecordCount - records.length),
            narrowSearchHint: null,
            rowOrderKey: catalogue.rowOrderKey ??
                `uncached:${catalogue.query}:${catalogue.records.map((record) => record.sourceUuid).join("\u0000")}`,
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
            canReviewPurchases: !!acquisition &&
                catalogueReady &&
                !handoff &&
                currencyLines.length > 0 &&
                (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
            canRetainAll: !!acquisition &&
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
function requestDecisionFor(request, decisions) {
    const decision = decisions.get(request.requestId);
    if (!decision || decision.factsFingerprint !== request.factsFingerprint)
        return null;
    return decision.request.requestId === request.requestId &&
        decision.request.requesterUserId === request.requesterUserId &&
        decision.request.requesterName === request.requesterName &&
        decision.request.requestedAt === request.requestedAt &&
        decision.request.reason === request.reason &&
        equipmentPolicyJudgmentFactsEqual(decision.request.facts, request.facts)
        ? decision
        : null;
}
function isTypeFilter(filter) {
    return filter.key === "type";
}
function isRarityFilter(filter) {
    return filter.key === "rarity";
}
function isSourceFilter(filter) {
    return filter.key === "source";
}
function isTraitFilter(filter) {
    return filter.key === "trait";
}
function isAvailabilityFilter(filter) {
    return filter.key === "availability" && filter.value === "available";
}
function isTitanMaulerFilter(filter) {
    return filter.key === "titan-mauler" && filter.value === "eligible";
}
function selectedFirst(filters) {
    return [...filters].sort((left, right) => Number(right.selected) - Number(left.selected));
}
function recipeSelectionLabel(selection, localize, locale) {
    if (!selection)
        return localize("wayfinder-pf2e.StartingEquipment.Policy.SelectionRecordedOnChoice");
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
function readableTimestamp(value, locale) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return value;
    try {
        return new Intl.DateTimeFormat(foundryIntlLocale(locale), {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(parsed);
    }
    catch {
        return parsed.toLocaleString();
    }
}
function foundryIntlLocale(locale) {
    const foundryLocale = locale?.trim().replaceAll("_", "-");
    if (!foundryLocale)
        return undefined;
    const candidate = FOUNDRY_INTL_LOCALE_ALIASES[foundryLocale.toLowerCase()] ?? foundryLocale;
    try {
        return Intl.DateTimeFormat.supportedLocalesOf([candidate]).length > 0 ? candidate : undefined;
    }
    catch {
        return undefined;
    }
}
function policyExplanations(acquisition, localize) {
    const material = acquisition.policySnapshot?.material;
    if (!material)
        return [];
    const fundingExplanation = material.resolvedRecipe.kind === "permanent-items"
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
function configuredPriceLabel(price, localize) {
    const components = price.configurationComponents;
    if (!components)
        return null;
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
        .filter((value) => value !== null)
        .join(" · ");
}
function recipeLabel(kind, localize) {
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
function isGmAuthority(value) {
    return value === "gm-fixed" || value === "gm-review" || value === "gm-confirmation";
}
function authoritySentence(recipeChoice, apply, localize) {
    const gmChooses = isGmAuthority(recipeChoice);
    const gmApplies = isGmAuthority(apply);
    if (gmChooses && gmApplies)
        return localize("wayfinder-pf2e.StartingEquipment.Authority.GmChoosesApplies");
    if (gmChooses)
        return localize("wayfinder-pf2e.StartingEquipment.Authority.GmChoosesOwnerApplies");
    if (gmApplies)
        return localize("wayfinder-pf2e.StartingEquipment.Authority.OwnerChoosesGmApplies");
    return localize("wayfinder-pf2e.StartingEquipment.Authority.OwnerChoosesApplies");
}
function fundingLabel(funding, allowances, localize) {
    if (funding.lane === "class-grant")
        return localize("wayfinder-pf2e.StartingEquipment.Funding.ClassGrant");
    if (funding.lane === "allowance") {
        const assignment = funding.assignment;
        if (assignment.mode === "automatic")
            return localize("wayfinder-pf2e.StartingEquipment.Funding.Allowance");
        const allowance = allowances.find((candidate) => candidate.allowanceId === assignment.allowanceId);
        return allowance
            ? localize("wayfinder-pf2e.StartingEquipment.Funding.LevelAllowance", { level: allowance.itemLevel })
            : localize("wayfinder-pf2e.StartingEquipment.Funding.Allowance");
    }
    return localize("wayfinder-pf2e.StartingEquipment.Funding.Currency");
}
function chargedCopper(line) {
    if (line.funding.lane === "class-grant")
        return 0;
    const resolved = resolveAcquisitionPrice(line.price);
    if (resolved.ok === false)
        return line.price.linePriceCopper;
    return line.funding.lane === "allowance" ? resolved.value.supplementalCopper : resolved.value.totalCopper;
}
function isPermanentItemType(itemType) {
    return itemType !== "ammo" && itemType !== "consumable";
}
const EQUIPMENT_TYPE_ICONS = Object.freeze({
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
function itemTypeIcon(itemType) {
    return EQUIPMENT_TYPE_ICONS[itemType] ?? "fa-cube";
}
/** One button per allowance level, so repeated levels read as a count instead of duplicate controls. */
function dedupeAllowanceLevels(allowances) {
    const byLevel = new Map();
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
function handoffReason(reason, localize) {
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
function formatCopper(copper, localize) {
    if (!Number.isSafeInteger(copper) || copper < 0) {
        return localize("wayfinder-pf2e.StartingEquipment.Currency.Unavailable");
    }
    if (copper === 0)
        return localize("wayfinder-pf2e.StartingEquipment.Currency.Gold", { value: 0 });
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
function cataloguePriceLabel(record, localize) {
    if (record.pricePending)
        return localize("wayfinder-pf2e.StartingEquipment.Catalogue.ViewForPrice");
    const price = formatCopper(record.priceCopper ?? -1, localize);
    const context = record.priceContext;
    if (!context)
        return price;
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
function localizedCatalogueInvariant(record, localize, locale) {
    let byLocalize = localizedCatalogueInvariantCache.get(record);
    const cached = byLocalize?.get(localize)?.get(locale);
    if (cached)
        return cached;
    const invariant = Object.freeze({
        levelLabel: localize("wayfinder-pf2e.StartingEquipment.Catalogue.LevelTag", { level: record.level }),
        priceLabel: cataloguePriceLabel(record, localize),
        rarityLabel: rarityLabel(record.rarity, localize),
        typeIcon: itemTypeIcon(record.itemType),
        itemTypeLabel: itemTypeLabel(record.itemType, localize),
        traits: Object.freeze(record.traits.map((trait) => pf2eTraitLabel(trait, localize))),
        // The compendium index carries no bulk, so the placeholder is dropped rather than shown as a non-answer.
        bulkLabel: record.bulkLabel === "See item details" ? "" : record.bulkLabel,
        unavailableReason: record.unavailableReason
            ? localize(record.exceptionRequestable
                ? "wayfinder-pf2e.StartingEquipment.Catalogue.ExceptionRequired"
                : "wayfinder-pf2e.StartingEquipment.Catalogue.ItemUnavailable")
            : null,
    });
    if (!byLocalize) {
        byLocalize = new WeakMap();
        localizedCatalogueInvariantCache.set(record, byLocalize);
    }
    let byLocale = byLocalize.get(localize);
    if (!byLocale) {
        byLocale = new Map();
        byLocalize.set(localize, byLocale);
    }
    byLocale.set(locale, invariant);
    return invariant;
}
function pf2eTraitLabel(trait, localize) {
    const key = `PF2E.Trait${pascalIdentifier(trait)}`;
    return localizeExternalKey(key, trait, localize);
}
function suppressedComponentLabel(component, itemType, localize) {
    if (component === "fundamental") {
        return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Fundamental");
    }
    if (component === "potency")
        return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Potency");
    if (component === "striking")
        return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Striking");
    if (component === "resilient")
        return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Resilient");
    if (component.startsWith("property:")) {
        const rune = component.slice("property:".length);
        return localize("wayfinder-pf2e.StartingEquipment.Price.Component.PropertyRune", {
            rune: localizeExternalKey(itemType === "weapon"
                ? `PF2E.WeaponPropertyRune.${rune}.Name`
                : `PF2E.ArmorPropertyRune${pascalIdentifier(rune)}`, rune, localize),
        });
    }
    return localize("wayfinder-pf2e.StartingEquipment.Price.Component.Other", {
        component: humanizeIdentifier(component),
    });
}
function localizeExternalKey(key, fallback, localize) {
    try {
        const label = localize(key);
        return label === key ? humanizeIdentifier(fallback) : label;
    }
    catch {
        return humanizeIdentifier(fallback);
    }
}
function pascalIdentifier(value) {
    return value
        .split(/[-_:]/u)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join("");
}
function humanizeIdentifier(value) {
    return value
        .split(/[-_:]/u)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}
function catalogueMessage(state, initialized, count, localize) {
    if (state === "ready") {
        return localize("wayfinder-pf2e.StartingEquipment.Catalogue.Ready", { count });
    }
    if (state === "error")
        return localize("wayfinder-pf2e.StartingEquipment.Catalogue.LoadFailed");
    return localize(initialized
        ? "wayfinder-pf2e.StartingEquipment.Catalogue.NotLoaded"
        : "wayfinder-pf2e.StartingEquipment.Catalogue.StartToLoad");
}
function catalogueFilterLabel(key, value, fallback, localize) {
    if (key === "rarity" && isRarity(value))
        return rarityLabel(value, localize);
    if (key === "type")
        return itemTypeLabel(value, localize);
    if (key === "trait")
        return pf2eTraitLabel(value, localize);
    if (key === "availability")
        return localize("wayfinder-pf2e.StartingEquipment.Catalogue.PolicyAvailable");
    if (key === "titan-mauler")
        return localize("wayfinder-pf2e.StartingEquipment.Catalogue.TitanMaulerEligible");
    return fallback;
}
function rarityLabel(rarity, localize) {
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
function isRarity(value) {
    return value === "common" || value === "uncommon" || value === "rare" || value === "unique";
}
function itemTypeLabel(itemType, localize) {
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
function reviewLabel(draft, localize) {
    if (draft.acquisitionCorrupt)
        return localize("wayfinder-pf2e.StartingEquipment.Review.Damaged");
    const acquisition = draft.acquisition;
    if (!acquisition)
        return localize("wayfinder-pf2e.StartingEquipment.Review.NotStarted");
    switch (acquisition.disposition.kind) {
        case "purchase-ledger":
            return localize("wayfinder-pf2e.StartingEquipment.Review.KitConfirmed");
        case "retain-all":
            return localize("wayfinder-pf2e.StartingEquipment.Review.KeepingCoin");
        case "handoff":
            return localize(acquisition.disposition.acknowledgedByUserId && acquisition.disposition.acknowledgedAt
                ? "wayfinder-pf2e.StartingEquipment.Review.HandledOnSheet"
                : "wayfinder-pf2e.StartingEquipment.Review.NeedsAcknowledgement");
        case "unreviewed":
            return localize(acquisition.disposition.invalidatedFrom
                ? "wayfinder-pf2e.StartingEquipment.Review.Changed"
                : "wayfinder-pf2e.StartingEquipment.Review.ChooseGear");
    }
}
//# sourceMappingURL=starting-equipment-pane.js.map