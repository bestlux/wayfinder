import { sourceIdOf } from "../../shared/source-id.js";
import type { DraftState, PendingStep } from "../../types.js";
import {
  createPlannedClassGrant,
  type ObservedClassGrantItem,
  type PlannedClassGrantV1,
  reconcilePlannedClassGrants,
} from "../domain/class-grant-reconciliation.js";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  supportedPhysicalGrantRoute,
  THAUMATURGE_FIXED_IMPLEMENTS,
  THAUMATURGE_IMPLEMENT_ORIGINS,
  type ThaumaturgeClassGrantProfileId,
  type ThaumaturgeFixedImplement,
  type ThaumaturgeImplementOrigin,
} from "../domain/physical-grant-route-registry.js";
import type { ClassGrantProjectionBlocker } from "./class-grant-projection-service.js";
import { findThaumaturgeNativeSelectorRecovery } from "./thaumaturge-native-selector-recovery.js";

const BENEFIT_IDS = {
  amulet: "ALcWRnRjvuPKu4nV",
  bell: "M0UnQTqofeg1npcl",
  chalice: "UfUqPcPcrGgRJCO3",
  lantern: "tBI15UqeQH7PLzAK",
  mirror: "AehJwnLCUyASCQlu",
  regalia: "3eRkOQa7h1MWmzBh",
  tome: "oADE2kM43wpF7MT5",
  wand: "YbRVsHfmhPXLfCTB",
} as const;

/** Only the two standard class origins authorize native fixed implements. */
export async function projectThaumaturgeImplementGrants(args: {
  readonly draft: DraftState;
  readonly classDocument: unknown;
  readonly activeSteps: readonly PendingStep[];
  readonly observedActorItems: readonly ObservedClassGrantItem[];
  readonly fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>;
}): Promise<{ grants: PlannedClassGrantV1[]; blockers: ClassGrantProjectionBlocker[] }> {
  const grants: PlannedClassGrantV1[] = [];
  const blockers: ClassGrantProjectionBlocker[] = [];
  for (const origin of THAUMATURGE_IMPLEMENT_ORIGINS) {
    const selection = args.draft.branchSelections[origin.slotId];
    if (
      !selection ||
      !(
        args.activeSteps.some((step) => step.slotId === origin.slotId) ||
        args.observedActorItems.some(
          (item) => item.sourceUuid === selection.uuid && item.wayfinderSlotId === origin.slotId
        )
      )
    )
      continue;
    const implement = THAUMATURGE_FIXED_IMPLEMENTS.find((entry) => selection.uuid === featureUuid(entry.featureId));
    const profileId: ThaumaturgeClassGrantProfileId = `thaumaturge-${implement?.slug ?? "amulet"}-implement-${origin.key}`;
    const fail = (code: "source-missing" | "source-drift", message: string): void => {
      blockers.push({ code, profileId, message });
    };
    if (
      !implement ||
      selection.slotId !== origin.slotId ||
      selection.itemType !== "feat" ||
      selection.featType !== "classfeature" ||
      args.draft.targetLevel < origin.level
    ) {
      fail(
        "source-drift",
        "This Thaumaturge implement or its selection origin has no reviewed native equipment support. Use the PF2E sheet for this build."
      );
      continue;
    }
    if (!rootLinksSelector(args.classDocument, origin)) {
      fail(
        "source-drift",
        "The installed Thaumaturge class no longer links the reviewed implement selector at its expected level."
      );
      continue;
    }
    const route = supportedPhysicalGrantRoute(profileId);
    const [selector, feature, item] = await Promise.all([
      args.fetchDocumentByUuid(origin.selectorUuid),
      args.fetchDocumentByUuid(route.grant.granterSourceUuid),
      args.fetchDocumentByUuid(route.grant.expectedSourceUuid!),
    ]);
    if (!selector || !feature || !item) {
      fail("source-missing", "A required installed PF2E Thaumaturge implement source document is unavailable.");
      continue;
    }
    if (
      !sourceMatches(selector, origin.selectorUuid, "feat") ||
      !sourceMatches(feature, route.grant.granterSourceUuid, "feat") ||
      !sourceMatches(item, route.grant.expectedSourceUuid!, "equipment") ||
      !reviewedSelector(selector, origin) ||
      !reviewedFeature(feature, implement) ||
      !reviewedItem(item, implement)
    ) {
      fail(
        "source-drift",
        "The installed Thaumaturge implement selection, fixed grant, or equipment facts changed; reviewed native equipment support is unavailable."
      );
      continue;
    }
    const grant = route.grant;
    const plannedGrant = createPlannedClassGrant({
      profileId,
      grantId: grant.grantId!,
      origin: { sourceSlotId: grant.originSourceSlotId, sourceUuid: grant.originSourceUuid },
      granterSourceUuid: grant.granterSourceUuid,
      expected: { sourceUuid: grant.expectedSourceUuid!, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: grant.nativeGrantChainSourceUuids,
    });
    // PF2E's allowDuplicate:false may attach its grant to an existing same-source
    // item. Only a previously materialized grant with the complete reviewed
    // ancestry can be reused; UUID resemblance cannot create new authority.
    const existingItems = args.observedActorItems.filter((entry) => entry.sourceUuid === grant.expectedSourceUuid);
    if (existingItems.length > 0) {
      const reconciliation = reconcilePlannedClassGrants({
        plan: [plannedGrant],
        actorItems: args.observedActorItems,
        phase: "before-acquisition",
        draftId: "thaumaturge-source-preflight",
        batchId: "thaumaturge-source-preflight",
      });
      const recoverable = findThaumaturgeNativeSelectorRecovery({
        draft: args.draft,
        grant: plannedGrant,
        actorItems: args.observedActorItems,
      });
      if (existingItems.length !== 1 || (reconciliation.entries[0]?.status !== "resolved" && !recoverable)) {
        fail(
          "source-drift",
          "An existing implement item does not have the exact reviewed Thaumaturge grant ancestry, or multiple copies exist. Wayfinder cannot adopt it as a class grant."
        );
        continue;
      }
    }
    grants.push(plannedGrant);
  }
  return { grants, blockers };
}

function rootLinksSelector(document: unknown, origin: ThaumaturgeImplementOrigin): boolean {
  if (
    !sourceMatches(document, CLASS_GRANT_PROFILE_UUIDS.thaumaturgeClass, "class") ||
    !isRecord(document) ||
    !isRecord(document.system) ||
    !isRecord(document.system.items)
  )
    return false;
  return (
    Object.values(document.system.items).filter(
      (entry) =>
        isRecord(entry) &&
        entry.level === origin.level &&
        (entry.uuid === origin.selectorUuid || entry.uuid === featureUuid(origin.selectorName))
    ).length === 1
  );
}

function reviewedSelector(document: unknown, origin: ThaumaturgeImplementOrigin): boolean {
  const values = rules(document);
  const choices = values.filter((rule) => rule.key === "ChoiceSet");
  const grants = values.filter((rule) => rule.key === "GrantItem");
  const choice = choices[0];
  const grant = grants[0];
  return (
    values.length === (origin.key === "first" ? 3 : 2) &&
    choices.length === 1 &&
    grants.length === 1 &&
    choice?.flag === "implement" &&
    choice.adjustName === false &&
    isRecord(choice.choices) &&
    same(choice.choices.filter, ["item:tag:thaumaturge-implement"]) &&
    choice.choices.itemType === undefined &&
    choice.predicate === undefined &&
    grant?.uuid === "{item|flags.system.rulesSelections.implement}" &&
    grant.predicate === undefined &&
    grant.inMemoryOnly !== true &&
    grant.track !== true
  );
}

function reviewedFeature(document: unknown, implement: ThaumaturgeFixedImplement): boolean {
  if (
    !isRecord(document) ||
    !isRecord(document.system) ||
    !isRecord(document.system.traits) ||
    !same(document.system.traits.otherTags, ["thaumaturge-implement"])
  )
    return false;
  const values = rules(document);
  const grants = values.filter((rule) => rule.key === "GrantItem");
  const physical = grants.filter(
    (rule) =>
      rule.uuid === equipmentUuid(implement.itemId) || rule.uuid === equipmentUuid(`${implement.name} Implement`)
  );
  const benefit = grants.filter(
    (rule) =>
      rule.uuid === featureUuid(BENEFIT_IDS[implement.slug]) ||
      rule.uuid === featureUuid(`Initiate Benefit (${implement.name})`)
  );
  return (
    values.length === 4 &&
    !values.some((rule) => rule.key === "ChoiceSet") &&
    grants.length === 2 &&
    physical.length === 1 &&
    physical[0]?.allowDuplicate === false &&
    physical[0].predicate === undefined &&
    physical[0].inMemoryOnly !== true &&
    physical[0].track !== true &&
    benefit.length === 1 &&
    same(benefit[0]?.predicate, ["class:thaumaturge"])
  );
}

function reviewedItem(document: unknown, implement: ThaumaturgeFixedImplement): boolean {
  if (!isRecord(document) || !isRecord(document.system)) return false;
  const system = document.system;
  const price = isRecord(system.price) && isRecord(system.price.value) ? system.price.value : null;
  const allowedCoins = new Set(["pp", "gp", "sp", "cp", "credits", "upb"]);
  const values = rules(document);
  return (
    system.quantity === 1 &&
    isRecord(system.level) &&
    system.level.value === 0 &&
    isRecord(system.traits) &&
    system.traits.rarity === "common" &&
    isRecord(system.usage) &&
    system.usage.value === "held-in-one-hand" &&
    !!price &&
    Object.entries(price).every(([key, value]) => allowedCoins.has(key) && value === 0) &&
    values.length === 2 &&
    values.every((rule) => rule.key === "RollOption" && rule.predicate === undefined) &&
    same(values.map((rule) => rule.option).sort(), ["implement-held", `implement:${implement.slug}:equipped`].sort())
  );
}

function sourceMatches(document: unknown, uuid: string, type: string): boolean {
  return (
    isRecord(document) &&
    document.type === type &&
    (sourceIdOf(document) === null || sourceIdOf(document) === uuid) &&
    (document._id === undefined || document._id === uuid.split(".").at(-1))
  );
}

function rules(document: unknown): Record<string, unknown>[] {
  return isRecord(document) && isRecord(document.system) && Array.isArray(document.system.rules)
    ? document.system.rules.filter(isRecord)
    : [];
}
function featureUuid(id: string): string {
  return `Compendium.pf2e.classfeatures.Item.${id}`;
}
function equipmentUuid(id: string): string {
  return `Compendium.pf2e.equipment-srd.Item.${id}`;
}
function same(value: unknown, expected: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
