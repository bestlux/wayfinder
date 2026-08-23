import { cloneData } from "../../shared/cloning.js";
import type { AcquisitionLinePolicyDecision } from "../domain/acquisition-types.js";
import { ADVENTURERS_PACK_SOURCE_UUID } from "../domain/acquisition-types.js";
import {
  type EffectiveEquipmentPolicySnapshotV1,
  type EquipmentRarity,
  evaluateEquipmentItemAuthority,
  resolveEquipmentItemExceptionJudgmentIds,
} from "../domain/equipment-policy.js";
import {
  type EquipmentSourceDiagnostic,
  sortEquipmentSourceDiagnostics,
  sourceDiagnostic,
} from "./equipment-source-policy.js";

export const EQUIPMENT_CATALOGUE_PROJECTION_VERSION = 1 as const;
export const WF_080_21_DAGGER_UUID = "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z";
export const ADVENTURERS_PACK_UUID = ADVENTURERS_PACK_SOURCE_UUID;

const INDEX_FIELDS = Object.freeze([
  "img",
  "type",
  "system.level.value",
  "system.traits.rarity",
  "system.traits.value",
  "system.traits.otherTags",
  "system.publication.title",
  "system.source.value",
  "system.price.value",
  "system.price.per",
  "system.price.sizeSensitive",
  "system.quantity",
  "system.rules",
  "system.runes",
  "system.material",
  "system.specific",
  "system.subitems",
]);
const PHYSICAL_ITEM_TYPES = new Set(["ammo", "armor", "backpack", "consumable", "equipment", "shield", "weapon"]);
const CONTAINER_ITEM_TYPES = new Set(["kit"]);
const INTERACTIVE_RULE_KEYS = new Set(["ChoiceSet", "GrantItem"]);
const DENOMINATIONS = ["pp", "gp", "sp", "cp"] as const;
const COPPER_VALUE = Object.freeze({ pp: 1000, gp: 100, sp: 10, cp: 1 });

type EquipmentDenomination = (typeof DENOMINATIONS)[number];

export interface EquipmentCataloguePackLike {
  /** Foundry replaces an index entry object on create/update and removes it on delete. */
  readonly indexEntryIdentity?: "stable-replacement";
  /** The adapter guarantees that requested PF2E physical-item source fields are complete, not projected guesses. */
  readonly indexedBrowsePricing?: "pf2e-physical-source-v1";
  readonly documentName?: string;
  readonly metadata?: { readonly type?: string };
  readonly getIndex: (options: { fields: string[] }) => Promise<Iterable<unknown> | null | undefined>;
  readonly getDocument: (documentId: string) => Promise<unknown | null>;
  readonly getDocuments?: (query: { _id: string }) => Promise<Iterable<unknown> | null | undefined>;
  readonly set?: (documentId: string, document: unknown) => unknown;
  readonly delete?: (documentId: string) => unknown;
}

export interface EquipmentCatalogueDraftContext {
  readonly draftId: string;
  readonly targetLevel: number;
  readonly version: number;
  readonly accessFactsFingerprint: string;
  /** Current in-memory selections and source-backed provenance required by registered Access adapters. */
  readonly accessFacts: Readonly<Record<string, unknown>>;
}

export interface EquipmentCatalogueContext {
  readonly actor: unknown;
  readonly draft: EquipmentCatalogueDraftContext;
  readonly policy: EffectiveEquipmentPolicySnapshotV1;
}

export interface NormalizedEquipmentPrice {
  readonly kind: "priced" | "missing" | "unparseable";
  readonly value: Readonly<Partial<Record<EquipmentDenomination, number>>> | null;
  readonly copperValue: number | null;
  readonly per: number;
  readonly sourceQuantity: number;
}

/**
 * Exact browse-only pricing facts that are safe to derive from a PF2E pack index.
 *
 * This is intentionally absent for configured, material, magical, rule-bearing, nested,
 * or otherwise ambiguous sources. Those records retain the prepared-document path.
 */
export interface IndexedEquipmentBrowsePriceFacts {
  readonly sizeSensitive: boolean;
}

export interface NormalizedEquipmentCatalogueCandidate {
  readonly sourceUuid: string;
  readonly packId: string;
  readonly documentId: string;
  readonly name: string;
  readonly img: string;
  readonly itemType: string;
  readonly level: number;
  readonly rarity: EquipmentRarity;
  readonly publicationSlug: string;
  readonly price: NormalizedEquipmentPrice;
  readonly indexedBrowsePriceFacts: IndexedEquipmentBrowsePriceFacts | null;
  readonly traits: readonly string[];
  readonly ruleKeys: readonly string[];
  readonly previewIdentity: string;
}

export interface EquipmentAccessResolutionInput {
  readonly actor: unknown;
  readonly draft: EquipmentCatalogueDraftContext;
  readonly candidate: NormalizedEquipmentCatalogueCandidate;
  /** Present during preview/Apply document resolution and null for index-only projections. */
  readonly source: Readonly<Record<string, unknown>> | null;
}

export interface EquipmentSourceAccessRecord {
  readonly sourceUuid: string;
  readonly accessRef: string;
  /** Stable adapter/schema identity. Function source text is deliberately not fingerprinted. */
  readonly profileVersion: string;
  readonly resolve: (input: EquipmentAccessResolutionInput) => boolean;
}

export interface EquipmentAccessRegistry {
  readonly fingerprint: string;
  readonly sourceUuids: readonly string[];
  readonly resolve: (input: EquipmentAccessResolutionInput) => string | null;
}

export interface EquipmentCatalogueUnavailableReason {
  readonly code:
    | "container-or-kit-excluded"
    | "interactive-rule-unsupported"
    | "item-type-unsupported"
    | "level-unparseable"
    | "price-missing"
    | "price-unparseable"
    | "rarity-unparseable"
    | "rarity-not-available"
    | "rules-unparseable"
    | "source-not-allowed"
    | "treasure-excluded";
  readonly message: string;
}

export interface EquipmentCatalogueEntry extends NormalizedEquipmentCatalogueCandidate {
  readonly available: boolean;
  readonly unavailableReasons: readonly EquipmentCatalogueUnavailableReason[];
  readonly policyDecision: AcquisitionLinePolicyDecision;
}

export interface EquipmentCatalogueProjection {
  readonly version: typeof EQUIPMENT_CATALOGUE_PROJECTION_VERSION;
  readonly cacheKey: string;
  readonly entries: readonly EquipmentCatalogueEntry[];
  readonly diagnostics: readonly EquipmentSourceDiagnostic[];
}

export interface EquipmentCataloguePreview {
  readonly sourceUuid: string;
  readonly previewIdentity: string;
  readonly source: Readonly<Record<string, unknown>> | null;
  /** Hydrated, current-policy reevaluation when a context was supplied. */
  readonly entry: EquipmentCatalogueEntry | null;
}

export interface EquipmentCatalogueApplyResolution {
  readonly source: Readonly<Record<string, unknown>>;
  readonly candidate: NormalizedEquipmentCatalogueCandidate;
  readonly documentFingerprint: string;
  readonly priceFingerprint: string;
  readonly available: boolean;
  readonly unavailableReasons: readonly EquipmentCatalogueUnavailableReason[];
  readonly policyDecision: AcquisitionLinePolicyDecision;
}

export interface EquipmentCatalogueBrowseResolutionResult {
  readonly sourceUuid: string;
  readonly resolution: EquipmentCatalogueApplyResolution | null;
  readonly error: Error | null;
}

export interface FixedNativeEquipmentSourceAuthority {
  readonly kind: "fixed-native-grant";
  readonly expectedSourceUuid: string;
  readonly expectedPackId: string;
}

export interface EquipmentCatalogueServiceOptions {
  readonly packs: Pick<ReadonlyMap<string, EquipmentCataloguePackLike>, "get">;
  /** Explicit PF2E equipment-tab pack projection; policy family membership alone is insufficient. */
  readonly equipmentPackIds: readonly string[];
  readonly accessRegistry?: EquipmentAccessRegistry;
}

export function fingerprintEquipmentDocument(source: unknown): string {
  if (!isRecord(source)) throw new TypeError("Equipment document fingerprinting requires a source object.");
  return fingerprint("equipment-document-v1", source);
}

interface CachedPreview {
  readonly previewIdentity: string;
  readonly source: Readonly<Record<string, unknown>> | null;
}

interface PendingPreview {
  readonly previewIdentity: string;
  readonly generation: number;
  readonly promise: Promise<CachedPreview>;
}

interface NormalizationResult {
  readonly candidate: NormalizedEquipmentCatalogueCandidate;
  readonly reasons: readonly EquipmentCatalogueUnavailableReason[];
}

type CachedProjectionCandidate = NormalizationResult;

interface PackProjectionResult {
  readonly candidates: readonly CachedProjectionCandidate[];
  readonly diagnostics: readonly EquipmentSourceDiagnostic[];
  readonly cacheable: boolean;
}

interface CachedPackNormalization {
  readonly candidate: CachedProjectionCandidate;
  readonly witness: string;
}

type PackNormalizationSnapshot = WeakMap<Readonly<Record<string, unknown>>, CachedPackNormalization>;

const LARGE_PACK_NORMALIZATION_CHUNK = 3_000;

interface CachedCandidateAuthority {
  readonly characterAccessRef: string | null;
  readonly exceptionIds: {
    readonly sourceExceptionJudgmentId: string | null;
    readonly rarityExceptionJudgmentId: string | null;
  };
  readonly authority: { readonly eligible: boolean; readonly reasons: readonly string[] };
}

interface ProjectionMaterialSnapshot {
  readonly packResults: readonly PackProjectionResult[];
  readonly result: PackProjectionResult;
}

const PROJECTION_SNAPSHOT_LIMIT = 8;

export function createEquipmentAccessRegistry(
  records: readonly EquipmentSourceAccessRecord[] = []
): EquipmentAccessRegistry {
  const byUuid = new Map<string, EquipmentSourceAccessRecord>();
  for (const record of records) {
    parseCompendiumItemUuid(record.sourceUuid);
    if (!nonEmpty(record.accessRef) || !nonEmpty(record.profileVersion)) {
      throw new TypeError("Equipment Access records require stable access and profile identities.");
    }
    if (byUuid.has(record.sourceUuid)) {
      throw new TypeError(`Equipment Access is registered more than once for ${record.sourceUuid}.`);
    }
    byUuid.set(record.sourceUuid, record);
  }
  const sourceUuids = [...byUuid.keys()].sort((left, right) => left.localeCompare(right));
  const registryFingerprint = fingerprint(
    "equipment-access-registry-v1",
    sourceUuids.map((sourceUuid) => {
      const record = byUuid.get(sourceUuid)!;
      return { sourceUuid, accessRef: record.accessRef, profileVersion: record.profileVersion };
    })
  );
  return Object.freeze({
    fingerprint: registryFingerprint,
    sourceUuids: Object.freeze(sourceUuids),
    resolve(input: EquipmentAccessResolutionInput): string | null {
      const record = byUuid.get(input.candidate.sourceUuid);
      if (!record) return null;
      try {
        return record.resolve(input) ? record.accessRef : null;
      } catch {
        return null;
      }
    },
  });
}

export const EMPTY_EQUIPMENT_ACCESS_REGISTRY = createEquipmentAccessRegistry();

export function createEquipmentCatalogueDraftContext(input: {
  readonly draftId: string;
  readonly targetLevel: number;
  readonly version: number;
  readonly accessFacts: Readonly<Record<string, unknown>>;
}): EquipmentCatalogueDraftContext {
  if (
    !nonEmpty(input.draftId) ||
    !Number.isSafeInteger(input.targetLevel) ||
    input.targetLevel < 1 ||
    input.targetLevel > 20 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    !isRecord(input.accessFacts)
  ) {
    throw new TypeError("Equipment catalogue Access requires current draft identity, version, and facts.");
  }
  const accessFacts = deepFreeze(cloneData(input.accessFacts));
  const material = {
    draftId: input.draftId,
    targetLevel: input.targetLevel,
    version: input.version,
    accessFacts,
  };
  return Object.freeze({
    ...material,
    accessFactsFingerprint: fingerprint("equipment-access-facts-v1", material),
  });
}

export class EquipmentCatalogueService {
  readonly #packs: EquipmentCatalogueServiceOptions["packs"];
  readonly #equipmentPackIds: ReadonlySet<string>;
  readonly #accessRegistry: EquipmentAccessRegistry;
  readonly #packIndexCache = new Map<string, Promise<PackProjectionResult>>();
  readonly #packNormalizationSnapshots = new Map<string, PackNormalizationSnapshot>();
  readonly #lastPackProjectionById = new Map<string, PackProjectionResult>();
  readonly #projectionMaterialSnapshots = new Map<string, ProjectionMaterialSnapshot>();
  readonly #evaluatedEntriesByMaterial = new WeakMap<
    PackProjectionResult,
    Map<string, readonly EquipmentCatalogueEntry[]>
  >();
  readonly #projectionCache = new Map<string, Promise<PackProjectionResult>>();
  readonly #latestCandidateByUuid = new Map<string, NormalizedEquipmentCatalogueCandidate>();
  readonly #previewCache = new Map<string, CachedPreview>();
  readonly #pendingPreviews = new Map<string, PendingPreview>();
  readonly #packGenerations = new Map<string, number>();
  #projectionGeneration = 0;

  constructor(options: EquipmentCatalogueServiceOptions) {
    this.#packs = options.packs;
    this.#equipmentPackIds = new Set(uniqueSorted(options.equipmentPackIds.filter(nonEmpty)));
    if (this.#equipmentPackIds.size !== options.equipmentPackIds.length) {
      throw new TypeError("Equipment catalogue pack IDs must be non-empty and unique.");
    }
    this.#accessRegistry = options.accessRegistry ?? EMPTY_EQUIPMENT_ACCESS_REGISTRY;
  }

  async project(context: EquipmentCatalogueContext): Promise<EquipmentCatalogueProjection> {
    assertContext(context);
    const packIds = uniqueSorted(
      context.policy.sourcePolicy.effectivePackIds.filter((packId) => this.#equipmentPackIds.has(packId))
    );
    const cacheKey = this.#projectionKey(context.policy, packIds);
    let pending = this.#projectionCache.get(cacheKey);
    if (pending === undefined) {
      pending = this.#loadProjectionCandidates(packIds);
      this.#projectionCache.set(cacheKey, pending);
      pending.catch(() => {
        if (this.#projectionCache.get(cacheKey) === pending) this.#projectionCache.delete(cacheKey);
      });
    }
    const loaded = await pending;
    if (!loaded.cacheable && this.#projectionCache.get(cacheKey) === pending) {
      this.#projectionCache.delete(cacheKey);
    }
    if (cacheKey !== this.#projectionKey(context.policy, packIds)) return this.project(context);
    const evaluatedKey = canonicalJson({
      policy: context.policy,
      accessRegistryFingerprint: this.#accessRegistry.fingerprint,
    });
    let evaluatedByPolicy = this.#evaluatedEntriesByMaterial.get(loaded);
    let entries = evaluatedByPolicy?.get(evaluatedKey);
    if (entries === undefined) {
      const sharedAuthority = context.policy.gmJudgments.some((judgment) => judgment.kind === "rarity-source-exception")
        ? null
        : new Map<string, CachedCandidateAuthority>();
      const evaluatedEntries: EquipmentCatalogueEntry[] = [];
      for (let index = 0; index < loaded.candidates.length; index += 1) {
        evaluatedEntries.push(this.#evaluateCandidate(context, loaded.candidates[index]!, null, sharedAuthority));
        if ((index + 1) % LARGE_PACK_NORMALIZATION_CHUNK === 0) await yieldProjectionTask();
      }
      if (evaluatedEntries.length % LARGE_PACK_NORMALIZATION_CHUNK !== 0) await yieldProjectionTask();
      evaluatedEntries.sort(compareEntries);
      if (evaluatedEntries.length > 0) await yieldProjectionTask();
      entries = Object.freeze(evaluatedEntries);
      evaluatedByPolicy ??= new Map();
      setBoundedCache(evaluatedByPolicy, evaluatedKey, entries, PROJECTION_SNAPSHOT_LIMIT);
      this.#evaluatedEntriesByMaterial.set(loaded, evaluatedByPolicy);
    }
    if (cacheKey !== this.#projectionKey(context.policy, packIds)) return this.project(context);
    for (const { candidate } of loaded.candidates) this.#latestCandidateByUuid.set(candidate.sourceUuid, candidate);
    return Object.freeze({
      version: EQUIPMENT_CATALOGUE_PROJECTION_VERSION,
      cacheKey,
      entries,
      diagnostics: Object.freeze([...loaded.diagnostics]),
    });
  }

  async hydratePreview(
    sourceUuid: string,
    context?: EquipmentCatalogueContext
  ): Promise<EquipmentCataloguePreview | null> {
    if (context) assertContext(context);
    const candidate = this.#latestCandidateByUuid.get(sourceUuid);
    if (!candidate) return null;
    const generation = this.#packGeneration(candidate.packId);
    const cached = this.#previewCache.get(sourceUuid);
    if (cached?.previewIdentity === candidate.previewIdentity) {
      return this.#previewResult(sourceUuid, candidate, cached, context);
    }
    let pending = this.#pendingPreviews.get(sourceUuid);
    if (
      pending === undefined ||
      pending.generation !== generation ||
      pending.previewIdentity !== candidate.previewIdentity
    ) {
      const { pack, documentId } = this.#resolvePack(sourceUuid);
      const previewIdentity = candidate.previewIdentity;
      pending = {
        generation,
        previewIdentity,
        promise: pack.getDocument(documentId).then((document) =>
          Object.freeze({
            previewIdentity,
            source: document === null ? null : extractDocumentSource(document),
          })
        ),
      };
      this.#pendingPreviews.set(sourceUuid, pending);
    }
    let next: CachedPreview;
    try {
      next = await pending.promise;
    } finally {
      if (this.#pendingPreviews.get(sourceUuid) === pending) this.#pendingPreviews.delete(sourceUuid);
    }
    const currentCandidate = this.#latestCandidateByUuid.get(sourceUuid);
    if (
      generation !== this.#packGeneration(candidate.packId) ||
      currentCandidate?.previewIdentity !== candidate.previewIdentity
    ) {
      return currentCandidate ? this.hydratePreview(sourceUuid, context) : null;
    }
    this.#previewCache.set(sourceUuid, next);
    return this.#previewResult(sourceUuid, candidate, next, context);
  }

  async resolveForApply(
    context: EquipmentCatalogueContext,
    sourceUuid: string
  ): Promise<EquipmentCatalogueApplyResolution> {
    return this.#resolveHydratedForApply(context, sourceUuid, false);
  }

  /**
   * Concurrently hydrates one bounded visible browse page. Apply, preview, and native-grant
   * callers deliberately keep using their fresh single-document paths.
   */
  async resolveManyForBrowse(
    context: EquipmentCatalogueContext,
    sourceUuids: readonly string[]
  ): Promise<readonly EquipmentCatalogueBrowseResolutionResult[]> {
    return this.#resolveManyForBrowse(context, sourceUuids, false);
  }

  async #resolveManyForBrowse(
    context: EquipmentCatalogueContext,
    sourceUuids: readonly string[],
    forceFresh: boolean
  ): Promise<readonly EquipmentCatalogueBrowseResolutionResult[]> {
    assertContext(context);
    if (sourceUuids.length > 12) {
      throw new TypeError("Equipment browse hydration is limited to 12 visible sources.");
    }
    const requests = sourceUuids.map((sourceUuid) => {
      const { pack, packId, documentId } = this.#resolvePack(sourceUuid);
      if (!this.#equipmentPackIds.has(packId) || !context.policy.sourcePolicy.effectivePackIds.includes(packId)) {
        throw new TypeError(`Equipment source ${sourceUuid} is outside the current effective pack set.`);
      }
      return { sourceUuid, pack, packId, documentId };
    });
    const generations = new Map(
      [...new Set(requests.map(({ packId }) => packId))].map((packId) => [packId, this.#packGeneration(packId)])
    );
    const results = await Promise.all(
      requests.map(async ({ sourceUuid, pack, packId, documentId }) => {
        try {
          const source = forceFresh
            ? await forceFreshBrowseSource(pack, documentId)
            : await pack
                .getDocument(documentId)
                .then((document) => (document === null ? null : extractDocumentSource(document)));
          if (source === null) {
            return Object.freeze({
              sourceUuid,
              resolution: null,
              error: new TypeError(`Equipment source ${sourceUuid} is no longer available.`),
            });
          }
          assertHydratedSourceIdentity(source, documentId);
          return Object.freeze({
            sourceUuid,
            resolution: this.#resolutionFromSource(context, sourceUuid, packId, source),
            error: null,
          });
        } catch (cause) {
          return Object.freeze({
            sourceUuid,
            resolution: null,
            error: browseHydrationError(sourceUuid, cause),
          });
        }
      })
    );
    if (requests.length > 0) await yieldProjectionTask();
    if ([...generations].some(([packId, generation]) => generation !== this.#packGeneration(packId))) {
      return this.#resolveManyForBrowse(context, sourceUuids, true);
    }
    return Object.freeze(results);
  }

  /**
   * Hydrates one exact source for a caller that already proved fixed native-grant authority.
   * This does not add the pack to catalogue projection, search, preview, or ordinary Apply.
   */
  async resolveFixedNativeSourceForApply(
    context: EquipmentCatalogueContext,
    sourceUuid: string,
    authority: FixedNativeEquipmentSourceAuthority
  ): Promise<EquipmentCatalogueApplyResolution> {
    if (authority.kind !== "fixed-native-grant" || sourceUuid !== authority.expectedSourceUuid) {
      throw new TypeError("Fixed native equipment hydration requires exact source authority.");
    }
    const { packId } = this.#resolvePack(sourceUuid);
    if (packId !== authority.expectedPackId) {
      throw new TypeError("Fixed native equipment hydration requires exact pack authority.");
    }
    return this.#resolveHydratedForApply(context, sourceUuid, true);
  }

  async #resolveHydratedForApply(
    context: EquipmentCatalogueContext,
    sourceUuid: string,
    allowOutsideEffectivePackSet: boolean
  ): Promise<EquipmentCatalogueApplyResolution> {
    assertContext(context);
    const { pack, packId, documentId } = this.#resolvePack(sourceUuid);
    if (
      !allowOutsideEffectivePackSet &&
      (!this.#equipmentPackIds.has(packId) || !context.policy.sourcePolicy.effectivePackIds.includes(packId))
    ) {
      throw new TypeError(`Equipment source ${sourceUuid} is outside the current effective pack set.`);
    }
    const document = await pack.getDocument(documentId);
    if (!document) throw new TypeError(`Equipment source ${sourceUuid} is no longer available.`);
    const source = extractDocumentSource(document);
    return this.#resolutionFromSource(context, sourceUuid, packId, source);
  }

  #resolutionFromSource(
    context: EquipmentCatalogueContext,
    sourceUuid: string,
    packId: string,
    source: Readonly<Record<string, unknown>>
  ): EquipmentCatalogueApplyResolution {
    const normalized = normalizeCandidate(source, packId, sourceUuid);
    const evaluated = this.#evaluateCandidate(context, normalized, source);
    return Object.freeze({
      source: cloneData(source),
      candidate: stripEvaluation(evaluated),
      documentFingerprint: fingerprintEquipmentDocument(source),
      priceFingerprint: fingerprint("equipment-price-v1", evaluated.price),
      available: evaluated.available,
      unavailableReasons: evaluated.unavailableReasons,
      policyDecision: evaluated.policyDecision,
    });
  }

  invalidatePack(packId: string): void {
    if (!nonEmpty(packId)) throw new TypeError("Equipment pack invalidation requires a pack ID.");
    this.#projectionGeneration += 1;
    this.#packGenerations.set(packId, this.#packGeneration(packId) + 1);
    this.#projectionCache.clear();
    for (const key of this.#packIndexCache.keys()) {
      if (key.startsWith(`${packId}|`)) this.#packIndexCache.delete(key);
    }
    for (const [sourceUuid, candidate] of this.#latestCandidateByUuid) {
      if (candidate.packId === packId) this.#latestCandidateByUuid.delete(sourceUuid);
    }
    for (const sourceUuid of this.#previewCache.keys()) {
      if (parseCompendiumItemUuid(sourceUuid).packId === packId) this.#previewCache.delete(sourceUuid);
    }
    for (const sourceUuid of this.#pendingPreviews.keys()) {
      if (parseCompendiumItemUuid(sourceUuid).packId === packId) this.#pendingPreviews.delete(sourceUuid);
    }
  }

  #projectionKey(policy: EffectiveEquipmentPolicySnapshotV1, packIds: readonly string[]): string {
    return canonicalJson({
      version: EQUIPMENT_CATALOGUE_PROJECTION_VERSION,
      packIds,
      policyFingerprint: policy.fingerprint,
      accessRegistryFingerprint: this.#accessRegistry.fingerprint,
      invalidationGeneration: this.#projectionGeneration,
    });
  }

  async #loadProjectionCandidates(packIds: readonly string[]): Promise<PackProjectionResult> {
    const byPack = await Promise.all(packIds.map((packId) => this.#loadPackCandidates(packId)));
    const materialKey = packIds.join("\u0000");
    const materialSnapshot = this.#projectionMaterialSnapshots.get(materialKey);
    if (
      materialSnapshot &&
      materialSnapshot.packResults.length === byPack.length &&
      materialSnapshot.packResults.every((result, index) => result === byPack[index])
    ) {
      await yieldProjectionTask();
      return materialSnapshot.result;
    }
    const diagnostics = byPack.flatMap((result) => result.diagnostics);
    const candidates: CachedProjectionCandidate[] = [];
    const seen = new Set<string>();
    const loadedCandidates = byPack.flatMap((result) => result.candidates);
    for (let index = 0; index < loadedCandidates.length; index += 1) {
      const { candidate, reasons } = loadedCandidates[index]!;
      if (seen.has(candidate.sourceUuid)) {
        diagnostics.push(
          sourceDiagnostic(
            "duplicate-equipment-source-identity",
            candidate.packId,
            candidate.sourceUuid,
            `Equipment source identity ${candidate.sourceUuid} occurs more than once; only the first record was retained.`
          )
        );
      } else {
        seen.add(candidate.sourceUuid);
        candidates.push({ candidate, reasons });
      }
      if ((index + 1) % LARGE_PACK_NORMALIZATION_CHUNK === 0) await yieldProjectionTask();
    }
    if (loadedCandidates.length % LARGE_PACK_NORMALIZATION_CHUNK !== 0) await yieldProjectionTask();
    const result = Object.freeze({
      candidates: Object.freeze(candidates),
      diagnostics: Object.freeze(sortEquipmentSourceDiagnostics(diagnostics)),
      cacheable: byPack.every((result) => result.cacheable),
    });
    if (result.cacheable) {
      setBoundedCache(
        this.#projectionMaterialSnapshots,
        materialKey,
        Object.freeze({ packResults: Object.freeze([...byPack]), result }),
        PROJECTION_SNAPSHOT_LIMIT
      );
    }
    return result;
  }

  #loadPackCandidates(packId: string): Promise<PackProjectionResult> {
    const key = `${packId}|${this.#packGeneration(packId)}`;
    let pending = this.#packIndexCache.get(key);
    if (pending !== undefined) return pending;
    const pack = this.#packs.get(packId);
    if (!pack) {
      return Promise.resolve(
        projectionFailure(
          sourceDiagnostic(
            "equipment-pack-missing",
            packId,
            null,
            `Configured equipment pack ${packId} is not installed or is unavailable to the current user.`
          )
        )
      );
    }
    const documentName = pack.documentName ?? pack.metadata?.type;
    if (documentName !== undefined && documentName !== "Item") {
      return Promise.resolve(
        projectionFailure(
          sourceDiagnostic(
            "equipment-pack-not-item",
            packId,
            null,
            `Configured equipment pack ${packId} is not an Item compendium and was excluded.`
          )
        )
      );
    }
    const normalizationSnapshot =
      pack.indexEntryIdentity === "stable-replacement"
        ? (this.#packNormalizationSnapshots.get(packId) ?? new WeakMap())
        : null;
    if (normalizationSnapshot) this.#packNormalizationSnapshots.set(packId, normalizationSnapshot);
    const generation = this.#packGeneration(packId);
    pending = loadPackProjection(pack, packId, normalizationSnapshot).then((result) => {
      if (!result.cacheable || generation !== this.#packGeneration(packId)) return result;
      const previous = this.#lastPackProjectionById.get(packId);
      if (previous && packProjectionEqual(previous, result)) return previous;
      this.#lastPackProjectionById.set(packId, result);
      return result;
    });
    this.#packIndexCache.set(key, pending);
    void pending.then(
      (result) => {
        if (!result.cacheable && this.#packIndexCache.get(key) === pending) this.#packIndexCache.delete(key);
      },
      () => {
        if (this.#packIndexCache.get(key) === pending) this.#packIndexCache.delete(key);
      }
    );
    return pending;
  }

  #evaluateCandidate(
    context: EquipmentCatalogueContext,
    normalized: CachedProjectionCandidate,
    source: Readonly<Record<string, unknown>> | null = null,
    sharedAuthority: Map<string, CachedCandidateAuthority> | null = null
  ): EquipmentCatalogueEntry {
    const candidate = normalized.candidate;
    const sharedKey =
      source === null && sharedAuthority !== null
        ? `${candidate.packId}\u0000${candidate.publicationSlug}\u0000${candidate.rarity}`
        : null;
    let evaluated = sharedKey === null ? undefined : sharedAuthority?.get(sharedKey);
    if (evaluated === undefined) {
      const blanketAuthorized = rarityAtOrBelow(candidate.rarity, context.policy.rarityPolicy.blanketCeiling);
      const characterAccessRef =
        blanketAuthorized || source === null
          ? null
          : this.#accessRegistry.resolve({
              actor: context.actor,
              draft: cloneAccessDraft(context.draft),
              candidate,
              source: cloneData(source),
            });
      const exceptionIds = resolveEquipmentItemExceptionJudgmentIds({
        policy: context.policy,
        sourceUuid: candidate.sourceUuid,
        packId: candidate.packId,
        publicationSlug: candidate.publicationSlug,
        rarity: candidate.rarity,
      });
      const authority = evaluateEquipmentItemAuthority({
        policy: context.policy,
        sourceUuid: candidate.sourceUuid,
        packId: candidate.packId,
        publicationSlug: candidate.publicationSlug,
        rarity: candidate.rarity,
        hasCharacterAccess: characterAccessRef !== null,
        ...exceptionIds,
      });
      evaluated = Object.freeze({ characterAccessRef, exceptionIds, authority });
      if (sharedKey !== null) sharedAuthority?.set(sharedKey, evaluated);
    }
    const { characterAccessRef, exceptionIds, authority } = evaluated;
    const policyReasons = authority.reasons.flatMap((code) => authorityReason(code));
    const unavailableReasons = dedupeReasons([...normalized.reasons, ...policyReasons]);
    const policyDecision: AcquisitionLinePolicyDecision = Object.freeze({
      eligible: authority.eligible && normalized.reasons.length === 0,
      packId: candidate.packId,
      publicationSlug: candidate.publicationSlug,
      rarity: candidate.rarity,
      sourceBasis: exceptionIds.sourceExceptionJudgmentId
        ? "gm-source-exception"
        : authority.reasons.includes("source-not-allowed")
          ? "source-not-allowed"
          : "approved-pack",
      rarityBasis:
        candidate.rarity === "common"
          ? "common"
          : exceptionIds.rarityExceptionJudgmentId
            ? "gm-rarity-exception"
            : characterAccessRef
              ? "specific-character-access"
              : `blanket-${context.policy.rarityPolicy.blanketCeiling}`,
      characterAccessRef,
      ...exceptionIds,
      abpTreatment: context.policy.abp.enabled ? `abp-${context.policy.abp.mode ?? "enabled"}` : "unchanged",
    });
    return Object.freeze({
      ...candidate,
      available: policyDecision.eligible,
      unavailableReasons: Object.freeze(unavailableReasons),
      policyDecision,
    });
  }

  #resolvePack(sourceUuid: string): {
    readonly pack: EquipmentCataloguePackLike;
    readonly packId: string;
    readonly documentId: string;
  } {
    const { packId, documentId } = parseCompendiumItemUuid(sourceUuid);
    const pack = this.#packs.get(packId);
    if (!pack) throw new TypeError(`Equipment pack ${packId} is unavailable.`);
    return { pack, packId, documentId };
  }

  #packGeneration(packId: string): number {
    return this.#packGenerations.get(packId) ?? 0;
  }

  #previewResult(
    sourceUuid: string,
    indexedCandidate: NormalizedEquipmentCatalogueCandidate,
    cached: CachedPreview,
    context?: EquipmentCatalogueContext
  ): EquipmentCataloguePreview {
    const source = cached.source === null ? null : cloneData(cached.source);
    const current = source === null ? null : normalizeCandidate(source, indexedCandidate.packId, sourceUuid);
    return Object.freeze({
      sourceUuid,
      previewIdentity: cached.previewIdentity,
      source,
      entry: context && current ? this.#evaluateCandidate(context, current, source) : null,
    });
  }
}

export function createEquipmentCatalogueService(options: EquipmentCatalogueServiceOptions): EquipmentCatalogueService {
  return new EquipmentCatalogueService(options);
}

async function loadPackProjection(
  pack: EquipmentCataloguePackLike,
  packId: string,
  normalizationSnapshot: PackNormalizationSnapshot | null
): Promise<PackProjectionResult> {
  let index: Iterable<unknown> | null | undefined;
  try {
    index = await pack.getIndex({ fields: [...INDEX_FIELDS] });
  } catch {
    return projectionFailure(
      sourceDiagnostic(
        "equipment-pack-index-failed",
        packId,
        null,
        `Equipment pack ${packId} could not be indexed. Check the installed package and retry.`
      ),
      false
    );
  }
  if (!isIterable(index)) {
    return projectionFailure(
      sourceDiagnostic(
        "equipment-pack-index-corrupt",
        packId,
        null,
        `Equipment pack ${packId} returned a malformed index and was excluded.`
      )
    );
  }
  let entries: unknown[];
  try {
    entries = Array.from(index);
  } catch {
    return projectionFailure(
      sourceDiagnostic(
        "equipment-pack-index-corrupt",
        packId,
        null,
        `Equipment pack ${packId} returned an unreadable index and was excluded.`
      )
    );
  }
  const candidates: CachedProjectionCandidate[] = [];
  const diagnostics: EquipmentSourceDiagnostic[] = [];
  let normalizationWork = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const witness = isRecord(entry) ? indexNormalizationWitness(entry) : null;
    const cached = isRecord(entry) ? normalizationSnapshot?.get(entry) : undefined;
    if (cached && witness !== null && cached.witness === witness) {
      candidates.push(cached.candidate);
      continue;
    }
    const normalized = normalizeIndexEntry(
      entry,
      packId,
      index,
      pack.indexedBrowsePricing === "pf2e-physical-source-v1"
    );
    if ("diagnostic" in normalized) diagnostics.push(normalized.diagnostic);
    else {
      candidates.push(normalized.candidate);
      if (isRecord(entry) && witness !== null) {
        normalizationSnapshot?.set(entry, Object.freeze({ candidate: normalized.candidate, witness }));
      }
    }
    normalizationWork += 1;
    if (normalizationWork % LARGE_PACK_NORMALIZATION_CHUNK === 0) await yieldProjectionTask();
  }
  if (normalizationWork % LARGE_PACK_NORMALIZATION_CHUNK !== 0) await yieldProjectionTask();
  return Object.freeze({
    candidates: Object.freeze(candidates),
    diagnostics: Object.freeze(sortEquipmentSourceDiagnostics(diagnostics)),
    cacheable: true,
  });
}

function indexNormalizationWitness(source: Readonly<Record<string, unknown>>): string | null {
  const system = record(source.system);
  const traits = record(system.traits);
  const publication = record(system.publication);
  const legacySource = record(system.source);
  const price = record(system.price);
  const rules = Array.isArray(system.rules) ? system.rules : null;
  return exactNormalizationWitness([
    source._id,
    source.uuid,
    source.name,
    source.img,
    source.type,
    record(system.level).value,
    traits.rarity,
    traits.value,
    traits.otherTags,
    publication.title,
    legacySource.value,
    price.value,
    price.per,
    price.sizeSensitive,
    system.quantity,
    rules?.map((rule) => record(rule).key) ?? null,
    system.runes,
    system.material,
    system.specific,
    system.subitems,
  ]);
}

function exactNormalizationWitness(value: unknown, ancestors = new Set<object>()): string | null {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${value.length}:${value}`;
  if (typeof value === "boolean") return value ? "boolean:true" : "boolean:false";
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "bigint") return `bigint:${String(value)}`;
  if (typeof value === "symbol") return `symbol:${String(value.description)}`;
  if (typeof value === "function") return "function";
  const objectValue = value as object;
  if (ancestors.has(objectValue)) return null;
  ancestors.add(objectValue);
  const source = value as Record<string, unknown>;
  const result = Array.isArray(value)
    ? witnessSequence("array", value, ancestors)
    : witnessSequence(
        "record",
        Object.keys(source)
          .sort((left, right) => left.localeCompare(right))
          .flatMap((key) => [key, source[key]]),
        ancestors
      );
  ancestors.delete(objectValue);
  return result;
}

function witnessSequence(kind: "array" | "record", values: readonly unknown[], ancestors: Set<object>): string | null {
  const parts: string[] = [];
  for (const value of values) {
    const part = exactNormalizationWitness(value, ancestors);
    if (part === null) return null;
    parts.push(`${part.length}:${part}`);
  }
  return `${kind}:${values.length}:${parts.join("")}`;
}

function normalizeIndexEntry(
  entry: unknown,
  packId: string,
  index: number,
  allowIndexedBrowsePriceFacts: boolean
): { readonly candidate: CachedProjectionCandidate } | { readonly diagnostic: EquipmentSourceDiagnostic } {
  const value = record(entry);
  const sourceIdentity = indexSourceIdentity(value, packId, index);
  const documentId = nonEmpty(value._id) ? value._id.trim() : documentIdFromUuid(value.uuid, packId);
  const uuidIdentity = nonEmpty(value.uuid) ? parseOptionalCompendiumItemUuid(value.uuid) : null;
  if (
    !documentId ||
    (nonEmpty(value.uuid) &&
      (!uuidIdentity || uuidIdentity.packId !== packId || uuidIdentity.documentId !== documentId))
  ) {
    return {
      diagnostic: sourceDiagnostic(
        "equipment-source-identity-corrupt",
        packId,
        sourceIdentity,
        `Equipment pack ${packId} contains a record with a missing or contradictory Item identity (${sourceIdentity}).`
      ),
    };
  }
  return {
    candidate: normalizeCandidate(
      value,
      packId,
      `Compendium.${packId}.Item.${documentId}`,
      documentId,
      allowIndexedBrowsePriceFacts
    ),
  };
}

function projectionFailure(diagnostic: EquipmentSourceDiagnostic, cacheable = true): PackProjectionResult {
  return Object.freeze({ candidates: Object.freeze([]), diagnostics: Object.freeze([diagnostic]), cacheable });
}

function normalizeCandidate(
  source: unknown,
  packId: string,
  sourceUuid: string,
  knownDocumentId?: string,
  allowIndexedBrowsePriceFacts = false
): NormalizationResult {
  const value = record(source);
  const system = record(value.system);
  const traitsRoot = record(system.traits);
  const rulesValid = Array.isArray(system.rules);
  const rawRules: unknown[] = Array.isArray(system.rules) ? system.rules : [];
  const ruleKeys = uniqueSorted(
    rawRules.map((rule) => {
      const value = record(rule);
      return nonEmpty(value.key) ? value.key : "<unknown>";
    })
  );
  const itemType = nonEmpty(value.type) ? value.type.trim().toLowerCase() : "unknown";
  const qualifiedKit = sourceUuid === ADVENTURERS_PACK_UUID && itemType === "kit";
  const rarity = qualifiedKit ? "common" : equipmentRarity(traitsRoot.rarity);
  const publication = record(system.publication);
  const legacySource = record(system.source);
  const publicationSlug = slugify(
    nonEmpty(publication.title) ? publication.title : nonEmpty(legacySource.value) ? legacySource.value : ""
  );
  const price = normalizePrice(system);
  const indexedBrowsePriceFacts = allowIndexedBrowsePriceFacts
    ? normalizeIndexedBrowsePriceFacts(system, traitsRoot, itemType, price)
    : null;
  const level = qualifiedKit ? 0 : nonNegativeInteger(record(system.level).value);
  const reasons: EquipmentCatalogueUnavailableReason[] = [];
  if (itemType === "treasure") {
    reasons.push(reason("treasure-excluded", "Treasure is excluded from equipment acquisition."));
  } else if (CONTAINER_ITEM_TYPES.has(itemType) && !qualifiedKit) {
    reasons.push(reason("container-or-kit-excluded", "Kits are not supported in this catalogue."));
  } else if (!PHYSICAL_ITEM_TYPES.has(itemType) && !qualifiedKit) {
    reasons.push(reason("item-type-unsupported", `Item type ${itemType} is not supported for equipment acquisition.`));
  }
  if (price.kind === "missing") reasons.push(reason("price-missing", "This item has no indexed base Price."));
  if (price.kind === "unparseable") {
    reasons.push(reason("price-unparseable", "This item's indexed base Price cannot be parsed safely."));
  }
  if (level === null) {
    reasons.push(reason("level-unparseable", "This item's indexed level is missing or invalid."));
  }
  if (rarity === null) {
    reasons.push(reason("rarity-unparseable", "This item's indexed rarity is missing or invalid."));
  }
  if (!rulesValid) {
    reasons.push(reason("rules-unparseable", "This item's indexed rule-element list is missing or invalid."));
  }
  const interactiveKeys = ruleKeys.filter((key) => INTERACTIVE_RULE_KEYS.has(key) || key === "<unknown>");
  if (interactiveKeys.length > 0) {
    reasons.push(
      reason(
        "interactive-rule-unsupported",
        `Interactive rule elements are not supported: ${interactiveKeys.join(", ")}.`
      )
    );
  }
  const parsedUuid = knownDocumentId ? { packId, documentId: knownDocumentId } : parseCompendiumItemUuid(sourceUuid);
  if (parsedUuid.packId !== packId) throw new TypeError(`Equipment source ${sourceUuid} does not belong to ${packId}.`);
  const candidateMaterial = {
    sourceUuid,
    packId,
    documentId: parsedUuid.documentId,
    name: nonEmpty(value.name) ? value.name.trim() : "Unnamed equipment",
    img: nonEmpty(value.img) ? value.img.trim() : "",
    itemType,
    level: level ?? 0,
    rarity: rarity ?? "unique",
    publicationSlug,
    price,
    indexedBrowsePriceFacts,
    traits: Object.freeze(uniqueSorted(stringArray(traitsRoot.value).map((trait) => trait.toLowerCase()))),
    ruleKeys: Object.freeze(ruleKeys),
  };
  const candidate: NormalizedEquipmentCatalogueCandidate = Object.freeze({
    ...candidateMaterial,
    previewIdentity: fingerprintEquipmentPreview(candidateMaterial),
  });
  return Object.freeze({ candidate, reasons: Object.freeze(reasons) });
}

function normalizePrice(system: Record<string, unknown>): NormalizedEquipmentPrice {
  if (!isRecord(system.price) || system.price.value === null || system.price.value === undefined) {
    return Object.freeze({ kind: "missing", value: null, copperValue: null, per: 1, sourceQuantity: 1 });
  }
  const price = record(system.price);
  const per = positiveInteger(price.per, 1);
  const sourceQuantity = positiveInteger(system.quantity, 1);
  const value = normalizeCoinValue(price.value);
  if (!value || per === null || sourceQuantity === null) {
    return Object.freeze({
      kind: "unparseable",
      value: null,
      copperValue: null,
      per: per ?? 1,
      sourceQuantity: sourceQuantity ?? 1,
    });
  }
  const copperValue = DENOMINATIONS.reduce((total, denomination) => {
    return total + (value[denomination] ?? 0) * COPPER_VALUE[denomination];
  }, 0);
  if (!Number.isSafeInteger(copperValue)) {
    return Object.freeze({ kind: "unparseable", value: null, copperValue: null, per, sourceQuantity });
  }
  return Object.freeze({ kind: "priced", value: Object.freeze(value), copperValue, per, sourceQuantity });
}

function normalizeIndexedBrowsePriceFacts(
  system: Record<string, unknown>,
  traitsRoot: Record<string, unknown>,
  itemType: string,
  price: NormalizedEquipmentPrice
): IndexedEquipmentBrowsePriceFacts | null {
  if (price.kind !== "priced") return null;
  const rules = system.rules;
  if (!Array.isArray(rules) || rulesCanAlterOwnPrice(rules, itemType)) return null;
  const subitems = system.subitems;
  if (subitems !== undefined && subitems !== null && (!Array.isArray(subitems) || subitems.length > 0)) return null;
  if (hasConfiguredPricing(system, itemType)) return null;
  const traits = new Set(stringArray(traitsRoot.value).map((trait) => trait.toLowerCase()));
  const otherTags = traitsRoot.otherTags;
  if (otherTags !== undefined && otherTags !== null && !Array.isArray(otherTags)) return null;
  if (stringArray(otherTags).some((tag) => tag.toLowerCase() === "shoddy")) return null;
  const rawSizeSensitive = record(system.price).sizeSensitive;
  if (["arcane", "divine", "magical", "occult", "primal", "tech"].some((trait) => traits.has(trait))) {
    return Object.freeze({ sizeSensitive: false });
  }
  if (typeof rawSizeSensitive === "boolean") return Object.freeze({ sizeSensitive: rawSizeSensitive });
  return Object.freeze({ sizeSensitive: true });
}

/**
 * PF2E derives physical-item price from source price, size, material, grade, runes,
 * specific-item state, and shoddy state. Ordinary actor rule elements do not rewrite
 * those item fields. ItemAlteration is the one rule family that can mutate an item;
 * it is browse-price-neutral only when its explicit target type excludes this source.
 */
function rulesCanAlterOwnPrice(rules: readonly unknown[], itemType: string): boolean {
  return rules.some((rawRule) => {
    const rule = record(rawRule);
    if (rule.key !== "ItemAlteration") return false;
    return !nonEmpty(rule.itemType) || rule.itemType.trim().toLowerCase() === itemType;
  });
}

function hasConfiguredPricing(system: Record<string, unknown>, itemType: string): boolean {
  const material = record(system.material);
  if (nonEmpty(material.type) || nonEmpty(material.grade)) return true;
  if (system.specific !== undefined && system.specific !== null && system.specific !== false) return true;
  if (itemType !== "weapon" && itemType !== "armor" && itemType !== "shield") return false;
  return hasMeaningfulConfigurationValue(system.runes);
}

function hasMeaningfulConfigurationValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") return false;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulConfigurationValue);
  if (!isRecord(value)) return true;
  return Object.values(value).some(hasMeaningfulConfigurationValue);
}

function normalizeCoinValue(raw: unknown): Partial<Record<EquipmentDenomination, number>> | null {
  if (typeof raw === "string") return parseCoinString(raw);
  if (!isRecord(raw)) return null;
  const normalized: Partial<Record<EquipmentDenomination, number>> = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    if (!DENOMINATIONS.includes(key as EquipmentDenomination)) return null;
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < 0) return null;
    normalized[key as EquipmentDenomination] = value;
  }
  return normalized;
}

function parseCoinString(raw: string): Partial<Record<EquipmentDenomination, number>> | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const normalized: Partial<Record<EquipmentDenomination, number>> = {};
  const pattern = /(\d+)\s*(pp|gp|sp|cp)/g;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matched = true;
    const denomination = match[2] as EquipmentDenomination;
    const value = Number(match[1]);
    const total = (normalized[denomination] ?? 0) + value;
    if (!Number.isSafeInteger(total)) return null;
    normalized[denomination] = total;
  }
  if (!matched || text.replace(pattern, "").replace(/[,+\s]/g, "") !== "") return null;
  return normalized;
}

function assertContext(context: EquipmentCatalogueContext): void {
  const actor = record(context.actor);
  if (!nonEmpty(actor.id) || actor.id !== context.policy.actorId) {
    throw new TypeError("Equipment catalogue actor does not match the effective policy subject.");
  }
  if (
    !nonEmpty(context.draft.draftId) ||
    context.draft.draftId !== context.policy.draftId ||
    context.draft.targetLevel !== context.policy.targetLevel ||
    context.draft.accessFactsFingerprint !==
      createEquipmentCatalogueDraftContext({
        draftId: context.draft.draftId,
        targetLevel: context.draft.targetLevel,
        version: context.draft.version,
        accessFacts: context.draft.accessFacts,
      }).accessFactsFingerprint
  ) {
    throw new TypeError("Equipment catalogue draft does not match the effective policy subject.");
  }
}

function cloneAccessDraft(draft: EquipmentCatalogueDraftContext): EquipmentCatalogueDraftContext {
  return createEquipmentCatalogueDraftContext({
    draftId: draft.draftId,
    targetLevel: draft.targetLevel,
    version: draft.version,
    accessFacts: draft.accessFacts,
  });
}

function rarityAtOrBelow(rarity: EquipmentRarity, ceiling: EquipmentRarity): boolean {
  const order: readonly EquipmentRarity[] = ["common", "uncommon", "rare", "unique"];
  return order.indexOf(rarity) <= order.indexOf(ceiling);
}

function authorityReason(code: string): EquipmentCatalogueUnavailableReason[] {
  if (code === "source-not-allowed") {
    return [reason("source-not-allowed", "This equipment source is not allowed by the current world policy.")];
  }
  if (code === "rarity-not-available") {
    return [
      reason(
        "rarity-not-available",
        "This item's rarity is not available through policy or a registered character Access profile."
      ),
    ];
  }
  return [];
}

function reason(
  code: EquipmentCatalogueUnavailableReason["code"],
  message: string
): EquipmentCatalogueUnavailableReason {
  return Object.freeze({ code, message });
}

function dedupeReasons(reasons: readonly EquipmentCatalogueUnavailableReason[]): EquipmentCatalogueUnavailableReason[] {
  const byCode = new Map(reasons.map((entry) => [entry.code, entry]));
  return [...byCode.values()];
}

function stripEvaluation(entry: EquipmentCatalogueEntry): NormalizedEquipmentCatalogueCandidate {
  return Object.freeze({
    sourceUuid: entry.sourceUuid,
    packId: entry.packId,
    documentId: entry.documentId,
    name: entry.name,
    img: entry.img,
    itemType: entry.itemType,
    level: entry.level,
    rarity: entry.rarity,
    publicationSlug: entry.publicationSlug,
    price: entry.price,
    indexedBrowsePriceFacts: entry.indexedBrowsePriceFacts,
    traits: entry.traits,
    ruleKeys: entry.ruleKeys,
    previewIdentity: entry.previewIdentity,
  });
}

function extractDocumentSource(document: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(document)) throw new TypeError("Equipment document hydration returned malformed data.");
  const toObject = document.toObject;
  const raw =
    typeof toObject === "function"
      ? (toObject as (source?: boolean) => unknown).call(document, true)
      : isRecord(document._source)
        ? document._source
        : document;
  if (!isRecord(raw)) throw new TypeError("Equipment document has no serializable source.");
  return cloneData(raw);
}

function browseHydrationError(sourceUuid: string, cause: unknown): Error {
  const detail = cause instanceof Error && nonEmpty(cause.message) ? ` ${cause.message}` : "";
  return new TypeError(`Equipment source ${sourceUuid} could not be hydrated for browse.${detail}`);
}

async function forceFreshBrowseSource(
  pack: EquipmentCataloguePackLike,
  documentId: string
): Promise<Readonly<Record<string, unknown>> | null> {
  if (typeof pack.getDocuments !== "function" || typeof pack.set !== "function" || typeof pack.delete !== "function") {
    throw new TypeError("Equipment pack cannot safely refresh an invalidated browse source.");
  }
  const documents = await pack.getDocuments.call(pack, { _id: documentId });
  if (!isIterable(documents)) throw new TypeError("Equipment pack refresh returned malformed data.");
  const exact = [...documents];
  if (exact.length > 1) throw new TypeError("Equipment pack refresh returned duplicate exact source identity.");
  const document = exact[0];
  if (document === undefined) {
    pack.delete.call(pack, documentId);
    return null;
  }
  const source = extractDocumentSource(document);
  assertHydratedSourceIdentity(source, documentId);
  pack.set.call(pack, documentId, document);
  return source;
}

function assertHydratedSourceIdentity(source: Readonly<Record<string, unknown>>, expectedDocumentId: string): void {
  if (!nonEmpty(source._id) || source._id.trim() !== expectedDocumentId) {
    throw new TypeError("Equipment browse hydration returned contradictory document identity.");
  }
}

function parseCompendiumItemUuid(sourceUuid: string): { readonly packId: string; readonly documentId: string } {
  const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(sourceUuid);
  if (!match) throw new TypeError(`Equipment source UUID is not an exact Compendium Item UUID: ${sourceUuid}.`);
  return { packId: match[1]!, documentId: match[2]! };
}

function documentIdFromUuid(raw: unknown, packId: string): string | null {
  if (!nonEmpty(raw)) return null;
  const parsed = parseOptionalCompendiumItemUuid(raw);
  return parsed?.packId === packId ? parsed.documentId : null;
}

function parseOptionalCompendiumItemUuid(raw: string): { readonly packId: string; readonly documentId: string } | null {
  try {
    return parseCompendiumItemUuid(raw);
  } catch {
    return null;
  }
}

function indexSourceIdentity(value: Record<string, unknown>, packId: string, index: number): string {
  if (nonEmpty(value.uuid)) return value.uuid.trim();
  if (nonEmpty(value._id)) return `Compendium.${packId}.Item.${value._id.trim()}`;
  return `${packId}#index-${index}`;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  if (value === null || value === undefined) return false;
  return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function";
}

function equipmentRarity(raw: unknown): EquipmentRarity | null {
  return raw === "common" || raw === "uncommon" || raw === "rare" || raw === "unique" ? raw : null;
}

function positiveInteger(raw: unknown, fallback: number): number | null {
  if (raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => nonEmpty(value)).map((value) => value.trim()) : [];
}

function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareEntries(left: EquipmentCatalogueEntry, right: EquipmentCatalogueEntry): number {
  return (
    left.level - right.level || left.name.localeCompare(right.name) || left.sourceUuid.localeCompare(right.sourceUuid)
  );
}

function packProjectionEqual(left: PackProjectionResult, right: PackProjectionResult): boolean {
  return (
    left.candidates.length === right.candidates.length &&
    left.candidates.every((candidate, index) => candidate === right.candidates[index]) &&
    left.diagnostics.length === right.diagnostics.length &&
    left.diagnostics.every((diagnostic, index) => equipmentDiagnosticEqual(diagnostic, right.diagnostics[index]))
  );
}

function equipmentDiagnosticEqual(
  left: EquipmentSourceDiagnostic,
  right: EquipmentSourceDiagnostic | undefined
): boolean {
  return (
    right !== undefined &&
    left.code === right.code &&
    left.packId === right.packId &&
    left.sourceIdentity === right.sourceIdentity &&
    left.message === right.message
  );
}

function setBoundedCache<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

function fingerprintEquipmentPreview(
  candidate: Omit<NormalizedEquipmentCatalogueCandidate, "previewIdentity">
): string {
  const price = candidate.price;
  let hash = 0x811c9dc5;
  hash = hashFingerprintPart(hash, candidate.sourceUuid);
  hash = hashFingerprintPart(hash, candidate.name);
  hash = hashFingerprintPart(hash, candidate.img);
  hash = hashFingerprintPart(hash, candidate.itemType);
  hash = hashFingerprintPart(hash, candidate.level);
  hash = hashFingerprintPart(hash, candidate.rarity);
  hash = hashFingerprintPart(hash, candidate.publicationSlug);
  hash = hashFingerprintPart(hash, price.kind);
  hash = hashFingerprintPart(hash, price.value?.pp ?? null);
  hash = hashFingerprintPart(hash, price.value?.gp ?? null);
  hash = hashFingerprintPart(hash, price.value?.sp ?? null);
  hash = hashFingerprintPart(hash, price.value?.cp ?? null);
  hash = hashFingerprintPart(hash, price.copperValue);
  hash = hashFingerprintPart(hash, price.per);
  hash = hashFingerprintPart(hash, price.sourceQuantity);
  hash = hashFingerprintPart(
    hash,
    candidate.indexedBrowsePriceFacts
      ? candidate.indexedBrowsePriceFacts.sizeSensitive
        ? "size-sensitive"
        : "fixed-size"
      : null
  );
  for (const trait of candidate.traits) hash = hashFingerprintPart(hash, trait);
  hash = hashFingerprintPart(hash, null);
  for (const ruleKey of candidate.ruleKeys) hash = hashFingerprintPart(hash, ruleKey);
  return `equipment-preview-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function yieldProjectionTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function fingerprint(prefix: string, value: unknown): string {
  return fingerprintText(prefix, canonicalJson(value));
}

function fingerprintText(prefix: string, text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hashFingerprintPart(hash: number, part: string | number | null): number {
  const text = part === null ? "" : String(part);
  const length = String(text.length);
  for (let index = 0; index < length.length; index += 1) {
    hash ^= length.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= 58;
  hash = Math.imul(hash, 0x01000193);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
