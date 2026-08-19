import { normalizeCompletedAcquisitionManifest, } from "../domain/completed-acquisition-manifest.js";
export async function buildAcquisitionReceiptViewModel(rawManifest, deps = {}) {
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
            fundingLabel: fundingLabel(entry.funding.lane),
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
        dispositionLabel: dispositionLabel(manifest.disposition),
        itemRows,
        classGrantRows: manifest.classGrants.map((entry) => ({
            grantId: entry.grant.grantId,
            sourceUuid: entry.grant.expected.sourceUuid,
            status: entry.status,
            observedItemIds: [...entry.observedItemIds],
        })),
        currency: {
            ...manifest.currency,
            spentLabel: formatCopper(manifest.currency.spentCopper),
            remainingLabel: formatCopper(manifest.currency.remainingCopper),
            observedLabel: formatCopper(manifest.currency.observedCopper),
        },
        authority: {
            applyLabel: authority.apply === "gm-review" ? "GM reviewed Apply" : "Actor-owner Apply",
            recipeChoiceLabel: authority.recipeChoice === "gm-fixed" ? "GM-selected recipe" : "Actor-owner recipe choice",
            higherLevelStartLabel: authority.higherLevelStart === "gm-confirmation"
                ? "GM-confirmed higher-level start"
                : "Actor-owner higher-level start attestation",
            judgmentIds: manifest.policy.material.gmJudgments.map((judgment) => judgment.id).sort(),
        },
        environmentLabel: `Foundry ${manifest.environment.foundryVersion} · PF2E ${manifest.environment.pf2eVersion} · Wayfinder ${manifest.environment.moduleVersion}`,
        canOpenInventory: true,
    };
}
function dispositionLabel(disposition) {
    switch (disposition) {
        case "purchase-ledger":
            return "Purchased starting equipment";
        case "retain-all":
            return "Retained all starting currency";
        case "handoff":
            return "Continued in the PF2E character sheet";
    }
}
function fundingLabel(lane) {
    switch (lane) {
        case "currency":
            return "Currency";
        case "allowance":
            return "Permanent-item allowance";
        case "class-grant":
            return "Automatic build grant";
    }
}
function compactSourceLabel(sourceUuid) {
    const documentId = sourceUuid.split(".").at(-1)?.trim();
    return documentId || sourceUuid;
}
function formatCopper(copper) {
    if (!Number.isSafeInteger(copper) || copper < 0) {
        throw new TypeError("Starting-equipment receipt currency is malformed.");
    }
    const gp = Math.floor(copper / 100);
    const sp = Math.floor((copper % 100) / 10);
    const cp = copper % 10;
    const parts = [];
    if (gp > 0)
        parts.push(`${gp} gp`);
    if (sp > 0)
        parts.push(`${sp} sp`);
    if (cp > 0 || parts.length === 0)
        parts.push(`${cp} cp`);
    return parts.join(" ");
}
//# sourceMappingURL=acquisition-receipt.js.map