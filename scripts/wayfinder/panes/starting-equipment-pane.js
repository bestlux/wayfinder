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
        };
    });
    const recordByUuid = new Map(catalogue.records.map((record) => [record.sourceUuid, record]));
    const plannedGrantById = new Map(acquisition?.plannedClassGrants.map((grant) => [grant.grantId, grant]) ?? []);
    const preview = records.find((record) => record.previewing) ?? null;
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
                : "This item no longer satisfies the effective policy.",
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
            recipeLabel: policy ? recipeLabel(policy.resolvedRecipe.kind) : "World default resolved during setup",
            budgetLabel: formatCopper(budgetCopper),
            automaticEligibilityLabel: policy
                ? `${capitalize(policy.rarityPolicy.blanketCeiling)} items from ${policy.sourcePolicy.effectivePackIds.length} approved pack${policy.sourcePolicy.effectivePackIds.length === 1 ? "" : "s"}`
                : "Common equipment from approved PF2E sources",
            authorityLabel: policy
                ? `${authorityLabel(policy.authorityPolicy.recipeChoice)} chooses the recipe; ${authorityLabel(policy.authorityPolicy.apply)} applies it`
                : "Resolved from the world equipment policy during setup",
            handoffLabel: "Existing currency or foreign physical equipment stays on the actor and routes to the PF2E inventory sheet.",
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
        review: {
            disposition,
            label: evaluation.status,
            canReviewPurchases: !!acquisition && !handoff && currencyLines.length > 0,
            canRetainAll: !!acquisition && !handoff && currencyLines.length === 0,
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
        "Level 1 uses the same 15 gp budget under either official starting-equipment recipe.",
        material.rarityPolicy.blanketCeiling === "common"
            ? "Common items are automatically eligible when their source pack is approved."
            : `Items up to ${material.rarityPolicy.blanketCeiling} rarity may be eligible under world policy.`,
    ];
}
function recipeLabel(kind) {
    switch (kind) {
        case "level-1-equivalent":
            return "Level-1 starting wealth (official recipes are equivalent)";
        case "permanent-items":
            return "Permanent items and currency";
        case "lump-sum":
            return "Lump-sum currency";
        default:
            return "GM-approved custom lump sum";
    }
}
function authorityLabel(value) {
    return value === "gm-fixed" || value === "gm-review" || value === "gm-confirmation" ? "GM" : "Actor owner";
}
function fundingLabel(lane) {
    if (lane === "class-grant")
        return "Automatic build grant · not charged";
    if (lane === "allowance")
        return "Permanent-item allowance";
    return "Starting wealth";
}
function handoffReason(reason) {
    switch (reason.code) {
        case "foreign-physical-items":
            return "The actor already has physical equipment that Wayfinder will not replace or merge.";
        case "nonzero-currency":
            return "The actor already has currency that Wayfinder will not reprice or replace.";
        case "unresolved-class-grant":
            return "A class-granted item could not be reconciled automatically.";
        default:
            return "A class-granted item has more than one possible match.";
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