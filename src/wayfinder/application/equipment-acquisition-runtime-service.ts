import type { EmbeddedItemSource } from "../../shared/actor-model.js";
import { cloneData } from "../../shared/cloning.js";
import type { DraftState } from "../../types.js";
import { acquisitionPolicyMaterialMatches, createAcquisitionPolicySnapshot } from "../domain/acquisition-draft.js";
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
  type PlannedClassGrantV1,
  type PreparedClassGrantPlanV1,
} from "../domain/class-grant-reconciliation.js";
import type { EffectiveEquipmentPolicySnapshotV1, OfficialEquipmentRecipe } from "../domain/equipment-policy.js";
import type { ResolvedAcquisitionSource } from "./acquisition-execution-service.js";
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
import { resolveEquipmentPolicyForActor } from "./equipment-policy-service.js";
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
  readonly mintLineId?: () => string;
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

export interface EquipmentAcquisitionRuntime {
  readonly uiAdapter: StartingEquipmentUiAdapter;
  readonly prepareNativeClassGrantLines: (
    request: NativeClassGrantLineRequest
  ) => Promise<readonly AcquisitionLineDraft[]>;
  readonly resolveCurrentPolicySnapshot: (
    actor: unknown,
    acquisition: AcquisitionDraftState
  ) => AcquisitionPolicySnapshot;
  readonly resolveSourceForApply: (request: EquipmentApplySourceRequest) => Promise<ResolvedAcquisitionSource>;
  readonly invalidatePack: (packId: string) => void;
}

export function createEquipmentAcquisitionRuntime(
  options: EquipmentAcquisitionRuntimeOptions
): EquipmentAcquisitionRuntime {
  const accessRegistry = options.accessRegistry ?? EMPTY_EQUIPMENT_ACCESS_REGISTRY;
  const resolveEffectivePolicy = options.resolveEffectivePolicy ?? resolveCurrentEffectivePolicy;
  const mintLineId = options.mintLineId ?? mintAcquisitionLineId;
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

  const currentContext = (
    actor: unknown,
    draft: DraftState,
    acquisition: AcquisitionDraftState
  ): { readonly policy: EffectiveEquipmentPolicySnapshotV1; readonly context: EquipmentCatalogueContext } => {
    if (draft.acquisition?.draftId !== acquisition.draftId || draft.acquisition.batchId !== acquisition.batchId) {
      throw new TypeError("The equipment catalogue request belongs to another acquisition draft.");
    }
    const policy = resolveEffectivePolicy(actor, acquisition);
    const snapshot = createAcquisitionPolicySnapshot(policy, acquisition.recipe);
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

  const uiAdapter: StartingEquipmentUiAdapter = {
    async project(request) {
      const acquisition = request.draft.acquisition;
      if (!acquisition) {
        return {
          state: "pending",
          message: "Set up starting equipment to load the approved catalogue.",
          query: request.query,
          records: [],
          filters: [],
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
        };
      }
      try {
        const { policy, context } = currentContext(request.actor, request.draft, acquisition);
        const catalogue = catalogueFor(policy);
        const projection = await catalogue.project(context);
        let projectedEntries = projection.entries;
        if (request.previewSourceUuid) {
          const preview = await catalogue.hydratePreview(request.previewSourceUuid, context);
          if (preview?.entry) {
            projectedEntries = projection.entries.map((entry) =>
              entry.sourceUuid === preview.entry!.sourceUuid ? preview.entry! : entry
            );
          }
        }
        const entries = projectedEntries.filter((entry) => entry.level === 0);
        const records = entries.map(toUiRecord);
        return {
          state: "ready",
          message: `${records.length} level-0 equipment option${records.length === 1 ? "" : "s"} loaded.`,
          query: request.query,
          records,
          filters: catalogueFilters(entries),
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
        };
      } catch (error) {
        return {
          state: "error",
          message: error instanceof Error ? error.message : "The approved equipment catalogue could not be loaded.",
          query: request.query,
          records: [],
          filters: [],
          activeFilters: request.filters,
          previewSourceUuid: request.previewSourceUuid,
        };
      }
    },
    async prepareLine(request) {
      const acquisition = requireAcquisition(request);
      const { policy, context } = currentContext(request.actor, request.draft, acquisition);
      const resolved = await catalogueFor(policy).resolveForApply(context, request.sourceUuid);
      assertWaveTwoCandidate(resolved);
      const price = buildResolvedPrice(resolved, 1, sourceSize(resolved.source));
      return {
        schemaVersion: 1,
        lineId: mintLineId(),
        sourceUuid: resolved.candidate.sourceUuid,
        documentFingerprint: resolved.documentFingerprint,
        priceFingerprint: resolved.priceFingerprint,
        itemLevel: resolved.candidate.level,
        permanence: permanence(resolved.candidate.itemType),
        componentKind: "baseline-item",
        policyDecision: cloneData(resolved.policyDecision),
        funding: { lane: "currency" },
        stackingIntent: "aggregate",
        price,
      };
    },
  };

  return {
    uiAdapter,
    async prepareNativeClassGrantLines(request) {
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      assertPreparedClassGrantPlanMatches({
        plan: request.classGrantPlan,
        actorId: policy.actorId,
        draftId: request.acquisition.draftId,
        batchId: request.acquisition.batchId,
        targetLevel: request.acquisition.targetLevel,
        persistedGrants: request.acquisition.plannedClassGrants,
      });
      const catalogue = catalogueFor(policy);
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
        const resolved = await catalogue.resolveForApply(context, grant.expected.sourceUuid);
        assertFixedNativeSource(grant, resolved);
        const lineId = persisted[0]?.lineId ?? mintLineId();
        if (!lineId.trim() || (persisted.length === 0 && lineIds.has(lineId))) {
          throw new TypeError("Native class-grant preparation requires a unique acquisition line ID.");
        }
        lineIds.add(lineId);
        const price = buildResolvedPrice(resolved, 1, sourceSize(resolved.source));
        if (price.materializedQuantity !== 1) {
          throw new Error(`Native class grant ${grant.grantId} must resolve to exactly one item.`);
        }
        const line: AcquisitionLineDraft = {
          schemaVersion: 1,
          lineId,
          sourceUuid: grant.expected.sourceUuid,
          documentFingerprint: resolved.documentFingerprint,
          priceFingerprint: resolved.priceFingerprint,
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
      return createAcquisitionPolicySnapshot(resolveEffectivePolicy(actor, acquisition), acquisition.recipe);
    },
    async resolveSourceForApply(request) {
      const persisted = request.characterDraft.acquisition;
      if (
        persisted?.draftId !== request.acquisition.draftId ||
        persisted.batchId !== request.acquisition.batchId ||
        persisted.manifestId !== request.acquisition.manifestId
      ) {
        throw new TypeError("The Apply source request belongs to another acquisition draft.");
      }
      const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
      const resolved = await catalogueFor(policy).resolveForApply(context, request.entry.sourceUuid);
      assertWaveTwoCandidate(resolved);
      const lines = request.entry.lineIds.map((lineId) => {
        const line = request.acquisition.lines.find((candidate) => candidate.lineId === lineId);
        if (!line) throw new TypeError(`Prepared acquisition line ${lineId} is unavailable.`);
        return line;
      });
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
      const resolvedPrice = buildResolvedPrice(
        resolved,
        request.entry.price.requestedQuantity,
        sourceSize(resolved.source)
      );
      return {
        source: cloneData(resolved.source) as EmbeddedItemSource,
        sourceUuid: resolved.candidate.sourceUuid,
        documentFingerprint: resolved.documentFingerprint,
        priceFingerprint: resolved.priceFingerprint,
        resolvedPrice,
        policyDecision: cloneData(resolved.policyDecision),
      };
    },
    invalidatePack(packId) {
      for (const catalogue of catalogues.values()) catalogue.invalidatePack(packId);
    },
  };
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

function assertExactCompendiumSource(sourceUuid: string, source: Readonly<Record<string, unknown>>): void {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(sourceUuid);
  if (!match) throw new TypeError(`Native class-grant source is not an exact Compendium Item UUID: ${sourceUuid}.`);
  if (source._id !== match[2]) {
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

function assertWaveTwoCandidate(resolved: EquipmentCatalogueApplyResolution): void {
  if (!resolved.available || !resolved.policyDecision.eligible) {
    throw new Error(resolved.unavailableReasons[0]?.message ?? "This equipment is unavailable under current policy.");
  }
  if (resolved.candidate.level !== 0) {
    throw new Error("Wave 2 supports only level-0 items for a level-1 character.");
  }
  if (!resolved.source || typeof resolved.source !== "object") {
    throw new TypeError("The equipment document has no embeddable source.");
  }
}

function buildResolvedPrice(
  resolved: EquipmentCatalogueApplyResolution,
  requestedQuantity: number,
  targetSize: AcquisitionPriceSnapshot["size"]
): AcquisitionPriceSnapshot {
  const normalized = resolved.candidate.price;
  const source = record(resolved.source);
  const system = record(source.system);
  const price = record(system.price);
  const material = record(system.material);
  const materialType = material.type;
  const materialGrade = material.grade;
  if (
    (materialType !== null && materialType !== undefined) ||
    (materialGrade !== null && materialGrade !== undefined)
  ) {
    throw new Error("Precious-material and graded equipment are deferred beyond the Wave 2 simple-item tracer.");
  }
  const sizeSensitive = price.sizeSensitive === undefined ? true : price.sizeSensitive;
  if (typeof sizeSensitive !== "boolean") throw new TypeError("The equipment size-pricing fact is malformed.");
  const basePrice: AcquisitionBasePriceSnapshot =
    normalized.kind === "priced" && normalized.value
      ? { kind: "priced", value: cloneData(normalized.value) }
      : normalized.kind === "missing"
        ? { kind: "missing" }
        : { kind: "unparseable" };
  const snapshot = createAcquisitionPriceSnapshot({
    basePrice,
    size: targetSize,
    sizeSensitive,
    preciousMaterial: false,
    adjustedBulkPriceCopper: null,
    configurationPriceCopper: 0,
    pricePer: normalized.per,
    sourceQuantity: normalized.sourceQuantity,
    requestedQuantity,
  });
  if (snapshot.ok === false) throw new TypeError(snapshot.message);
  return snapshot.value;
}

function sourceSize(source: Readonly<Record<string, unknown>>): AcquisitionPriceSnapshot["size"] {
  const raw = record(source.system).size;
  const sizes: Readonly<Record<string, AcquisitionPriceSnapshot["size"]>> = {
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
  if (typeof raw !== "string" || !sizes[raw.trim().toLowerCase()]) {
    throw new TypeError("The equipment source has no supported size fact.");
  }
  return sizes[raw.trim().toLowerCase()]!;
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

function toUiRecord(entry: EquipmentCatalogueEntry) {
  return {
    sourceUuid: entry.sourceUuid,
    name: entry.name,
    itemType: entry.itemType,
    level: entry.level,
    rarity: entry.rarity,
    sourceLabel: publicationLabel(entry.publicationSlug),
    priceCopper: entry.price.copperValue,
    priceLabel: formatCopper(entry.price.copperValue),
    bulkLabel: "See item details",
    handsLabel: null,
    traits: [...entry.traits],
    available: entry.available,
    unavailableReason: entry.unavailableReasons[0]?.message ?? null,
  };
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
