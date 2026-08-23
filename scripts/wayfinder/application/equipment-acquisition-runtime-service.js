import { MODULE_ID } from "../../constants.js";
import { cloneData } from "../../shared/cloning.js";
import { resolveUuid } from "../../shared/foundry-compat.js";
import { acquisitionPolicyMaterialMatches, createAcquisitionPolicySnapshot, invalidateAcquisitionReview, normalizeAcquisitionDraft, recordPlannedClassGrants, } from "../domain/acquisition-draft.js";
import { mintAcquisitionLineId } from "../domain/acquisition-identity.js";
import { createAcquisitionPriceSnapshot } from "../domain/acquisition-ledger.js";
import { assertPreparedClassGrantPlanMatches, evaluateTitanMaulerCandidate, normalizePlannedClassGrant, titanMaulerTargetSize, } from "../domain/class-grant-reconciliation.js";
import { clampStartingEquipmentResultWindow, STARTING_EQUIPMENT_RESULT_WINDOW, } from "../starting-equipment-result-window.js";
import { buildTitanMaulerCandidate, titanMaulerGrantIdForDraft } from "./class-grant-projection-service.js";
import { isBrowsePhysicalBatchSafeSource, prepareTransientBrowsePhysicalItems, } from "./equipment-browse-preparation-service.js";
import { buildEquipmentCatalogueFacetOptions, buildEquipmentCatalogueLevelFacet, equipmentCatalogueSourceLabel, isTitanMaulerEligibleEntry, matchesEquipmentCatalogueFilters, normalizeEquipmentCatalogueFilters, } from "./equipment-catalogue-filters.js";
import { createEquipmentCatalogueDraftContext, createEquipmentCatalogueService, EMPTY_EQUIPMENT_ACCESS_REGISTRY, } from "./equipment-catalogue-service.js";
import { resolveCurrentEquipmentSourceDiagnostics, resolveEquipmentPolicyForActor, } from "./equipment-policy-service.js";
import { createEquipmentPreviewProjector } from "./equipment-preview-projector.js";
import { materializedPhysicalItemSize, prepareTransientDraftedEquipmentActor, resolvePreparedDraftedEquipmentSize, } from "./equipment-size-preparation-service.js";
import { sortEquipmentSourceDiagnostics } from "./equipment-source-policy.js";
import { isQualifiedKitSource, prepareAdventurersPackExpansion } from "./pf2e-kit-adapter.js";
import { registerStartingEquipmentUiAdapter, } from "./starting-equipment-ui-adapter.js";
export const DEFAULT_BROWSE_PREPARED_RECORD_CACHE_LIMIT = STARTING_EQUIPMENT_RESULT_WINDOW.maximumSize * 2 + STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize;
export const DEFAULT_DRAFTED_EQUIPMENT_SIZE_CACHE_LIMIT = 32;
export class ConfiguredItemHandoffRequiredError extends Error {
    reason;
    constructor(reason) {
        super(`${reason.itemName} requires an explicit PF2E inventory-sheet handoff.`);
        this.name = "ConfiguredItemHandoffRequiredError";
        this.reason = cloneData(reason);
    }
}
export class EquipmentSourceHealthError extends Error {
    diagnostics;
    constructor(diagnostics) {
        super("Approved equipment sources are unavailable or inconsistent. Ask your GM to review them.");
        this.name = "EquipmentSourceHealthError";
        this.diagnostics = Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
    }
}
class UnsupportedPreparedPriceError extends TypeError {
    constructor(message) {
        super(message);
        this.name = "UnsupportedPreparedPriceError";
    }
}
export function commitTitanMaulerLineSynchronization(args) {
    if (args.draft.acquisition !== args.expectedAcquisition ||
        args.currentDraftFingerprint !== args.expectedDraftFingerprint) {
        return false;
    }
    if (args.result.changed)
        args.draft.acquisition = args.result.acquisition;
    return true;
}
export function createEquipmentAcquisitionRuntime(options) {
    const accessRegistry = options.accessRegistry ?? EMPTY_EQUIPMENT_ACCESS_REGISTRY;
    const resolveEffectivePolicy = options.resolveEffectivePolicy ?? resolveCurrentEffectivePolicy;
    const resolveSourceDiagnostics = options.resolveSourceDiagnostics ?? ((policy) => resolveCurrentEquipmentSourceDiagnostics({ policy }));
    const mintLineId = options.mintLineId ?? mintAcquisitionLineId;
    const fetchDocumentByUuid = options.fetchDocumentByUuid ?? resolveUuid;
    const prepareConfiguredItem = options.prepareConfiguredItem ?? prepareTransientConfiguredItem;
    const preparePhysicalItem = options.preparePhysicalItem ?? prepareTransientPhysicalItem;
    const prepareBrowsePhysicalItems = options.prepareBrowsePhysicalItems ??
        (options.preparePhysicalItem
            ? prepareBrowsePhysicalItemsIndividually(options.preparePhysicalItem)
            : prepareTransientBrowsePhysicalItems);
    const prepareDraftedActor = options.prepareDraftedActor ?? prepareTransientDraftedEquipmentActor;
    const prepareKitExpansion = options.prepareKitExpansion ?? prepareAdventurersPackExpansion;
    const browsePreparedRecordCacheLimit = options.browsePreparedRecordCacheLimit ?? DEFAULT_BROWSE_PREPARED_RECORD_CACHE_LIMIT;
    if (!Number.isSafeInteger(browsePreparedRecordCacheLimit) || browsePreparedRecordCacheLimit < 1) {
        throw new TypeError("The equipment browse prepared-record cache limit must be a positive integer.");
    }
    const draftedEquipmentSizeCacheLimit = options.draftedEquipmentSizeCacheLimit ?? DEFAULT_DRAFTED_EQUIPMENT_SIZE_CACHE_LIMIT;
    if (!Number.isSafeInteger(draftedEquipmentSizeCacheLimit) || draftedEquipmentSizeCacheLimit < 1) {
        throw new TypeError("The drafted equipment size cache limit must be a positive integer.");
    }
    const catalogues = new Map();
    const previewProjector = createEquipmentPreviewProjector();
    const browsePreparedRecordCache = new Map();
    const draftedEquipmentSizeCache = new Map();
    const cachedBrowseRecord = (key) => {
        const cached = browsePreparedRecordCache.get(key);
        if (!cached)
            return null;
        browsePreparedRecordCache.delete(key);
        browsePreparedRecordCache.set(key, cached);
        return cloneData(cached);
    };
    const cacheBrowseRecord = (key, value) => {
        browsePreparedRecordCache.delete(key);
        browsePreparedRecordCache.set(key, cloneData(value));
        while (browsePreparedRecordCache.size > browsePreparedRecordCacheLimit) {
            const oldest = browsePreparedRecordCache.keys().next().value;
            if (typeof oldest !== "string")
                break;
            browsePreparedRecordCache.delete(oldest);
        }
    };
    const catalogueFor = (policy) => {
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
    const resolveDraftedEquipmentSize = (actor, draft) => requireDraftedAncestryEquipmentSize({
        actor,
        draft,
        targetLevel: draft.targetLevel,
        fetchDocumentByUuid,
        prepareDraftedActor,
    });
    const cachedDraftedEquipmentSize = (actor, draft, actorPricingFingerprint = fingerprintActorPricingContext(actor)) => {
        const draftSnapshot = snapshotDraftedEquipmentSizeMaterial(draft);
        const cacheKey = actorPricingFingerprint
            ? draftedEquipmentSizeCacheKey({ actorPricingFingerprint, draft: draftSnapshot })
            : null;
        if (cacheKey) {
            const cached = draftedEquipmentSizeCache.get(cacheKey);
            if (cached !== undefined) {
                draftedEquipmentSizeCache.delete(cacheKey);
                draftedEquipmentSizeCache.set(cacheKey, cached);
                return cached;
            }
        }
        const pending = resolveDraftedEquipmentSize(actor, draftSnapshot).then((size) => {
            if (cacheKey &&
                fingerprintActorPricingContext(actor) !== actorPricingFingerprint &&
                draftedEquipmentSizeCache.get(cacheKey) === pending) {
                draftedEquipmentSizeCache.delete(cacheKey);
            }
            return size;
        }, (error) => {
            if (cacheKey && draftedEquipmentSizeCache.get(cacheKey) === pending) {
                draftedEquipmentSizeCache.delete(cacheKey);
            }
            throw error;
        });
        if (cacheKey) {
            draftedEquipmentSizeCache.set(cacheKey, pending);
            while (draftedEquipmentSizeCache.size > draftedEquipmentSizeCacheLimit) {
                const oldest = draftedEquipmentSizeCache.keys().next().value;
                if (typeof oldest !== "string")
                    break;
                draftedEquipmentSizeCache.delete(oldest);
            }
        }
        return pending;
    };
    const currentContext = (actor, draft, acquisition) => {
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
    const requireHealthyCatalogue = async (policy, context) => {
        const catalogue = catalogueFor(policy);
        const projection = await catalogue.project(context);
        const diagnostics = combineSourceDiagnostics(resolveSourceDiagnostics(policy), projection.diagnostics);
        if (diagnostics.length > 0)
            throw new EquipmentSourceHealthError(diagnostics);
        return { catalogue, projection };
    };
    const uiAdapter = {
        async project(request) {
            throwIfStartingEquipmentProjectionAborted(request.signal);
            const acquisition = request.draft.acquisition;
            const titanMauler = titanMaulerProjection(request.draft);
            if (!acquisition) {
                return {
                    state: "pending",
                    message: "Start the step above and the gear list loads here.",
                    query: request.query,
                    offset: 0,
                    limit: request.limit,
                    matchedRecordCount: 0,
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
                throwIfStartingEquipmentProjectionAborted(request.signal);
                let projectedEntries = projection.entries;
                let projectedPreview = null;
                let hydratedPreviewEntry = null;
                if (request.previewSourceUuid) {
                    const preview = await catalogue.hydratePreview(request.previewSourceUuid, context);
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    if (preview?.entry) {
                        hydratedPreviewEntry = preview.entry;
                        projectedEntries = projection.entries.map((entry) => entry.sourceUuid === preview.entry.sourceUuid ? preview.entry : entry);
                        projectedPreview = await previewProjector.project(preview);
                        throwIfStartingEquipmentProjectionAborted(request.signal);
                    }
                }
                const maximumLevel = policy.recipe.kind === "permanent-items" ? policy.targetLevel : policy.targetLevel - 1;
                const entries = projectedEntries.filter((entry) => entry.level <= maximumLevel);
                const actorPricingFingerprint = fingerprintActorPricingContext(request.actor);
                const targetSize = await cachedDraftedEquipmentSize(request.actor, request.draft, actorPricingFingerprint);
                throwIfStartingEquipmentProjectionAborted(request.signal);
                const normalizedFilters = normalizeEquipmentCatalogueFilters({
                    query: request.query,
                    filters: request.filters,
                    defaults: {
                        policyAvailable: true,
                        titanMaulerEligible: titanMauler.required && titanMauler.selectedSourceUuid === null,
                    },
                });
                const matchedEntries = rankCatalogueMatches(entries.filter((entry) => matchesEquipmentCatalogueFilters(entry, normalizedFilters)), request.query);
                const resultWindow = clampStartingEquipmentResultWindow(request, matchedEntries.length);
                const visibleEntries = matchedEntries.slice(resultWindow.offset, resultWindow.offset + resultWindow.limit);
                const browseRows = visibleEntries.map((entry) => {
                    if (entry.price.kind !== "priced" ||
                        entry.unavailableReasons.some((reason) => reason.code !== "source-not-allowed" && reason.code !== "rarity-not-available")) {
                        return { kind: "record", record: toUiRecord(entry) };
                    }
                    const browseCacheKey = actorPricingFingerprint
                        ? equipmentBrowsePreparedRecordCacheKey({
                            projectionCacheKey: projection.cacheKey,
                            entry,
                            actorPricingFingerprint,
                            accessFactsFingerprint: context.draft.accessFactsFingerprint,
                            targetLevel: policy.targetLevel,
                            targetSize,
                        })
                        : null;
                    const cached = browseCacheKey ? cachedBrowseRecord(browseCacheKey) : null;
                    const indexedPrice = indexedBrowsePrice(entry, targetSize);
                    return cached
                        ? { kind: "record", record: cached }
                        : indexedPrice
                            ? { kind: "record", record: toUiRecord(entry, indexedPrice) }
                            : { kind: "pending", entry, browseCacheKey };
                });
                const pendingRows = browseRows.filter((row) => row.kind === "pending");
                const resolvedRows = (await mapChunksWithConcurrency(chunksOf(pendingRows, STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize), STARTING_EQUIPMENT_RESULT_WINDOW.prefetchConcurrency, async (pendingChunk) => {
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    const browseResolutions = await catalogue.resolveManyForBrowse(context, pendingChunk.map(({ entry }) => entry.sourceUuid));
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    if (browseResolutions.length !== pendingChunk.length ||
                        browseResolutions.some((result, index) => result.sourceUuid !== pendingChunk[index]?.entry.sourceUuid)) {
                        throw new Error("Equipment bulk hydration returned unstable entry mapping.");
                    }
                    return pendingChunk.map((row, index) => {
                        const result = browseResolutions[index];
                        if (result.error !== null)
                            throw result.error;
                        if (result.resolution === null) {
                            throw new Error(`Equipment bulk hydration omitted ${row.entry.sourceUuid}.`);
                        }
                        return { ...row, resolved: result.resolution };
                    });
                }, request.signal)).flat();
                const batchRows = resolvedRows.filter(({ resolved }) => usesBrowsePhysicalPreparation(resolved));
                const batchResultByKey = new Map();
                const preparedChunks = await mapChunksWithConcurrency(chunksOf(batchRows, STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize), STARTING_EQUIPMENT_RESULT_WINDOW.prefetchConcurrency, async (batchChunk, chunkIndex) => {
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    if (chunkIndex > 0)
                        await yieldBetweenEquipmentPreparationChunks();
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    const batchResults = await prepareBrowsePhysicalItems({
                        actor: request.actor,
                        targetLevel: policy.targetLevel,
                        targetSize,
                        entries: batchChunk.map(({ entry, resolved }) => ({
                            key: entry.sourceUuid,
                            source: resolved.source,
                        })),
                    });
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    if (batchResults.length !== batchChunk.length ||
                        batchResults.some((result, index) => result.key !== batchChunk[index]?.entry.sourceUuid)) {
                        throw new Error("PF2E browse equipment preparation returned unstable entry mapping.");
                    }
                    return batchResults;
                }, request.signal);
                for (const batchResults of preparedChunks) {
                    for (const result of batchResults)
                        batchResultByKey.set(result.key, result);
                }
                const preparedRecordByUuid = new Map();
                await mapChunksWithConcurrency(chunksOf(resolvedRows, STARTING_EQUIPMENT_RESULT_WINDOW.hydrationChunkSize), STARTING_EQUIPMENT_RESULT_WINDOW.prefetchConcurrency, async (resolvedChunk, chunkIndex) => {
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    if (chunkIndex > 0)
                        await yieldBetweenEquipmentPreparationChunks();
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                    await Promise.all(resolvedChunk.map(async ({ entry, browseCacheKey, resolved }) => {
                        throwIfStartingEquipmentProjectionAborted(request.signal);
                        try {
                            const batchResult = batchResultByKey.get(entry.sourceUuid);
                            let price;
                            if (usesBrowsePhysicalPreparation(resolved)) {
                                if (!batchResult)
                                    throw new Error("PF2E browse equipment preparation omitted a visible entry.");
                                if (batchResult.error !== null)
                                    throw batchResult.error;
                                price = buildSimpleResolvedPriceFromPrepared({
                                    resolved,
                                    requestedQuantity: 1,
                                    targetSize,
                                    prepared: batchResult.prepared,
                                });
                            }
                            else {
                                price = (await buildResolvedPrice({
                                    resolved,
                                    requestedQuantity: 1,
                                    targetSize,
                                    actor: request.actor,
                                    targetLevel: policy.targetLevel,
                                    packs: options.packs,
                                    prepareConfiguredItem,
                                    preparePhysicalItem,
                                })).price;
                                throwIfStartingEquipmentProjectionAborted(request.signal);
                            }
                            const record = toUiRecord(entry, price);
                            if (browseCacheKey)
                                cacheBrowseRecord(browseCacheKey, record);
                            preparedRecordByUuid.set(entry.sourceUuid, record);
                        }
                        catch (error) {
                            if (error instanceof ConfiguredItemHandoffRequiredError) {
                                const record = toUiRecord(entry);
                                if (browseCacheKey)
                                    cacheBrowseRecord(browseCacheKey, record);
                                preparedRecordByUuid.set(entry.sourceUuid, record);
                                return;
                            }
                            if (error instanceof UnsupportedPreparedPriceError) {
                                const record = { ...toUiRecord(entry, null), available: false, unavailableReason: error.message };
                                if (browseCacheKey)
                                    cacheBrowseRecord(browseCacheKey, record);
                                preparedRecordByUuid.set(entry.sourceUuid, record);
                                return;
                            }
                            throw error;
                        }
                    }));
                    throwIfStartingEquipmentProjectionAborted(request.signal);
                }, request.signal);
                const records = browseRows.map((row) => {
                    if (row.kind === "record")
                        return row.record;
                    const prepared = preparedRecordByUuid.get(row.entry.sourceUuid);
                    if (!prepared)
                        throw new Error("PF2E browse equipment preparation omitted a projected record.");
                    return prepared;
                });
                throwIfStartingEquipmentProjectionAborted(request.signal);
                const visibleSourceUuids = new Set(records.map((record) => record.sourceUuid));
                const projectedEntryByUuid = new Map(projectedEntries.map((entry) => [entry.sourceUuid, entry]));
                const lineRecordSourceUuids = new Set(visibleSourceUuids);
                const lineRecords = acquisition.lines.flatMap((line) => {
                    if (lineRecordSourceUuids.has(line.sourceUuid))
                        return [];
                    const entry = projectedEntryByUuid.get(line.sourceUuid);
                    if (!entry)
                        return [];
                    lineRecordSourceUuids.add(line.sourceUuid);
                    return [toUiRecord(entry, line.price)];
                });
                return {
                    state: "ready",
                    message: `${entries.length} piece${entries.length === 1 ? "" : "s"} of gear to browse.`,
                    diagnostics: [],
                    query: request.query,
                    offset: resultWindow.offset,
                    limit: resultWindow.limit,
                    matchedRecordCount: matchedEntries.length,
                    records,
                    previewRecord: records.find((record) => record.sourceUuid === request.previewSourceUuid) ??
                        (hydratedPreviewEntry ? toUiRecord(hydratedPreviewEntry) : null),
                    lineRecords,
                    filters: catalogueFilters(entries, normalizedFilters, request.filters, titanMauler),
                    levelFilter: buildEquipmentCatalogueLevelFacet(entries, normalizedFilters),
                    activeFilters: effectiveCatalogueFilters(request.filters, normalizedFilters, titanMauler),
                    previewSourceUuid: request.previewSourceUuid,
                    preview: projectedPreview,
                    titanMauler,
                };
            }
            catch (error) {
                if (request.signal?.aborted)
                    throwStartingEquipmentProjectionAbort(request.signal);
                return {
                    state: "error",
                    message: error instanceof Error
                        ? error.message
                        : "The gear list would not load. Ask your GM to check the approved equipment sources.",
                    diagnostics: error instanceof EquipmentSourceHealthError ? error.diagnostics : [],
                    query: request.query,
                    offset: 0,
                    limit: request.limit,
                    matchedRecordCount: 0,
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
            const targetSize = await resolveDraftedEquipmentSize(request.actor, request.draft);
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
            const kitExpansion = isQualifiedKitSource(resolved.candidate.sourceUuid)
                ? await prepareKitExpansion({
                    sourceUuid: resolved.candidate.sourceUuid,
                    kitDocument: await requireDocument(fetchDocumentByUuid, resolved.candidate.sourceUuid),
                    targetSize,
                    fetchDocumentByUuid,
                })
                : null;
            const funding = resolveRequestedFunding(policy, request.funding ?? { lane: "currency" }, resolved.candidate.level, itemPermanence);
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
                stackingIntent: kitExpansion ? "separate" : "aggregate",
                price: priced.price,
                ...(kitExpansion ? { kitExpansion: cloneData(kitExpansion.snapshot) } : {}),
            };
        },
        async prepareTitanMaulerLine(request) {
            const acquisition = requireAcquisition(request);
            const grantId = titanMaulerGrantIdForDraft(request.draft);
            if (!grantId)
                throw new TypeError("Titan Mauler is not part of the current drafted build.");
            if (acquisition.lines.some((line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId)) {
                throw new TypeError("Remove the current Titan Mauler weapon before choosing another one.");
            }
            const actorSize = await resolveDraftedEquipmentSize(request.actor, request.draft);
            if (!actorSize) {
                throw new TypeError("Titan Mauler requires a selected ancestry with a supported size.");
            }
            const targetSize = titanMaulerTargetSize(actorSize);
            if (!targetSize)
                throw new TypeError("Titan Mauler cannot prepare a weapon larger than Gargantuan.");
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
            const nativeGrants = request.classGrantPlan.grants.filter((grant) => grant.materializer === "pf2e-native");
            if (nativeGrants.length === 0)
                return Object.freeze([]);
            const targetSize = await resolveDraftedEquipmentSize(request.actor, request.characterDraft);
            const lineIds = new Set(request.acquisition.lines.map((line) => line.lineId));
            const prepared = [];
            for (const grant of nativeGrants) {
                assertFixedNativeGrant(grant);
                const persisted = request.acquisition.lines.filter((line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grant.grantId);
                if (persisted.length > 1) {
                    throw new Error(`Native class grant ${grant.grantId} requires exactly one acquisition line.`);
                }
                const resolved = await catalogue.resolveFixedNativeSourceForApply(context, grant.expected.sourceUuid, fixedNativeSourceAuthority(grant));
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
                const line = {
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
            return createAcquisitionPolicySnapshot(resolveEffectivePolicy(actor, acquisition), acquisition.recipe, acquisition.recipeSelection);
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
                if (!line)
                    throw new TypeError(`Prepared acquisition line ${lineId} is unavailable.`);
                return line;
            });
            const fixedNativeGrant = resolveFixedNativeApplyGrant(request, persisted, lines);
            const resolved = fixedNativeGrant
                ? await catalogue.resolveFixedNativeSourceForApply(context, request.entry.sourceUuid, fixedNativeSourceAuthority(fixedNativeGrant))
                : await catalogue.resolveForApply(context, request.entry.sourceUuid);
            if (fixedNativeGrant) {
                assertFixedNativeSource(fixedNativeGrant, resolved);
            }
            else {
                assertSupportedCandidate(resolved);
            }
            const currentPermanence = permanence(resolved.candidate.itemType);
            if (lines.some((line) => line.sourceUuid !== resolved.candidate.sourceUuid ||
                line.itemLevel !== resolved.candidate.level ||
                line.permanence !== currentPermanence ||
                line.componentKind !== "baseline-item")) {
                throw new Error(`Acquisition item material drifted for ${request.entry.entryId}.`);
            }
            const titanGrantId = titanMaulerGrantIdForDraft(request.characterDraft);
            const isTitanMauler = request.entry.funding.lane === "class-grant" && request.entry.funding.grant.plannedGrantId === titanGrantId;
            let targetSize;
            if (isTitanMauler) {
                if (lines.length !== 1 || lines[0]?.funding.lane !== "class-grant") {
                    throw new Error("Titan Mauler must resolve from exactly one automatic build-grant line.");
                }
                const actorSize = await resolveDraftedEquipmentSize(request.actor, request.characterDraft);
                const titanTargetSize = actorSize ? titanMaulerTargetSize(actorSize) : null;
                if (!actorSize ||
                    !titanTargetSize ||
                    request.entry.price.size !== titanTargetSize ||
                    lines[0].price.size !== titanTargetSize) {
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
                    throw new Error(eligibility?.ok === false
                        ? eligibility.message
                        : "The reviewed Titan Mauler weapon facts are malformed or changed.");
                }
                targetSize = titanTargetSize;
            }
            else {
                targetSize = await resolveDraftedEquipmentSize(request.actor, request.characterDraft);
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
            const kitExpansion = lines[0]?.kitExpansion
                ? await prepareKitExpansion({
                    sourceUuid: resolved.candidate.sourceUuid,
                    kitDocument: await requireDocument(fetchDocumentByUuid, resolved.candidate.sourceUuid),
                    targetSize,
                    fetchDocumentByUuid,
                })
                : null;
            if (lines.some((line) => canonicalJson(line.kitExpansion ?? null) !== canonicalJson(kitExpansion?.snapshot ?? null))) {
                throw new Error(`Acquisition kit expansion drifted for ${request.entry.entryId}.`);
            }
            return {
                source: cloneData(resolved.source),
                sourceUuid: resolved.candidate.sourceUuid,
                documentFingerprint: resolved.documentFingerprint,
                priceFingerprint: priced.priceFingerprint,
                resolvedPrice: priced.price,
                policyDecision: cloneData(resolved.policyDecision),
                ...(kitExpansion
                    ? {
                        expandedSources: [...kitExpansion.sources].map(([expansionPath, source]) => ({
                            expansionPath,
                            source: cloneData(source),
                        })),
                    }
                    : {}),
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
            if (authorityCodes.length === 0 ||
                resolved.unavailableReasons.some((reason) => reason.code !== "source-not-allowed" && reason.code !== "rarity-not-available")) {
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
            if (!currentGrantId ||
                titanLines.length !== 1 ||
                !line ||
                line.funding.lane !== "class-grant" ||
                line.funding.grant.plannedGrantId !== currentGrantId) {
                return removeTitanMaulerLines(request.acquisition, "build-changed");
            }
            let actorSize;
            try {
                actorSize = await resolveDraftedEquipmentSize(request.actor, request.characterDraft);
            }
            catch {
                return invalidateTitanMaulerVerification(request.acquisition);
            }
            if (!actorSize)
                return invalidateTitanMaulerVerification(request.acquisition);
            const targetSize = titanMaulerTargetSize(actorSize);
            if (!targetSize || line.price.size !== targetSize) {
                return removeTitanMaulerLines(request.acquisition, "size-changed");
            }
            let current;
            try {
                const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
                const { catalogue } = await requireHealthyCatalogue(policy, context);
                current = {
                    policy,
                    resolved: await catalogue.resolveForApply(context, line.sourceUuid),
                };
            }
            catch {
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
            }
            catch {
                return removeTitanMaulerLines(request.acquisition, "source-changed");
            }
        },
        invalidatePack(packId) {
            browsePreparedRecordCache.clear();
            draftedEquipmentSizeCache.clear();
            for (const catalogue of catalogues.values())
                catalogue.invalidatePack(packId);
        },
    };
}
function combineSourceDiagnostics(...groups) {
    const unique = new Map();
    for (const diagnostic of groups.flat()) {
        const key = canonicalJson([diagnostic.code, diagnostic.packId, diagnostic.sourceIdentity, diagnostic.message]);
        unique.set(key, diagnostic);
    }
    return Object.freeze(sortEquipmentSourceDiagnostics([...unique.values()]));
}
function assertFixedNativeGrant(grant) {
    if (grant.materializer !== "pf2e-native" ||
        grant.eligibilityKind !== "fixed-class-grant" ||
        grant.eligibilityEvidence.kind !== "fixed-native-profile" ||
        grant.expected.quantity !== 1 ||
        (grant.expected.itemType !== "equipment" && grant.expected.itemType !== "weapon")) {
        throw new TypeError(`Class grant ${grant.grantId} is not an authoritative fixed native profile.`);
    }
}
function assertFixedNativeSource(grant, resolved) {
    const authorityOnlyReasons = new Set(["rarity-not-available", "source-not-allowed"]);
    const structuralReason = resolved.unavailableReasons.find((reason) => !authorityOnlyReasons.has(reason.code));
    if (structuralReason)
        throw new Error(structuralReason.message);
    if (resolved.candidate.sourceUuid !== grant.expected.sourceUuid ||
        resolved.candidate.itemType !== grant.expected.itemType ||
        resolved.candidate.level !== 0 ||
        permanence(resolved.candidate.itemType) !== "permanent") {
        throw new Error(`Native class-grant source material changed for ${grant.grantId}.`);
    }
    assertExactCompendiumSource(grant.expected.sourceUuid, resolved.source);
}
function resolveFixedNativeApplyGrant(request, persistedAcquisition, lines) {
    const funding = request.entry.funding;
    if (funding.lane !== "class-grant")
        return null;
    const grants = request.acquisition.plannedClassGrants.filter((grant) => grant.grantId === funding.grant.plannedGrantId);
    if (grants.length !== 1) {
        throw new Error(`Class grant ${funding.grant.plannedGrantId} is not persisted exactly once.`);
    }
    const requestedGrant = grants[0];
    const grant = normalizePlannedClassGrant(requestedGrant);
    if (!grant) {
        throw new TypeError(`Class grant ${funding.grant.plannedGrantId} is not a canonical persisted grant.`);
    }
    if (grant.materializer !== "pf2e-native")
        return null;
    const persistedGrants = persistedAcquisition.plannedClassGrants.filter((candidate) => candidate.grantId === grant.grantId);
    const requestedGrantLines = request.acquisition.lines.filter(isGrantFundedLine(grant.grantId));
    const persistedGrantLines = persistedAcquisition.lines.filter(isGrantFundedLine(grant.grantId));
    const persistedGrant = persistedGrants[0] ? normalizePlannedClassGrant(persistedGrants[0]) : null;
    if (persistedGrants.length !== 1 ||
        !persistedGrant ||
        canonicalJson(persistedGrant) !== canonicalJson(grant) ||
        requestedGrantLines.length !== 1 ||
        persistedGrantLines.length !== 1 ||
        canonicalJson(requestedGrantLines[0]) !== canonicalJson(persistedGrantLines[0])) {
        throw new Error(`PF2E-native class grant ${grant.grantId} is not persisted exactly once.`);
    }
    assertFixedNativeGrant(grant);
    const line = lines[0];
    const plannedItem = request.entry.plannedItems[0];
    if (lines.length !== 1 ||
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
        plannedItem.plannedContainerId !== null) {
        throw new Error(`PF2E-native class grant ${grant.grantId} differs from its persisted acquisition authority.`);
    }
    return grant;
}
function isGrantFundedLine(grantId) {
    return (line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId;
}
function assertExactCompendiumSource(sourceUuid, source) {
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
function fixedNativeSourceAuthority(grant) {
    const identity = compendiumItemIdentity(grant.expected.sourceUuid);
    return {
        kind: "fixed-native-grant",
        expectedSourceUuid: grant.expected.sourceUuid,
        expectedPackId: identity.packId,
    };
}
function compendiumItemIdentity(sourceUuid) {
    const match = /^Compendium\.([^.]+\.[^.]+)\.Item\.([^.]+)$/.exec(sourceUuid);
    if (!match)
        throw new TypeError(`Native class-grant source is not an exact Compendium Item UUID: ${sourceUuid}.`);
    return { packId: match[1], documentId: match[2] };
}
let foundryRuntime = null;
export function registerFoundryEquipmentAcquisitionRuntime() {
    const runtime = getFoundryEquipmentAcquisitionRuntime();
    registerStartingEquipmentUiAdapter(runtime.uiAdapter);
    return runtime;
}
export function getFoundryEquipmentAcquisitionRuntime() {
    foundryRuntime ??= createEquipmentAcquisitionRuntime({
        packs: {
            get(packId) {
                return foundryEquipmentPackAdapter(packId);
            },
        },
    });
    return foundryRuntime;
}
function foundryEquipmentPackAdapter(packId) {
    const pack = game.packs?.get?.(packId);
    if (!pack)
        return undefined;
    return {
        indexEntryIdentity: "stable-replacement",
        indexedBrowsePricing: "pf2e-physical-source-v1",
        documentName: pack.documentName,
        metadata: pack.metadata,
        getIndex: (options) => pack.getIndex(options),
        getDocument: (documentId) => pack.getDocument(documentId),
        ...(typeof pack.getDocuments === "function"
            ? { getDocuments: (query) => pack.getDocuments(query) }
            : {}),
        ...(typeof pack.set === "function"
            ? { set: (documentId, document) => pack.set(documentId, document) }
            : {}),
        ...(typeof pack.delete === "function" ? { delete: (documentId) => pack.delete(documentId) } : {}),
    };
}
export function invalidateFoundryEquipmentCataloguePack(packId) {
    foundryRuntime?.invalidatePack(packId);
}
function resolveCurrentEffectivePolicy(actor, acquisition) {
    const reviewed = acquisition.policySnapshot;
    if (!reviewed)
        throw new TypeError("Starting-equipment policy must be reviewed before catalogue access.");
    return resolveEquipmentPolicyForActor({
        actor,
        draftId: acquisition.draftId,
        targetLevel: acquisition.targetLevel,
        selectedRecipe: selectedOfficialRecipe(acquisition.recipe.kind),
        higherLevelStartClaim: higherLevelStartClaim(reviewed.material.higherLevelStartEvidence),
        customLumpSum: acquisition.recipe.kind === "custom-lump-sum"
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
function higherLevelStartClaim(evidence) {
    if (evidence.kind === "not-required")
        return null;
    if (evidence.kind === "gm-confirmation") {
        return { kind: "gm-confirmation", judgmentId: evidence.judgment.id, startKind: evidence.startKind };
    }
    return { ...evidence };
}
function selectedOfficialRecipe(kind) {
    return kind === "permanent-items" ? "permanent-items" : "lump-sum";
}
function requireAcquisition(request) {
    const acquisition = request.draft.acquisition;
    if (!acquisition || request.draft.acquisitionCorrupt) {
        throw new TypeError("Set up a valid starting-equipment draft before adding an item.");
    }
    return acquisition;
}
function assertSupportedCandidate(resolved) {
    if (!resolved.available || !resolved.policyDecision.eligible) {
        throw new Error(resolved.unavailableReasons[0]?.message ?? "This equipment is unavailable under current policy.");
    }
    if (!resolved.source || typeof resolved.source !== "object") {
        throw new TypeError("The equipment document has no embeddable source.");
    }
}
function assertTitanMaulerCandidate(resolved) {
    assertSupportedCandidate(resolved);
    if (resolved.candidate.level !== 0) {
        throw new Error("Titan Mauler requires a level-0 weapon.");
    }
}
function resolveRequestedFunding(policy, requested, itemLevel, itemPermanence) {
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
    if (!allowance)
        throw new Error("The selected permanent-item allowance no longer exists.");
    if (itemLevel > allowance.itemLevel) {
        throw new Error(`A level ${allowance.itemLevel} allowance cannot fund a level ${itemLevel} item.`);
    }
    return { lane: "allowance", assignment: { mode: "player", allowanceId: allowance.allowanceId } };
}
async function buildResolvedPrice(input) {
    if (isQualifiedKitSource(input.resolved.candidate.sourceUuid)) {
        if (input.requestedQuantity !== 1 || input.resolved.candidate.itemType !== "kit") {
            throw new TypeError("Adventurer's Pack is a fixed one-pack purchase.");
        }
        const snapshot = createAcquisitionPriceSnapshot({
            basePrice: {
                kind: "priced",
                value: cloneData(input.resolved.candidate.price.value ?? {}),
            },
            size: input.targetSize,
            sizeSensitive: false,
            preciousMaterial: false,
            adjustedBulkPriceCopper: null,
            configurationPriceCopper: 0,
            pricePer: 1,
            sourceQuantity: 1,
            requestedQuantity: 1,
        });
        if (snapshot.ok === false || snapshot.value.linePriceCopper !== 150) {
            throw new Error("Adventurer's Pack no longer has its qualified 15 sp price.");
        }
        return { price: snapshot.value, priceFingerprint: input.resolved.priceFingerprint };
    }
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
    const handoffError = (issue) => new ConfiguredItemHandoffRequiredError({
        code: "unsafe-configured-item",
        sourceUuid: input.resolved.candidate.sourceUuid,
        itemName: input.resolved.candidate.name,
        issue,
    });
    if (configuration.specific !== null)
        throw handoffError("specific-magic-item");
    if (input.requestedQuantity !== 1 ||
        input.resolved.candidate.price.per !== 1 ||
        input.resolved.candidate.price.sourceQuantity !== 1) {
        throw handoffError("unsupported-unit-pricing");
    }
    const pack = input.packs.get(input.resolved.candidate.packId);
    if (!pack)
        throw handoffError("base-item-unavailable");
    const index = Array.from((await pack.getIndex({
        fields: ["type", "system.slug", "system.level.value", "system.runes", "system.material"],
    })) ?? []);
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
    if (!baseSource)
        throw handoffError("base-item-unavailable");
    const emptyMaterial = { type: null, grade: null };
    const emptyRunes = configuration.itemType === "weapon"
        ? { potency: 0, striking: 0, property: [] }
        : { potency: 0, resilient: 0, property: [] };
    const fundamentalRunes = { ...configuration.runes, property: [] };
    const prepare = (base, runes, material, forceNonSpecific) => input.prepareConfiguredItem({
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
    if (!fullPrepared ||
        !runeOnlyPrepared ||
        !fundamentalPrepared ||
        !materialPrepared ||
        !actualPrepared ||
        actualPrepared.totalCopper !== fullPrepared.totalCopper ||
        canonicalJson(actualPrepared.runes) !== canonicalJson(fullPrepared.runes) ||
        canonicalJson(actualPrepared.material) !== canonicalJson(fullPrepared.material)) {
        throw handoffError("prepared-components-unsafe");
    }
    const effectiveFundamental = fundamentalPrepared.runes.potency > 0 || meaningfulFundamental(fundamentalPrepared.runes.fundamental);
    const propertyRuneCopper = runeOnlyPrepared.runes.property.length > 0
        ? runeOnlyPrepared.totalCopper - (effectiveFundamental ? fundamentalPrepared.totalCopper : 0)
        : 0;
    const preciousMaterialCopper = materialPrepared.material.type && materialPrepared.material.grade ? materialPrepared.totalCopper : 0;
    const baselineAndFundamentalCopper = fullPrepared.totalCopper - propertyRuneCopper - preciousMaterialCopper;
    if (![propertyRuneCopper, preciousMaterialCopper, baselineAndFundamentalCopper].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw handoffError("prepared-components-unsafe");
    }
    const components = {
        version: 1,
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
        suppressedByAbp: suppressedConfiguredComponents(normalizeConfiguredRunes(configuration.runes, configuration.itemType), fullPrepared.runes),
    };
    const basePrice = { kind: "priced", value: { cp: baselineAndFundamentalCopper } };
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
    if (snapshot.ok === false)
        throw handoffError("prepared-components-unsafe");
    const preparedPrice = snapshot.value;
    if (preparedPrice.unitPriceCopper !== fullPrepared.totalCopper) {
        throw handoffError("prepared-components-unsafe");
    }
    return {
        price: preparedPrice,
        priceFingerprint: fingerprintPreparedPrice(preparedPrice),
    };
}
function usesBrowsePhysicalPreparation(resolved) {
    return (!isQualifiedKitSource(resolved.candidate.sourceUuid) &&
        configuredItemFacts(resolved.source, resolved.candidate.itemType) === null &&
        isBrowsePhysicalBatchSafeSource(resolved.source));
}
async function requireDocument(fetchDocumentByUuid, uuid) {
    const document = await fetchDocumentByUuid(uuid);
    if (!document)
        throw new Error(`Equipment document ${uuid} is unavailable.`);
    return document;
}
function buildSimpleResolvedPrice(input) {
    const prepared = input.preparePhysicalItem({
        actor: input.actor,
        targetLevel: input.targetLevel,
        targetSize: input.targetSize,
        source: input.resolved.source,
    });
    return buildSimpleResolvedPriceFromPrepared({
        resolved: input.resolved,
        requestedQuantity: input.requestedQuantity,
        targetSize: input.targetSize,
        prepared,
    });
}
function indexedBrowsePrice(entry, targetSize) {
    const facts = entry.indexedBrowsePriceFacts;
    const normalized = entry.price;
    if (!facts || normalized.kind !== "priced" || !normalized.value)
        return null;
    const snapshot = createAcquisitionPriceSnapshot({
        basePrice: { kind: "priced", value: cloneData(normalized.value) },
        size: targetSize,
        sizeSensitive: facts.sizeSensitive,
        preciousMaterial: false,
        adjustedBulkPriceCopper: null,
        configurationPriceCopper: 0,
        pricePer: normalized.per,
        sourceQuantity: normalized.sourceQuantity,
        requestedQuantity: 1,
    });
    if (snapshot.ok === false)
        return null;
    if ((normalized.copperValue ?? 0) > 0 && snapshot.value.linePriceCopper === 0)
        return null;
    return snapshot.value;
}
function buildSimpleResolvedPriceFromPrepared(input) {
    const normalized = input.resolved.candidate.price;
    const preparedFacts = preparedPhysicalPriceFacts(input.prepared);
    const basePrice = normalized.kind === "priced" && normalized.value
        ? { kind: "priced", value: cloneData(normalized.value) }
        : normalized.kind === "missing"
            ? { kind: "missing" }
            : { kind: "unparseable" };
    const baseline = createAcquisitionPriceSnapshot({
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
    if (baseline.ok === false)
        throw new TypeError(baseline.message);
    if ((normalized.copperValue ?? 0) > 0 && preparedFacts.totalCopper === 0) {
        throw new UnsupportedPreparedPriceError(preparedFacts.temporary
            ? "PF2E treats this prepared item as temporary, so it cannot be purchased from starting wealth."
            : "This item must be purchased in a quantity that produces a nonzero exact PF2E charge.");
    }
    const configurationPriceCopper = preparedFacts.totalCopper - baseline.value.unitPriceCopper;
    if (!Number.isSafeInteger(configurationPriceCopper) || configurationPriceCopper < 0) {
        throw new TypeError("PF2E prepared equipment pricing differs from Wayfinder's reviewed price basis.");
    }
    const snapshot = createAcquisitionPriceSnapshot({
        basePrice,
        size: input.targetSize,
        sizeSensitive: preparedFacts.sizeSensitive,
        preciousMaterial: preparedFacts.preciousMaterial,
        adjustedBulkPriceCopper: preparedFacts.preciousMaterial ? preparedFacts.totalCopper : null,
        configurationPriceCopper,
        pricePer: normalized.per,
        sourceQuantity: normalized.sourceQuantity,
        requestedQuantity: input.requestedQuantity,
    });
    if (snapshot.ok === false)
        throw new TypeError(snapshot.message);
    if (snapshot.value.unitPriceCopper !== preparedFacts.totalCopper) {
        throw new TypeError("PF2E prepared equipment pricing differs from Wayfinder's reviewed price basis.");
    }
    if ((normalized.copperValue ?? 0) > 0 && snapshot.value.linePriceCopper === 0) {
        throw new UnsupportedPreparedPriceError("This item must be purchased in a quantity that produces a nonzero exact PF2E charge.");
    }
    return snapshot.value;
}
function preparedPhysicalPriceFacts(item) {
    const system = record(record(item).system);
    const price = record(system.price);
    if (typeof price.sizeSensitive !== "boolean") {
        throw new TypeError("PF2E prepared equipment has no authoritative size-pricing fact.");
    }
    const totalCopper = coinsCopper(price.value);
    if (totalCopper === null)
        throw new TypeError("PF2E prepared equipment has no exact prepared Price.");
    const material = normalizeConfiguredMaterial(record(system.material));
    if ((material.type === null) !== (material.grade === null)) {
        throw new TypeError("PF2E prepared equipment has malformed precious-material facts.");
    }
    return {
        sizeSensitive: price.sizeSensitive,
        preciousMaterial: material.type !== null,
        temporary: system.temporary === true,
        totalCopper,
    };
}
function configuredItemFacts(source, itemType) {
    if (itemType !== "weapon" && itemType !== "armor")
        return null;
    const system = record(record(source).system);
    const runes = record(system.runes);
    const material = record(system.material);
    const baseItem = system.baseItem;
    const specific = system.specific ?? null;
    const normalizedRunes = normalizeConfiguredRunes(runes, itemType);
    const normalizedMaterial = normalizeConfiguredMaterial(material);
    const configured = normalizedRunes.potency > 0 ||
        meaningfulFundamental(normalizedRunes.fundamental) ||
        normalizedRunes.property.length > 0 ||
        normalizedMaterial.type !== null ||
        normalizedMaterial.grade !== null;
    if (!configured)
        return null;
    if (typeof baseItem !== "string" || !baseItem.trim()) {
        throw new Error("Configured equipment has no exact PF2E base-item identity; use the inventory sheet.");
    }
    return {
        itemType,
        baseItem: baseItem.trim(),
        specific,
        runes: cloneData(runes),
        material: normalizedMaterial,
    };
}
function preparedConfiguredFacts(item, itemType) {
    const system = record(record(item).system);
    const totalCopper = coinsCopper(record(system.price).value);
    if (totalCopper === null)
        return null;
    return {
        runes: normalizeConfiguredRunes(record(system.runes), itemType),
        material: normalizeConfiguredMaterial(record(system.material)),
        totalCopper,
    };
}
function normalizeConfiguredRunes(runes, itemType) {
    const potency = Number.isSafeInteger(runes.potency) && Number(runes.potency) >= 0 ? Number(runes.potency) : 0;
    const fundamentalKey = itemType === "weapon" ? "striking" : "resilient";
    const rawFundamental = runes[fundamentalKey];
    const fundamental = rawFundamental === null || typeof rawFundamental === "string" || Number.isSafeInteger(rawFundamental)
        ? rawFundamental
        : null;
    const property = Array.isArray(runes.property)
        ? runes.property.filter((value) => typeof value === "string")
        : [];
    return { potency, fundamental, property };
}
function normalizeConfiguredMaterial(material) {
    return {
        type: typeof material.type === "string" && material.type ? material.type : null,
        grade: typeof material.grade === "string" && material.grade ? material.grade : null,
    };
}
function meaningfulFundamental(value) {
    return (typeof value === "number" && value > 0) || (typeof value === "string" && value !== "" && value !== "0");
}
function suppressedConfiguredComponents(source, prepared) {
    const suppressed = [];
    if (source.potency > prepared.potency)
        suppressed.push("potency");
    if (meaningfulFundamental(source.fundamental) && !meaningfulFundamental(prepared.fundamental)) {
        suppressed.push("fundamental");
    }
    for (const property of source.property) {
        if (!prepared.property.includes(property))
            suppressed.push(`property:${property}`);
    }
    return suppressed.sort();
}
function coinsCopper(value) {
    const coins = record(value);
    if (Number.isSafeInteger(coins.copperValue) && Number(coins.copperValue) >= 0)
        return Number(coins.copperValue);
    let total = 0;
    for (const [denomination, factor] of Object.entries({ pp: 1000, gp: 100, sp: 10, cp: 1 })) {
        const amount = coins[denomination] ?? 0;
        if (!Number.isSafeInteger(amount) || Number(amount) < 0)
            return null;
        total += Number(amount) * factor;
        if (!Number.isSafeInteger(total))
            return null;
    }
    return total;
}
function documentSource(document) {
    const toObject = record(document).toObject;
    if (typeof toObject !== "function")
        return null;
    const source = toObject.call(document, true);
    return source && typeof source === "object" ? cloneData(source) : null;
}
function prepareBrowsePhysicalItemsIndividually(preparePhysicalItem) {
    return async (input) => input.entries.map((entry) => {
        try {
            return {
                key: entry.key,
                prepared: preparePhysicalItem({
                    actor: input.actor,
                    targetLevel: input.targetLevel,
                    targetSize: input.targetSize,
                    source: entry.source,
                }),
                error: null,
            };
        }
        catch (error) {
            return { key: entry.key, prepared: null, error };
        }
    });
}
function prepareTransientConfiguredItem(input) {
    const itemSource = cloneData(input.baseSource);
    const itemSystem = record(itemSource.system);
    itemSystem.runes = cloneData(input.runes);
    itemSystem.material = cloneData(input.material);
    if (input.forceNonSpecific)
        itemSystem.specific = null;
    itemSource.system = itemSystem;
    return prepareTransientPhysicalItem({
        actor: input.actor,
        targetLevel: input.targetLevel,
        targetSize: input.targetSize,
        source: itemSource,
    });
}
function prepareTransientPhysicalItem(input) {
    const actorToObject = record(input.actor).toObject;
    if (typeof actorToObject !== "function") {
        throw new Error("Equipment pricing requires a PF2E actor preparation context.");
    }
    const actorSource = cloneData(actorToObject.call(input.actor, true));
    const actorSystem = record(actorSource.system);
    const details = record(actorSystem.details);
    const level = record(details.level);
    level.value = input.targetLevel;
    details.level = level;
    actorSystem.details = details;
    actorSource.system = actorSystem;
    actorSource._id = transientId();
    actorSource.name = `Wayfinder equipment-price preparation ${input.targetLevel}`;
    const itemSource = cloneData(input.source);
    const itemSystem = record(itemSource.system);
    itemSystem.size = materializedPhysicalItemSize(input.targetSize);
    itemSource.system = itemSystem;
    const itemId = transientId();
    itemSource._id = itemId;
    actorSource.items = [itemSource];
    const actorClass = record(record(CONFIG).Actor).documentClass;
    if (typeof actorClass !== "function")
        throw new Error("PF2E actor preparation is unavailable.");
    const temporary = new actorClass(actorSource, {
        temporary: true,
    });
    const items = record(temporary).items;
    const get = record(items).get;
    const item = typeof get === "function" ? get.call(items, itemId) : null;
    if (!item)
        throw new Error("PF2E did not prepare the transient equipment item.");
    return item;
}
function transientId() {
    const randomId = record(record(globalThis).foundry).utils;
    const mint = record(randomId).randomID;
    if (typeof mint === "function")
        return mint(16);
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
function fingerprintPreparedPrice(price) {
    const text = canonicalJson({ version: 1, price });
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `equipment-prepared-price-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function buildTitanMaulerLine(args) {
    const line = {
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
    if (!candidate)
        throw new Error("The selected Titan Mauler weapon facts are malformed or changed.");
    const eligibility = evaluateTitanMaulerCandidate(candidate);
    if (eligibility.ok === false)
        throw new Error(eligibility.message);
    return line;
}
function isTitanMaulerLine(line) {
    return (line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId.startsWith("class-grant:titan-mauler:"));
}
function removeTitanMaulerLines(acquisition, reason) {
    const withoutLines = {
        ...acquisition,
        lines: acquisition.lines.filter((line) => !isTitanMaulerLine(line)),
    };
    const withoutGrants = recordPlannedClassGrants(withoutLines, withoutLines.plannedClassGrants.filter((grant) => !grant.grantId.startsWith("class-grant:titan-mauler:")));
    return {
        acquisition: invalidateAcquisitionReview(withoutGrants, ["document"]),
        changed: true,
        reason,
    };
}
function invalidateTitanMaulerVerification(acquisition) {
    const invalidated = invalidateAcquisitionReview(acquisition, ["document"]);
    return {
        acquisition: invalidated,
        changed: invalidated !== acquisition,
        reason: "verification-failed",
    };
}
async function requireDraftedAncestryEquipmentSize(input) {
    return resolvePreparedDraftedEquipmentSize(input);
}
function permanence(itemType) {
    return itemType === "ammo" || itemType === "consumable" ? "consumable" : "permanent";
}
function buildAccessFacts(draft) {
    const selections = [...Object.values(draft.selections), ...Object.values(draft.branchSelections)]
        .map((selection) => ({ slotId: selection.slotId, sourceUuid: selection.uuid }))
        .sort((left, right) => left.slotId.localeCompare(right.slotId) || left.sourceUuid.localeCompare(right.sourceUuid));
    return {
        selections,
        classChoices: sortedRecord(draft.classChoices),
        singletonChoices: sortedRecord(draft.singletonChoices),
    };
}
function titanMaulerProjection(draft) {
    const grantId = titanMaulerGrantIdForDraft(draft);
    if (!grantId)
        return { required: false, selectedSourceUuid: null };
    const selected = draft.acquisition?.lines.find((line) => line.funding.lane === "class-grant" && line.funding.grant.plannedGrantId === grantId);
    return { required: true, selectedSourceUuid: selected?.sourceUuid ?? null };
}
function toUiRecord(entry, preparedPrice) {
    const preparedPriceCopper = preparedPrice === undefined ? entry.price.copperValue : (preparedPrice?.linePriceCopper ?? null);
    return {
        sourceUuid: entry.sourceUuid,
        name: entry.name,
        itemType: entry.itemType,
        level: entry.level,
        rarity: entry.rarity,
        sourceLabel: equipmentCatalogueSourceLabel(entry.publicationSlug),
        priceCopper: preparedPriceCopper,
        priceLabel: formatCopper(preparedPriceCopper),
        priceContext: preparedPrice && (preparedPrice.materializedQuantity !== 1 || preparedPrice.pricePer !== 1)
            ? {
                materializedQuantity: preparedPrice.materializedQuantity,
                pricePer: preparedPrice.pricePer,
            }
            : null,
        bulkLabel: "See item details",
        handsLabel: null,
        traits: [...entry.traits],
        available: entry.available,
        unavailableReason: entry.unavailableReasons[0]?.message ?? null,
        exceptionRequestable: entry.unavailableReasons.length > 0 &&
            entry.unavailableReasons.every((reason) => reason.code === "source-not-allowed" || reason.code === "rarity-not-available"),
        titanMaulerEligible: isTitanMaulerEligibleEntry(entry),
    };
}
function rankCatalogueMatches(entries, query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return entries
        .map((entry, index) => ({ entry, index, relevance: catalogueQueryRelevance(entry, normalizedQuery) }))
        .sort((left, right) => Number(right.entry.available) - Number(left.entry.available) ||
        left.relevance - right.relevance ||
        left.index - right.index)
        .map(({ entry }) => entry);
}
function catalogueQueryRelevance(entry, normalizedQuery) {
    if (!normalizedQuery)
        return 0;
    const name = entry.name.trim().toLocaleLowerCase();
    if (name === normalizedQuery)
        return 0;
    if (name.startsWith(normalizedQuery))
        return 1;
    if (name.includes(normalizedQuery))
        return 2;
    return 3;
}
function chunksOf(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size)
        chunks.push(values.slice(index, index + size));
    return chunks;
}
async function mapChunksWithConcurrency(chunks, concurrency, worker, signal) {
    throwIfStartingEquipmentProjectionAborted(signal);
    if (chunks.length === 0)
        return [];
    const results = new Array(chunks.length);
    let nextIndex = 0;
    const runWorker = async () => {
        while (nextIndex < chunks.length) {
            throwIfStartingEquipmentProjectionAborted(signal);
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(chunks[index], index);
            throwIfStartingEquipmentProjectionAborted(signal);
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency)), chunks.length) }, () => runWorker()));
    return results;
}
function throwIfStartingEquipmentProjectionAborted(signal) {
    if (!signal?.aborted)
        return;
    throwStartingEquipmentProjectionAbort(signal);
}
function throwStartingEquipmentProjectionAbort(signal) {
    if (typeof signal.throwIfAborted === "function")
        signal.throwIfAborted();
    const error = new Error("The starting-equipment projection was replaced by a newer request.");
    error.name = "AbortError";
    throw error;
}
async function yieldBetweenEquipmentPreparationChunks() {
    const taskScheduler = globalThis.scheduler;
    if (typeof taskScheduler?.yield === "function") {
        await taskScheduler.yield();
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
}
function catalogueFilters(entries, filters, requested, titanMauler) {
    const facet = (key) => buildEquipmentCatalogueFacetOptions(entries, filters, key, requested[key]);
    return [
        ...facet("availability"),
        ...facet("type"),
        ...facet("rarity"),
        ...facet("source"),
        ...facet("trait"),
        ...(titanMauler.required && titanMauler.selectedSourceUuid === null ? facet("titan-mauler") : []),
    ];
}
function effectiveCatalogueFilters(requested, filters, titanMauler) {
    return {
        ...requested,
        availability: [filters.policyAvailable ? "available" : "all"],
        ...(titanMauler.required && titanMauler.selectedSourceUuid === null
            ? { "titan-mauler": [filters.titanMaulerEligible ? "eligible" : "all"] }
            : {}),
    };
}
function formatCopper(copper) {
    if (copper === null || !Number.isSafeInteger(copper) || copper < 0)
        return "Unavailable";
    if (copper === 0)
        return "0 gp";
    const gp = Math.floor(copper / 100);
    const sp = Math.floor((copper % 100) / 10);
    const cp = copper % 10;
    return [gp ? `${gp} gp` : "", sp ? `${sp} sp` : "", cp ? `${cp} cp` : ""].filter(Boolean).join(" ");
}
function sortedRecord(input) {
    return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}
function equipmentBrowsePreparedRecordCacheKey(input) {
    return fingerprintRuntimeMaterial("equipment-browse-prepared-record-v1", {
        projectionCacheKey: input.projectionCacheKey,
        evaluatedEntry: input.entry,
        actorPricingFingerprint: input.actorPricingFingerprint,
        accessFactsFingerprint: input.accessFactsFingerprint,
        targetLevel: input.targetLevel,
        targetSize: input.targetSize,
    });
}
function draftedEquipmentSizeCacheKey(input) {
    const selections = Object.values(input.draft.selections)
        .filter((selection) => selection.itemType === "ancestry" || selection.itemType === "heritage")
        .map((selection) => ({
        slotId: selection.slotId,
        itemType: selection.itemType,
        packId: selection.packId,
        documentId: selection.documentId,
        uuid: selection.uuid,
        slug: selection.slug ?? null,
    }))
        .sort((left, right) => left.itemType.localeCompare(right.itemType) ||
        left.slotId.localeCompare(right.slotId) ||
        left.uuid.localeCompare(right.uuid));
    const singletonChoices = Object.entries(input.draft.singletonChoices)
        .filter(([slotId]) => isDraftedEquipmentSizeSingletonChoice(slotId))
        .sort(([left], [right]) => left.localeCompare(right));
    return fingerprintRuntimeMaterial("equipment-drafted-size-v1", {
        actorPricingFingerprint: input.actorPricingFingerprint,
        targetLevel: input.draft.targetLevel,
        selections,
        singletonChoices,
    });
}
function snapshotDraftedEquipmentSizeMaterial(draft) {
    const selections = Object.fromEntries(Object.entries(draft.selections)
        .filter(([, selection]) => selection.itemType === "ancestry" || selection.itemType === "heritage")
        .map(([slotId, selection]) => [slotId, cloneData(selection)]));
    const singletonChoices = Object.fromEntries(Object.entries(draft.singletonChoices).filter(([slotId]) => isDraftedEquipmentSizeSingletonChoice(slotId)));
    return {
        ...draft,
        selections,
        singletonChoices,
    };
}
function isDraftedEquipmentSizeSingletonChoice(slotId) {
    return slotId.startsWith("singleton-choice-ancestry-") || slotId.startsWith("singleton-choice-heritage-");
}
function fingerprintActorPricingContext(actor) {
    try {
        const actorRecord = record(actor);
        const toObject = actorRecord.toObject;
        const source = typeof toObject === "function" ? toObject.call(actor, true) : actor;
        const actorSource = record(source);
        return fingerprintRuntimeMaterial("equipment-actor-pricing-v1", {
            type: actorSource.type ?? actorRecord.type ?? null,
            system: cloneData(actorSource.system ?? actorRecord.system ?? {}),
            items: pricingEmbeddedDocuments(actorSource.items ?? actorRecord.items),
            effects: pricingEmbeddedDocuments(actorSource.effects ?? actorRecord.effects),
            flags: flagsWithoutWayfinder(actorSource.flags ?? actorRecord.flags),
        });
    }
    catch {
        return null;
    }
}
function pricingEmbeddedDocuments(value) {
    const collection = Array.isArray(value)
        ? value
        : Array.isArray(record(value).contents)
            ? record(value).contents
            : [];
    return collection.map((document) => {
        const documentRecord = record(document);
        const toObject = documentRecord.toObject;
        const source = typeof toObject === "function" ? toObject.call(document, true) : document;
        const cloned = cloneData(record(source));
        cloned.flags = flagsWithoutWayfinder(cloned.flags);
        return cloned;
    });
}
function flagsWithoutWayfinder(value) {
    const flags = cloneData(record(value));
    delete flags[MODULE_ID];
    return flags;
}
function fingerprintRuntimeMaterial(namespace, value) {
    const text = canonicalJson({ namespace, value });
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${namespace}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const input = value;
        return `{${Object.keys(input)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
//# sourceMappingURL=equipment-acquisition-runtime-service.js.map