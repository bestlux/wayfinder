import { normalizeAcquisitionFunding, normalizeAcquisitionLinePolicyDecision, normalizeAcquisitionMaterialLineFacts, normalizeAcquisitionPolicySnapshot, normalizeAcquisitionPriceSnapshot, } from "./acquisition-draft.js";
import { assertPreparedAcquisitionIdentityPlanMatches, } from "./acquisition-identity.js";
import { resolveAcquisitionPrice } from "./acquisition-ledger.js";
import { isClassGrantReconciliationConsistent, normalizePlannedClassGrant, } from "./class-grant-reconciliation.js";
import { normalizeEconomicBaseline } from "./economic-baseline.js";
export function createCompletedAcquisitionManifest(args) {
    const { draft, identityPlan } = args;
    assertPreparedAcquisitionIdentityPlanMatches({ plan: identityPlan, actorId: args.actorId, draft });
    if (!draft.policySnapshot || !draft.baseline) {
        throw new TypeError("A completed acquisition manifest requires reviewed policy and economic baseline facts.");
    }
    if (!validTimestamp(args.appliedAt) || !nonEmpty(args.appliedBy.userId) || !nonEmpty(args.appliedBy.userName)) {
        throw new TypeError("A completed acquisition manifest requires applying user and time evidence.");
    }
    const disposition = completedDisposition(draft);
    const reconciliation = args.finalClassGrantReconciliation;
    if (!isClassGrantReconciliationConsistent(reconciliation) ||
        reconciliation.phase !== "final" ||
        reconciliation.draftId !== draft.draftId ||
        reconciliation.batchId !== draft.batchId) {
        throw new TypeError("Completed class-grant evidence belongs to another acquisition.");
    }
    const grantEntries = new Map(reconciliation.entries.map((entry) => [entry.grantId, entry]));
    if (grantEntries.size !== draft.plannedClassGrants.length ||
        draft.plannedClassGrants.some((grant) => !grantEntries.has(grant.grantId))) {
        throw new TypeError("Completed class-grant evidence does not cover the prepared plan exactly.");
    }
    if (disposition !== "handoff" && reconciliation.entries.some((entry) => entry.status !== "resolved")) {
        throw new TypeError("Automated acquisition cannot complete with unresolved or ambiguous class grants.");
    }
    if (disposition === "handoff" && args.observedItems.length > 0) {
        throw new TypeError("A handoff manifest cannot claim automated item mutation.");
    }
    validateCurrency(args.currency, identityPlan, draft.baseline.currencyCopper, disposition);
    const observedByPlannedId = new Map();
    const actualItemIds = new Set();
    for (const observed of args.observedItems) {
        if (!nonEmpty(observed.plannedItemId) ||
            !nonEmpty(observed.actualItemId) ||
            !nonEmpty(observed.actualSourceUuid) ||
            !safePositiveInteger(observed.actualQuantity) ||
            observedByPlannedId.has(observed.plannedItemId) ||
            actualItemIds.has(observed.actualItemId) ||
            (observed.plannedContainerId !== null && !nonEmpty(observed.plannedContainerId)) ||
            (observed.actualContainerId !== null && !nonEmpty(observed.actualContainerId))) {
            throw new TypeError("Completed acquisition item evidence is malformed or duplicated.");
        }
        observedByPlannedId.set(observed.plannedItemId, structuredClone(observed));
        actualItemIds.add(observed.actualItemId);
    }
    const entries = identityPlan.entries.map((entry) => {
        const observedItems = entry.plannedItems.flatMap((planned) => {
            const observed = observedByPlannedId.get(planned.plannedItemId);
            if (!observed)
                return [];
            if (observed.plannedContainerId !== planned.plannedContainerId) {
                throw new TypeError("Completed acquisition container identity differs from the prepared plan.");
            }
            if (observed.actualSourceUuid !== planned.sourceUuid || observed.actualQuantity !== planned.quantity) {
                throw new TypeError("Completed acquisition item facts differ from the prepared plan.");
            }
            return [observed];
        });
        if (disposition !== "handoff" && observedItems.length !== entry.plannedItems.length) {
            throw new TypeError("Completed acquisition evidence is missing a prepared item identity.");
        }
        return {
            entryId: entry.entryId,
            preAggregationKey: entry.preAggregationKey,
            lineIds: [...entry.lineIds],
            sourceUuid: entry.sourceUuid,
            documentFingerprint: entry.documentFingerprint,
            priceFingerprint: entry.priceFingerprint,
            quantity: entry.quantity,
            stackingIntent: entry.stackingIntent,
            funding: structuredClone(entry.funding),
            resolvedAllowanceId: entry.resolvedAllowanceId,
            policyDecision: structuredClone(entry.policyDecision),
            price: structuredClone(entry.price),
            plannedItems: structuredClone(entry.plannedItems),
            observedItems,
        };
    });
    const plannedIds = new Set(identityPlan.entries.flatMap((entry) => entry.plannedItems.map((item) => item.plannedItemId)));
    if ([...observedByPlannedId.keys()].some((plannedId) => !plannedIds.has(plannedId))) {
        throw new TypeError("Completed acquisition evidence contains an unplanned item identity.");
    }
    if (!observedContainersMatchPlan(entries)) {
        throw new TypeError("Completed acquisition container evidence differs from the prepared plan.");
    }
    const classGrants = draft.plannedClassGrants.map((grant) => {
        const entry = grantEntries.get(grant.grantId);
        if (entry.status === "pending")
            throw new TypeError("Final class-grant evidence cannot remain pending.");
        return {
            grant: structuredClone(grant),
            status: entry.status,
            observedItemIds: [...entry.itemIds].sort(),
        };
    });
    if (!classGrantFundedEntriesMatch(entries, classGrants, disposition !== "handoff")) {
        throw new TypeError("Completed class-grant item evidence differs from acquisition item evidence.");
    }
    const policy = normalizeAcquisitionPolicySnapshot(draft.policySnapshot);
    if (!policy)
        throw new TypeError("Completed acquisition policy evidence is malformed.");
    const material = {
        schemaVersion: 1,
        id: draft.manifestId,
        actorId: args.actorId,
        draftId: draft.draftId,
        batchId: draft.batchId,
        appliedBy: structuredClone(args.appliedBy),
        appliedAt: args.appliedAt,
        targetLevel: draft.targetLevel,
        disposition,
        policy,
        ledgerDigest: identityPlan.ledgerDigest,
        economicBaseline: structuredClone(draft.baseline),
        currency: structuredClone(args.currency),
        logicalLines: structuredClone(identityPlan.materialFacts.lines),
        entries,
        classGrants,
        environment: structuredClone(args.environment),
    };
    const manifest = { ...material, fingerprint: manifestFingerprint(material) };
    assertCompletedAcquisitionManifestMatchesIdentityPlan(manifest, identityPlan);
    return manifest;
}
export function normalizeCompletedAcquisitionManifest(raw) {
    if (!isRecord(raw) || raw.schemaVersion !== 1)
        return null;
    if (!nonEmpty(raw.id) ||
        !nonEmpty(raw.actorId) ||
        !nonEmpty(raw.draftId) ||
        !nonEmpty(raw.batchId) ||
        !isRecord(raw.appliedBy) ||
        !nonEmpty(raw.appliedBy.userId) ||
        !nonEmpty(raw.appliedBy.userName) ||
        !validTimestamp(raw.appliedAt) ||
        !validTargetLevel(raw.targetLevel) ||
        (raw.disposition !== "purchase-ledger" && raw.disposition !== "retain-all" && raw.disposition !== "handoff") ||
        !nonEmpty(raw.ledgerDigest) ||
        !isRecord(raw.currency) ||
        !Array.isArray(raw.logicalLines) ||
        !Array.isArray(raw.entries) ||
        !Array.isArray(raw.classGrants) ||
        !isRecord(raw.environment) ||
        !nonEmpty(raw.environment.foundryVersion) ||
        !nonEmpty(raw.environment.pf2eVersion) ||
        !nonEmpty(raw.environment.moduleVersion) ||
        !nonEmpty(raw.fingerprint)) {
        return null;
    }
    const policy = normalizeAcquisitionPolicySnapshot(raw.policy);
    const disposition = raw.disposition;
    const baseline = normalizeEconomicBaseline(raw.economicBaseline);
    const entries = normalizeCompletedEntries(raw.entries, disposition);
    const logicalLines = raw.logicalLines.map(normalizeAcquisitionMaterialLineFacts);
    const classGrants = normalizeCompletedClassGrants(raw.classGrants);
    if (!policy ||
        !baseline ||
        baseline.actorId !== raw.actorId ||
        policy.material.subject.actorId !== raw.actorId ||
        policy.material.subject.draftId !== raw.draftId ||
        policy.material.subject.targetLevel !== raw.targetLevel ||
        !entries ||
        !classGrants ||
        !observedContainersMatchPlan(entries) ||
        (disposition !== "handoff" && classGrants.some((entry) => entry.status !== "resolved")) ||
        !classGrantFundedEntriesMatch(entries, classGrants, disposition !== "handoff") ||
        logicalLines.some((line) => !line) ||
        !completedEntriesCoverLogicalLines(entries, logicalLines)) {
        return null;
    }
    const currency = structuredClone(raw.currency);
    if (!validManifestCurrency(currency))
        return null;
    const spentCopper = completedEntrySpend(entries);
    if (spentCopper === null || (disposition !== "handoff" && spentCopper !== currency.spentCopper))
        return null;
    const ordinaryEntryCount = entries.filter((entry) => entry.funding.lane !== "class-grant").length;
    if ((disposition === "retain-all" && (ordinaryEntryCount !== 0 || currency.spentCopper !== 0)) ||
        (disposition === "purchase-ledger" && ordinaryEntryCount === 0)) {
        return null;
    }
    try {
        validateNormalizedCurrency(currency, policy.material.budgetCopper, baseline.currencyCopper, disposition);
    }
    catch {
        return null;
    }
    const material = {
        schemaVersion: 1,
        id: raw.id,
        actorId: raw.actorId,
        draftId: raw.draftId,
        batchId: raw.batchId,
        appliedBy: { userId: raw.appliedBy.userId, userName: raw.appliedBy.userName },
        appliedAt: raw.appliedAt,
        targetLevel: raw.targetLevel,
        disposition,
        policy,
        ledgerDigest: raw.ledgerDigest,
        economicBaseline: baseline,
        currency,
        logicalLines: logicalLines,
        entries,
        classGrants,
        environment: {
            foundryVersion: raw.environment.foundryVersion,
            pf2eVersion: raw.environment.pf2eVersion,
            moduleVersion: raw.environment.moduleVersion,
        },
    };
    if (raw.fingerprint !== manifestFingerprint(material))
        return null;
    return { ...material, fingerprint: raw.fingerprint };
}
export function manifestsMateriallyEqual(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
export function manifestsDescribeSameOutcome(left, right) {
    return canonicalJson(stableOutcome(left)) === canonicalJson(stableOutcome(right));
}
export function assertCompletedAcquisitionManifestMatchesIdentityPlan(manifest, identityPlan) {
    const expectedPolicy = {
        version: 1,
        fingerprint: identityPlan.policyFingerprint,
        material: identityPlan.materialFacts.policyMaterial,
    };
    const expectedEntries = identityPlan.entries.map((entry) => ({
        entryId: entry.entryId,
        preAggregationKey: entry.preAggregationKey,
        lineIds: entry.lineIds,
        sourceUuid: entry.sourceUuid,
        documentFingerprint: entry.documentFingerprint,
        priceFingerprint: entry.priceFingerprint,
        quantity: entry.quantity,
        stackingIntent: entry.stackingIntent,
        funding: entry.funding,
        resolvedAllowanceId: entry.resolvedAllowanceId,
        policyDecision: entry.policyDecision,
        price: entry.price,
        plannedItems: entry.plannedItems,
    }));
    const actualEntries = manifest.entries.map(({ observedItems: _observedItems, ...entry }) => entry);
    const expectedRemaining = manifest.disposition === "handoff" ? identityPlan.ledger.budgetCopper : identityPlan.ledger.remainingCopper;
    const expectedSpent = manifest.disposition === "handoff" ? 0 : identityPlan.ledger.spentCopper;
    if (manifest.id !== identityPlan.subject.manifestId ||
        manifest.actorId !== identityPlan.subject.actorId ||
        manifest.draftId !== identityPlan.subject.draftId ||
        manifest.batchId !== identityPlan.subject.batchId ||
        manifest.targetLevel !== identityPlan.subject.targetLevel ||
        manifest.disposition !== identityPlan.disposition.kind ||
        manifest.ledgerDigest !== identityPlan.ledgerDigest ||
        manifest.currency.budgetCopper !== identityPlan.ledger.budgetCopper ||
        manifest.currency.spentCopper !== expectedSpent ||
        manifest.currency.remainingCopper !== expectedRemaining ||
        canonicalJson(manifest.policy) !== canonicalJson(expectedPolicy) ||
        canonicalJson(manifest.economicBaseline) !== canonicalJson(identityPlan.materialFacts.baseline) ||
        canonicalJson(manifest.logicalLines) !== canonicalJson(identityPlan.materialFacts.lines) ||
        canonicalJson(actualEntries) !== canonicalJson(expectedEntries) ||
        canonicalJson(manifest.classGrants.map((entry) => entry.grant)) !==
            canonicalJson(identityPlan.materialFacts.plannedClassGrants)) {
        throw new TypeError("Completed acquisition evidence differs from the prepared identity plan.");
    }
}
export function completedClassGrantsMatchFinalReconciliation(manifest, reconciliation) {
    if (!isClassGrantReconciliationConsistent(reconciliation) || reconciliation.phase !== "final")
        return false;
    if (manifest.draftId !== reconciliation.draftId || manifest.batchId !== reconciliation.batchId)
        return false;
    const entries = new Map(reconciliation.entries.map((entry) => [entry.grantId, entry]));
    return (entries.size === manifest.classGrants.length &&
        manifest.classGrants.every((completed) => {
            const observed = entries.get(completed.grant.grantId);
            return (observed?.status === completed.status &&
                canonicalJson([...observed.itemIds].sort()) === canonicalJson([...completed.observedItemIds].sort()));
        }));
}
export function findCompletedAcquisitionManifestByBatchId(manifest, batchId) {
    return manifest?.batchId === batchId ? structuredClone(manifest) : null;
}
export function computeCompletedAcquisitionManifestFingerprint(value) {
    if (!isRecord(value))
        throw new TypeError("Completed acquisition manifest material must be an object.");
    const { fingerprint: _fingerprint, ...material } = value;
    return manifestFingerprint(material);
}
function completedDisposition(draft) {
    if (draft.disposition.kind === "purchase-ledger" || draft.disposition.kind === "retain-all") {
        return draft.disposition.kind;
    }
    if (draft.disposition.kind === "handoff" &&
        nonEmpty(draft.disposition.acknowledgedByUserId) &&
        validTimestamp(draft.disposition.acknowledgedAt)) {
        return "handoff";
    }
    throw new TypeError("Acquisition completion requires reviewed purchase, retain-all, or acknowledged handoff state.");
}
function validateCurrency(currency, identityPlan, baselineCopper, disposition) {
    if (currency.budgetCopper !== identityPlan.ledger.budgetCopper ||
        currency.spentCopper !== (disposition === "handoff" ? 0 : identityPlan.ledger.spentCopper) ||
        currency.remainingCopper !==
            (disposition === "handoff" ? identityPlan.ledger.budgetCopper : identityPlan.ledger.remainingCopper)) {
        throw new TypeError("Completed acquisition currency differs from the prepared ledger.");
    }
    validateNormalizedCurrency(currency, identityPlan.ledger.budgetCopper, baselineCopper, disposition);
}
function validateNormalizedCurrency(currency, budgetCopper, baselineCopper, disposition) {
    if (!validManifestCurrency(currency) ||
        currency.budgetCopper !== budgetCopper ||
        currency.preCopper !== baselineCopper) {
        throw new TypeError("Completed acquisition currency evidence is invalid.");
    }
    if (disposition === "handoff") {
        if (currency.spentCopper !== 0 ||
            currency.targetCopper !== currency.preCopper ||
            currency.observedCopper !== currency.preCopper) {
            throw new TypeError("A handoff manifest cannot claim automated currency mutation.");
        }
        return;
    }
    if (currency.spentCopper + currency.remainingCopper !== currency.budgetCopper ||
        currency.targetCopper !== currency.preCopper + currency.remainingCopper ||
        currency.observedCopper !== currency.targetCopper) {
        throw new TypeError("Completed acquisition currency does not reconcile to the reviewed budget.");
    }
}
function validManifestCurrency(value) {
    return [
        value.preCopper,
        value.budgetCopper,
        value.targetCopper,
        value.observedCopper,
        value.spentCopper,
        value.remainingCopper,
    ].every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}
function normalizeCompletedEntries(rawEntries, disposition) {
    const entryIds = new Set();
    const lineIds = new Set();
    const plannedIds = new Set();
    const ownedContainerIds = new Set();
    const actualIds = new Set();
    const entries = [];
    for (const raw of rawEntries) {
        if (!isRecord(raw) ||
            !nonEmpty(raw.entryId) ||
            entryIds.has(raw.entryId) ||
            !nonEmpty(raw.preAggregationKey) ||
            !nonEmpty(raw.sourceUuid) ||
            !nonEmpty(raw.documentFingerprint) ||
            !nonEmpty(raw.priceFingerprint) ||
            !safePositiveInteger(raw.quantity) ||
            (raw.stackingIntent !== "aggregate" && raw.stackingIntent !== "separate") ||
            !Array.isArray(raw.lineIds) ||
            raw.lineIds.length === 0 ||
            !Array.isArray(raw.plannedItems) ||
            !Array.isArray(raw.observedItems) ||
            !isRecord(raw.policyDecision)) {
            return null;
        }
        const funding = normalizeAcquisitionFunding(raw.funding);
        const price = normalizeAcquisitionPriceSnapshot(raw.price);
        const resolvedAllowanceId = raw.resolvedAllowanceId;
        if (!funding ||
            !price ||
            (resolvedAllowanceId !== null && !nonEmpty(resolvedAllowanceId)) ||
            (funding.lane === "allowance" && resolvedAllowanceId === null) ||
            (funding.lane !== "allowance" && resolvedAllowanceId !== null)) {
            return null;
        }
        entryIds.add(raw.entryId);
        const normalizedLineIds = [];
        for (const lineId of raw.lineIds) {
            if (!nonEmpty(lineId) || lineIds.has(lineId))
                return null;
            lineIds.add(lineId);
            normalizedLineIds.push(lineId);
        }
        const entryPlannedIds = new Set();
        const plannedItems = [];
        for (const planned of raw.plannedItems) {
            const ownedContainerId = isRecord(planned) ? planned.ownedContainerId : undefined;
            if (!isRecord(planned) ||
                !nonEmpty(planned.plannedItemId) ||
                plannedIds.has(planned.plannedItemId) ||
                (ownedContainerId !== null && (!nonEmpty(ownedContainerId) || ownedContainerIds.has(ownedContainerId))) ||
                !nonEmpty(planned.sourceUuid) ||
                !safePositiveInteger(planned.quantity) ||
                (planned.plannedContainerId !== null && !nonEmpty(planned.plannedContainerId))) {
                return null;
            }
            const normalizedOwnedContainerId = ownedContainerId === null ? null : String(ownedContainerId);
            plannedIds.add(planned.plannedItemId);
            if (normalizedOwnedContainerId !== null)
                ownedContainerIds.add(normalizedOwnedContainerId);
            entryPlannedIds.add(planned.plannedItemId);
            plannedItems.push({
                plannedItemId: planned.plannedItemId,
                ownedContainerId: normalizedOwnedContainerId,
                sourceUuid: planned.sourceUuid,
                quantity: planned.quantity,
                plannedContainerId: planned.plannedContainerId === null ? null : String(planned.plannedContainerId),
            });
        }
        if (plannedItems.length === 0 ||
            plannedItems.some((item) => item.sourceUuid !== raw.sourceUuid) ||
            plannedItems.reduce((total, item) => total + item.quantity, 0) !== raw.quantity ||
            price.materializedQuantity !== raw.quantity) {
            return null;
        }
        const observedPlannedIds = new Set();
        const observedItems = [];
        for (const observed of raw.observedItems) {
            const planned = isRecord(observed)
                ? plannedItems.find((item) => item.plannedItemId === observed.plannedItemId)
                : undefined;
            if (!isRecord(observed) ||
                !planned ||
                !nonEmpty(observed.plannedItemId) ||
                !entryPlannedIds.has(observed.plannedItemId) ||
                observedPlannedIds.has(observed.plannedItemId) ||
                !nonEmpty(observed.actualItemId) ||
                actualIds.has(observed.actualItemId) ||
                !nonEmpty(observed.actualSourceUuid) ||
                observed.actualSourceUuid !== planned.sourceUuid ||
                !safePositiveInteger(observed.actualQuantity) ||
                observed.actualQuantity !== planned.quantity ||
                (observed.plannedContainerId !== null && !nonEmpty(observed.plannedContainerId)) ||
                observed.plannedContainerId !== planned.plannedContainerId ||
                (observed.actualContainerId !== null && !nonEmpty(observed.actualContainerId))) {
                return null;
            }
            actualIds.add(observed.actualItemId);
            observedPlannedIds.add(observed.plannedItemId);
            observedItems.push({
                plannedItemId: observed.plannedItemId,
                actualItemId: observed.actualItemId,
                actualSourceUuid: observed.actualSourceUuid,
                actualQuantity: observed.actualQuantity,
                plannedContainerId: observed.plannedContainerId === null ? null : String(observed.plannedContainerId),
                actualContainerId: observed.actualContainerId === null ? null : String(observed.actualContainerId),
            });
        }
        if (disposition === "handoff" ? observedItems.length !== 0 : observedItems.length !== plannedItems.length) {
            return null;
        }
        const policyDecision = normalizeAcquisitionLinePolicyDecision(raw.policyDecision);
        if (!policyDecision)
            return null;
        entries.push({
            entryId: raw.entryId,
            preAggregationKey: raw.preAggregationKey,
            lineIds: normalizedLineIds,
            sourceUuid: raw.sourceUuid,
            documentFingerprint: raw.documentFingerprint,
            priceFingerprint: raw.priceFingerprint,
            quantity: raw.quantity,
            stackingIntent: raw.stackingIntent,
            funding,
            resolvedAllowanceId: resolvedAllowanceId === null ? null : String(resolvedAllowanceId),
            policyDecision,
            price,
            plannedItems,
            observedItems,
        });
    }
    return entries;
}
function normalizeCompletedClassGrants(rawGrants) {
    const ids = new Set();
    const grants = [];
    for (const raw of rawGrants) {
        if (!isRecord(raw))
            return null;
        const grant = normalizePlannedClassGrant(raw.grant);
        if (!grant)
            return null;
        const id = grant.grantId;
        if (!nonEmpty(id) ||
            ids.has(id) ||
            (raw.status !== "resolved" && raw.status !== "unresolved" && raw.status !== "ambiguous") ||
            !Array.isArray(raw.observedItemIds) ||
            new Set(raw.observedItemIds).size !== raw.observedItemIds.length ||
            raw.observedItemIds.some((itemId) => !nonEmpty(itemId))) {
            return null;
        }
        ids.add(id);
        if ((raw.status === "resolved" && raw.observedItemIds.length === 0) ||
            (raw.status === "unresolved" && raw.observedItemIds.length !== 0) ||
            (raw.status === "ambiguous" && raw.observedItemIds.length < 2)) {
            return null;
        }
        grants.push({ grant, status: raw.status, observedItemIds: [...raw.observedItemIds].sort() });
    }
    return grants;
}
function observedContainersMatchPlan(entries) {
    const plannedItems = entries.flatMap((entry) => entry.plannedItems);
    const observedByPlannedId = new Map(entries.flatMap((entry) => entry.observedItems.map((observed) => [observed.plannedItemId, observed])));
    const ownerByContainerId = new Map(plannedItems.flatMap((planned) => planned.ownedContainerId === null ? [] : [[planned.ownedContainerId, planned.plannedItemId]]));
    const parentByPlannedItemId = new Map();
    for (const planned of plannedItems) {
        if (planned.plannedContainerId === null)
            continue;
        const owner = ownerByContainerId.get(planned.plannedContainerId);
        if (!owner)
            return false;
        parentByPlannedItemId.set(planned.plannedItemId, owner);
    }
    for (const planned of plannedItems) {
        const visited = new Set();
        let current = planned.plannedItemId;
        while (current) {
            if (visited.has(current))
                return false;
            visited.add(current);
            current = parentByPlannedItemId.get(current);
        }
    }
    for (const entry of entries) {
        for (const observed of entry.observedItems) {
            if (observed.plannedContainerId === null) {
                if (observed.actualContainerId !== null)
                    return false;
                continue;
            }
            const containerOwnerPlannedItemId = ownerByContainerId.get(observed.plannedContainerId);
            const observedContainer = containerOwnerPlannedItemId
                ? observedByPlannedId.get(containerOwnerPlannedItemId)
                : undefined;
            if (!observedContainer || observed.actualContainerId !== observedContainer.actualItemId)
                return false;
        }
    }
    return true;
}
function classGrantFundedEntriesMatch(entries, classGrants, compareObservedItems) {
    const grantsById = new Map(classGrants.map((entry) => [entry.grant.grantId, entry]));
    const fundedEntries = entries.filter((entry) => entry.funding.lane === "class-grant");
    if (fundedEntries.length !== classGrants.length)
        return false;
    const entryCountsByGrantId = new Map();
    for (const entry of fundedEntries) {
        if (entry.funding.lane !== "class-grant")
            return false;
        const grantId = entry.funding.grant.plannedGrantId;
        entryCountsByGrantId.set(grantId, (entryCountsByGrantId.get(grantId) ?? 0) + 1);
        const completedGrant = grantsById.get(grantId);
        if (!completedGrant ||
            (compareObservedItems &&
                canonicalJson(entry.observedItems.map((item) => item.actualItemId).sort()) !==
                    canonicalJson([...completedGrant.observedItemIds].sort()))) {
            return false;
        }
    }
    return classGrants.every((entry) => entryCountsByGrantId.get(entry.grant.grantId) === 1);
}
function completedEntrySpend(entries) {
    let total = 0;
    for (const entry of entries) {
        const resolved = resolveAcquisitionPrice(entry.price);
        if (!resolved.ok)
            return null;
        const amount = entry.funding.lane === "currency" ? resolved.value.totalCopper : resolved.value.supplementalCopper;
        total += amount;
        if (!Number.isSafeInteger(total))
            return null;
    }
    return total;
}
function completedEntriesCoverLogicalLines(entries, lines) {
    const byId = new Map(lines.map((line) => [line.lineId, line]));
    if (byId.size !== lines.length)
        return false;
    const covered = new Set();
    for (const entry of entries) {
        let requestedQuantity = 0;
        for (const lineId of entry.lineIds) {
            const line = byId.get(lineId);
            if (!line ||
                covered.has(lineId) ||
                line.sourceUuid !== entry.sourceUuid ||
                line.documentFingerprint !== entry.documentFingerprint ||
                line.priceFingerprint !== entry.priceFingerprint ||
                line.stackingIntent !== entry.stackingIntent ||
                canonicalJson(line.funding) !== canonicalJson(entry.funding) ||
                line.resolvedAllowanceId !== entry.resolvedAllowanceId ||
                canonicalJson(line.policyDecision) !== canonicalJson(entry.policyDecision)) {
                return false;
            }
            requestedQuantity += line.requestedQuantity;
            if (!Number.isSafeInteger(requestedQuantity))
                return false;
            covered.add(lineId);
        }
        if (requestedQuantity !== entry.price.requestedQuantity ||
            requestedQuantity * entry.price.sourceQuantity !== entry.quantity) {
            return false;
        }
    }
    return covered.size === lines.length;
}
function stableOutcome(manifest) {
    const { appliedBy: _appliedBy, appliedAt: _appliedAt, environment: _environment, fingerprint: _fingerprint, ...stable } = manifest;
    return stable;
}
function manifestFingerprint(material) {
    const text = canonicalJson(material);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `wf-manifest-fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function validTimestamp(value) {
    return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}
function validTargetLevel(value) {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20;
}
function safePositiveInteger(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=completed-acquisition-manifest.js.map