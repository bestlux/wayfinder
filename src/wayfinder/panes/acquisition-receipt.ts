import {
  type CompletedAcquisitionManifestV1,
  normalizeCompletedAcquisitionManifest,
} from "../domain/completed-acquisition-manifest.js";

export interface AcquisitionReceiptItemRow {
  readonly plannedItemId: string;
  readonly actualItemId: string;
  readonly name: string;
  readonly sourceUuid: string;
  readonly quantity: number;
  readonly containerId: string | null;
  readonly containerName: string | null;
  readonly fundingLabel: string;
}

export interface AcquisitionReceiptClassGrantRow {
  readonly grantId: string;
  readonly sourceUuid: string;
  readonly status: "resolved" | "unresolved" | "ambiguous";
  readonly observedItemIds: readonly string[];
}

export interface AcquisitionReceiptViewModel {
  readonly manifestId: string;
  readonly batchId: string;
  readonly appliedAt: string;
  readonly appliedBy: string;
  readonly disposition: CompletedAcquisitionManifestV1["disposition"];
  readonly dispositionLabel: string;
  readonly itemRows: readonly AcquisitionReceiptItemRow[];
  readonly classGrantRows: readonly AcquisitionReceiptClassGrantRow[];
  readonly currency: {
    readonly preCopper: number;
    readonly budgetCopper: number;
    readonly spentCopper: number;
    readonly remainingCopper: number;
    readonly targetCopper: number;
    readonly observedCopper: number;
    readonly spentLabel: string;
    readonly remainingLabel: string;
    readonly observedLabel: string;
  };
  readonly authority: {
    readonly applyLabel: string;
    readonly recipeChoiceLabel: string;
    readonly higherLevelStartLabel: string;
    readonly judgmentIds: readonly string[];
  };
  readonly environmentLabel: string;
  readonly canOpenInventory: true;
}

export interface AcquisitionReceiptDependencies {
  resolveItemName?: (sourceUuid: string, actualItemId: string) => string | null | Promise<string | null>;
  resolveContainerName?: (containerId: string) => string | null | Promise<string | null>;
}

export async function buildAcquisitionReceiptViewModel(
  rawManifest: unknown,
  deps: AcquisitionReceiptDependencies = {}
): Promise<AcquisitionReceiptViewModel> {
  const manifest = normalizeCompletedAcquisitionManifest(rawManifest);
  if (!manifest) {
    throw new TypeError("Starting-equipment receipt requires a valid completed acquisition manifest.");
  }

  const itemRows = await Promise.all(
    manifest.entries.flatMap((entry) =>
      entry.observedItems.map(async (observed): Promise<AcquisitionReceiptItemRow> => {
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
      })
    )
  );
  itemRows.sort(
    (left, right) => left.name.localeCompare(right.name) || left.actualItemId.localeCompare(right.actualItemId)
  );

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
      higherLevelStartLabel:
        authority.higherLevelStart === "gm-confirmation"
          ? "GM-confirmed higher-level start"
          : "Actor-owner higher-level start attestation",
      judgmentIds: manifest.policy.material.gmJudgments.map((judgment) => judgment.id).sort(),
    },
    environmentLabel: `Foundry ${manifest.environment.foundryVersion} · PF2E ${manifest.environment.pf2eVersion} · Wayfinder ${manifest.environment.moduleVersion}`,
    canOpenInventory: true,
  };
}

function dispositionLabel(disposition: CompletedAcquisitionManifestV1["disposition"]): string {
  switch (disposition) {
    case "purchase-ledger":
      return "Purchased starting equipment";
    case "retain-all":
      return "Retained all starting currency";
    case "handoff":
      return "Continued in the PF2E character sheet";
  }
}

function fundingLabel(lane: CompletedAcquisitionManifestV1["entries"][number]["funding"]["lane"]): string {
  switch (lane) {
    case "currency":
      return "Currency";
    case "allowance":
      return "Permanent-item allowance";
    case "class-grant":
      return "Class grant";
  }
}

function compactSourceLabel(sourceUuid: string): string {
  const documentId = sourceUuid.split(".").at(-1)?.trim();
  return documentId || sourceUuid;
}

function formatCopper(copper: number): string {
  if (!Number.isSafeInteger(copper) || copper < 0) {
    throw new TypeError("Starting-equipment receipt currency is malformed.");
  }
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  const parts = [];
  if (gp > 0) parts.push(`${gp} gp`);
  if (sp > 0) parts.push(`${sp} sp`);
  if (cp > 0 || parts.length === 0) parts.push(`${cp} cp`);
  return parts.join(" ");
}
