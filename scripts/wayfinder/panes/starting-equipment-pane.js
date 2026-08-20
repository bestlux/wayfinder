export const MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS = 12;
export function buildStartingEquipmentPane(step, draft, evaluation, catalogue) {
    const acquisition = draft.acquisition;
    const policy = acquisition?.policySnapshot?.material ?? null;
    const budgetCopper = policy?.budgetCopper ?? 1_500;
    const spentCopper = acquisition?.lines.reduce((sum, line) => sum + (line.funding.lane === "class-grant" ? 0 : line.price.linePriceCopper), 0) ?? 0;
    const reviewedRemaining = acquisition?.disposition.kind === "purchase-ledger" || acquisition?.disposition.kind === "retain-all"
        ? acquisition.disposition.review.remainingCopper
        : null;
    const remainingCopper = reviewedRemaining ?? Math.max(0, budgetCopper - spentCopper);
    const matchingRecords = catalogue.records.filter((record) => matchesQuery(record, catalogue.query) && matchesFilters(record, catalogue.activeFilters));
    const records = matchingRecords.slice(0, MAX_VISIBLE_STARTING_EQUIPMENT_RESULTS).map((record) => {
        const affordable = record.priceCopper !== null && record.priceCopper <= remainingCopper;
        return {
            ...record,
            affordable,
            previewing: record.sourceUuid === catalogue.previewSourceUuid,
            canAdd: record.available && affordable,
            canChooseTitanMauler: catalogue.titanMauler.required &&
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
    const cartLines = acquisition?.lines.map((line) => {
        const record = recordByUuid.get(line.sourceUuid);
        return {
            lineId: line.lineId,
            sourceUuid: line.sourceUuid,
            name: record?.name ?? line.sourceUuid,
            quantity: line.price.requestedQuantity,
            priceLabel: formatCopper(line.price.linePriceCopper),
            fundingLabel: fundingLabel(line.funding.lane),
            canRemove: line.funding.lane !== "class-grant" ||
                plannedGrantById.get(line.funding.grant.plannedGrantId)?.materializer !== "pf2e-native",
            canChangeQuantity: line.funding.lane !== "class-grant",
            unavailableReason: line.funding.lane === "class-grant" || line.policyDecision.eligible
                ? null
                : "Your world's rules no longer allow this item.",
            focusId: `starting-equipment-line:${line.lineId}`,
        };
    }) ?? [];
    const disposition = acquisition?.disposition.kind ?? "not-started";
    const currencyLines = acquisition?.lines.filter((line) => line.funding.lane !== "class-grant") ?? [];
    const handoff = acquisition?.disposition.kind === "handoff" ? acquisition.disposition : null;
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
        policy: {
            recipeLabel: policy ? recipeLabel(policy.resolvedRecipe.kind) : "Read from your world when you start",
            budgetLabel: formatCopper(budgetCopper),
            automaticEligibilityLabel: policy
                ? `${capitalize(policy.rarityPolicy.blanketCeiling)} gear from ${policy.sourcePolicy.effectivePackIds.length} approved pack${policy.sourcePolicy.effectivePackIds.length === 1 ? "" : "s"}`
                : "Common gear from approved PF2E sources",
            authorityLabel: policy
                ? `${authorityLabel(policy.authorityPolicy.recipeChoice)} picks the funding, ${authorityLabel(policy.authorityPolicy.apply)} applies it`
                : "Read from your world when you start",
            handoffLabel: "Coin and gear your character already has stay put. Handle those on the PF2E inventory tab.",
            explanations: policy && acquisition ? policyExplanations(acquisition) : [],
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
            canReviewPurchases: !!acquisition &&
                !handoff &&
                currencyLines.length > 0 &&
                (!catalogue.titanMauler.required || catalogue.titanMauler.selectedSourceUuid !== null),
            canRetainAll: !!acquisition &&
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
function matchesQuery(record, query) {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized)
        return true;
    return [record.name, record.sourceLabel, record.rarity, record.itemType, ...record.traits]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
}
function matchesFilters(record, filters) {
    return Object.entries(filters).every(([key, values]) => {
        if (values.length === 0)
            return true;
        const actual = key === "rarity"
            ? record.rarity
            : key === "source"
                ? record.sourceLabel
                : key === "type"
                    ? record.itemType
                    : null;
        return actual !== null && values.includes(actual);
    });
}
function policyExplanations(acquisition) {
    const material = acquisition.policySnapshot?.material;
    if (!material)
        return [];
    return [
        "At level 1 you have 15 gp to spend, whichever funding option your GM picked.",
        material.rarityPolicy.blanketCeiling === "common"
            ? "Anything Common is fair game, as long as its pack is approved."
            : `Your GM has opened this up to ${material.rarityPolicy.blanketCeiling} gear.`,
    ];
}
function recipeLabel(kind) {
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
function authorityLabel(value) {
    return value === "gm-fixed" || value === "gm-review" || value === "gm-confirmation" ? "Your GM" : "You";
}
function fundingLabel(lane) {
    if (lane === "class-grant")
        return "Granted by your build · free";
    if (lane === "allowance")
        return "Permanent item allowance";
    return "Paid from starting wealth";
}
function handoffReason(reason) {
    switch (reason.code) {
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
function formatCopper(copper) {
    if (!Number.isSafeInteger(copper) || copper < 0)
        return "Unavailable";
    if (copper === 0)
        return "0 gp";
    const gp = Math.floor(copper / 100);
    const sp = Math.floor((copper % 100) / 10);
    const cp = copper % 10;
    return [gp > 0 ? `${gp} gp` : "", sp > 0 ? `${sp} sp` : "", cp > 0 ? `${cp} cp` : ""].filter(Boolean).join(" ");
}
function capitalize(value) {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
//# sourceMappingURL=starting-equipment-pane.js.map