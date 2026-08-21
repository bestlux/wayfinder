import type { EmbeddedItemSource } from "../../shared/actor-model.js";
import { cloneData } from "../../shared/cloning.js";
import { resolveUuid } from "../../shared/foundry-compat.js";
import type { DraftState } from "../../types.js";
import {
  acquisitionPolicyMaterialMatches,
  createAcquisitionPolicySnapshot,
  invalidateAcquisitionReview,
  normalizeAcquisitionDraft,
  recordPlannedClassGrants,
} from "../domain/acquisition-draft.js";
import type { PreparedAcquisitionEntryV1 } from "../domain/acquisition-identity.js";
import { mintAcquisitionLineId } from "../domain/acquisition-identity.js";
import { createAcquisitionPriceSnapshot } from "../domain/acquisition-ledger.js";
import type {
  AcquisitionBasePriceSnapshot,
  AcquisitionDraftState,
  AcquisitionLineDraft,
  AcquisitionPolicySnapshot,
  AcquisitionPriceSnapshot,
} from "../domain/acquisition-types.js";
import {
  assertPreparedClassGrantPlanMatches,
  evaluateTitanMaulerCandidate,
  normalizePlannedClassGrant,
  type PlannedClassGrantV1,
  type PreparedClassGrantPlanV1,
  type TitanMaulerCandidate,
  titanMaulerTargetSize,
} from "../domain/class-grant-reconciliation.js";
import type { EconomicHandoffReason } from "../domain/economic-baseline.js";
import type {
  EffectiveEquipmentPolicySnapshotV1,
  EquipmentHigherLevelStartClaim,
  EquipmentHigherLevelStartEvidence,
  EquipmentPolicyJudgmentFacts,
  OfficialEquipmentRecipe,
} from "../domain/equipment-policy.js";
import type { ResolvedAcquisitionSource } from "./acquisition-execution-service.js";
import { buildTitanMaulerCandidate, titanMaulerGrantIdForDraft } from "./class-grant-projection-service.js";
import {
  createEquipmentCatalogueDraftContext,
  createEquipmentCatalogueService,
  EMPTY_EQUIPMENT_ACCESS_REGISTRY,
  type EquipmentAccessRegistry,
  type EquipmentCatalogueApplyResolution,
  type EquipmentCatalogueContext,
  type EquipmentCatalogueEntry,
  type EquipmentCataloguePackLike,
  type EquipmentCatalogueService,
} from "./equipment-catalogue-service.js";
import {
  resolveCurrentEquipmentSourceDiagnostics,
  resolveEquipmentPolicyForActor,
} from "./equipment-policy-service.js";
import {
  materializedPhysicalItemSize,
  type PrepareDraftedEquipmentActor,
  prepareTransientDraftedEquipmentActor,
  resolvePreparedDraftedEquipmentSize,
} from "./equipment-size-preparation-service.js";
import { type EquipmentSourceDiagnostic, sortEquipmentSourceDiagnostics } from "./equipment-source-policy.js";
import {
  registerStartingEquipmentUiAdapter,
  type StartingEquipmentUiAdapter,
  type StartingEquipmentUiRequest,
} from "./starting-equipment-ui-adapter.js";

export interface EquipmentAcquisitionRuntimeOptions {
  readonly packs: Pick<ReadonlyMap<string, EquipmentCataloguePackLike>, "get">;
  readonly accessRegistry?: EquipmentAccessRegistry;
  readonly resolveEffectivePolicy?: (
    actor: unknown,
    acquisition: AcquisitionDraftState
  ) => EffectiveEquipmentPolicySnapshotV1;
  readonly resolveSourceDiagnostics?: (
    policy: EffectiveEquipmentPolicySnapshotV1
  ) => readonly EquipmentSourceDiagnostic[];
  readonly mintLineId?: () => string;
  readonly fetchDocumentByUuid?: (uuid: string) => Promise<unknown | null>;
  readonly prepareConfiguredItem?: (input: {
    readonly actor: unknown;
    readonly targetLevel: number;
    readonly targetSize: AcquisitionPriceSnapshot["size"];
    readonly baseSource: Readonly<Record<string, unknown>>;
    readonly runes: Readonly<Record<string, unknown>>;
    readonly material: Readonly<Record<string, unknown>>;
    readonly forceNonSpecific: boolean;
  }) => unknown;
  readonly preparePhysicalItem?: (input: {
    readonly actor: unknown;
    readonly targetLevel: number;
    readonly targetSize: AcquisitionPriceSnapshot["size"];
    readonly source: Readonly<Record<string, unknown>>;
  }) => unknown;
  readonly prepareDraftedActor?: PrepareDraftedEquipmentActor;
}

export interface EquipmentApplySourceRequest {
  readonly actor: unknown;
  readonly characterDraft: DraftState;
  readonly acquisition: AcquisitionDraftState;
  readonly entry: PreparedAcquisitionEntryV1;
}

export interface NativeClassGrantLineRequest {
  readonly actor: unknown;
  readonly characterDraft: DraftState;
  readonly acquisition: AcquisitionDraftState;
  readonly classGrantPlan: PreparedClassGrantPlanV1;
}

export interface CurrentEquipmentAccessRequest {
  readonly actor: unknown;
  readonly characterDraft: DraftState;
  readonly acquisition: AcquisitionDraftState;
  readonly sourceUuid: string;
}

export interface CurrentEquipmentExceptionRequest {
  readonly actor: unknown;
  readonly characterDraft: DraftState;
  readonly acquisition: AcquisitionDraftState;
  readonly sourceUuid: string;
}

export interface TitanMaulerLineSynchronizationResult {
  readonly acquisition: AcquisitionDraftState;
  readonly changed: boolean;
  readonly reason: "build-changed" | "size-changed" | "source-changed" | "verification-failed" | null;
}

export type ConfiguredItemHandoffReason = Extract<EconomicHandoffReason, { readonly code: "unsafe-configured-item" }>;

export class ConfiguredItemHandoffRequiredError extends Error {
  readonly reason: ConfiguredItemHandoffReason;

  constructor(reason: ConfiguredItemHandoffReason) {
    super(`${reason.itemName} requires an explicit PF2E inventory-sheet handoff.`);
    this.name = "ConfiguredItemHandoffRequiredError";
    this.reason = cloneData(reason);
  }
}

export class EquipmentSourceHealthError extends Error {
  readonly diagnostics: readonly EquipmentSourceDiagnostic[];

  constructor(diagnostics: readonly EquipmentSourceDiagnostic[]) {
    super("Approved equipment sources are unavailable or inconsistent. Ask your GM to review them.");
    this.name = "EquipmentSourceHealthError";
    this.diagnostics = Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }
}

class PartialUnitPriceRequiredError extends TypeError {
  constructor() {
    super("This item must be purchased in a quantity that produces a nonzero exact PF2E charge.");
    this.name = "PartialUnitPriceRequiredError";
  }
}

export function commitTitanMaulerLineSynchronization(args: {
  readonly draft: DraftState;
  readonly expectedAcquisition: AcquisitionDraftState;
  readonly expectedDraftFingerprint: string;
  readonly currentDraftFingerprint: string;
  readonly result: TitanMaulerLineSynchronizationResult;
}): boolean {
  if (
    args.draft.acquisition !== args.expectedAcquisition ||
    args.currentDraftFingerprint !== args.expectedDraftFingerprint
  ) {
    return false;
  }
  if (args.result.changed) args.draft.acquisition = args.result.acquisition;
  return true;
}

export interface EquipmentAcquisitionRuntime {
  readonly uiAdapter: StartingEquipmentUiAdapter;
  readonly prepareNativeClassGrantLines: (
    request: NativeClassGrantLineRequest
  ) => Promise<readonly AcquisitionLineDraft[]>;
  readonly resolveCurrentPolicySnapshot: (
    actor: unknown,
    acquisition: AcquisitionDraftState
  ) => AcquisitionPolicySnapshot;
  readonly assertCurrentSourceHealth: (request: Omit<EquipmentApplySourceRequest, "entry">) => Promise<void>;
  readonly resolveSourceForApply: (request: EquipmentApplySourceRequest) => Promise<ResolvedAcquisitionSource>;
  readonly resolveCurrentCharacterAccessRef: (request: CurrentEquipmentAccessRequest) => Promise<string | null>;
  readonly resolveItemExceptionFacts: (
    request: CurrentEquipmentExceptionRequest
  ) => Promise<Extract<EquipmentPolicyJudgmentFacts, { readonly kind: "rarity-source-exception" }>>;
  readonly synchronizeTitanMaulerLine: (
    request: Omit<CurrentEquipmentAccessRequest, "sourceUuid">
  ) => Promise<TitanMaulerLineSynchronizationResult>;
  readonly invalidatePack: (packId: string) => void;
}

export function createEquipmentAcquisitionRuntime(
  options: EquipmentAcquisitionRuntimeOptions
): EquipmentAcquisitionRuntime {
  const accessRegistry = options.accessRegistry ?? EMPTY_EQUIPMENT_ACCESS_REGISTRY;
  const resolveEffectivePolicy = options.resolveEffectivePolicy ?? resolveCurrentEffectivePolicy;
  const resolveSourceDiagnostics =
    options.resolveSourceDiagnostics ?? ((policy) => resolveCurrentEquipmentSourceDiagnostics({ policy }));
  const mintLineId = options.mintLineId ?? mintAcquisitionLineId;
  const fetchDocumentByUuid = options.fetchDocumentByUuid ?? resolveUuid;
  const prepareConfiguredItem = options.prepareConfiguredItem ?? prepareTransientConfiguredItem;
  const preparePhysicalItem = options.preparePhysicalItem ?? prepareTransientPhysicalItem;
  const prepareDraftedActor = options.prepareDraftedActor ?? prepareTransientDraftedEquipmentActor;
  const catalogues = new Map<string, EquipmentCatalogueService>();

  const catalogueFor = (policy: EffectiveEquipmentPolicySnapshotV1): EquipmentCatalogueService => {
    const packIds = [...new Set(policy.sourcePolicy.effectivePackIds)].sort((left, right) => left.localeCompare(right));
    const key = canonicalJson(packIds);
    let catalogue = catalogues.get(key);
    if (!catalogue) {
      catalogue = createEquipmentCatalogueService({
        packs: options.packs,
        equipmentPackIds: packIds,
        accessRegistry,
      });
      catalogues.set(key, catalogue);
    }
    return catalogue;
  };

  const draftedEquipmentSize = (actor: unknown, draft: DraftState) =>
    requireDraftedAncestryEquipmentSize({
      actor,
      draft,
      targetLevel: draft.targetLevel,
      fetchDocumentByUuid,
      prepareDraftedActor,
    });

  const currentContext = (
    actor: unknown,
    draft: DraftState,
    acquisition: AcquisitionDraftState
  ): { readonly policy: EffectiveEquipmentPolicySnapshotV1; readonly context: EquipmentCatalogueContext } => {
    if (draft.acquisition?.draftId !== acquisition.draftId || draft.acquisition.batchId !== acquisition.batchId) {
      throw new TypeError("The equipment catalogue request belongs to another acquisition draft.");
    }
    const policy = resolveEffectivePolicy(actor, acquisition);
    const snapshot = createAcquisitionPolicySnapshot(policy, acquisition.recipe, acquisition.recipeSelection);
    if (!acquisition.policySnapshot || !acquisitionPolicyMaterialMatches(acquisition.policySnapshot, snapshot)) {
      throw new Error("The current equipment policy differs from the reviewed acquisition policy.");
    }
    return {
      policy,
      context: {
        actor,
        policy,
        draft: createEquipmentCatalogueDraftContext({
          draftId: acquisition.draftId,
          targetLevel: acquisition.targetLevel,
          version: draft.version,
          accessFacts: buildAccessFacts(draft),
        }),
      },
    };
  };

  const requireHealthyCatalogue = async (
    policy: EffectiveEquipmentPolicySnapshotV1,
    context: EquipmentCatalogueContext
  ) => {
    const catalogue = catalogueFor(policy);
    const projection = await catalogue.project(context);
    const diagnostics = combineSourceDiagnostics(resolveSourceDiagnostics(policy), projection.diagnostics);
    if (diagnostics.length > 0) throw new EquipmentSourceHealthError(diagnostics);
    return { catalogue, projection };
  };

  const uiAdapter: StartingEquipmentUiAdapter = {
    async project(request) {
      const acquisition = request.draft.acquisition;
      const titanMauler = titanMaulerProjection(request.draft);
      if (!acquisition) {
        return {
          state: "pending",
          message: "Start the step above and the gear list loads here.",
          query: request.query,
          records: [],
          filters: [],
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
          titanMauler,
        };
      }
      try {
        const { policy, context } = currentContext(request.actor, request.draft, acquisition);
        const { catalogue, projection } = await requireHealthyCatalogue(policy, context);
        let projectedEntries = projection.entries;
        if (request.previewSourceUuid) {
          const preview = await catalogue.hydratePreview(request.previewSourceUuid, context);
          if (preview?.entry) {
            projectedEntries = projection.entries.map((entry) =>
              entry.sourceUuid === preview.entry!.sourceUuid ? preview.entry! : entry
            );
          }
        }
        const maximumLevel = policy.recipe.kind === "permanent-items" ? policy.targetLevel : policy.targetLevel - 1;
        const entries = projectedEntries.filter((entry) => entry.level <= maximumLevel);
        const targetSize = await draftedEquipmentSize(request.actor, request.draft);
        const visibleEntries = entries.filter((entry) => matchesCatalogueRequest(entry, request)).slice(0, 12);
        const records = await Promise.all(
          visibleEntries.map(async (entry) => {
            if (
              entry.price.kind !== "priced" ||
              entry.unavailableReasons.some(
                (reason) => reason.code !== "source-not-allowed" && reason.code !== "rarity-not-available"
              )
            ) {
              return toUiRecord(entry);
            }
            const resolved = await catalogue.resolveForApply(context, entry.sourceUuid);
            try {
              const priced = await buildResolvedPrice({
                resolved,
                requestedQuantity: 1,
                targetSize,
                actor: request.actor,
                targetLevel: policy.targetLevel,
                packs: options.packs,
                prepareConfiguredItem,
                preparePhysicalItem,
              });
              return toUiRecord(entry, priced.price);
            } catch (error) {
              if (error instanceof ConfiguredItemHandoffRequiredError) return toUiRecord(entry);
              if (error instanceof PartialUnitPriceRequiredError) {
                return { ...toUiRecord(entry, null), available: false, unavailableReason: error.message };
              }
              throw error;
            }
          })
        );
        return {
          state: "ready",
          message: `${entries.length} piece${entries.length === 1 ? "" : "s"} of gear to browse.`,
          diagnostics: [],
          query: request.query,
          records,
          filters: catalogueFilters(entries),
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
          titanMauler,
        };
      } catch (error) {
        return {
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "The gear list would not load. Ask your GM to check the approved equipment sources.",
          diagnostics: error instanceof EquipmentSourceHealthError ? error.diagnostics : [],
          query: request.query,
          records: [],
          filters: [],
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
          titanMauler,
        };
      }
    },
    async prepareLine(request) {
      const acquisition = requireAcquisition(request);
      const { policy, context } = currentContext(request.actor, request.draft, acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      const resolved = await catalogue.resolveForApply(context, request.sourceUuid);
      assertSupportedCandidate(resolved);
      const targetSize = await draftedEquipmentSize(request.actor, request.draft);
      const priced = await buildResolvedPrice({
        resolved,
        requestedQuantity: 1,
        targetSize,
        actor: request.actor,
        targetLevel: policy.targetLevel,
        packs: options.packs,
        prepareConfiguredItem,
        preparePhysicalItem,
      });
      const itemPermanence = permanence(resolved.candidate.itemType);
      const funding = resolveRequestedFunding(
        policy,
        request.funding ?? { lane: "currency" },
        resolved.candidate.level,
        itemPermanence
      );
      return {
        schemaVersion: 1,
        lineId: mintLineId(),
        sourceUuid: resolved.candidate.sourceUuid,
        documentFingerprint: resolved.documentFingerprint,
        priceFingerprint: priced.priceFingerprint,
        itemLevel: resolved.candidate.level,
        permanence: itemPermanence,
        componentKind: "baseline-item",
        policyDecision: cloneData(resolved.policyDecision),
        funding,
        stackingIntent: "aggregate",
        price: priced.price,
      };
    },
    async prepareTitanMaulerLine(request) {
      const acquisition = requireAcquisition(request);
      const grantId = titanMaulerGrantIdForDraft(request.draft);
      if (!grantId) throw new TypeError("Titan Mauler is not part of the current drafted build.");
      if (
        acquisition.lines.some(
          (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId
        )
      ) {
        throw new TypeError("Remove the current Titan Mauler weapon before choosing another one.");
      }
      const actorSize = await draftedEquipmentSize(request.actor, request.draft);
      if (!actorSize) {
        throw new TypeError("Titan Mauler requires a selected ancestry with a supported size.");
      }
      const targetSize = titanMaulerTargetSize(actorSize);
      if (!targetSize) throw new TypeError("Titan Mauler cannot prepare a weapon larger than Gargantuan.");

      const { policy, context } = currentContext(request.actor, request.draft, acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      const resolved = await catalogue.resolveForApply(context, request.sourceUuid);
      assertTitanMaulerCandidate(resolved);
      assertExactCompendiumSource(resolved.candidate.sourceUuid, resolved.source);
      return buildTitanMaulerLine({
        resolved,
        policy,
        actor: request.actor,
        targetLevel: policy.targetLevel,
        preparePhysicalItem,
        actorSize,
        targetSize,
        grantId,
        lineId: mintLineId(),
      });
    },
  };

  return {
    uiAdapter,
    async prepareNativeClassGrantLines(request) {
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      assertPreparedClassGrantPlanMatches({
        plan: request.classGrantPlan,
        actorId: policy.actorId,
        draftId: request.acquisition.draftId,
        batchId: request.acquisition.batchId,
        targetLevel: request.acquisition.targetLevel,
        persistedGrants: request.acquisition.plannedClassGrants,
      });
      const targetSize = await draftedEquipmentSize(request.actor, request.characterDraft);
      const nativeGrants = request.classGrantPlan.grants.filter((grant) => grant.materializer === "pf2e-native");
      const lineIds = new Set(request.acquisition.lines.map((line) => line.lineId));
      const prepared: AcquisitionLineDraft[] = [];
      for (const grant of nativeGrants) {
        assertFixedNativeGrant(grant);
        const persisted = request.acquisition.lines.filter(
          (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grant.grantId
        );
        if (persisted.length > 1) {
          throw new Error(`Native class grant ${grant.grantId} requires exactly one acquisition line.`);
        }
        const resolved = await catalogue.resolveFixedNativeSourceForApply(
          context,
          grant.expected.sourceUuid,
          fixedNativeSourceAuthority(grant)
        );
        assertFixedNativeSource(grant, resolved);
        const lineId = persisted[0]?.lineId ?? mintLineId();
        if (!lineId.trim() || (persisted.length === 0 && lineIds.has(lineId))) {
          throw new TypeError("Native class-grant preparation requires a unique acquisition line ID.");
        }
        lineIds.add(lineId);
        const priced = await buildResolvedPrice({
          resolved,
          requestedQuantity: 1,
          targetSize,
          actor: request.actor,
          targetLevel: policy.targetLevel,
          packs: options.packs,
          prepareConfiguredItem,
          preparePhysicalItem,
        });
        const price = priced.price;
        if (price.materializedQuantity !== 1) {
          throw new Error(`Native class grant ${grant.grantId} must resolve to exactly one item.`);
        }
        const line: AcquisitionLineDraft = {
          schemaVersion: 1,
          lineId,
          sourceUuid: grant.expected.sourceUuid,
          documentFingerprint: resolved.documentFingerprint,
          priceFingerprint: priced.priceFingerprint,
          itemLevel: resolved.candidate.level,
          permanence: "permanent",
          componentKind: "baseline-item",
          policyDecision: cloneData(resolved.policyDecision),
          funding: { lane: "class-grant", grant: { plannedGrantId: grant.grantId } },
          stackingIntent: "separate",
          price,
        };
        if (persisted[0] && canonicalJson(persisted[0]) !== canonicalJson(line)) {
          throw new Error(`Native class-grant source material drifted for ${grant.grantId}.`);
        }
        prepared.push(persisted[0] ?? line);
      }
      return Object.freeze(prepared);
    },
    resolveCurrentPolicySnapshot(actor, acquisition) {
      return createAcquisitionPolicySnapshot(
        resolveEffectivePolicy(actor, acquisition),
        acquisition.recipe,
        acquisition.recipeSelection
      );
    },
    async assertCurrentSourceHealth(request) {
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      await requireHealthyCatalogue(policy, context);
    },
    async resolveSourceForApply(request) {
      const persisted = normalizeAcquisitionDraft(cloneData(request.characterDraft.acquisition));
      const requested = normalizeAcquisitionDraft(cloneData(request.acquisition));
      if (!persisted || !requested || canonicalJson(persisted) !== canonicalJson(requested)) {
        throw new TypeError("The Apply source request does not match the persisted acquisition state.");
      }
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      const lines = request.entry.lineIds.map((lineId) => {
        const line = request.acquisition.lines.find((candidate) => candidate.lineId === lineId);
        if (!line) throw new TypeError(`Prepared acquisition line ${lineId} is unavailable.`);
        return line;
      });
      const fixedNativeGrant = resolveFixedNativeApplyGrant(request, persisted, lines);
      const resolved = fixedNativeGrant
        ? await catalogue.resolveFixedNativeSourceForApply(
            context,
            request.entry.sourceUuid,
            fixedNativeSourceAuthority(fixedNativeGrant)
          )
        : await catalogue.resolveForApply(context, request.entry.sourceUuid);
      if (fixedNativeGrant) {
        assertFixedNativeSource(fixedNativeGrant, resolved);
      } else {
        assertSupportedCandidate(resolved);
      }
      const currentPermanence = permanence(resolved.candidate.itemType);
      if (
        lines.some(
          (line) =>
            line.sourceUuid !== resolved.candidate.sourceUuid ||
            line.itemLevel !== resolved.candidate.level ||
            line.permanence !== currentPermanence ||
            line.componentKind !== "baseline-item"
        )
      ) {
        throw new Error(`Acquisition item material drifted for ${request.entry.entryId}.`);
      }
      const titanGrantId = titanMaulerGrantIdForDraft(request.characterDraft);
      const isTitanMauler =
        request.entry.funding.lane === "class-grant" && request.entry.funding.grant.plannedGrantId === titanGrantId;
      let targetSize: AcquisitionPriceSnapshot["size"];
      if (isTitanMauler) {
        if (lines.length !== 1 || lines[0]?.funding.lane !== "class-grant") {
          throw new Error("Titan Mauler must resolve from exactly one automatic build-grant line.");
        }
        const actorSize = await draftedEquipmentSize(request.actor, request.characterDraft);
        const titanTargetSize = actorSize ? titanMaulerTargetSize(actorSize) : null;
        if (
          !actorSize ||
          !titanTargetSize ||
          request.entry.price.size !== titanTargetSize ||
          lines[0].price.size !== titanTargetSize
        ) {
          throw new Error("The reviewed Titan Mauler weapon size no longer matches the drafted ancestry.");
        }
        const candidate = buildTitanMaulerCandidate({
          document: resolved.source,
          line: lines[0],
          policy,
          actorSize,
          characterAccessRef: resolved.policyDecision.characterAccessRef,
        });
        const eligibility = candidate ? evaluateTitanMaulerCandidate(candidate) : null;
        if (!candidate || eligibility?.ok === false) {
          throw new Error(
            eligibility?.ok === false
              ? eligibility.message
              : "The reviewed Titan Mauler weapon facts are malformed or changed."
          );
        }
        targetSize = titanTargetSize;
      } else {
        targetSize = await draftedEquipmentSize(request.actor, request.characterDraft);
        if (request.entry.price.size !== targetSize || lines.some((line) => line.price.size !== targetSize)) {
          throw new Error("The reviewed equipment size no longer matches the drafted ancestry.");
        }
      }
      const priced = await buildResolvedPrice({
        resolved,
        requestedQuantity: request.entry.price.requestedQuantity,
        targetSize,
        actor: request.actor,
        targetLevel: policy.targetLevel,
        packs: options.packs,
        prepareConfiguredItem,
        preparePhysicalItem,
      });
      return {
        source: cloneData(resolved.source) as EmbeddedItemSource,
        sourceUuid: resolved.candidate.sourceUuid,
        documentFingerprint: resolved.documentFingerprint,
        priceFingerprint: priced.priceFingerprint,
        resolvedPrice: priced.price,
        policyDecision: cloneData(resolved.policyDecision),
      };
    },
    async resolveCurrentCharacterAccessRef(request) {
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      const resolved = await catalogue.resolveForApply(context, request.sourceUuid);
      assertTitanMaulerCandidate(resolved);
      return resolved.policyDecision.characterAccessRef;
    },
    async resolveItemExceptionFacts(request) {
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      const { catalogue } = await requireHealthyCatalogue(policy, context);
      const resolved = await catalogue.resolveForApply(context, request.sourceUuid);
      const authorityCodes = resolved.unavailableReasons
        .map((reason) => reason.code)
        .filter((code) => code === "source-not-allowed" || code === "rarity-not-available");
      if (
        authorityCodes.length === 0 ||
        resolved.unavailableReasons.some(
          (reason) => reason.code !== "source-not-allowed" && reason.code !== "rarity-not-available"
        )
      ) {
        throw new TypeError("Only an otherwise supported item blocked by source or rarity can request an exception.");
      }
      const scope = authorityCodes.includes("source-not-allowed")
        ? authorityCodes.includes("rarity-not-available")
          ? "source-and-rarity"
          : "source"
        : "rarity";
      return {
        kind: "rarity-source-exception",
        actorId: policy.actorId,
        draftId: policy.draftId,
        targetLevel: policy.targetLevel,
        scope,
        sourceUuid: resolved.candidate.sourceUuid,
        packId: resolved.candidate.packId,
        publicationSlug: resolved.candidate.publicationSlug,
        rarity: resolved.candidate.rarity,
      };
    },
    async synchronizeTitanMaulerLine(request) {
      const titanLines = request.acquisition.lines.filter(isTitanMaulerLine);
      if (titanLines.length === 0) {
        return { acquisition: request.acquisition, changed: false, reason: null };
      }
      const currentGrantId = titanMaulerGrantIdForDraft(request.characterDraft);
      const line = titanLines[0];
      if (
        !currentGrantId ||
        titanLines.length !== 1 ||
        !line ||
        line.funding.lane !== "class-grant" ||
        line.funding.grant.plannedGrantId !== currentGrantId
      ) {
        return removeTitanMaulerLines(request.acquisition, "build-changed");
      }
      let actorSize: TitanMaulerCandidate["actorSize"] | null;
      try {
        actorSize = await draftedEquipmentSize(request.actor, request.characterDraft);
      } catch {
        return invalidateTitanMaulerVerification(request.acquisition);
      }
      if (!actorSize) return invalidateTitanMaulerVerification(request.acquisition);
      const targetSize = titanMaulerTargetSize(actorSize);
      if (!targetSize || line.price.size !== targetSize) {
        return removeTitanMaulerLines(request.acquisition, "size-changed");
      }
      let current: {
        readonly policy: EffectiveEquipmentPolicySnapshotV1;
        readonly resolved: EquipmentCatalogueApplyResolution;
      };
      try {
        const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
        const { catalogue } = await requireHealthyCatalogue(policy, context);
        current = {
          policy,
          resolved: await catalogue.resolveForApply(context, line.sourceUuid),
        };
      } catch {
        return invalidateTitanMaulerVerification(request.acquisition);
      }
      try {
        const { policy, resolved } = current;
        assertTitanMaulerCandidate(resolved);
        assertExactCompendiumSource(resolved.candidate.sourceUuid, resolved.source);
        const currentLine = buildTitanMaulerLine({
          resolved,
          policy,
          actor: request.actor,
          targetLevel: policy.targetLevel,
          preparePhysicalItem,
          actorSize,
          targetSize,
          grantId: currentGrantId,
          lineId: line.lineId,
        });
        return canonicalJson(currentLine) === canonicalJson(line)
          ? { acquisition: request.acquisition, changed: false, reason: null }
          : removeTitanMaulerLines(request.acquisition, "source-changed");
      } catch {
        return removeTitanMaulerLines(request.acquisition, "source-changed");
      }
    },
    invalidatePack(packId) {
      for (const catalogue of catalogues.values()) catalogue.invalidatePack(packId);
    },
  };
}

function combineSourceDiagnostics(
  ...groups: readonly (readonly EquipmentSourceDiagnostic[])[]
): readonly EquipmentSourceDiagnostic[] {
  const unique = new Map<string, EquipmentSourceDiagnostic>();
  for (const diagnostic of groups.flat()) {
    const key = canonicalJson([diagnostic.code, diagnostic.packId, diagnostic.sourceIdentity, diagnostic.message]);
    unique.set(key, diagnostic);
  }
  return Object.freeze(sortEquipmentSourceDiagnostics([...unique.values()]));
}

function assertFixedNativeGrant(grant: PlannedClassGrantV1): void {
  if (
    grant.materializer !== "pf2e-native" ||
    grant.eligibilityKind !== "fixed-class-grant" ||
    grant.eligibilityEvidence.kind !== "fixed-native-profile" ||
    grant.expected.quantity !== 1 ||
    (grant.expected.itemType !== "equipment" && grant.expected.itemType !== "weapon")
  ) {
    throw new TypeError(`Class grant ${grant.grantId} is not an authoritative fixed native profile.`);
  }
}

function assertFixedNativeSource(grant: PlannedClassGrantV1, resolved: EquipmentCatalogueApplyResolution): void {
  const authorityOnlyReasons = new Set(["rarity-not-available", "source-not-allowed"]);
  const structuralReason = resolved.unavailableReasons.find((reason) => !authorityOnlyReasons.has(reason.code));
  if (structuralReason) throw new Error(structuralReason.message);
  if (
    resolved.candidate.sourceUuid !== grant.expected.sourceUuid ||
    resolved.candidate.itemType !== grant.expected.itemType ||
    resolved.candidate.level !== 0 ||
    permanence(resolved.candidate.itemType) !== "permanent"
  ) {
    throw new Error(`Native class-grant source material changed for ${grant.grantId}.`);
  }
  assertExactCompendiumSource(grant.expected.sourceUuid, resolved.source);
}

function resolveFixedNativeApplyGrant(
  request: EquipmentApplySourceRequest,
  persistedAcquisition: AcquisitionDraftState,
  lines: readonly AcquisitionLineDraft[]
): PlannedClassGrantV1 | null {
  const funding = request.entry.funding;
  if (funding.lane !== "class-grant") return null;
  const grants = request.acquisition.plannedClassGrants.filter(
    (grant) => grant.grantId === funding.grant.plannedGrantId
  );
  if (grants.length !== 1) {
    throw new Error(`Class grant ${funding.grant.plannedGrantId} is not persisted exactly once.`);
  }
  const requestedGrant = grants[0]!;
  const grant = normalizePlannedClassGrant(requestedGrant);
  if (!grant) {
    throw new TypeError(`Class grant ${funding.grant.plannedGrantId} is not a canonical persisted grant.`);
  }
  if (grant.materializer !== "pf2e-native") return null;
  const persistedGrants = persistedAcquisition.plannedClassGrants.filter(
    (candidate) => candidate.grantId === grant.grantId
  );
  const requestedGrantLines = request.acquisition.lines.filter(isGrantFundedLine(grant.grantId));
  const persistedGrantLines = persistedAcquisition.lines.filter(isGrantFundedLine(grant.grantId));
  const persistedGrant = persistedGrants[0] ? normalizePlannedClassGrant(persistedGrants[0]) : null;
  if (
    persistedGrants.length !== 1 ||
    !persistedGrant ||
    canonicalJson(persistedGrant) !== canonicalJson(grant) ||
    requestedGrantLines.length !== 1 ||
    persistedGrantLines.length !== 1 ||
    canonicalJson(requestedGrantLines[0]) !== canonicalJson(persistedGrantLines[0])
  ) {
    throw new Error(`PF2E-native class grant ${grant.grantId} is not persisted exactly once.`);
  }
  assertFixedNativeGrant(grant);
  const line = lines[0];
  const plannedItem = request.entry.plannedItems[0];
  if (
    lines.length !== 1 ||
    request.entry.lineIds.length !== 1 ||
    !line ||
    line.lineId !== request.entry.lineIds[0] ||
    line.funding.lane !== "class-grant" ||
    line.funding.grant.plannedGrantId !== grant.grantId ||
    line.sourceUuid !== grant.expected.sourceUuid ||
    request.entry.sourceUuid !== grant.expected.sourceUuid ||
    line.documentFingerprint !== request.entry.documentFingerprint ||
    line.priceFingerprint !== request.entry.priceFingerprint ||
    canonicalJson(line.policyDecision) !== canonicalJson(request.entry.policyDecision) ||
    canonicalJson(line.price) !== canonicalJson(request.entry.price) ||
    line.itemLevel !== 0 ||
    line.permanence !== "permanent" ||
    line.componentKind !== "baseline-item" ||
    line.stackingIntent !== "separate" ||
    line.price.materializedQuantity !== 1 ||
    request.entry.quantity !== 1 ||
    request.entry.stackingIntent !== "separate" ||
    request.entry.plannedItems.length !== 1 ||
    !plannedItem ||
    plannedItem.sourceUuid !== grant.expected.sourceUuid ||
    plannedItem.quantity !== 1 ||
    plannedItem.ownedContainerId !== null ||
    plannedItem.plannedContainerId !== null
  ) {
    throw new Error(`PF2E-native class grant ${grant.grantId} differs from its persisted acquisition authority.`);
  }
  return grant;
}

function isGrantFundedLine(grantId: string): (line: AcquisitionLineDraft) => boolean {
  return (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId;
}

function assertExactCompendiumSource(sourceUuid: string, source: Readonly<Record<string, unknown>>): void {
  const identity = compendiumItemIdentity(sourceUuid);
  if (source._id !== identity.documentId) {
    throw new Error(`Native class-grant source ${sourceUuid} returned a different document identity.`);
  }
  const statsSource = record(source._stats).compendiumSource;
  const coreSource = record(record(source.flags).core).sourceId;
  for (const identity of [statsSource, coreSource]) {
    if (identity !== undefined && identity !== null && identity !== sourceUuid) {
      throw new Error(`Native class-grant source ${sourceUuid} has mismatched source provenance.`);
    }
  }
}

function fixedNativeSourceAuthority(grant: PlannedClassGrantV1): {
  readonly kind: "fixed-native-grant";
  readonly expectedSourceUuid: string;
  readonly expectedPackId: string;
} {
  const identity = compendiumItemIdentity(grant.expected.sourceUuid);
  return {
    kind: "fixed-native-grant",
    expectedSourceUuid: grant.expected.sourceUuid,
    expectedPackId: identity.packId,
  };
}

function compendiumItemIdentity(sourceUuid: string): { readonly packId: string; readonly documentId: string } {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(sourceUuid);
  if (!match) throw new TypeError(`Native class-grant source is not an exact Compendium Item UUID: ${sourceUuid}.`);
  return { packId: match[1]!, documentId: match[2]! };
}

let foundryRuntime: EquipmentAcquisitionRuntime | null = null;

export function registerFoundryEquipmentAcquisitionRuntime(): EquipmentAcquisitionRuntime {
  const runtime = getFoundryEquipmentAcquisitionRuntime();
  registerStartingEquipmentUiAdapter(runtime.uiAdapter);
  return runtime;
}

export function getFoundryEquipmentAcquisitionRuntime(): EquipmentAcquisitionRuntime {
  foundryRuntime ??= createEquipmentAcquisitionRuntime({
    packs: {
      get(packId) {
        return game.packs?.get?.(packId) as EquipmentCataloguePackLike | undefined;
      },
    },
  });
  return foundryRuntime;
}

export function invalidateFoundryEquipmentCataloguePack(packId: string): void {
  foundryRuntime?.invalidatePack(packId);
}

function resolveCurrentEffectivePolicy(
  actor: unknown,
  acquisition: AcquisitionDraftState
): EffectiveEquipmentPolicySnapshotV1 {
  const reviewed = acquisition.policySnapshot;
  if (!reviewed) throw new TypeError("Starting-equipment policy must be reviewed before catalogue access.");
  return resolveEquipmentPolicyForActor({
    actor,
    draftId: acquisition.draftId,
    targetLevel: acquisition.targetLevel,
    selectedRecipe: selectedOfficialRecipe(acquisition.recipe.kind),
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
}

function higherLevelStartClaim(evidence: EquipmentHigherLevelStartEvidence): EquipmentHigherLevelStartClaim | null {
  if (evidence.kind === "not-required") return null;
  if (evidence.kind === "gm-confirmation") {
    return { kind: "gm-confirmation", judgmentId: evidence.judgment.id, startKind: evidence.startKind };
  }
  return { ...evidence };
}

function selectedOfficialRecipe(kind: AcquisitionDraftState["recipe"]["kind"]): OfficialEquipmentRecipe {
  return kind === "permanent-items" ? "permanent-items" : "lump-sum";
}

function requireAcquisition(request: StartingEquipmentUiRequest): AcquisitionDraftState {
  const acquisition = request.draft.acquisition;
  if (!acquisition || request.draft.acquisitionCorrupt) {
    throw new TypeError("Set up a valid starting-equipment draft before adding an item.");
  }
  return acquisition;
}

function assertSupportedCandidate(resolved: EquipmentCatalogueApplyResolution): void {
  if (!resolved.available || !resolved.policyDecision.eligible) {
    throw new Error(resolved.unavailableReasons[0]?.message ?? "This equipment is unavailable under current policy.");
  }
  if (!resolved.source || typeof resolved.source !== "object") {
    throw new TypeError("The equipment document has no embeddable source.");
  }
}

function assertTitanMaulerCandidate(resolved: EquipmentCatalogueApplyResolution): void {
  assertSupportedCandidate(resolved);
  if (resolved.candidate.level !== 0) {
    throw new Error("Titan Mauler requires a level-0 weapon.");
  }
}

function resolveRequestedFunding(
  policy: EffectiveEquipmentPolicySnapshotV1,
  requested: { readonly lane: "currency" } | { readonly lane: "allowance"; readonly allowanceId: string },
  itemLevel: number,
  itemPermanence: "consumable" | "permanent"
): AcquisitionLineDraft["funding"] {
  if (requested.lane === "currency") {
    if (itemLevel >= policy.targetLevel) {
      throw new Error("Starting currency can buy only items below the character's target level.");
    }
    return { lane: "currency" };
  }
  if (policy.recipe.kind !== "permanent-items") {
    throw new Error("The lump-sum recipe does not include permanent-item allowances.");
  }
  if (itemPermanence !== "permanent") {
    throw new Error("A permanent-item allowance cannot fund a consumable.");
  }
  const allowance = policy.recipe.allowances.find((candidate) => candidate.allowanceId === requested.allowanceId);
  if (!allowance) throw new Error("The selected permanent-item allowance no longer exists.");
  if (itemLevel > allowance.itemLevel) {
    throw new Error(`A level ${allowance.itemLevel} allowance cannot fund a level ${itemLevel} item.`);
  }
  return { lane: "allowance", assignment: { mode: "player", allowanceId: allowance.allowanceId } };
}

async function buildResolvedPrice(input: {
  readonly resolved: EquipmentCatalogueApplyResolution;
  readonly requestedQuantity: number;
  readonly targetSize: AcquisitionPriceSnapshot["size"];
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly packs: Pick<ReadonlyMap<string, EquipmentCataloguePackLike>, "get">;
  readonly prepareConfiguredItem: NonNullable<EquipmentAcquisitionRuntimeOptions["prepareConfiguredItem"]>;
  readonly preparePhysicalItem: NonNullable<EquipmentAcquisitionRuntimeOptions["preparePhysicalItem"]>;
}): Promise<{ readonly price: AcquisitionPriceSnapshot; readonly priceFingerprint: string }> {
  const configuration = configuredItemFacts(input.resolved.source, input.resolved.candidate.itemType);
  if (!configuration) {
    return {
      price: buildSimpleResolvedPrice({
        resolved: input.resolved,
        requestedQuantity: input.requestedQuantity,
        targetSize: input.targetSize,
        actor: input.actor,
        targetLevel: input.targetLevel,
        preparePhysicalItem: input.preparePhysicalItem,
      }),
      priceFingerprint: input.resolved.priceFingerprint,
    };
  }
  const handoffError = (issue: ConfiguredItemHandoffReason["issue"]): ConfiguredItemHandoffRequiredError =>
    new ConfiguredItemHandoffRequiredError({
      code: "unsafe-configured-item",
      sourceUuid: input.resolved.candidate.sourceUuid,
      itemName: input.resolved.candidate.name,
      issue,
    });
  if (configuration.specific !== null) throw handoffError("specific-magic-item");
  if (
    input.requestedQuantity !== 1 ||
    input.resolved.candidate.price.per !== 1 ||
    input.resolved.candidate.price.sourceQuantity !== 1
  ) {
    throw handoffError("unsupported-unit-pricing");
  }
  const pack = input.packs.get(input.resolved.candidate.packId);
  if (!pack) throw handoffError("base-item-unavailable");
  const index = Array.from(
    (await pack.getIndex({
      fields: ["type", "system.slug", "system.level.value", "system.runes", "system.material"],
    })) ?? []
  );
  const baseEntry = index.find((entry) => {
    const candidate = record(entry);
    return candidate.type === configuration.itemType && record(candidate.system).slug === configuration.baseItem;
  });
  const baseId = record(baseEntry)._id;
  if (typeof baseId !== "string" || !baseId) {
    throw handoffError("base-item-unavailable");
  }
  const baseDocument = await pack.getDocument(baseId);
  const baseSource = documentSource(baseDocument);
  if (!baseSource) throw handoffError("base-item-unavailable");
  const emptyMaterial = { type: null, grade: null };
  const emptyRunes =
    configuration.itemType === "weapon"
      ? { potency: 0, striking: 0, property: [] }
      : { potency: 0, resilient: 0, property: [] };
  const fundamentalRunes = { ...configuration.runes, property: [] };
  const prepare = (
    base: Readonly<Record<string, unknown>>,
    runes: Readonly<Record<string, unknown>>,
    material: Readonly<Record<string, unknown>>,
    forceNonSpecific: boolean
  ) =>
    input.prepareConfiguredItem({
      actor: input.actor,
      targetLevel: input.targetLevel,
      targetSize: input.targetSize,
      baseSource: base,
      runes,
      material,
      forceNonSpecific,
    });
  const full = prepare(baseSource, configuration.runes, configuration.material, true);
  const runeOnly = prepare(baseSource, configuration.runes, emptyMaterial, true);
  const fundamentalOnly = prepare(baseSource, fundamentalRunes, emptyMaterial, true);
  const materialOnly = prepare(baseSource, emptyRunes, configuration.material, true);
  const actual = prepare(input.resolved.source, configuration.runes, configuration.material, false);
  const fullPrepared = preparedConfiguredFacts(full, configuration.itemType);
  const runeOnlyPrepared = preparedConfiguredFacts(runeOnly, configuration.itemType);
  const fundamentalPrepared = preparedConfiguredFacts(fundamentalOnly, configuration.itemType);
  const materialPrepared = preparedConfiguredFacts(materialOnly, configuration.itemType);
  const actualPrepared = preparedConfiguredFacts(actual, configuration.itemType);
  if (
    !fullPrepared ||
    !runeOnlyPrepared ||
    !fundamentalPrepared ||
    !materialPrepared ||
    !actualPrepared ||
    actualPrepared.totalCopper !== fullPrepared.totalCopper ||
    canonicalJson(actualPrepared.runes) !== canonicalJson(fullPrepared.runes) ||
    canonicalJson(actualPrepared.material) !== canonicalJson(fullPrepared.material)
  ) {
    throw handoffError("prepared-components-unsafe");
  }
  const effectiveFundamental =
    fundamentalPrepared.runes.potency > 0 || meaningfulFundamental(fundamentalPrepared.runes.fundamental);
  const propertyRuneCopper =
    runeOnlyPrepared.runes.property.length > 0
      ? runeOnlyPrepared.totalCopper - (effectiveFundamental ? fundamentalPrepared.totalCopper : 0)
      : 0;
  const preciousMaterialCopper =
    materialPrepared.material.type && materialPrepared.material.grade ? materialPrepared.totalCopper : 0;
  const baselineAndFundamentalCopper = fullPrepared.totalCopper - propertyRuneCopper - preciousMaterialCopper;
  if (
    ![propertyRuneCopper, preciousMaterialCopper, baselineAndFundamentalCopper].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  ) {
    throw handoffError("prepared-components-unsafe");
  }
  const components = {
    version: 1 as const,
    itemType: configuration.itemType,
    baseItem: configuration.baseItem,
    source: {
      runes: normalizeConfiguredRunes(configuration.runes, configuration.itemType),
      material: configuration.material,
    },
    prepared: {
      runes: fullPrepared.runes,
      material: fullPrepared.material,
      totalCopper: fullPrepared.totalCopper,
    },
    baselineAndFundamentalCopper,
    propertyRuneCopper,
    preciousMaterialCopper,
    suppressedByAbp: suppressedConfiguredComponents(
      normalizeConfiguredRunes(configuration.runes, configuration.itemType),
      fullPrepared.runes
    ),
  };
  const basePrice: AcquisitionBasePriceSnapshot = { kind: "priced", value: { cp: baselineAndFundamentalCopper } };
  const snapshot = createAcquisitionPriceSnapshot({
    basePrice,
    size: input.targetSize,
    sizeSensitive: false,
    preciousMaterial: preciousMaterialCopper > 0,
    adjustedBulkPriceCopper: preciousMaterialCopper > 0 ? baselineAndFundamentalCopper : null,
    configurationPriceCopper: propertyRuneCopper + preciousMaterialCopper,
    pricePer: 1,
    sourceQuantity: 1,
    requestedQuantity: 1,
    configurationComponents: components,
  });
  if (snapshot.ok === false) throw handoffError("prepared-components-unsafe");
  const preparedPrice = snapshot.value;
  if (preparedPrice.unitPriceCopper !== fullPrepared.totalCopper) {
    throw handoffError("prepared-components-unsafe");
  }
  return {
    price: preparedPrice,
    priceFingerprint: fingerprintPreparedPrice(preparedPrice),
  };
}

function buildSimpleResolvedPrice(input: {
  readonly resolved: EquipmentCatalogueApplyResolution;
  readonly requestedQuantity: number;
  readonly targetSize: AcquisitionPriceSnapshot["size"];
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly preparePhysicalItem: NonNullable<EquipmentAcquisitionRuntimeOptions["preparePhysicalItem"]>;
}): AcquisitionPriceSnapshot {
  const normalized = input.resolved.candidate.price;
  const prepared = input.preparePhysicalItem({
    actor: input.actor,
    targetLevel: input.targetLevel,
    targetSize: input.targetSize,
    source: input.resolved.source,
  });
  const preparedFacts = preparedPhysicalPriceFacts(prepared);
  const basePrice: AcquisitionBasePriceSnapshot =
    normalized.kind === "priced" && normalized.value
      ? { kind: "priced", value: cloneData(normalized.value) }
      : normalized.kind === "missing"
        ? { kind: "missing" }
        : { kind: "unparseable" };
  const snapshot = createAcquisitionPriceSnapshot({
    basePrice,
    size: input.targetSize,
    sizeSensitive: preparedFacts.sizeSensitive,
    preciousMaterial: preparedFacts.preciousMaterial,
    adjustedBulkPriceCopper: preparedFacts.preciousMaterial ? preparedFacts.totalCopper : null,
    configurationPriceCopper: 0,
    pricePer: normalized.per,
    sourceQuantity: normalized.sourceQuantity,
    requestedQuantity: input.requestedQuantity,
  });
  if (snapshot.ok === false) throw new TypeError(snapshot.message);
  if (snapshot.value.unitPriceCopper !== preparedFacts.totalCopper) {
    throw new TypeError("PF2E prepared equipment pricing differs from Wayfinder's reviewed price basis.");
  }
  if ((normalized.copperValue ?? 0) > 0 && snapshot.value.linePriceCopper === 0) {
    throw new PartialUnitPriceRequiredError();
  }
  return snapshot.value;
}

function preparedPhysicalPriceFacts(item: unknown): {
  readonly sizeSensitive: boolean;
  readonly preciousMaterial: boolean;
  readonly totalCopper: number;
} {
  const system = record(record(item).system);
  const price = record(system.price);
  if (typeof price.sizeSensitive !== "boolean") {
    throw new TypeError("PF2E prepared equipment has no authoritative size-pricing fact.");
  }
  const totalCopper = coinsCopper(price.value);
  if (totalCopper === null) throw new TypeError("PF2E prepared equipment has no exact prepared Price.");
  const material = normalizeConfiguredMaterial(record(system.material));
  if ((material.type === null) !== (material.grade === null)) {
    throw new TypeError("PF2E prepared equipment has malformed precious-material facts.");
  }
  return {
    sizeSensitive: price.sizeSensitive,
    preciousMaterial: material.type !== null,
    totalCopper,
  };
}

function configuredItemFacts(source: unknown, itemType: string) {
  if (itemType !== "weapon" && itemType !== "armor") return null;
  const system = record(record(source).system);
  const runes = record(system.runes);
  const material = record(system.material);
  const baseItem = system.baseItem;
  const specific = system.specific ?? null;
  const normalizedRunes = normalizeConfiguredRunes(runes, itemType);
  const normalizedMaterial = normalizeConfiguredMaterial(material);
  const configured =
    normalizedRunes.potency > 0 ||
    meaningfulFundamental(normalizedRunes.fundamental) ||
    normalizedRunes.property.length > 0 ||
    normalizedMaterial.type !== null ||
    normalizedMaterial.grade !== null;
  if (!configured) return null;
  if (typeof baseItem !== "string" || !baseItem.trim()) {
    throw new Error("Configured equipment has no exact PF2E base-item identity; use the inventory sheet.");
  }
  return {
    itemType,
    baseItem: baseItem.trim(),
    specific,
    runes: cloneData(runes),
    material: normalizedMaterial,
  } as const;
}

function preparedConfiguredFacts(item: unknown, itemType: "weapon" | "armor") {
  const system = record(record(item).system);
  const totalCopper = coinsCopper(record(system.price).value);
  if (totalCopper === null) return null;
  return {
    runes: normalizeConfiguredRunes(record(system.runes), itemType),
    material: normalizeConfiguredMaterial(record(system.material)),
    totalCopper,
  };
}

function normalizeConfiguredRunes(runes: Readonly<Record<string, unknown>>, itemType: "weapon" | "armor") {
  const potency = Number.isSafeInteger(runes.potency) && Number(runes.potency) >= 0 ? Number(runes.potency) : 0;
  const fundamentalKey = itemType === "weapon" ? "striking" : "resilient";
  const rawFundamental = runes[fundamentalKey];
  const fundamental =
    rawFundamental === null || typeof rawFundamental === "string" || Number.isSafeInteger(rawFundamental)
      ? (rawFundamental as string | number | null)
      : null;
  const property = Array.isArray(runes.property)
    ? runes.property.filter((value): value is string => typeof value === "string")
    : [];
  return { potency, fundamental, property };
}

function normalizeConfiguredMaterial(material: Readonly<Record<string, unknown>>) {
  return {
    type: typeof material.type === "string" && material.type ? material.type : null,
    grade: typeof material.grade === "string" && material.grade ? material.grade : null,
  };
}

function meaningfulFundamental(value: string | number | null): boolean {
  return (typeof value === "number" && value > 0) || (typeof value === "string" && value !== "" && value !== "0");
}

function suppressedConfiguredComponents(
  source: ReturnType<typeof normalizeConfiguredRunes>,
  prepared: ReturnType<typeof normalizeConfiguredRunes>
): string[] {
  const suppressed: string[] = [];
  if (source.potency > prepared.potency) suppressed.push("potency");
  if (meaningfulFundamental(source.fundamental) && !meaningfulFundamental(prepared.fundamental)) {
    suppressed.push("fundamental");
  }
  for (const property of source.property) {
    if (!prepared.property.includes(property)) suppressed.push(`property:${property}`);
  }
  return suppressed.sort();
}

function coinsCopper(value: unknown): number | null {
  const coins = record(value);
  if (Number.isSafeInteger(coins.copperValue) && Number(coins.copperValue) >= 0) return Number(coins.copperValue);
  let total = 0;
  for (const [denomination, factor] of Object.entries({ pp: 1000, gp: 100, sp: 10, cp: 1 })) {
    const amount = coins[denomination] ?? 0;
    if (!Number.isSafeInteger(amount) || Number(amount) < 0) return null;
    total += Number(amount) * factor;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function documentSource(document: unknown): Readonly<Record<string, unknown>> | null {
  const toObject = record(document).toObject;
  if (typeof toObject !== "function") return null;
  const source = (toObject as (source?: boolean) => unknown).call(document, true);
  return source && typeof source === "object" ? (cloneData(source) as Readonly<Record<string, unknown>>) : null;
}

function prepareTransientConfiguredItem(input: {
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly targetSize: AcquisitionPriceSnapshot["size"];
  readonly baseSource: Readonly<Record<string, unknown>>;
  readonly runes: Readonly<Record<string, unknown>>;
  readonly material: Readonly<Record<string, unknown>>;
  readonly forceNonSpecific: boolean;
}): unknown {
  const itemSource = cloneData(input.baseSource) as Record<string, unknown>;
  const itemSystem = record(itemSource.system);
  itemSystem.runes = cloneData(input.runes);
  itemSystem.material = cloneData(input.material);
  if (input.forceNonSpecific) itemSystem.specific = null;
  itemSource.system = itemSystem;
  return prepareTransientPhysicalItem({
    actor: input.actor,
    targetLevel: input.targetLevel,
    targetSize: input.targetSize,
    source: itemSource,
  });
}

function prepareTransientPhysicalItem(input: {
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly targetSize: AcquisitionPriceSnapshot["size"];
  readonly source: Readonly<Record<string, unknown>>;
}): unknown {
  const actorToObject = record(input.actor).toObject;
  if (typeof actorToObject !== "function") {
    throw new Error("Equipment pricing requires a PF2E actor preparation context.");
  }
  const actorSource = cloneData((actorToObject as (source?: boolean) => unknown).call(input.actor, true)) as Record<
    string,
    unknown
  >;
  const actorSystem = record(actorSource.system);
  const details = record(actorSystem.details);
  const level = record(details.level);
  level.value = input.targetLevel;
  details.level = level;
  actorSystem.details = details;
  actorSource.system = actorSystem;
  actorSource._id = transientId();
  actorSource.name = `Wayfinder equipment-price preparation ${input.targetLevel}`;
  const itemSource = cloneData(input.source) as Record<string, unknown>;
  const itemSystem = record(itemSource.system);
  itemSystem.size = materializedPhysicalItemSize(input.targetSize);
  itemSource.system = itemSystem;
  const itemId = transientId();
  itemSource._id = itemId;
  actorSource.items = [itemSource];
  const actorClass = record(record(CONFIG).Actor).documentClass;
  if (typeof actorClass !== "function") throw new Error("PF2E actor preparation is unavailable.");
  const temporary = new (actorClass as new (source: unknown, context: unknown) => unknown)(actorSource, {
    temporary: true,
  });
  const items = record(temporary).items;
  const get = record(items).get;
  const item = typeof get === "function" ? (get as (id: string) => unknown).call(items, itemId) : null;
  if (!item) throw new Error("PF2E did not prepare the transient equipment item.");
  return item;
}

function transientId(): string {
  const randomId = record(record(globalThis).foundry).utils;
  const mint = record(randomId).randomID;
  if (typeof mint === "function") return (mint as (length: number) => string)(16);
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function fingerprintPreparedPrice(price: AcquisitionPriceSnapshot): string {
  const text = canonicalJson({ version: 1, price });
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `equipment-prepared-price-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildTitanMaulerLine(args: {
  readonly resolved: EquipmentCatalogueApplyResolution;
  readonly policy: EffectiveEquipmentPolicySnapshotV1;
  readonly actor: unknown;
  readonly targetLevel: number;
  readonly preparePhysicalItem: NonNullable<EquipmentAcquisitionRuntimeOptions["preparePhysicalItem"]>;
  readonly actorSize: TitanMaulerCandidate["actorSize"];
  readonly targetSize: NonNullable<ReturnType<typeof titanMaulerTargetSize>>;
  readonly grantId: string;
  readonly lineId: string;
}): AcquisitionLineDraft {
  const line: AcquisitionLineDraft = {
    schemaVersion: 1,
    lineId: args.lineId,
    sourceUuid: args.resolved.candidate.sourceUuid,
    documentFingerprint: args.resolved.documentFingerprint,
    priceFingerprint: args.resolved.priceFingerprint,
    itemLevel: args.resolved.candidate.level,
    permanence: "permanent",
    componentKind: "baseline-item",
    policyDecision: cloneData(args.resolved.policyDecision),
    funding: { lane: "class-grant", grant: { plannedGrantId: args.grantId } },
    stackingIntent: "separate",
    price: buildSimpleResolvedPrice({
      resolved: args.resolved,
      requestedQuantity: 1,
      targetSize: args.targetSize,
      actor: args.actor,
      targetLevel: args.targetLevel,
      preparePhysicalItem: args.preparePhysicalItem,
    }),
  };
  const candidate = buildTitanMaulerCandidate({
    document: args.resolved.source,
    line,
    policy: args.policy,
    actorSize: args.actorSize,
    characterAccessRef: args.resolved.policyDecision.characterAccessRef,
  });
  if (!candidate) throw new Error("The selected Titan Mauler weapon facts are malformed or changed.");
  const eligibility = evaluateTitanMaulerCandidate(candidate);
  if (eligibility.ok === false) throw new Error(eligibility.message);
  return line;
}

function isTitanMaulerLine(line: AcquisitionLineDraft): boolean {
  return (
    line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId.startsWith("class-grant:titan-mauler:")
  );
}

function removeTitanMaulerLines(
  acquisition: AcquisitionDraftState,
  reason: Exclude<TitanMaulerLineSynchronizationResult["reason"], null>
): TitanMaulerLineSynchronizationResult {
  const withoutLines = {
    ...acquisition,
    lines: acquisition.lines.filter((line) => !isTitanMaulerLine(line)),
  };
  const withoutGrants = recordPlannedClassGrants(
    withoutLines,
    withoutLines.plannedClassGrants.filter((grant) => !grant.grantId.startsWith("class-grant:titan-mauler:"))
  );
  return {
    acquisition: invalidateAcquisitionReview(withoutGrants, ["document"]),
    changed: true,
    reason,
  };
}

function invalidateTitanMaulerVerification(acquisition: AcquisitionDraftState): TitanMaulerLineSynchronizationResult {
  const invalidated = invalidateAcquisitionReview(acquisition, ["document"]);
  return {
    acquisition: invalidated,
    changed: invalidated !== acquisition,
    reason: "verification-failed",
  };
}

async function requireDraftedAncestryEquipmentSize(input: {
  readonly actor: unknown;
  readonly draft: DraftState;
  readonly targetLevel: number;
  readonly fetchDocumentByUuid: (uuid: string) => Promise<unknown | null>;
  readonly prepareDraftedActor: NonNullable<EquipmentAcquisitionRuntimeOptions["prepareDraftedActor"]>;
}): Promise<AcquisitionPriceSnapshot["size"]> {
  return resolvePreparedDraftedEquipmentSize(input);
}

function permanence(itemType: string): AcquisitionLineDraft["permanence"] {
  return itemType === "ammo" || itemType === "consumable" ? "consumable" : "permanent";
}

function buildAccessFacts(draft: DraftState): Readonly<Record<string, unknown>> {
  const selections = [...Object.values(draft.selections), ...Object.values(draft.branchSelections)]
    .map((selection) => ({ slotId: selection.slotId, sourceUuid: selection.uuid }))
    .sort((left, right) => left.slotId.localeCompare(right.slotId) || left.sourceUuid.localeCompare(right.sourceUuid));
  return {
    selections,
    classChoices: sortedRecord(draft.classChoices),
    singletonChoices: sortedRecord(draft.singletonChoices),
  };
}

function titanMaulerProjection(draft: DraftState): {
  readonly required: boolean;
  readonly selectedSourceUuid: string | null;
} {
  const grantId = titanMaulerGrantIdForDraft(draft);
  if (!grantId) return { required: false, selectedSourceUuid: null };
  const selected = draft.acquisition?.lines.find(
    (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId
  );
  return { required: true, selectedSourceUuid: selected?.sourceUuid ?? null };
}

function toUiRecord(entry: EquipmentCatalogueEntry, preparedPrice?: AcquisitionPriceSnapshot | null) {
  const preparedPriceCopper =
    preparedPrice === undefined ? entry.price.copperValue : (preparedPrice?.linePriceCopper ?? null);
  return {
    sourceUuid: entry.sourceUuid,
    name: entry.name,
    itemType: entry.itemType,
    level: entry.level,
    rarity: entry.rarity,
    sourceLabel: publicationLabel(entry.publicationSlug),
    priceCopper: preparedPriceCopper,
    priceLabel: cataloguePriceLabel(preparedPriceCopper, preparedPrice),
    bulkLabel: "See item details",
    handsLabel: null,
    traits: [...entry.traits],
    available: entry.available,
    unavailableReason: entry.unavailableReasons[0]?.message ?? null,
    exceptionRequestable:
      entry.unavailableReasons.length > 0 &&
      entry.unavailableReasons.every(
        (reason) => reason.code === "source-not-allowed" || reason.code === "rarity-not-available"
      ),
    titanMaulerEligible: isPotentialTitanMaulerEntry(entry),
  };
}

function cataloguePriceLabel(priceCopper: number | null, price?: AcquisitionPriceSnapshot | null): string {
  const label = formatCopper(priceCopper);
  if (!price || priceCopper === null) return label;
  if (price.materializedQuantity === 1 && price.pricePer === 1) return label;
  const perContext = price.pricePer !== price.materializedQuantity ? ` (priced per ${price.pricePer})` : "";
  return `${label} for ${price.materializedQuantity}${perContext}`;
}

function matchesCatalogueRequest(entry: EquipmentCatalogueEntry, request: StartingEquipmentUiRequest): boolean {
  const query = request.query.trim().toLocaleLowerCase();
  if (
    query &&
    ![entry.name, publicationLabel(entry.publicationSlug), entry.rarity, entry.itemType, ...entry.traits]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query)
  ) {
    return false;
  }
  return Object.entries(request.filters).every(([key, values]) => {
    if (values.length === 0) return true;
    const actual =
      key === "rarity"
        ? entry.rarity
        : key === "source"
          ? publicationLabel(entry.publicationSlug)
          : key === "type"
            ? entry.itemType
            : null;
    return actual !== null && values.includes(actual);
  });
}

function isPotentialTitanMaulerEntry(entry: EquipmentCatalogueEntry): boolean {
  return (
    entry.available &&
    entry.itemType === "weapon" &&
    !entry.traits.includes("unarmed") &&
    entry.price.kind === "priced" &&
    entry.price.copperValue !== null &&
    entry.price.copperValue <= 900 &&
    entry.price.sourceQuantity === 1 &&
    (entry.rarity === "common" || entry.policyDecision.characterAccessRef !== null)
  );
}

function catalogueFilters(entries: readonly EquipmentCatalogueEntry[]) {
  const values = [
    ...uniqueSorted(entries.map((entry) => entry.itemType)).map((value) => ({
      key: "type",
      label: title(value),
      value,
    })),
    ...uniqueSorted(entries.map((entry) => entry.rarity)).map((value) => ({
      key: "rarity",
      label: title(value),
      value,
    })),
    ...uniqueSorted(entries.map((entry) => publicationLabel(entry.publicationSlug))).map((value) => ({
      key: "source",
      label: value,
      value,
    })),
  ];
  return values;
}

function publicationLabel(slug: string): string {
  return title(slug.replace(/-/g, " "));
}

function title(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCopper(copper: number | null): string {
  if (copper === null || !Number.isSafeInteger(copper) || copper < 0) return "Unavailable";
  if (copper === 0) return "0 gp";
  const gp = Math.floor(copper / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  return [gp ? `${gp} gp` : "", sp ? `${sp} sp` : "", cp ? `${cp} cp` : ""].filter(Boolean).join(" ");
}

function sortedRecord(input: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
