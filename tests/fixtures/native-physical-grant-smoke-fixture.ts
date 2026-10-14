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
  return { items, classGrants };
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
