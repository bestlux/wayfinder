import { MODULE_ID } from "../../constants.js";
import { resolveUuid } from "../../shared/foundry-compat.js";
import { sourceIdOf } from "../../shared/source-id.js";
import type { DraftState, PendingStep, SelectionRef } from "../../types.js";
import { acquisitionPolicyMaterialMatches, createAcquisitionPolicySnapshot } from "../domain/acquisition-draft.js";
import type { AcquisitionLineDraft, AcquisitionRecipeSelection } from "../domain/acquisition-types.js";
import {
  CLASS_GRANT_PROFILE_UUIDS,
  type ClassGrantProfileId,
  createPlannedClassGrant,
  createPreparedClassGrantPlan,
  type EquipmentSize,
  evaluateTitanMaulerCandidate,
  type ObservedClassGrantItem,
  type PlannedClassGrantV1,
  type PreparedClassGrantPlanV1,
  type TitanMaulerCandidate,
} from "../domain/class-grant-reconciliation.js";
import { normalizeAcquisitionIdentity } from "../domain/economic-baseline.js";
import {
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentHigherLevelStartClaim,
  type EquipmentHigherLevelStartEvidence,
  evaluateEquipmentItemAuthority,
} from "../domain/equipment-policy.js";
import {
  currentPf2eVersion,
  findUnsupportedPhysicalGrantRoutes,
  type PhysicalGrantCoverageBlocker,
  physicalGrantCoverageBlockers,
} from "../domain/physical-grant-coverage.js";
import { resolveEquipmentPolicyForActor } from "./equipment-policy-service.js";

const UUIDS = CLASS_GRANT_PROFILE_UUIDS;

interface ProfileClassGrantProjectionBlocker {
  readonly code: "source-missing" | "source-drift" | "titan-selection-required" | "titan-ineligible";
  readonly profileId: ClassGrantProfileId;
  readonly message: string;
}

export type ClassGrantProjectionBlocker = ProfileClassGrantProjectionBlocker | PhysicalGrantCoverageBlocker;

export interface ClassGrantProjectionResult {
  readonly grants: readonly PlannedClassGrantV1[];
  readonly preparedPlan: PreparedClassGrantPlanV1 | null;
  readonly blockers: readonly ClassGrantProjectionBlocker[];
}

export interface CurrentClassGrantProjectionOptions {
  readonly fetchDocumentByUuid?: (uuid: string) => Promise<unknown | null>;
  readonly resolveCharacterAccessRef?: (sourceUuid: string) => Promise<string | null> | string | null;
  readonly pf2eVersion?: string | null;
}

export async function prepareCurrentClassGrantPlan(
  actor: unknown,
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  options: CurrentClassGrantProjectionOptions = {}
): Promise<PreparedClassGrantPlanV1> {
  const result = await projectCurrentClassGrants(actor, draft, activeSteps, options);
  if (!result.preparedPlan || result.blockers.length > 0) {
    throw new Error(result.blockers[0]?.message ?? "The current class-grant plan is unavailable.");
  }
  return result.preparedPlan;
}

export async function projectCurrentClassGrants(
  actor: unknown,
  draft: DraftState,
  activeSteps: readonly PendingStep[],
  options: CurrentClassGrantProjectionOptions = {}
): Promise<ClassGrantProjectionResult> {
  const acquisition = draft.acquisition;
  if (!acquisition?.policySnapshot) {
    throw new TypeError("Starting-equipment Apply requires a reviewed equipment policy.");
  }
  const coverageBlockers = physicalGrantCoverageBlockers(
    draft,
    activeSteps,
    options.pf2eVersion === undefined ? currentPf2eVersion() : options.pf2eVersion
  );
  if (coverageBlockers.length > 0) {
    return { grants: [], preparedPlan: null, blockers: coverageBlockers };
  }
  const reviewed = acquisition.policySnapshot;
  const currentPolicy = resolveEquipmentPolicyForActor({
    actor,
    draftId: acquisition.draftId,
    targetLevel: acquisition.targetLevel,
    selectedRecipe: selectedOfficialRecipe(acquisition.recipe),
    higherLevelStartClaim: higherLevelStartClaim(reviewed.material.higherLevelStartEvidence),
    customLumpSum:
      acquisition.recipe.kind === "custom-lump-sum"
        ? { amountCopper: acquisition.recipe.amountCopper, judgmentId: acquisition.recipe.judgmentRef }
        : null,
    extraCurrentLevelAllowanceIds: reviewed.material.gmJudgments
      .filter((judgment) => judgment.kind === "extra-current-level-allowance")
      .map((judgment) => judgment.id),
    exceptionJudgmentIds: reviewed.material.gmJudgments
      .filter((judgment) => judgment.kind === "rarity-source-exception")
      .map((judgment) => judgment.id),
  });
  const currentSnapshot = createAcquisitionPolicySnapshot(
    currentPolicy,
    acquisition.recipe,
    acquisition.recipeSelection
  );
  if (!acquisitionPolicyMaterialMatches(reviewed, currentSnapshot)) {
    throw new Error("The reviewed equipment policy changed before class-grant preparation.");
  }
  const observedActorItems = captureObservedClassGrantItems(actor);
  const fetchDocumentByUuid = options.fetchDocumentByUuid ?? resolveUuid;
  const actorSize = titanMaulerGrantIdForDraft(draft)
    ? await resolveDraftedAncestryEquipmentSize(draft, fetchDocumentByUuid)
    : null;
  const result = await projectPlannedClassGrants({
    draft,
    actorId: currentPolicy.actorId,
    draftId: acquisition.draftId,
    batchId: acquisition.batchId,
    targetLevel: acquisition.targetLevel,
    activeSteps,
    observedActorItems,
    fetchDocumentByUuid,
    currentEquipmentPolicy: currentPolicy,
    actorSize,
    // Only a registered catalogue Access adapter may produce this reference.
    // Callers that do not provide the bridge remain fail-closed for restricted
    // Titan Mauler weapons; Common weapons do not need one.
    resolveCharacterAccessRef: options.resolveCharacterAccessRef ?? (() => null),
  });
  return result;
}

export function titanMaulerGrantIdForDraft(draft: DraftState): string | null {
  const classSelection = draft.selections["class-level-1"];
  if (
    classSelection?.slotId !== "class-level-1" ||
    classSelection.itemType !== "class" ||
    classSelection.uuid !== UUIDS.barbarianClass
  ) {
    return null;
  }
  const giantInstinct = Object.values(draft.branchSelections).find(
    (selection) =>
      selection.slotId === "class-branch-instinct-level-1" &&
      selection.uuid === UUIDS.giantInstinct &&
      selection.itemType === "feat" &&
      selection.featType === "classfeature"
  );
  return giantInstinct ? `class-grant:titan-mauler:${giantInstinct.slotId}` : null;
}

export async function resolveDraftedAncestryEquipmentSize(
  draft: DraftState,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null> = resolveUuid
): Promise<EquipmentSize | null> {
  const selection = draft.selections["ancestry-level-1"];
  if (selection?.slotId !== "ancestry-level-1" || selection.itemType !== "ancestry" || !nonEmpty(selection.uuid)) {
    return null;
  }
  const document = await fetchDocumentByUuid(selection.uuid);
  if (!isRecord(document) || (document.type !== undefined && document.type !== "ancestry")) return null;
  const sourceId = sourceIdOf(document);
  if (sourceId !== null && sourceId !== selection.uuid) return null;
  const system = isRecord(document.system) ? document.system : {};
  return equipmentSize(system.size);
}

export function captureObservedClassGrantItems(actor: unknown): ObservedClassGrantItem[] {
  if (!isRecord(actor) || !nonEmpty(actor.id)) throw new TypeError("Class-grant observation requires an actor ID.");
  const contents = collectionContents(actor.items);
  const observed: ObservedClassGrantItem[] = [];
  const visit = (item: unknown): void => {
    if (!isRecord(item) || !nonEmpty(item.id) || !nonEmpty(item.type)) {
      throw new TypeError("An actor item is missing its stable class-grant identity.");
    }
    const rawIdentity =
      isRecord(item.flags) && isRecord(item.flags[MODULE_ID]) ? item.flags[MODULE_ID].acquisition : null;
    const acquisitionIdentity = rawIdentity == null ? null : normalizeAcquisitionIdentity(rawIdentity);
    if (rawIdentity != null && !acquisitionIdentity) {
      throw new TypeError(`Actor item ${item.id} has a malformed Wayfinder acquisition identity.`);
    }
    const grantedByItemId =
      isRecord(item.flags) &&
      isRecord(item.flags.pf2e) &&
      isRecord(item.flags.pf2e.grantedBy) &&
      nonEmpty(item.flags.pf2e.grantedBy.id)
        ? item.flags.pf2e.grantedBy.id
        : null;
    const rawLocation = isRecord(item.system) ? item.system.location : null;
    const locationItemId = nonEmpty(rawLocation)
      ? rawLocation
      : isRecord(rawLocation) && nonEmpty(rawLocation.value)
        ? rawLocation.value
        : null;
    const quantity = Number(item.quantity ?? (isRecord(item.system) ? item.system.quantity : 1) ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new TypeError(`Actor item ${item.id} has an invalid quantity.`);
    }
    observed.push({
      itemId: item.id,
      sourceUuid: sourceIdOf(item),
      itemType: item.type,
      quantity,
      grantedByItemId,
      locationItemId,
      wayfinderSlotId:
        isRecord(item.flags) && isRecord(item.flags[MODULE_ID]) && nonEmpty(item.flags[MODULE_ID].slotId)
          ? item.flags[MODULE_ID].slotId
          : null,
      acquisitionIdentity,
    });
    for (const child of collectionContents(item.subitems)) visit(child);
  };
  for (const item of contents) visit(item);
  if (new Set(observed.map((item) => item.itemId)).size !== observed.length) {
    throw new TypeError("Actor class-grant observation contains duplicate item IDs.");
  }
  return observed;
}

export async function projectPlannedClassGrants(args: {
  readonly draft: DraftState;
  readonly actorId: string;
  readonly draftId: string;
  readonly batchId: string;
  readonly targetLevel: number;
  readonly activeSteps: readonly PendingStep[];
  readonly observedActorItems: readonly ObservedClassGrantItem[];
  readonly fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>;
  readonly currentEquipmentPolicy?: EffectiveEquipmentPolicySnapshotV1 | null;
  readonly actorSize?: TitanMaulerCandidate["actorSize"] | null;
  readonly resolveCharacterAccessRef?: (sourceUuid: string) => Promise<string | null> | string | null;
}): Promise<ClassGrantProjectionResult> {
  const coverageBlockers = findUnsupportedPhysicalGrantRoutes(args.draft, args.activeSteps);
  if (coverageBlockers.length > 0) {
    return completeProjection(args, [], coverageBlockers);
  }
  const grants: PlannedClassGrantV1[] = [];
  const blockers: ClassGrantProjectionBlocker[] = [];
  const ancestrySelection = args.draft.selections["ancestry-level-1"];
  const activeAncestryProfile =
    ancestrySelection?.itemType === "ancestry" &&
    ancestrySelection.slotId === "ancestry-level-1" &&
    (ancestrySelection.uuid === UUIDS.dwarfAncestry || ancestrySelection.uuid === UUIDS.sarangayAncestry) &&
    originIsActive(ancestrySelection, args.activeSteps, args.observedActorItems);
  if (activeAncestryProfile) {
    const ancestryDocument = await args.fetchDocumentByUuid(ancestrySelection.uuid);
    const profileId =
      ancestrySelection.uuid === UUIDS.dwarfAncestry ? ("dwarf-clan-dagger" as const) : ("sarangay-head-gem" as const);
    const result = ancestryDocument
      ? ancestrySelection.uuid === UUIDS.dwarfAncestry
        ? await projectDwarf(ancestryDocument, args.fetchDocumentByUuid)
        : await projectSarangay(ancestryDocument, args.fetchDocumentByUuid)
      : sourceMissing(profileId);
    if (result.grant) grants.push(result.grant);
    if (result.blocker) blockers.push(result.blocker);
  }

  const classSelection = args.draft.selections["class-level-1"];
  if (
    !classSelection ||
    classSelection.itemType !== "class" ||
    classSelection.slotId !== "class-level-1" ||
    !originIsActive(classSelection, args.activeSteps, args.observedActorItems)
  ) {
    return completeProjection(args, grants, blockers);
  }

  const activeProfile =
    classSelection.uuid === UUIDS.alchemistClass ||
    (classSelection.uuid === UUIDS.investigatorClass &&
      Object.values(args.draft.branchSelections).some(
        (selection) =>
          selection.slotId === "class-branch-methodology-level-1" &&
          selection.uuid === UUIDS.alchemicalSciences &&
          originIsActive(selection, args.activeSteps, args.observedActorItems)
      )) ||
    (classSelection.uuid === UUIDS.barbarianClass &&
      Object.values(args.draft.branchSelections).some(
        (selection) =>
          selection.slotId === "class-branch-instinct-level-1" &&
          selection.uuid === UUIDS.giantInstinct &&
          originIsActive(selection, args.activeSteps, args.observedActorItems)
      ));
  if (!activeProfile) return completeProjection(args, grants, blockers);
  const classDocument = await args.fetchDocumentByUuid(classSelection.uuid);
  if (!classDocument) {
    return completeProjection(args, grants, [
      ...blockers,
      sourceMissing(profileIdForSelection(classSelection.uuid, args.draft)).blocker!,
    ]);
  }

  if (classSelection.uuid === UUIDS.alchemistClass) {
    const result = await projectAlchemist(classDocument, args.fetchDocumentByUuid);
    if (result.grant) grants.push(result.grant);
    if (result.blocker) blockers.push(result.blocker);
  }

  const branchSelections = Object.values(args.draft.branchSelections);
  const alchemicalSciences = branchSelections.find(
    (selection) =>
      selection.slotId === "class-branch-methodology-level-1" &&
      selection.uuid === UUIDS.alchemicalSciences &&
      originIsActive(selection, args.activeSteps, args.observedActorItems)
  );
  if (classSelection.uuid === UUIDS.investigatorClass && alchemicalSciences) {
    const result = await projectInvestigator(classDocument, alchemicalSciences, args.fetchDocumentByUuid);
    if (result.grant) grants.push(result.grant);
    if (result.blocker) blockers.push(result.blocker);
  }

  const giantInstinct = branchSelections.find(
    (selection) =>
      selection.slotId === "class-branch-instinct-level-1" &&
      selection.uuid === UUIDS.giantInstinct &&
      originIsActive(selection, args.activeSteps, args.observedActorItems)
  );
  if (classSelection.uuid === UUIDS.barbarianClass && giantInstinct) {
    const result = await projectTitanMauler(
      classDocument,
      giantInstinct,
      args.draft.acquisition?.lines ?? [],
      args.currentEquipmentPolicy ?? null,
      args.actorSize ?? null,
      args.resolveCharacterAccessRef,
      args.fetchDocumentByUuid,
      args
    );
    if (result.grant) grants.push(result.grant);
    if (result.blocker) blockers.push(result.blocker);
  }

  grants.sort((left, right) => left.grantId.localeCompare(right.grantId));
  return completeProjection(args, grants, blockers);
}

async function projectDwarf(
  ancestryDocument: unknown,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>
): Promise<Projection> {
  const profileId = "dwarf-clan-dagger" as const;
  if (!rootIncludesFeature(ancestryDocument, UUIDS.clanDaggerFeature, 0)) {
    return sourceDrift(profileId, "The installed Dwarf ancestry no longer links the reviewed Clan Dagger feature.");
  }
  const feature = await fetchDocumentByUuid(UUIDS.clanDaggerFeature);
  const dagger = await fetchDocumentByUuid(UUIDS.clanDaggerItem);
  if (!feature || !dagger) return sourceMissing(profileId);
  if (!hasReviewedClanDaggerChoice(feature) || !isReviewedClanDaggerItem(dagger)) {
    return sourceDrift(profileId, "The installed Dwarf Clan Dagger grant relationship changed.");
  }
  return {
    grant: createPlannedClassGrant({
      grantId: "class-grant:dwarf-clan-dagger:ancestry-level-1",
      profileId,
      origin: { sourceSlotId: "ancestry-level-1", sourceUuid: UUIDS.dwarfAncestry },
      granterSourceUuid: UUIDS.clanDaggerFeature,
      expected: { sourceUuid: UUIDS.clanDaggerItem, quantity: 1, itemType: "weapon" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [UUIDS.clanDaggerFeature, UUIDS.dwarfAncestry],
    }),
  };
}

async function projectSarangay(
  ancestryDocument: unknown,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>
): Promise<Projection> {
  const profileId = "sarangay-head-gem" as const;
  if (!rootIncludesFeature(ancestryDocument, UUIDS.headGemFeature, 1)) {
    return sourceDrift(profileId, "The installed Sarangay ancestry no longer links the reviewed Head Gem feature.");
  }
  const feature = await fetchDocumentByUuid(UUIDS.headGemFeature);
  const headGem = await fetchDocumentByUuid(UUIDS.headGemItem);
  if (!feature || !headGem) return sourceMissing(profileId);
  if (!hasOnlyStaticGrant(feature, UUIDS.headGemItem) || !isReviewedHeadGemItem(headGem)) {
    return sourceDrift(profileId, "The installed Sarangay Head Gem grant relationship changed.");
  }
  return {
    grant: createPlannedClassGrant({
      grantId: "class-grant:sarangay-head-gem:ancestry-level-1",
      profileId,
      origin: { sourceSlotId: "ancestry-level-1", sourceUuid: UUIDS.sarangayAncestry },
      granterSourceUuid: UUIDS.headGemFeature,
      expected: { sourceUuid: UUIDS.headGemItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [UUIDS.headGemFeature, UUIDS.sarangayAncestry],
    }),
  };
}

async function projectAlchemist(
  classDocument: unknown,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>
): Promise<Projection> {
  const profileId = "alchemist-formula-book" as const;
  if (!rootIncludesFeature(classDocument, UUIDS.alchemyFeature, 1)) {
    return sourceDrift(profileId, "The installed Alchemist class no longer links the reviewed Alchemy feature.");
  }
  const alchemy = await fetchDocumentByUuid(UUIDS.alchemyFeature);
  const formulaBook = await fetchDocumentByUuid(UUIDS.formulaBookFeature);
  const formulaBookItem = await fetchDocumentByUuid(UUIDS.formulaBookItem);
  if (!alchemy || !formulaBook || !formulaBookItem) return sourceMissing(profileId);
  if (
    !hasExactlyOneStaticGrant(alchemy, UUIDS.formulaBookFeature) ||
    !hasExactlyOneStaticGrant(formulaBook, UUIDS.formulaBookItem) ||
    !isReviewedFormulaBookItem(formulaBookItem)
  ) {
    return sourceDrift(profileId, "The installed Alchemist formula-book GrantItem chain changed.");
  }
  return {
    grant: createPlannedClassGrant({
      grantId: "class-grant:alchemist-formula-book:class-level-1",
      profileId,
      origin: { sourceSlotId: "class-level-1", sourceUuid: UUIDS.alchemistClass },
      granterSourceUuid: UUIDS.formulaBookFeature,
      expected: { sourceUuid: UUIDS.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [UUIDS.formulaBookFeature, UUIDS.alchemyFeature, UUIDS.alchemistClass],
    }),
  };
}

async function projectInvestigator(
  classDocument: unknown,
  selection: SelectionRef,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>
): Promise<Projection> {
  const profileId = "investigator-alchemical-sciences-formula-book" as const;
  if (!rootIncludesFeature(classDocument, UUIDS.methodologyFeature, 1)) {
    return sourceDrift(profileId, "The installed Investigator class no longer links the reviewed Methodology feature.");
  }
  const methodology = await fetchDocumentByUuid(UUIDS.methodologyFeature);
  const alchemicalSciences = await fetchDocumentByUuid(UUIDS.alchemicalSciences);
  const formulaBookItem = await fetchDocumentByUuid(UUIDS.formulaBookItem);
  if (!methodology || !alchemicalSciences || !formulaBookItem) return sourceMissing(profileId);
  if (
    !hasDynamicBranch(methodology, "methodology", "investigator-methodology") ||
    !hasOtherTag(alchemicalSciences, "investigator-methodology") ||
    !hasExactlyOneStaticGrant(alchemicalSciences, UUIDS.formulaBookItem) ||
    !isReviewedFormulaBookItem(formulaBookItem)
  ) {
    return sourceDrift(profileId, "The installed Alchemical Sciences source relationship changed.");
  }
  return {
    grant: createPlannedClassGrant({
      grantId: `class-grant:investigator-formula-book:${selection.slotId}`,
      profileId,
      origin: { sourceSlotId: selection.slotId, sourceUuid: selection.uuid },
      granterSourceUuid: UUIDS.alchemicalSciences,
      expected: { sourceUuid: UUIDS.formulaBookItem, quantity: 1, itemType: "equipment" },
      materializer: "pf2e-native",
      eligibilityKind: "fixed-class-grant",
      resaleRule: "normal",
      eligibilityEvidence: { kind: "fixed-native-profile" },
      nativeGrantChainSourceUuids: [UUIDS.alchemicalSciences, UUIDS.methodologyFeature, UUIDS.investigatorClass],
    }),
  };
}

async function projectTitanMauler(
  classDocument: unknown,
  selection: SelectionRef,
  acquisitionLines: readonly AcquisitionLineDraft[],
  policy: EffectiveEquipmentPolicySnapshotV1 | null,
  actorSize: TitanMaulerCandidate["actorSize"] | null,
  resolveCharacterAccessRef: ((sourceUuid: string) => Promise<string | null> | string | null) | undefined,
  fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>,
  subject: { readonly actorId: string; readonly draftId: string; readonly targetLevel: number }
): Promise<Projection> {
  const profileId = "giant-instinct-titan-mauler" as const;
  if (!rootIncludesFeature(classDocument, UUIDS.instinctFeature, 1)) {
    return sourceDrift(profileId, "The installed Barbarian class no longer links the reviewed Instinct feature.");
  }
  const instinct = await fetchDocumentByUuid(UUIDS.instinctFeature);
  const giant = await fetchDocumentByUuid(UUIDS.giantInstinct);
  if (!instinct || !giant) return sourceMissing(profileId);
  if (
    !hasDynamicBranch(instinct, "instinct", "barbarian-instinct") ||
    !hasOtherTag(giant, "barbarian-instinct") ||
    !hasTitanMaulerSemanticCanaries(giant)
  ) {
    return sourceDrift(profileId, "The installed Giant Instinct source relationship changed.");
  }
  const grantId = `class-grant:titan-mauler:${selection.slotId}`;
  const grantLines = acquisitionLines.filter(
    (entry) => entry.funding.lane === "class-grant" && entry.funding.grant.plannedGrantId === grantId
  );
  if (grantLines.length === 0 || !policy || !actorSize) {
    return {
      blocker: {
        code: "titan-selection-required",
        profileId,
        message: "Giant Instinct requires a reviewed Titan Mauler weapon selection.",
      },
    };
  }
  if (grantLines.length !== 1) {
    return {
      blocker: {
        code: "titan-ineligible",
        profileId,
        message: "Giant Instinct requires exactly one reviewed Titan Mauler weapon selection.",
      },
    };
  }
  const line = grantLines[0]!;
  if (
    policy.actorId !== subject.actorId ||
    policy.draftId !== subject.draftId ||
    policy.targetLevel !== subject.targetLevel
  ) {
    return sourceDrift(profileId, "The current Titan Mauler equipment policy belongs to another subject.");
  }
  const weaponDocument = await fetchDocumentByUuid(line.sourceUuid);
  if (!weaponDocument) return sourceMissing(profileId);
  const characterAccessRef = (await resolveCharacterAccessRef?.(line.sourceUuid)) ?? null;
  const candidate = buildTitanMaulerCandidate({
    document: weaponDocument,
    line,
    policy,
    actorSize,
    characterAccessRef,
  });
  if (!candidate) return sourceDrift(profileId, "The selected Titan Mauler weapon facts changed or are malformed.");
  const eligibility = evaluateTitanMaulerCandidate(candidate);
  if (eligibility.ok === false) {
    return {
      blocker: { code: "titan-ineligible", profileId, message: eligibility.message },
    };
  }
  return {
    grant: createPlannedClassGrant({
      grantId,
      profileId,
      origin: { sourceSlotId: selection.slotId, sourceUuid: selection.uuid },
      granterSourceUuid: UUIDS.giantInstinct,
      expected: { sourceUuid: candidate.sourceUuid, quantity: 1, itemType: "weapon" },
      materializer: "wayfinder-acquisition",
      eligibilityKind: "catalogue-choice",
      resaleRule: "zero-until-rune-investment",
      eligibilityEvidence: {
        kind: "titan-mauler",
        documentFingerprint: candidate.documentFingerprint,
        lineId: candidate.lineId,
        lineDocumentFingerprint: candidate.lineDocumentFingerprint,
        linePriceFingerprint: candidate.linePriceFingerprint,
        policyFingerprint: candidate.policyFingerprint,
        actorSize: candidate.actorSize,
        targetSize: candidate.targetSize,
        basePriceCopper: candidate.basePriceCopper!,
        weaponCategory: candidate.weaponCategory!,
        rangeIncrement: candidate.rangeIncrement,
        rarity: candidate.rarity,
        characterAccessRef: candidate.characterAccessRef,
        sourceAllowed: true,
        quantity: 1,
        permanence: "permanent",
        componentKind: "baseline-item",
      },
      nativeGrantChainSourceUuids: [],
    }),
  };
}

type Projection = { readonly grant?: PlannedClassGrantV1; readonly blocker?: ClassGrantProjectionBlocker };

function completeProjection(
  subject: {
    readonly actorId: string;
    readonly draftId: string;
    readonly batchId: string;
    readonly targetLevel: number;
  },
  grants: readonly PlannedClassGrantV1[],
  blockers: readonly ClassGrantProjectionBlocker[]
): ClassGrantProjectionResult {
  return {
    grants,
    blockers,
    preparedPlan:
      blockers.length === 0
        ? createPreparedClassGrantPlan({
            actorId: subject.actorId,
            draftId: subject.draftId,
            batchId: subject.batchId,
            targetLevel: subject.targetLevel,
            grants,
          })
        : null,
  };
}

function profileIdForSelection(classUuid: string, draft: DraftState): ClassGrantProfileId {
  if (classUuid === UUIDS.alchemistClass) return "alchemist-formula-book";
  if (
    classUuid === UUIDS.investigatorClass &&
    Object.values(draft.branchSelections).some((selection) => selection.uuid === UUIDS.alchemicalSciences)
  ) {
    return "investigator-alchemical-sciences-formula-book";
  }
  return "giant-instinct-titan-mauler";
}

function sourceMissing(profileId: ClassGrantProfileId): Projection {
  return {
    blocker: {
      code: "source-missing",
      profileId,
      message: "A required installed PF2E class-grant source document is unavailable.",
    },
  };
}

function sourceDrift(profileId: ClassGrantProfileId, message: string): Projection {
  return { blocker: { code: "source-drift", profileId, message } };
}

function rootIncludesFeature(document: unknown, uuid: string, level: number): boolean {
  const items =
    isRecord(document) && isRecord(document.system) && isRecord(document.system.items)
      ? Object.values(document.system.items)
      : [];
  return (
    items.filter(
      (entry) =>
        isRecord(entry) && entry.uuid === uuid && Number.isInteger(entry.level) && Number(entry.level) === level
    ).length === 1
  );
}

function hasReviewedClanDaggerChoice(document: unknown): boolean {
  const values = rules(document);
  const choices = values.filter((rule) => rule.key === "ChoiceSet" && rule.flag === "clanWeapon");
  const choice = choices[0];
  const options = choice && Array.isArray(choice.choices) ? choice.choices.filter(isRecord) : [];
  const optionValues = options.map((option) => option.value).sort();
  const allGrants = values.filter((rule) => rule.key === "GrantItem");
  const daggerGrants = allGrants.filter(
    (rule) =>
      rule.uuid === UUIDS.clanDaggerItem &&
      Array.isArray(rule.predicate) &&
      rule.predicate.length === 1 &&
      rule.predicate[0] === "clan-dagger"
  );
  const pistolGrants = allGrants.filter(
    (rule) =>
      rule.uuid === UUIDS.clanPistolFeature &&
      Array.isArray(rule.predicate) &&
      rule.predicate.length === 1 &&
      rule.predicate[0] === "clan-pistol"
  );
  const rollOptions = values.filter(
    (rule) =>
      rule.key === "RollOption" &&
      rule.option === "{item|flags.system.rulesSelections.clanWeapon}" &&
      rule.removeUponCreate === true
  );
  return (
    choices.length === 1 &&
    optionValues.length === 2 &&
    optionValues[0] === "clan-dagger" &&
    optionValues[1] === "clan-pistol" &&
    allGrants.length === 2 &&
    daggerGrants.length === 1 &&
    pistolGrants.length === 1 &&
    rollOptions.length === 1
  );
}

function hasExactlyOneStaticGrant(document: unknown, uuid: string): boolean {
  return rules(document).filter((rule) => rule.key === "GrantItem" && rule.uuid === uuid).length === 1;
}

function hasOnlyStaticGrant(document: unknown, uuid: string): boolean {
  const grants = rules(document).filter((rule) => rule.key === "GrantItem");
  return grants.length === 1 && grants[0]?.uuid === uuid && grants[0].predicate === undefined;
}

function hasDynamicBranch(document: unknown, flag: string, otherTag: string): boolean {
  const values = rules(document);
  const choices = values.filter((rule) => rule.key === "ChoiceSet" && rule.flag === flag);
  const grants = values.filter(
    (rule) => rule.key === "GrantItem" && rule.uuid === `{item|flags.system.rulesSelections.${flag}}`
  );
  const choice = choices[0];
  return (
    choices.length === 1 &&
    !!choice &&
    isRecord(choice.choices) &&
    Array.isArray(choice.choices.filter) &&
    choice.choices.filter.includes(`item:tag:${otherTag}`) &&
    grants.length === 1
  );
}

function isReviewedFormulaBookItem(document: unknown): boolean {
  if (!isRecord(document) || document.type !== "equipment" || !isRecord(document.system)) return false;
  const slug = document.system.slug;
  const level = isRecord(document.system.level) ? document.system.level.value : null;
  const traits = isRecord(document.system.traits) ? document.system.traits : null;
  const rarity = traits && typeof traits.rarity === "string" ? traits.rarity : null;
  const quantity = document.system.quantity;
  const price = preparedPriceValueOf(document.system);
  return (
    slug === "formula-book-blank" &&
    level === 0 &&
    rarity === "common" &&
    quantity === 1 &&
    !!price &&
    copperValue(price) === 100
  );
}

function isReviewedClanDaggerItem(document: unknown): boolean {
  if (!isRecord(document) || document.type !== "weapon" || !isRecord(document.system)) return false;
  const level = isRecord(document.system.level) ? document.system.level.value : null;
  const traits = isRecord(document.system.traits) ? document.system.traits : null;
  const price = preparedPriceValueOf(document.system);
  return (
    document.system.slug === "clan-dagger" &&
    document.system.baseItem === "clan-dagger" &&
    document.system.category === "simple" &&
    level === 0 &&
    traits?.rarity === "uncommon" &&
    document.system.quantity === 1 &&
    !!price &&
    copperValue(price) === 200
  );
}

function isReviewedHeadGemItem(document: unknown): boolean {
  if (!isRecord(document) || document.type !== "equipment" || !isRecord(document.system)) return false;
  const level = isRecord(document.system.level) ? document.system.level.value : null;
  const traits = isRecord(document.system.traits) ? document.system.traits : null;
  const price = preparedPriceValueOf(document.system);
  return (
    document.system.slug === "head-gem" &&
    level === 0 &&
    traits?.rarity === "common" &&
    document.system.quantity === 1 &&
    !!price &&
    copperValue(price) === 0
  );
}

function originIsActive(
  selection: SelectionRef,
  activeSteps: readonly PendingStep[],
  observedActorItems: readonly ObservedClassGrantItem[]
): boolean {
  return (
    activeSteps.some((step) => step.slotId === selection.slotId) ||
    observedActorItems.some((item) => item.sourceUuid === selection.uuid && item.wayfinderSlotId === selection.slotId)
  );
}

function selectedOfficialRecipe(recipe: AcquisitionRecipeSelection): "permanent-items" | "lump-sum" {
  return recipe.kind === "permanent-items" ? "permanent-items" : "lump-sum";
}

function higherLevelStartClaim(evidence: EquipmentHigherLevelStartEvidence): EquipmentHigherLevelStartClaim | null {
  if (evidence.kind === "not-required") return null;
  if (evidence.kind === "gm-confirmation") {
    return {
      kind: "gm-confirmation",
      judgmentId: evidence.judgment.id,
      startKind: evidence.startKind,
    };
  }
  return { ...evidence };
}

function equipmentSize(rawSize: unknown): EquipmentSize | null {
  if (typeof rawSize !== "string") return null;
  const normalized = rawSize.trim().toLowerCase();
  const sizes: Record<string, EquipmentSize> = {
    tiny: "tiny",
    sm: "small",
    small: "small",
    med: "medium",
    medium: "medium",
    lg: "large",
    large: "large",
    huge: "huge",
    grg: "gargantuan",
    gargantuan: "gargantuan",
  };
  return sizes[normalized] ?? null;
}

function hasTitanMaulerSemanticCanaries(document: unknown): boolean {
  if (!isRecord(document) || !isRecord(document.system) || !isRecord(document.system.description)) return false;
  const text = typeof document.system.description.value === "string" ? document.system.description.value : "";
  const normalized = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return (
    normalized.includes("price of 9 gp or less") &&
    normalized.includes("one size larger") &&
    normalized.includes("no value if sold")
  );
}

export function buildTitanMaulerCandidate(args: {
  readonly document: unknown;
  readonly line: AcquisitionLineDraft;
  readonly policy: EffectiveEquipmentPolicySnapshotV1;
  readonly actorSize: TitanMaulerCandidate["actorSize"];
  readonly characterAccessRef: string | null;
}): TitanMaulerCandidate | null {
  const { document, line, policy } = args;
  if (!isRecord(document) || document.type !== "weapon" || !isRecord(document.system)) return null;
  const sourceUuid = sourceIdOf(document);
  if (sourceUuid !== null && sourceUuid !== line.sourceUuid) return null;
  const packMatch = /^Compendium\.([^.]+\.[^.]+)\.Item\.[^.]+$/u.exec(line.sourceUuid);
  if (!packMatch || line.policyDecision.packId !== packMatch[1]) return null;
  const category = document.system.category;
  const range = document.system.range ?? null;
  const traits = isRecord(document.system.traits) ? document.system.traits : null;
  const rarity = traits?.rarity;
  const publicationSlug = publicationSlugOf(document.system);
  if (
    line.policyDecision.eligible !== true ||
    !nonEmpty(category) ||
    (range !== null && (typeof range !== "number" || !Number.isFinite(range))) ||
    (rarity !== "common" && rarity !== "uncommon" && rarity !== "rare" && rarity !== "unique") ||
    publicationSlug !== line.policyDecision.publicationSlug ||
    rarity !== line.policyDecision.rarity ||
    args.characterAccessRef !== line.policyDecision.characterAccessRef
  ) {
    return null;
  }
  const documentPrice = preparedPriceValueOf(document.system);
  if (!documentPrice || line.price.basePrice.kind !== "priced") return null;
  const basePriceCopper = copperValue(documentPrice);
  const lineBasePriceCopper = copperValue(line.price.basePrice.value);
  if (basePriceCopper === null || lineBasePriceCopper !== basePriceCopper) return null;
  const sourceAuthority = evaluateEquipmentItemAuthority({
    policy,
    sourceUuid: line.sourceUuid,
    packId: line.policyDecision.packId,
    publicationSlug,
    rarity: "common",
    hasCharacterAccess: true,
    sourceExceptionJudgmentId: line.policyDecision.sourceExceptionJudgmentId,
    rarityExceptionJudgmentId: null,
  });
  const materializedQuantity = line.price.sourceQuantity * line.price.requestedQuantity;
  if (!Number.isSafeInteger(materializedQuantity)) return null;
  return {
    sourceUuid: line.sourceUuid,
    itemType: "weapon",
    weaponCategory: category,
    rangeIncrement: range as number | null,
    rarity,
    characterAccessRef: args.characterAccessRef,
    sourceAllowed: sourceAuthority.eligible,
    basePriceCopper,
    actorSize: args.actorSize,
    targetSize: line.price.size,
    quantity: materializedQuantity,
    permanence: line.permanence,
    componentKind: line.componentKind,
    documentFingerprint: materialFingerprint({
      sourceUuid: line.sourceUuid,
      type: document.type,
      category,
      range,
      rarity,
      basePriceCopper,
      lineDocumentFingerprint: line.documentFingerprint,
      linePriceFingerprint: line.priceFingerprint,
    }),
    lineId: line.lineId,
    lineDocumentFingerprint: line.documentFingerprint,
    linePriceFingerprint: line.priceFingerprint,
    policyFingerprint: policy.fingerprint,
  };
}

function copperValue(value: Record<string, unknown>): number | null {
  const denominations = new Set(["pp", "gp", "sp", "cp"]);
  if (Object.keys(value).some((key) => !denominations.has(key))) return null;
  let total = 0;
  for (const [denomination, factor] of Object.entries({ pp: 1000, gp: 100, sp: 10, cp: 1 })) {
    const amount = value[denomination] ?? 0;
    if (!Number.isSafeInteger(amount) || Number(amount) < 0) return null;
    const next = total + Number(amount) * factor;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}

function preparedPriceValueOf(system: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(system.price) || !isRecord(system.price.value)) return null;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(system.price.value)) {
    if (key === "credits" || key === "upb") {
      if (value !== 0) return null;
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function publicationSlugOf(system: Record<string, unknown>): string | null {
  const publication = isRecord(system.publication) ? system.publication : null;
  const source = isRecord(system.source) ? system.source : null;
  const title = nonEmpty(publication?.title) ? publication.title : nonEmpty(source?.value) ? source.value : null;
  if (title === null) return null;
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : null;
}

function materialFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `class-grant-source-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasOtherTag(document: unknown, tag: string): boolean {
  return (
    isRecord(document) &&
    isRecord(document.system) &&
    isRecord(document.system.traits) &&
    Array.isArray(document.system.traits.otherTags) &&
    document.system.traits.otherTags.filter((value) => value === tag).length === 1
  );
}

function rules(document: unknown): Record<string, unknown>[] {
  return isRecord(document) && isRecord(document.system) && Array.isArray(document.system.rules)
    ? document.system.rules.filter(isRecord)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectionContents(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value.values === "function") return [...(value.values as () => Iterable<unknown>)()];
  return [];
}
