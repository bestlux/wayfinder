import { createPlannedClassGrant } from "../../src/wayfinder/domain/class-grant-reconciliation";
import { physicalGrantRouteById } from "../../src/wayfinder/domain/physical-grant-route-registry";

export function nativePhysicalGrantSmokeFixture(routeIds: readonly string[]) {
  const items: any[] = [];
  const bySource = new Map<string, any>();
  const classGrants = routeIds.map((routeId) => {
    const route = physicalGrantRouteById(routeId);
    if (route?.classification !== "supported-native" || !route.grant.expectedSourceUuid || !route.grant.grantId) {
      throw new Error(`Expected supported fixed native route: ${routeId}`);
    }
    const profile = route.grant;
    let parent: any = null;
    for (const sourceId of [...profile.nativeGrantChainSourceUuids].reverse()) {
      let item = bySource.get(sourceId);
      if (!item) {
        item = itemEvidence(sourceId, false, parent);
        bySource.set(sourceId, item);
        items.push(item);
      }
      parent = item;
    }
    const physical = itemEvidence(profile.expectedSourceUuid!, true, parent);
    items.push(physical);
    return {
      grant: createPlannedClassGrant({
        grantId: profile.grantId!,
        profileId: route.profileId,
        origin: { sourceSlotId: profile.originSourceSlotId, sourceUuid: profile.originSourceUuid },
        granterSourceUuid: profile.granterSourceUuid,
        expected: { sourceUuid: profile.expectedSourceUuid!, quantity: 1, itemType: profile.expectedItemType },
        materializer: "pf2e-native",
        eligibilityKind: "fixed-class-grant",
        resaleRule: profile.resaleRule,
        eligibilityEvidence: { kind: "fixed-native-profile" },
        nativeGrantChainSourceUuids: profile.nativeGrantChainSourceUuids,
      }),
      status: "resolved",
      observedItemIds: [physical.id],
    };
  });
  // Use the realized native retain-all line/entry shape recorded by the Foundry smoke lane.
  const logicalLines = classGrants.map(({ grant }, index) => ({
    lineId: `wf-line-native-${index}`,
    sourceUuid: grant.expected.sourceUuid,
    documentFingerprint: `equipment-document-v1-${String(index).padStart(8, "0")}`,
    priceFingerprint: "equipment-price-v1-77af2be6",
    itemLevel: 0,
    requestedQuantity: 1,
    stackingIntent: "separate",
    permanence: "permanent",
    componentKind: "baseline-item",
    policyDecision: {
      eligible: true,
      packId: "pf2e.equipment-srd",
      publicationSlug: "pathfinder-dark-archive-remastered",
      rarity: "common",
      sourceBasis: "approved-pack",
      rarityBasis: "common",
      characterAccessRef: null,
      sourceExceptionJudgmentId: null,
      rarityExceptionJudgmentId: null,
      abpTreatment: "unchanged",
    },
    funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
    resolvedAllowanceId: null,
  }));
  const entries = logicalLines.map((line, index) => {
    const plannedItemId = `wf-planned-item-sha256-${String(index).padStart(64, "0")}`;
    return {
      entryId: `wf-entry-sha256-${String(index).padStart(64, "0")}`,
      preAggregationKey: `wf-preagg-sha256-${String(index).padStart(64, "0")}`,
      lineIds: [line.lineId],
      sourceUuid: line.sourceUuid,
      documentFingerprint: line.documentFingerprint,
      priceFingerprint: line.priceFingerprint,
      quantity: 1,
      stackingIntent: line.stackingIntent,
      funding: structuredClone(line.funding),
      resolvedAllowanceId: null,
      policyDecision: structuredClone(line.policyDecision),
      price: {
        basePrice: { kind: "priced", value: {} },
        size: "medium",
        sizeSensitive: true,
        preciousMaterial: false,
        adjustedBulkPriceCopper: null,
        configurationPriceCopper: 0,
        pricePer: 1,
        sourceQuantity: 1,
        requestedQuantity: 1,
        materializedQuantity: 1,
        unitPriceCopper: 0,
        linePriceCopper: 0,
      },
      plannedItems: [
        {
          plannedItemId,
          ownedContainerId: null,
          sourceUuid: line.sourceUuid,
          quantity: 1,
          plannedContainerId: null,
        },
      ],
      observedItems: [
        {
          plannedItemId,
          actualItemId: classGrants[index]!.observedItemIds[0]!,
          actualSourceUuid: line.sourceUuid,
          actualQuantity: 1,
          plannedContainerId: null,
          actualContainerId: null,
        },
      ],
    };
  });
  return { items, classGrants, logicalLines, entries };
}

function itemEvidence(sourceId: string, physical: boolean, parent: any) {
  return {
    id: sourceId.split(".").at(-1)!,
    name: sourceId,
    type: physical ? "equipment" : "feat",
    sourceId,
    isPhysical: physical,
    isCurrency: false,
    quantity: physical ? 1 : null,
    acquisition: null,
    slotId: null,
    destinationKey: null,
    trainingKey: null,
    containerId: null,
    location: null,
    grantedById: parent?.id ?? null,
    grantAncestryIds: parent ? [parent.id, ...parent.grantAncestryIds] : [],
  };
}
