import { MODULE_ID } from "../../constants.js";
import { cloneData } from "../../shared/cloning.js";
import { normalizeAcquisitionDraft, normalizeAcquisitionPolicySnapshot } from "../domain/acquisition-draft.js";
import { assertPreparedAcquisitionIdentityPlanMatches, prepareAcquisitionIdentityPlan, } from "../domain/acquisition-identity.js";
import { evaluateAcquisitionCompletion, evaluateAcquisitionLedger } from "../domain/acquisition-ledger.js";
import { createCompletedAcquisitionManifest, } from "../domain/completed-acquisition-manifest.js";
import { captureActorEconomicBaseline, evaluateActorEconomicAdmission, } from "./economic-baseline-service.js";
export function createAcquisitionExecutionSession(dependencies) {
    const inventory = dependencies.inventory ?? createPf2eAcquisitionInventoryAdapter();
    const now = dependencies.now ?? (() => new Date().toISOString());
    let prepared = null;
    return {
        readCurrentAcquisitionHistory: async () => {
            const history = await dependencies.readHistory();
            return {
                completedAcquisitionManifest: history.completedAcquisitionManifest,
                completedAcquisitionManifestCorrupt: history.completedAcquisitionManifestCorrupt,
            };
        },
        executeAcquisitionItems: async ({ actor, draft, classGrantPlan, emitWriteCheckpoint }) => {
            prepared = await prepareExecution({
                actor,
                draft,
                classGrantPlan,
                dependencies,
                now,
            });
            if (prepared.handoff)
                return;
            let current = captureBaseline(actor, now);
            assertStableNonAcquisitionItems(prepared.initialBaseline, current, prepared.identityPlan);
            assertCurrencyUnchanged(prepared.initialBaseline, current);
            let observation = observePlannedItems(prepared.identityPlan, current);
            let ordinal = 0;
            for (const entry of prepared.identityPlan.entries) {
                const source = prepared.sources.get(entry.entryId);
                if (!source)
                    throw new Error(`Prepared acquisition source ${entry.entryId} is unavailable.`);
                for (const plannedItem of entry.plannedItems) {
                    if (observation.evidence.some((item) => item.plannedItemId === plannedItem.plannedItemId))
                        continue;
                    ordinal += 1;
                    const stamped = stampAcquisitionSource(source, entry, plannedItem, prepared.identityPlan.subject);
                    await executeItemWrite({
                        actor,
                        source: stamped,
                        ordinal,
                        emitWriteCheckpoint,
                        inventory,
                    });
                    current = captureBaseline(actor, now);
                    assertStableNonAcquisitionItems(prepared.initialBaseline, current, prepared.identityPlan);
                    assertCurrencyUnchanged(prepared.initialBaseline, current);
                    observation = observePlannedItems(prepared.identityPlan, current);
                    if (!observation.evidence.some((item) => item.plannedItemId === plannedItem.plannedItemId)) {
                        throw new Error(`PF2E did not create prepared acquisition item ${plannedItem.plannedItemId}.`);
                    }
                    await emitWriteCheckpoint("embedded-item-create", "after", ordinal);
                }
            }
            assertAllPlannedItemsObserved(prepared.identityPlan, observation);
        },
        executeAcquisitionCurrency: async ({ actor, draft, classGrantPlan, emitWriteCheckpoint }) => {
            const execution = requirePreparedExecution(prepared, actor, draft, classGrantPlan);
            let current = captureBaseline(actor, now);
            assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
            const observation = observePlannedItems(execution.identityPlan, current);
            if (execution.handoff) {
                if (current.fingerprint !== execution.initialBaseline.fingerprint) {
                    throw new Error("Actor wealth changed after the starting-equipment handoff was admitted.");
                }
                return;
            }
            assertAllPlannedItemsObserved(execution.identityPlan, observation);
            const delta = execution.targetCopper - current.currencyCopper;
            if (!Number.isSafeInteger(delta))
                throw new RangeError("Starting-equipment currency delta is unsafe.");
            if (delta !== 0) {
                await emitWriteCheckpoint("currency-convergence", "before", 1);
                if (delta > 0)
                    await inventory.addCurrency(actor, delta);
                else
                    await inventory.removeCurrency(actor, -delta);
                current = captureBaseline(actor, now);
                assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
                assertAllPlannedItemsObserved(execution.identityPlan, observePlannedItems(execution.identityPlan, current));
                if (current.currencyCopper !== execution.targetCopper) {
                    throw new Error("PF2E did not converge actor currency to the reviewed absolute target.");
                }
                await emitWriteCheckpoint("currency-convergence", "after", 1);
            }
            if (current.currencyCopper !== execution.targetCopper) {
                throw new Error("Actor currency differs from the reviewed absolute target.");
            }
        },
        verifyAcquisitionOutcome: async ({ actor, draft, classGrantPlan, finalClassGrantReconciliation, }) => {
            const execution = requirePreparedExecution(prepared, actor, draft, classGrantPlan);
            return verifyPreparedExecution({
                actor,
                execution,
                finalClassGrantReconciliation,
                dependencies,
                now,
            });
        },
        prepareRecoveredAcquisitionOutcome: async ({ actor, draft, classGrantPlan, finalClassGrantReconciliation }) => {
            const execution = await prepareExecution({
                actor,
                draft,
                classGrantPlan,
                dependencies,
                now,
                recoveryFinalization: true,
            });
            return verifyPreparedExecution({
                actor,
                execution,
                finalClassGrantReconciliation,
                dependencies,
                now,
            });
        },
    };
}
export function createPf2eAcquisitionInventoryAdapter() {
    return {
        add: async (actor, source, options) => {
            const inventory = actorInventory(actor);
            const add = inventory.add;
            if (typeof add !== "function")
                throw new Error("PF2E actor inventory item insertion is unavailable.");
            return Reflect.apply(add, inventory, [source, options]);
        },
        addCurrency: async (actor, copper) => callCurrencyMethod(actor, "addCurrency", copper),
        removeCurrency: async (actor, copper) => callCurrencyMethod(actor, "removeCurrency", copper),
    };
}
async function prepareExecution(args) {
    const actorId = actorIdentifier(args.actor);
    const acquisition = normalizeAcquisitionDraft(cloneData(args.draft.acquisition));
    if (!acquisition)
        throw new TypeError("Starting-equipment execution requires canonical acquisition state.");
    if (acquisition.targetLevel !== 1 || args.draft.targetLevel !== 1) {
        throw new Error("Wave 2 starting-equipment execution is limited to level 1.");
    }
    if (args.recoveryFinalization && !hasApplyRecoveryState(args.draft)) {
        throw new Error("Starting-equipment recovery verification requires persisted Apply recovery evidence.");
    }
    const ledger = evaluateAcquisitionLedger(acquisition, args.classGrantPlan);
    const completion = evaluateAcquisitionCompletion(acquisition, ledger);
    if (!ledger.valid || !ledger.materialFacts || !completion.complete) {
        throw new Error(`Starting-equipment review is incomplete: ${completion.reasons.join(", ") || "invalid-ledger"}.`);
    }
    const identityPlan = await prepareAcquisitionIdentityPlan({
        actorId,
        draft: acquisition,
        ledger,
        classGrantPlan: args.classGrantPlan,
    });
    assertWaveTwoIdentityShape(identityPlan);
    const targetCopper = acquisition.disposition.kind === "handoff"
        ? acquisition.baseline.currencyCopper
        : safeCopperAdd(acquisition.baseline.currencyCopper, identityPlan.ledger.remainingCopper);
    const retryExpectation = buildRetryExpectation(identityPlan, targetCopper, args.draft);
    const history = await args.dependencies.readHistory();
    const initialBaseline = captureBaseline(args.actor, args.now);
    const admission = evaluateActorEconomicAdmission({
        actor: args.actor,
        draftId: acquisition.draftId,
        batchId: acquisition.batchId,
        targetLevel: acquisition.targetLevel,
        higherLevelStartEvidence: acquisition.policySnapshot.material.higherLevelStartEvidence,
        history: economicHistory(history, args.recoveryFinalization === true),
        retryExpectation,
        preparedClassGrantPlan: args.classGrantPlan,
        classGrantPhase: "before-acquisition",
        capturedAt: initialBaseline.capturedAt,
    });
    const handoff = acquisition.disposition.kind === "handoff";
    assertEconomicAdmission(admission, acquisition, initialBaseline);
    const currentPolicy = normalizeAcquisitionPolicySnapshot(cloneData(await args.dependencies.resolveCurrentPolicySnapshot({ actor: args.actor, draft: acquisition })));
    if (!currentPolicy ||
        !acquisition.policySnapshot ||
        stableJson(currentPolicy.material) !== stableJson(acquisition.policySnapshot.material)) {
        throw new Error("Current starting-equipment policy differs from the reviewed authority.");
    }
    const sources = new Map();
    if (!handoff) {
        for (const entry of identityPlan.entries) {
            const resolved = await args.dependencies.resolveSource({ actor: args.actor, draft: acquisition, entry });
            assertResolvedSourceMatches(entry, resolved);
            sources.set(entry.entryId, cloneData(resolved.source));
        }
    }
    await args.dependencies.assertApplyAuthority({ actor: args.actor, draft: acquisition });
    const policyAfterPreflight = normalizeAcquisitionPolicySnapshot(cloneData(await args.dependencies.resolveCurrentPolicySnapshot({ actor: args.actor, draft: acquisition })));
    if (!policyAfterPreflight ||
        !acquisition.policySnapshot ||
        stableJson(policyAfterPreflight.material) !== stableJson(acquisition.policySnapshot.material)) {
        throw new Error("Starting-equipment policy changed during source preflight.");
    }
    const afterPreflight = captureBaseline(args.actor, args.now);
    if (afterPreflight.fingerprint !== initialBaseline.fingerprint) {
        throw new Error("Actor wealth changed during starting-equipment source preflight.");
    }
    const historyAfterPreflight = await args.dependencies.readHistory();
    const admissionAfterPreflight = evaluateActorEconomicAdmission({
        actor: args.actor,
        draftId: acquisition.draftId,
        batchId: acquisition.batchId,
        targetLevel: acquisition.targetLevel,
        higherLevelStartEvidence: acquisition.policySnapshot.material.higherLevelStartEvidence,
        history: economicHistory(historyAfterPreflight, args.recoveryFinalization === true),
        retryExpectation,
        preparedClassGrantPlan: args.classGrantPlan,
        classGrantPhase: "before-acquisition",
        capturedAt: afterPreflight.capturedAt,
    });
    assertEconomicAdmission(admissionAfterPreflight, acquisition, afterPreflight);
    const initialObservation = observePlannedItems(identityPlan, initialBaseline);
    if (!handoff && admission.kind === "eligible-retry") {
        const observed = [...initialObservation.observedEntryIds].sort();
        const admitted = [...admission.entryIds].sort();
        if (stableJson(observed) !== stableJson(admitted)) {
            throw new Error("Observed retry items differ from economic admission evidence.");
        }
    }
    if (handoff && initialObservation.evidence.length > 0) {
        throw new Error("A PF2E-sheet handoff cannot contain automated acquisition items.");
    }
    return {
        actorId,
        draft: acquisition,
        classGrantPlan: args.classGrantPlan,
        identityPlan,
        initialBaseline,
        targetCopper,
        handoff,
        sources,
    };
}
function verifyPreparedExecution(args) {
    const { execution } = args;
    const current = captureBaseline(args.actor, args.now);
    assertStableNonAcquisitionItems(execution.initialBaseline, current, execution.identityPlan);
    const observation = observePlannedItems(execution.identityPlan, current);
    if (execution.handoff) {
        if (current.fingerprint !== execution.initialBaseline.fingerprint) {
            throw new Error("Actor wealth changed after the starting-equipment handoff was admitted.");
        }
    }
    else {
        assertAllPlannedItemsObserved(execution.identityPlan, observation);
    }
    if (current.currencyCopper !== execution.targetCopper) {
        throw new Error("Actor currency differs from the completed starting-equipment target.");
    }
    const baselineCopper = execution.draft.baseline?.currencyCopper;
    if (!Number.isSafeInteger(baselineCopper) || baselineCopper < 0) {
        throw new TypeError("The reviewed starting-equipment baseline is unavailable.");
    }
    const currency = execution.handoff
        ? {
            preCopper: baselineCopper,
            budgetCopper: execution.identityPlan.ledger.budgetCopper,
            spentCopper: 0,
            remainingCopper: execution.identityPlan.ledger.budgetCopper,
            targetCopper: baselineCopper,
            observedCopper: current.currencyCopper,
        }
        : {
            preCopper: baselineCopper,
            budgetCopper: execution.identityPlan.ledger.budgetCopper,
            spentCopper: execution.identityPlan.ledger.spentCopper,
            remainingCopper: execution.identityPlan.ledger.remainingCopper,
            targetCopper: execution.targetCopper,
            observedCopper: current.currencyCopper,
        };
    const manifest = createCompletedAcquisitionManifest({
        actorId: execution.actorId,
        draft: execution.draft,
        identityPlan: execution.identityPlan,
        appliedBy: args.dependencies.readApplyingUser(),
        appliedAt: args.now(),
        currency,
        observedItems: execution.handoff ? [] : observation.evidence,
        finalClassGrantReconciliation: args.finalClassGrantReconciliation,
        environment: args.dependencies.readEnvironment(),
    });
    return { kind: "completed", identityPlan: execution.identityPlan, manifest };
}
function requirePreparedExecution(execution, actor, draft, classGrantPlan) {
    if (!execution)
        throw new Error("Starting-equipment items must be prepared before currency or verification.");
    const acquisition = normalizeAcquisitionDraft(cloneData(draft.acquisition));
    if (!acquisition || actorIdentifier(actor) !== execution.actorId) {
        throw new Error("Starting-equipment execution belongs to another actor or draft.");
    }
    assertPreparedAcquisitionIdentityPlanMatches({
        plan: execution.identityPlan,
        actorId: execution.actorId,
        draft: acquisition,
    });
    if (classGrantPlan.fingerprint !== execution.classGrantPlan.fingerprint) {
        throw new Error("Starting-equipment class-grant authority changed during Apply.");
    }
    return execution;
}
function assertResolvedSourceMatches(entry, resolved) {
    if (resolved.sourceUuid !== entry.sourceUuid) {
        throw new Error(`Acquisition source drifted for ${entry.entryId}.`);
    }
    if (resolved.documentFingerprint !== entry.documentFingerprint) {
        throw new Error(`Acquisition document drifted for ${entry.entryId}.`);
    }
    if (resolved.priceFingerprint !== entry.priceFingerprint) {
        throw new Error(`Acquisition price drifted for ${entry.entryId}.`);
    }
    if (stableJson(resolved.resolvedPrice) !== stableJson(entry.price) ||
        resolved.resolvedPrice.materializedQuantity !== entry.quantity) {
        throw new Error(`Acquisition resolved-price or quantity drifted for ${entry.entryId}.`);
    }
    if (stableJson(resolved.policyDecision) !== stableJson(entry.policyDecision)) {
        throw new Error(`Acquisition policy drifted for ${entry.entryId}.`);
    }
    if (!resolved.source || typeof resolved.source !== "object") {
        throw new TypeError(`Acquisition source ${entry.entryId} has no embeddable item data.`);
    }
}
function assertEconomicAdmission(admission, acquisition, baseline) {
    if (acquisition.disposition.kind === "handoff") {
        if (admission.kind !== "handoff" || stableJson(admission.handoff) !== stableJson(acquisition.disposition.handoff)) {
            throw new Error("The acknowledged starting-equipment handoff no longer matches current actor wealth.");
        }
    }
    else if (admission.kind !== "eligible-empty" && admission.kind !== "eligible-retry") {
        const detail = admission.kind === "blocked" ? admission.message : "current wealth requires PF2E-sheet handoff";
        throw new Error(`Starting-equipment economic admission failed: ${detail}.`);
    }
    if (admission.baseline.fingerprint !== baseline.fingerprint) {
        throw new Error("Actor wealth changed while starting-equipment admission was evaluated.");
    }
    if (acquisition.disposition.kind !== "handoff" &&
        admission.kind === "eligible-empty" &&
        acquisition.baseline.fingerprint !== baseline.fingerprint) {
        throw new Error("Current actor wealth differs from the reviewed economic baseline.");
    }
}
function stampAcquisitionSource(sourceInput, entry, plannedItem, subject) {
    const source = cloneData(sourceInput);
    delete source._id;
    source.system = {
        ...(source.system ?? {}),
        quantity: plannedItem.quantity,
        containerId: null,
    };
    source.flags = { ...(source.flags ?? {}) };
    source.flags.core = { ...(source.flags.core ?? {}), sourceId: plannedItem.sourceUuid };
    source.flags[MODULE_ID] = {
        ...(source.flags[MODULE_ID] ?? {}),
        acquisition: {
            version: 1,
            draftId: subject.draftId,
            batchId: subject.batchId,
            manifestId: subject.manifestId,
            lineId: entry.lineIds[0],
            entryId: entry.entryId,
            plannedItemId: plannedItem.plannedItemId,
            plannedContainerId: plannedItem.plannedContainerId,
            plannedGrantId: entry.funding.lane === "class-grant" ? entry.funding.grant.plannedGrantId : null,
            stackingIntent: entry.stackingIntent,
        },
    };
    return source;
}
async function executeItemWrite(args) {
    await args.emitWriteCheckpoint("embedded-item-create", "before", args.ordinal);
    await args.inventory.add(args.actor, args.source, { stack: false, render: false });
}
function observePlannedItems(plan, baseline) {
    const expectedByPlannedId = new Map(plan.entries.flatMap((entry) => entry.plannedItems.map((planned) => [planned.plannedItemId, { entry, planned }])));
    const observedByPlannedId = new Map();
    const observedEntryIds = new Set();
    for (const item of baseline.physicalItems) {
        const identity = item.acquisitionIdentity;
        if (!identity || identity.draftId !== plan.subject.draftId || identity.batchId !== plan.subject.batchId)
            continue;
        const expected = expectedByPlannedId.get(identity.plannedItemId);
        if (!expected ||
            identity.manifestId !== plan.subject.manifestId ||
            identity.entryId !== expected.entry.entryId ||
            identity.lineId !== expected.entry.lineIds[0] ||
            identity.plannedContainerId !== expected.planned.plannedContainerId ||
            identity.plannedGrantId !==
                (expected.entry.funding.lane === "class-grant" ? expected.entry.funding.grant.plannedGrantId : null) ||
            identity.stackingIntent !== expected.entry.stackingIntent ||
            item.sourceUuid !== expected.planned.sourceUuid ||
            item.quantity !== expected.planned.quantity ||
            item.containerId !== expected.planned.plannedContainerId) {
            throw new Error(`Actor item ${item.itemId} has mismatched acquisition identity or material facts.`);
        }
        if (observedByPlannedId.has(identity.plannedItemId)) {
            throw new Error(`Prepared acquisition item ${identity.plannedItemId} exists more than once.`);
        }
        observedByPlannedId.set(identity.plannedItemId, {
            plannedItemId: identity.plannedItemId,
            actualItemId: item.itemId,
            actualSourceUuid: expected.planned.sourceUuid,
            actualQuantity: item.quantity,
            plannedContainerId: expected.planned.plannedContainerId,
            actualContainerId: item.containerId,
        });
        observedEntryIds.add(expected.entry.entryId);
    }
    return {
        evidence: plan.entries.flatMap((entry) => entry.plannedItems.flatMap((planned) => {
            const observed = observedByPlannedId.get(planned.plannedItemId);
            return observed ? [observed] : [];
        })),
        observedEntryIds,
    };
}
function assertAllPlannedItemsObserved(plan, observation) {
    const expected = plan.entries.reduce((count, entry) => count + entry.plannedItems.length, 0);
    if (observation.evidence.length !== expected) {
        throw new Error("Completed acquisition evidence is missing one or more prepared items.");
    }
}
function assertStableNonAcquisitionItems(initial, current, plan) {
    const stableItems = (baseline) => baseline.physicalItems.filter((item) => item.acquisitionIdentity?.draftId !== plan.subject.draftId ||
        item.acquisitionIdentity.batchId !== plan.subject.batchId);
    if (stableJson(stableItems(initial)) !== stableJson(stableItems(current))) {
        throw new Error("Actor physical inventory changed outside the prepared acquisition batch.");
    }
}
function assertCurrencyUnchanged(initial, current) {
    if (initial.currencyCopper !== current.currencyCopper) {
        throw new Error("Actor currency changed before absolute acquisition convergence.");
    }
}
function buildRetryExpectation(plan, expectedCurrencyCopper, draft) {
    const recoveryPersisted = hasApplyRecoveryState(draft);
    return {
        draftId: plan.subject.draftId,
        batchId: plan.subject.batchId,
        manifestId: plan.subject.manifestId,
        expectedCurrencyCopper,
        expectedEntries: plan.entries.map((entry) => {
            const planned = entry.plannedItems[0];
            return {
                entryId: entry.entryId,
                plannedItemId: planned.plannedItemId,
                plannedContainerId: planned.plannedContainerId,
                lineId: entry.lineIds[0],
                sourceUuid: planned.sourceUuid,
                quantity: planned.quantity,
                containerId: planned.plannedContainerId,
                stackingIntent: entry.stackingIntent,
            };
        }),
        allowCurrencyOnlyConvergence: recoveryPersisted && plan.disposition.kind === "retain-all",
    };
}
function assertWaveTwoIdentityShape(plan) {
    for (const entry of plan.entries) {
        if (entry.plannedItems.length !== 1 ||
            entry.lineIds.length === 0 ||
            entry.plannedItems[0].ownedContainerId !== null ||
            entry.plannedItems[0].plannedContainerId !== null) {
            throw new Error("Wave 2 supports one non-container root item per prepared acquisition entry.");
        }
    }
}
function economicHistory(history, recoveringFinalization) {
    return {
        previousCharacterAppliedAt: recoveringFinalization ? null : history.lastAppliedAt,
        previousTargetLevel: recoveringFinalization ? null : history.lastTargetLevel,
        completedAcquisitionManifestId: history.completedAcquisitionManifest?.id ?? null,
        completedAcquisitionManifestCorrupt: history.completedAcquisitionManifestCorrupt,
    };
}
function hasApplyRecoveryState(draft) {
    return (draft.applyAttemptStepIds.length > 0 ||
        draft.applyCompletedStepIds.length > 0 ||
        Object.keys(draft.applyRecoveryActorUpdate).length > 0);
}
function captureBaseline(actor, now) {
    return captureActorEconomicBaseline(actor, { capturedAt: now() });
}
function actorIdentifier(actor) {
    const id = isRecord(actor) ? actor.id : null;
    if (typeof id !== "string" || id.trim().length === 0) {
        throw new TypeError("Starting-equipment execution requires an actor ID.");
    }
    return id;
}
function actorInventory(actor) {
    if (!isRecord(actor) || !isRecord(actor.inventory)) {
        throw new Error("PF2E actor inventory is unavailable.");
    }
    return actor.inventory;
}
async function callCurrencyMethod(actor, methodName, copper) {
    if (!Number.isSafeInteger(copper) || copper <= 0)
        throw new RangeError("Currency convergence requires copper.");
    const inventory = actorInventory(actor);
    const method = inventory[methodName];
    if (typeof method !== "function") {
        throw new Error(`PF2E actor inventory ${methodName} is unavailable.`);
    }
    return Reflect.apply(method, inventory, [{ cp: copper }]);
}
function safeCopperAdd(left, right) {
    const total = left + right;
    if (!Number.isSafeInteger(total) || total < 0) {
        throw new RangeError("Starting-equipment absolute currency target is unsafe.");
    }
    return total;
}
function stableJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("Acquisition comparison cannot contain non-finite numbers.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        if (Object.values(value).some((entry) => entry === undefined)) {
            throw new TypeError("Acquisition comparison cannot contain undefined values.");
        }
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(",")}}`;
    }
    throw new TypeError("Acquisition comparison contains unsupported data.");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=acquisition-execution-service.js.map