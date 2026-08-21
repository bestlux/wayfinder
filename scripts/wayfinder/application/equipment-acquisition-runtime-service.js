import { cloneData } from "../../shared/cloning.js";
import { resolveUuid } from "../../shared/foundry-compat.js";
import { acquisitionPolicyMaterialMatches, createAcquisitionPolicySnapshot, invalidateAcquisitionReview, normalizeAcquisitionDraft, recordPlannedClassGrants, } from "../domain/acquisition-draft.js";
import { mintAcquisitionLineId } from "../domain/acquisition-identity.js";
import { createAcquisitionPriceSnapshot } from "../domain/acquisition-ledger.js";
import { assertPreparedClassGrantPlanMatches, evaluateTitanMaulerCandidate, normalizePlannedClassGrant, titanMaulerTargetSize, } from "../domain/class-grant-reconciliation.js";
import { buildTitanMaulerCandidate, resolveDraftedAncestryEquipmentSize, titanMaulerGrantIdForDraft, } from "./class-grant-projection-service.js";
import { createEquipmentCatalogueDraftContext, createEquipmentCatalogueService, EMPTY_EQUIPMENT_ACCESS_REGISTRY, } from "./equipment-catalogue-service.js";
import { resolveEquipmentPolicyForActor } from "./equipment-policy-service.js";
import { registerStartingEquipmentUiAdapter, } from "./starting-equipment-ui-adapter.js";
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
    const mintLineId = options.mintLineId ?? mintAcquisitionLineId;
    const fetchDocumentByUuid = options.fetchDocumentByUuid ?? resolveUuid;
    const prepareConfiguredItem = options.prepareConfiguredItem ?? prepareTransientConfiguredItem;
    const catalogues = new Map();
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
    const currentContext = (actor, draft, acquisition) => {
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
    const uiAdapter = {
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
                const catalogue = catalogueFor(policy);
                const projection = await catalogue.project(context);
                let projectedEntries = projection.entries;
                if (request.previewSourceUuid) {
                    const preview = await catalogue.hydratePreview(request.previewSourceUuid, context);
                    if (preview?.entry) {
                        projectedEntries = projection.entries.map((entry) => entry.sourceUuid === preview.entry.sourceUuid ? preview.entry : entry);
                    }
                }
                const maximumLevel = policy.recipe.kind === "permanent-items" ? policy.targetLevel : policy.targetLevel - 1;
                const entries = projectedEntries.filter((entry) => entry.level <= maximumLevel);
                const records = entries.map(toUiRecord);
                return {
                    state: "ready",
                    message: `${records.length} piece${records.length === 1 ? "" : "s"} of gear to browse.`,
                    query: request.query,
                    records,
                    filters: catalogueFilters(entries),
                    activeFilters: request.filters,
                    previewSourceUuid: request.previewSourceUuid,
                    titanMauler,
                };
            }
            catch (error) {
                return {
                    state: "error",
                    message: error instanceof Error
                        ? error.message
                        : "The gear list would not load. Ask your GM to check the approved equipment sources.",
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
            const resolved = await catalogueFor(policy).resolveForApply(context, request.sourceUuid);
            assertSupportedCandidate(resolved);
            const priced = await buildResolvedPrice({
                resolved,
                requestedQuantity: 1,
                targetSize: sourceSize(resolved.source),
                actor: request.actor,
                targetLevel: policy.targetLevel,
                packs: options.packs,
                prepareConfiguredItem,
            });
            const itemPermanence = permanence(resolved.candidate.itemType);
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
                stackingIntent: "aggregate",
                price: priced.price,
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
            const actorSize = await resolveDraftedAncestryEquipmentSize(request.draft, fetchDocumentByUuid);
            if (!actorSize) {
                throw new TypeError("Titan Mauler requires a selected ancestry with a supported size.");
            }
            const targetSize = titanMaulerTargetSize(actorSize);
            if (!targetSize)
                throw new TypeError("Titan Mauler cannot prepare a weapon larger than Gargantuan.");
            const { policy, context } = currentContext(request.actor, request.draft, acquisition);
            const resolved = await catalogueFor(policy).resolveForApply(context, request.sourceUuid);
            assertTitanMaulerCandidate(resolved);
            assertExactCompendiumSource(resolved.candidate.sourceUuid, resolved.source);
            return buildTitanMaulerLine({
                resolved,
                policy,
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
                    targetSize: sourceSize(resolved.source),
                    actor: request.actor,
                    targetLevel: policy.targetLevel,
                    packs: options.packs,
                    prepareConfiguredItem,
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
            return createAcquisitionPolicySnapshot(resolveEffectivePolicy(actor, acquisition), acquisition.recipe);
        },
        async resolveSourceForApply(request) {
            const persisted = normalizeAcquisitionDraft(cloneData(request.characterDraft.acquisition));
            const requested = normalizeAcquisitionDraft(cloneData(request.acquisition));
            if (!persisted || !requested || canonicalJson(persisted) !== canonicalJson(requested)) {
                throw new TypeError("The Apply source request does not match the persisted acquisition state.");
            }
            const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
            const lines = request.entry.lineIds.map((lineId) => {
                const line = request.acquisition.lines.find((candidate) => candidate.lineId === lineId);
                if (!line)
                    throw new TypeError(`Prepared acquisition line ${lineId} is unavailable.`);
                return line;
            });
            const catalogue = catalogueFor(policy);
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
            if (request.entry.funding.lane === "class-grant" && request.entry.funding.grant.plannedGrantId === titanGrantId) {
                if (lines.length !== 1 || lines[0]?.funding.lane !== "class-grant") {
                    throw new Error("Titan Mauler must resolve from exactly one automatic build-grant line.");
                }
                const actorSize = await resolveDraftedAncestryEquipmentSize(request.characterDraft, fetchDocumentByUuid);
                const targetSize = actorSize ? titanMaulerTargetSize(actorSize) : null;
                if (!actorSize ||
                    !targetSize ||
                    request.entry.price.size !== targetSize ||
                    lines[0].price.size !== targetSize) {
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
            }
            const priced = await buildResolvedPrice({
                resolved,
                requestedQuantity: request.entry.price.requestedQuantity,
                targetSize: request.entry.price.size,
                actor: request.actor,
                targetLevel: policy.targetLevel,
                packs: options.packs,
                prepareConfiguredItem,
            });
            return {
                source: cloneData(resolved.source),
                sourceUuid: resolved.candidate.sourceUuid,
                documentFingerprint: resolved.documentFingerprint,
                priceFingerprint: priced.priceFingerprint,
                resolvedPrice: priced.price,
                policyDecision: cloneData(resolved.policyDecision),
            };
        },
        async resolveCurrentCharacterAccessRef(request) {
            const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
            const resolved = await catalogueFor(policy).resolveForApply(context, request.sourceUuid);
            assertTitanMaulerCandidate(resolved);
            return resolved.policyDecision.characterAccessRef;
        },
        async resolveItemExceptionFacts(request) {
            const { policy, context } = currentContext(request.actor, request.characterDraft, request.acquisition);
            const resolved = await catalogueFor(policy).resolveForApply(context, request.sourceUuid);
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
                actorSize = await resolveDraftedAncestryEquipmentSize(request.characterDraft, fetchDocumentByUuid);
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
                current = {
                    policy,
                    resolved: await catalogueFor(policy).resolveForApply(context, line.sourceUuid),
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
            for (const catalogue of catalogues.values())
                catalogue.invalidatePack(packId);
        },
    };
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
                return game.packs?.get?.(packId);
            },
        },
    });
    return foundryRuntime;
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
    const configuration = configuredItemFacts(input.resolved.source, input.resolved.candidate.itemType);
    if (!configuration) {
        return {
            price: buildSimpleResolvedPrice(input.resolved, input.requestedQuantity, input.targetSize),
            priceFingerprint: input.resolved.priceFingerprint,
        };
    }
    if (configuration.specific !== null) {
        throw new Error("This specific configured magic item requires an explicit PF2E inventory-sheet handoff.");
    }
    if (input.requestedQuantity !== 1 ||
        input.resolved.candidate.price.per !== 1 ||
        input.resolved.candidate.price.sourceQuantity !== 1) {
        throw new Error("Configured equipment is supported only as one individually priced permanent item.");
    }
    const pack = input.packs.get(input.resolved.candidate.packId);
    if (!pack)
        throw new Error("The configured equipment base-item pack is unavailable.");
    const index = Array.from((await pack.getIndex({
        fields: ["type", "system.slug", "system.level.value", "system.runes", "system.material"],
    })) ?? []);
    const baseEntry = index.find((entry) => {
        const candidate = record(entry);
        return candidate.type === configuration.itemType && record(candidate.system).slug === configuration.baseItem;
    });
    const baseId = record(baseEntry)._id;
    if (typeof baseId !== "string" || !baseId) {
        throw new Error("PF2E did not expose the configured equipment's clean base item; use the inventory sheet.");
    }
    const baseDocument = await pack.getDocument(baseId);
    const baseSource = documentSource(baseDocument);
    if (!baseSource)
        throw new Error("The configured equipment clean base item is no longer available.");
    const emptyMaterial = { type: null, grade: null };
    const emptyRunes = configuration.itemType === "weapon"
        ? { potency: 0, striking: 0, property: [] }
        : { potency: 0, resilient: 0, property: [] };
    const fundamentalRunes = { ...configuration.runes, property: [] };
    const prepare = (base, runes, material, forceNonSpecific) => input.prepareConfiguredItem({
        actor: input.actor,
        targetLevel: input.targetLevel,
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
        throw new Error("PF2E cannot safely express this configured item as a decomposed starting-equipment choice.");
    }
    const effectiveFundamental = fundamentalPrepared.runes.potency > 0 || meaningfulFundamental(fundamentalPrepared.runes.fundamental);
    const propertyRuneCopper = runeOnlyPrepared.runes.property.length > 0
        ? runeOnlyPrepared.totalCopper - (effectiveFundamental ? fundamentalPrepared.totalCopper : 0)
        : 0;
    const preciousMaterialCopper = materialPrepared.material.type && materialPrepared.material.grade ? materialPrepared.totalCopper : 0;
    const baselineAndFundamentalCopper = fullPrepared.totalCopper - propertyRuneCopper - preciousMaterialCopper;
    if (![propertyRuneCopper, preciousMaterialCopper, baselineAndFundamentalCopper].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("PF2E configured-item components did not converge to a safe exact price.");
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
    if (snapshot.ok === false || snapshot.value.unitPriceCopper !== fullPrepared.totalCopper) {
        throw new Error("Configured equipment price components do not equal PF2E's prepared total.");
    }
    return {
        price: snapshot.value,
        priceFingerprint: fingerprintPreparedPrice(snapshot.value),
    };
}
function buildSimpleResolvedPrice(resolved, requestedQuantity, targetSize) {
    const normalized = resolved.candidate.price;
    const source = record(resolved.source);
    const system = record(source.system);
    const price = record(system.price);
    const sizeSensitive = price.sizeSensitive === undefined ? true : price.sizeSensitive;
    if (typeof sizeSensitive !== "boolean")
        throw new TypeError("The equipment size-pricing fact is malformed.");
    const basePrice = normalized.kind === "priced" && normalized.value
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
    if (snapshot.ok === false)
        throw new TypeError(snapshot.message);
    return snapshot.value;
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
function prepareTransientConfiguredItem(input) {
    const actorToObject = record(input.actor).toObject;
    if (typeof actorToObject !== "function") {
        throw new Error("Configured equipment requires a PF2E actor preparation context.");
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
    actorSource.name = `Wayfinder configured-item preparation ${input.targetLevel}`;
    const itemSource = cloneData(input.baseSource);
    const itemSystem = record(itemSource.system);
    itemSystem.runes = cloneData(input.runes);
    itemSystem.material = cloneData(input.material);
    if (input.forceNonSpecific)
        itemSystem.specific = null;
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
        throw new Error("PF2E did not prepare the transient configured item.");
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
        price: buildSimpleResolvedPrice(args.resolved, 1, args.targetSize),
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
function sourceSize(source) {
    const raw = record(source.system).size;
    const sizes = {
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
    return sizes[raw.trim().toLowerCase()];
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
function toUiRecord(entry) {
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
        exceptionRequestable: entry.unavailableReasons.length > 0 &&
            entry.unavailableReasons.every((reason) => reason.code === "source-not-allowed" || reason.code === "rarity-not-available"),
        titanMaulerEligible: isPotentialTitanMaulerEntry(entry),
    };
}
function isPotentialTitanMaulerEntry(entry) {
    return (entry.available &&
        entry.itemType === "weapon" &&
        !entry.traits.includes("unarmed") &&
        entry.price.kind === "priced" &&
        entry.price.copperValue !== null &&
        entry.price.copperValue <= 900 &&
        entry.price.sourceQuantity === 1 &&
        (entry.rarity === "common" || entry.policyDecision.characterAccessRef !== null));
}
function catalogueFilters(entries) {
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
function publicationLabel(slug) {
    return title(slug.replace(/-/g, " "));
}
function title(value) {
    return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
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
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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