import { normalizeCompletedAcquisitionManifest, } from "../domain/completed-acquisition-manifest.js";
export async function buildAcquisitionReceiptViewModel(rawManifest, deps) {
    const manifest = normalizeCompletedAcquisitionManifest(rawManifest);
    if (!manifest) {
        throw new TypeError("Starting-equipment receipt requires a valid completed acquisition manifest.");
    }
    const itemRows = await Promise.all(manifest.entries.flatMap((entry) => entry.observedItems.map(async (observed) => {
        const resolvedName = await deps.resolveItemName?.(observed.actualSourceUuid, observed.actualItemId);
        const containerName = observed.actualContainerId
            ? ((await deps.resolveContainerName?.(observed.actualContainerId)) ?? observed.actualContainerId)
            : null;
        return {
            plannedItemId: observed.plannedItemId,
            actualItemId: observed.actualItemId,
            name: resolvedName ?? compactSourceLabel(observed.actualSourceUuid),
            sourceUuid: observed.actualSourceUuid,
            quantity: observed.actualQuantity,
            containerId: observed.actualContainerId,
            containerName,
            fundingLabel: fundingLabel(entry.funding.lane, deps.localize),
        };
    })));
    itemRows.sort((left, right) => left.name.localeCompare(right.name) || left.actualItemId.localeCompare(right.actualItemId));
    const authority = manifest.policy.material.authorityPolicy;
    return {
        manifestId: manifest.id,
        batchId: manifest.batchId,
        appliedAt: manifest.appliedAt,
        appliedBy: manifest.appliedBy.userName,
        disposition: manifest.disposition,
        dispositionLabel: dispositionLabel(manifest.disposition, deps.localize),
        itemRows,
        classGrantRows: manifest.classGrants.map((entry) => ({
            grantId: entry.grant.grantId,
            sourceUuid: entry.grant.expected.sourceUuid,
            status: entry.status,
            statusLabel: classGrantStatusLabel(entry.status, deps.localize),
            observedItemIds: [...entry.observedItemIds],
        })),
        currency: {
            ...manifest.currency,
            spentLabel: formatCopper(manifest.currency.spentCopper, deps.localize),
            remainingLabel: formatCopper(manifest.currency.remainingCopper, deps.localize),
            observedLabel: formatCopper(manifest.currency.observedCopper, deps.localize),
        },
        authority: {
            applyLabel: deps.localize(authority.apply === "gm-review"
                ? "wayfinder-pf2e.AcquisitionReceipt.Authority.GmReviewed"
                : "wayfinder-pf2e.AcquisitionReceipt.Authority.AppliedByYou"),
            recipeChoiceLabel: deps.localize(authority.recipeChoice === "gm-fixed"
                ? "wayfinder-pf2e.AcquisitionReceipt.Authority.FundingSetByGm"
                : "wayfinder-pf2e.AcquisitionReceipt.Authority.FundingChosenByYou"),
            recipeSelectionLabel: recipeSelectionLabel(manifest.policy.material.recipeSelection, deps.localize),
            recipeSelectedAt: manifest.policy.material.recipeSelection?.selectedAt ?? null,
            higherLevelStartLabel: deps.localize(authority.higherLevelStart === "gm-confirmation"
                ? "wayfinder-pf2e.AcquisitionReceipt.Authority.HigherLevelConfirmed"
                : "wayfinder-pf2e.AcquisitionReceipt.Authority.HigherLevelNoted"),
            judgmentIds: manifest.policy.material.gmJudgments.map((judgment) => judgment.id).sort(),
        },
        environmentLabel: deps.localize("wayfinder-pf2e.AcquisitionReceipt.Environment", {
            foundryVersion: manifest.environment.foundryVersion,
            pf2eVersion: manifest.environment.pf2eVersion,
            moduleVersion: manifest.environment.moduleVersion,
        }),
        canOpenInventory: true,
    };
}
function recipeSelectionLabel(selection, localize) {
    if (!selection)
        return localize("wayfinder-pf2e.AcquisitionReceipt.Authority.SelectorUnavailable");
    return selection.selector.kind === "unattributed-world-policy"
        ? localize("wayfinder-pf2e.AcquisitionReceipt.Authority.LegacyWorldPolicy")
        : localize("wayfinder-pf2e.AcquisitionReceipt.Authority.SelectedBy", {
            userName: selection.selector.userName,
        });
}
function classGrantStatusLabel(status, localize) {
    switch (status) {
        case "resolved":
            return localize("wayfinder-pf2e.AcquisitionReceipt.ClassGrant.Resolved");
        case "pending":
            return localize("wayfinder-pf2e.AcquisitionReceipt.ClassGrant.Pending");
        case "ambiguous":
            return localize("wayfinder-pf2e.AcquisitionReceipt.ClassGrant.Ambiguous");
        default:
            return localize("wayfinder-pf2e.AcquisitionReceipt.ClassGrant.Unresolved");
    }
}
function dispositionLabel(disposition, localize) {
    switch (disposition) {
        case "purchase-ledger":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Disposition.Purchased");
        case "retain-all":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Disposition.Retained");
        case "handoff":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Disposition.Handoff");
    }
}
function fundingLabel(lane, localize) {
    switch (lane) {
        case "currency":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Funding.Currency");
        case "allowance":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Funding.Allowance");
        case "class-grant":
            return localize("wayfinder-pf2e.AcquisitionReceipt.Funding.ClassGrant");
    }
}
function compactSourceLabel(sourceUuid) {
    const documentId = sourceUuid.split(".").at(-1)?.trim();
    return documentId || sourceUuid;
}
function formatCopper(copper, localize) {
    if (!Number.isSafeInteger(copper) || copper < 0) {
        throw new TypeError("Starting-equipment receipt currency is malformed.");
    }
    const gp = Math.floor(copper / 100);
    const sp = Math.floor((copper % 100) / 10);
    const cp = copper % 10;
    const parts = [];
    if (gp > 0)
        parts.push(localize("wayfinder-pf2e.StartingEquipment.Currency.Gold", { value: gp }));
    if (sp > 0)
        parts.push(localize("wayfinder-pf2e.StartingEquipment.Currency.Silver", { value: sp }));
    if (cp > 0 || parts.length === 0) {
        parts.push(localize("wayfinder-pf2e.StartingEquipment.Currency.Copper", { value: cp }));
    }
    return parts.join(" ");
}
//# sourceMappingURL=acquisition-receipt.js.map