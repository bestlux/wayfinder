import { createHash } from "node:crypto";

export const SMOKE_EVIDENCE_SCHEMA_VERSION = 3;

const VALID_STACKING_INTENTS = new Set(["aggregate", "separate"]);
const APPLY_PHASE_IDS = Object.freeze([
  "singleton-replacements",
  "singleton-system-grants",
  "singleton-explicit-grants",
  "singleton-choice-persistence-early",
  "skill-training-items",
  "class-archetype",
  "class-branches",
  "class-feature-choices",
  "native-spellcasting-before-feats",
  "feat-selections",
  "singleton-choice-persistence-late",
  "spell-choices",
  "native-spellcasting-after-spells",
  "boost-item-updates",
  "source-flag-restoration",
  "class-grant-reconcile-before-acquisition",
  "acquisition-items",
  "class-grant-reconcile-after-acquisition",
  "class-grant-reconcile-final",
  "verify-outcome",
  "finalize-actor",
]);
const VALID_APPLY_PHASES = new Set(APPLY_PHASE_IDS);
const VALID_APPLY_WRITE_OPERATIONS = new Set(["final-actor-update"]);
const REVIEWABLE_FINDING_CODES = new Set(["manual-classification"]);
const REQUIRED_FINAL_ACTOR_UPDATE_PATHS = [
  "flags.wayfinder-pf2e.draft",
  "flags.wayfinder-pf2e.state",
];
const ACTOR_AUTHORITY_KEYS = [
  "canUpdate",
  "defaultOwnershipLevel",
  "explicitOwnershipLevel",
  "isOwner",
  "ownerPermission",
];
const ACQUISITION_EVIDENCE_KEYS = ["currency", "failureSnapshot", "manifest", "policy"];
const ACQUISITION_CURRENCY_KEYS = [
  "budgetCopper",
  "observedCopper",
  "preCopper",
  "remainingCopper",
  "spentCopper",
  "targetCopper",
];
const ITEM_EVIDENCE_KEYS = [
  "acquisition",
  "containerId",
  "destinationKey",
  "grantAncestryIds",
  "grantedById",
  "id",
  "isCurrency",
  "isPhysical",
  "location",
  "name",
  "quantity",
  "slotId",
  "sourceId",
  "trainingKey",
  "type",
];
const MODULE_STATE_KEYS = [
  "completedAcquisitionManifest",
  "completedAcquisitionManifestCorrupt",
  "completedStepIds",
  "existingCharacterHistory",
  "lastAppliedAt",
  "lastAppliedSpellRarityAttestations",
  "lastTargetLevel",
  "version",
];
const APPLY_REVIEW_KEYS = ["confirmationMessage", "reviewLines"];
const APPLIED_SPELL_ATTESTATION_KEYS = [
  "attestedAt",
  "authorName",
  "authorUserId",
  "claimedBasis",
  "kind",
  "reason",
  "selectedSpells",
  "status",
  "subject",
  "subjectLabel",
  "trust",
  "version",
];
const SPELL_ATTESTATION_SUBJECT_KEYS = [
  "actorId",
  "destinationKey",
  "slotId",
  "stepId",
  "stepLevel",
  "stepRarityCeiling",
  "targetLevel",
  "worldRarityCeiling",
];
const SPELL_SELECTION_REQUIRED_KEYS = [
  "documentId",
  "featType",
  "itemType",
  "level",
  "name",
  "packId",
  "slotId",
  "uuid",
];
const SPELL_SELECTION_ALLOWED_KEYS = [...SPELL_SELECTION_REQUIRED_KEYS, "slug"];
const EXPECTED_SPELL_ATTESTATION_KEYS = [
  "claimedBasis",
  "destinationKey",
  "reason",
  "selectedSpells",
  "slotId",
  "stepId",
  "stepLevel",
  "stepRarityCeiling",
  "worldRarityCeiling",
];
const EXPECTED_SPELL_SELECTION_KEYS = ["level", "name", "uuid"];

export function assertIncrementalSmokeCasesSupported(caseDefinitions) {
  const unsupported = caseDefinitions
    .filter((definition) => definition?.applySafetyFailureCheckpoint)
    .map((definition) => definition.id);
  if (unsupported.length > 0) {
    throw new Error(
      `Apply safety cases cannot run through --incremental-case; use --case instead: ${unsupported.join(", ")}`
    );
  }
}

export function qualifySmokeResult(resultInput, caseDefinitions = []) {
  const result = structuredClone(resultInput);
  assertSmokeResultShape(result);
  assertCaseCoverage(result.cases, caseDefinitions);
  const definitionsById = new Map(caseDefinitions.map((definition) => [definition.id, definition]));

  for (const smokeCase of result.cases) {
    const definition = definitionsById.get(smokeCase.id) ?? {};
    const caseKind = definition.caseKind ?? "character-build";
    const findings = [
      ...caseShapeFindings(smokeCase),
      ...classificationFindings(smokeCase),
      ...actorEvidenceFindings(smokeCase.actor, definition.sourceGroupExpectations ?? []),
      ...definitionActorOutcomeFindings(smokeCase.actor, definition),
      ...applySafetyEvidenceFindings(smokeCase, definition),
      ...(caseKind === "character-build" ? characterBuildEvidenceFindings(smokeCase, definition) : []),
      ...acquisitionEnvelopeFindings(smokeCase),
      ...(caseKind === "acquisition" ? acquisitionEvidenceFindings(smokeCase) : []),
    ];
    findings.push(...reviewRecordFindings(findings, definition.reviewedFindings ?? [], result.user.isGM));
    const reviewedFindings = applyFindingReviews(uniqueFindings(findings), definition.reviewedFindings ?? []);
    const unreviewedFindings = reviewedFindings.filter((finding) => finding.review === null);

    smokeCase.caseKind = caseKind;
    smokeCase.evidence ??= {};
    smokeCase.evidence.contract = {
      schemaVersion: SMOKE_EVIDENCE_SCHEMA_VERSION,
      findings: reviewedFindings,
      reviewedFindingCount: reviewedFindings.length - unreviewedFindings.length,
      unreviewedFindingCount: unreviewedFindings.length,
    };

    const failures = Array.isArray(smokeCase.failures)
      ? smokeCase.failures
      : [`Malformed browser failure evidence: ${String(smokeCase.failures)}`];
    for (const finding of unreviewedFindings) {
      const message = `Unreviewed smoke finding ${finding.id}: ${finding.message}`;
      if (!failures.includes(message)) failures.push(message);
    }
    smokeCase.failures = failures;
    smokeCase.status = failures.length > 0 ? "fail" : "pass";
  }

  result.summary = summarizeCases(result.cases);
  result.qualification = {
    passed: result.summary.failed === 0 && result.summary.classified === 0,
    reviewedFindingCount: result.cases.reduce(
      (total, smokeCase) => total + smokeCase.evidence.contract.reviewedFindingCount,
      0
    ),
    unreviewedFindingCount: result.cases.reduce(
      (total, smokeCase) => total + smokeCase.evidence.contract.unreviewedFindingCount,
      0
    ),
  };
  return result;
}

export function buildActorSourceEvidence(actorEvidence, expectations = []) {
  const items = Array.isArray(actorEvidence?.items) ? actorEvidence.items : [];
  const groupsBySource = new Map();

  for (const item of items) {
    if (!nonEmptyString(item.sourceId) || item.isCurrency === true) continue;
    const group = groupsBySource.get(item.sourceId) ?? [];
    group.push(item);
    groupsBySource.set(item.sourceId, group);
  }

  const sourceGroups = [...groupsBySource.entries()]
    .map(([sourceId, sourceItems]) => ({
      sourceId,
      documentCount: sourceItems.length,
      totalQuantity: sourceItems.every((item) => item.isPhysical === true)
        ? sourceItems.reduce((total, item) => total + item.quantity, 0)
        : null,
      itemIds: sourceItems.map((item) => item.id).sort(),
      semanticIdentities: sourceItems.map(semanticItemIdentity).sort(),
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

  const findings = [];
  for (const item of items) {
    findings.push(...itemShapeFindings(item, items));
  }
  findings.push(...duplicateRuntimeIdentityFindings(items));

  for (const group of sourceGroups) {
    const sourceItems = groupsBySource.get(group.sourceId);
    const identities = new Map();
    for (const item of sourceItems) {
      const identity = semanticItemIdentity(item);
      const matching = identities.get(identity) ?? [];
      matching.push(item.id);
      identities.set(identity, matching);
    }
    for (const [identity, itemIds] of identities) {
      if (itemIds.length > 1) {
        findings.push(
          finding(
            "ambiguous-source-identity",
            `${group.sourceId}:${identity}`,
            `Source ${group.sourceId} appears in ${itemIds.length} documents without distinct quantity, grant, slot, destination, or acquisition identity.`
          )
        );
      }
    }
    findings.push(...stackingFindings(group.sourceId, sourceItems));
  }

  for (const expectation of expectations) {
    findings.push(...sourceExpectationFindings(sourceGroups, expectation));
  }

  return { findings: uniqueFindings(findings), sourceGroups };
}

export function validateAcquisitionEvidence(smokeCase) {
  return acquisitionEvidenceFindings(smokeCase);
}

function assertSmokeResultShape(result) {
  if (!result || typeof result !== "object") throw new Error("Foundry smoke evidence must be an object.");
  if (result.schemaVersion !== SMOKE_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Foundry smoke evidence must use schema ${SMOKE_EVIDENCE_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(result.cases)) throw new Error("Foundry smoke evidence must contain cases.");
  const user = result.user;
  if (
    !user ||
    typeof user !== "object" ||
    !nonEmptyString(user.id) ||
    !nonEmptyString(user.name) ||
    !Number.isInteger(user.role) ||
    user.role < 0 ||
    user.role > 4 ||
    typeof user.isGM !== "boolean" ||
    user.isGM !== (user.role >= 3)
  ) {
    throw new Error("Foundry smoke evidence must contain a complete user role record.");
  }
}

function assertCaseCoverage(cases, caseDefinitions) {
  const observedIds = cases.map((smokeCase) => smokeCase?.id);
  const duplicateObservedIds = duplicateValues(observedIds);
  if (duplicateObservedIds.length > 0) {
    throw new Error(`Foundry smoke evidence contains duplicate case ids: ${duplicateObservedIds.join(", ")}.`);
  }
  if (caseDefinitions.length === 0) return;

  const requestedIds = caseDefinitions.map((definition) => definition?.id);
  const duplicateRequestedIds = duplicateValues(requestedIds);
  if (duplicateRequestedIds.length > 0) {
    throw new Error(`Foundry smoke definitions contain duplicate case ids: ${duplicateRequestedIds.join(", ")}.`);
  }
  const observedSet = new Set(observedIds);
  const requestedSet = new Set(requestedIds);
  const missing = requestedIds.filter((id) => !observedSet.has(id));
  const unexpected = observedIds.filter((id) => !requestedSet.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Foundry smoke case coverage mismatch; missing=${missing.join(",") || "none"}, unexpected=${unexpected.join(",") || "none"}.`
    );
  }
}

function caseShapeFindings(smokeCase) {
  const findings = [];
  const subject = String(smokeCase?.id ?? "case");
  if (!Array.isArray(smokeCase?.failures)) {
    findings.push(
      finding("malformed-case-failures", subject, "Smoke case failures must be a serialized array of messages.")
    );
  }
  if (!Array.isArray(smokeCase?.classifications)) {
    findings.push(
      finding(
        "malformed-case-classifications",
        subject,
        "Smoke case classifications must be a serialized array of messages."
      )
    );
  }
  if (!smokeCase?.actor) {
    findings.push(finding("missing-actor-evidence", subject, "Smoke case has no actor evidence snapshot."));
  }
  if (smokeCase?.status === "fail" && Array.isArray(smokeCase.failures) && smokeCase.failures.length === 0) {
    findings.push(
      finding("unexplained-case-failure", subject, "Browser marked the smoke case failed without failure evidence.")
    );
  }
  return findings;
}

function characterBuildEvidenceFindings(smokeCase, definition) {
  const subject = String(smokeCase?.id ?? "case");
  const actor = smokeCase?.actor;
  const evidence = smokeCase?.evidence;
  const expectedStepIds = Array.isArray(evidence?.preStepIds)
    ? evidence.preStepIds
    : Array.isArray(evidence?.initialStepIds) && Array.isArray(evidence?.incrementalStepIds)
      ? Array.from(new Set([...evidence.initialStepIds, ...evidence.incrementalStepIds]))
      : null;
  const expectedAttestations = definition?.expectedAppliedSpellRarityAttestations ?? [];
  const targetLevel = definition?.targetLevel ?? actor?.levelAfterApply;
  const findings = [];
  if (
    !nonEmptyString(actor?.id) ||
    !Number.isSafeInteger(targetLevel) ||
    targetLevel < 1 ||
    !nonEmptyUniqueStringArray(expectedStepIds) ||
    actor?.levelAfterApply !== targetLevel ||
    actor?.moduleDraftAfterApply !== null ||
    !finalModuleStateMatches(actor?.moduleStateAfterApply, {
      actorId: actor.id,
      targetLevel,
      expectedStepIds,
      expectedExistingCharacterHistory: definition?.expectedExistingCharacterHistory ?? null,
      expectedAppliedSpellRarityAttestations: expectedAttestations,
    })
  ) {
    findings.push(
      finding(
        "character-build-state-mismatch",
        subject,
        "Character-build evidence must include the exact final module state and spell-attestation receipt for this actor."
      )
    );
  }

  const applyReview = evidence?.applyReview;
  const appliedAttestations = actor?.moduleStateAfterApply?.lastAppliedSpellRarityAttestations;
  const expectedReviewLines = validAppliedSpellRarityAttestations(appliedAttestations)
    ? appliedAttestations.map(spellRarityAttestationReviewLine)
    : null;
  if (
    !exactObjectKeys(applyReview, APPLY_REVIEW_KEYS) ||
    !nonEmptyString(applyReview.confirmationMessage) ||
    !Array.isArray(expectedReviewLines) ||
    !structuredValueEquals(applyReview.reviewLines, expectedReviewLines) ||
    !expectedReviewLines.every((line) => applyReview.confirmationMessage.includes(line))
  ) {
    findings.push(
      finding(
        "apply-review-evidence-mismatch",
        subject,
        "Character-build evidence must prove the exact spell-attestation disclosure shown at Apply confirmation."
      )
    );
  }
  return findings;
}

function applySafetyEvidenceFindings(smokeCase, definition) {
  const subject = String(smokeCase?.id ?? "case");
  const requestedTarget = definition?.applySafetyFailureCheckpoint;
  const evidence = smokeCase?.evidence?.applySafety;
  if (requestedTarget === undefined || requestedTarget === null) {
    return evidence === undefined || evidence === null
      ? []
      : [
          finding(
            "unexpected-apply-safety-evidence",
            subject,
            "Smoke case emitted Apply safety evidence without a requested checkpoint target."
          ),
        ];
  }

  const parsedExpected = parseCheckpointId(requestedTarget.checkpointId);
  const expectedOccurrence = requestedTarget.occurrence;
  if (
    !parsedExpected ||
    !Number.isSafeInteger(expectedOccurrence) ||
    expectedOccurrence < 1 ||
    (parsedExpected.kind === "phase" && expectedOccurrence !== 1) ||
    (parsedExpected.kind === "write" && parsedExpected.operation === "final-actor-update" && expectedOccurrence !== 1) ||
    !Number.isSafeInteger(definition?.targetLevel) ||
    definition.targetLevel < 1 ||
    !validExpectedPreApplyBaseline(definition?.expectedPreApply) ||
    !Number.isSafeInteger(definition?.expectedItemCount) ||
    definition.expectedItemCount < 0 ||
    !uniqueStringArray(definition?.expectedItemIdentities) ||
    definition.expectedItemIdentities.length !== definition.expectedItemCount ||
    !uniqueStringArray(definition?.expectedItemSemanticIdentities) ||
    definition.expectedItemSemanticIdentities.length !== definition.expectedItemCount ||
    !validExactSkillRanks(definition?.expectedExactSkillRanks) ||
    !validAbilityBoostState(definition?.expectedAbilityBoosts) ||
    !nonEmptyUniqueStringArray(definition?.expectedFinalActorUpdatePaths) ||
    !REQUIRED_FINAL_ACTOR_UPDATE_PATHS.every((path) => definition.expectedFinalActorUpdatePaths.includes(path)) ||
    !nonEmptyUniqueStringArray(definition?.expectedPreStepIds) ||
    !nonEmptyUniqueStringArray(definition?.expectedRetryStepIds) ||
    !definition?.expectedCompletedReceiptCounts ||
    typeof definition.expectedCompletedReceiptCounts !== "object" ||
    Array.isArray(definition.expectedCompletedReceiptCounts) ||
    !definition?.expectedCompletedReceiptIdentities ||
    typeof definition.expectedCompletedReceiptIdentities !== "object" ||
    Array.isArray(definition.expectedCompletedReceiptIdentities)
  ) {
    return [
      finding(
        "invalid-apply-safety-definition",
        subject,
        "Apply safety definition needs a supported checkpoint, exact fixture outcomes, and pinned final actor paths."
      ),
    ];
  }
  const expected = {
    ...parsedExpected,
    ordinal: parsedExpected.kind === "write" ? expectedOccurrence : null,
  };
  if (!evidence || typeof evidence !== "object") {
    return [
      finding(
        "missing-apply-safety-evidence",
        subject,
        "Requested Apply safety checkpoint has no structured browser evidence."
      ),
    ];
  }

  const findings = [];
  if (
    evidence.target?.checkpointId !== requestedTarget.checkpointId ||
    evidence.target?.occurrence !== expectedOccurrence
  ) {
    findings.push(
      finding(
        "apply-safety-target-mismatch",
        subject,
        "Apply safety evidence target does not match the requested checkpoint and occurrence."
      )
    );
  }
  if (evidence.matchingOccurrence !== expectedOccurrence) {
    findings.push(
      finding(
        "apply-safety-occurrence-mismatch",
        subject,
        "Apply safety injection did not occur at the requested matching occurrence."
      )
    );
  }
  findings.push(
    ...checkpointEvidenceFindings(evidence.injectedCheckpoint, expected, subject, "injected"),
    ...checkpointEvidenceFindings(evidence.observedCheckpoint, expected, subject, "observed")
  );
  const postFinalCheckpoint =
    expected.checkpointId === "write:final-actor-update:after" ||
    expected.checkpointId === "phase:finalize-actor:after";
  const failureState = evidence.failureState;
  const validPreApplyLevel = Number.isSafeInteger(failureState?.preApplyLevel) && failureState.preApplyLevel >= 1;
  const preStepIds = smokeCase?.evidence?.preStepIds;
  const validFailureItemSnapshots =
    uniqueStringArray(failureState?.preApplyItemIds) &&
    uniqueStringArray(failureState?.observedItemIds) &&
    uniqueStringArray(failureState?.changedItemIds);
  const validFailureModuleSnapshots =
    validModuleStateSnapshot(failureState?.preApplyModuleState) &&
    validModuleStateSnapshot(failureState?.observedModuleState);
  const expectedPreApply = definition.expectedPreApply;
  const preApplyBaselineMatches =
    validPreApplyLevel &&
    failureState.preApplyLevel === expectedPreApply.level &&
    uniqueStringArray(failureState?.preApplyItemIds) &&
    failureState.preApplyItemIds.length === expectedPreApply.itemCount &&
    exactModuleStateMatches(failureState?.preApplyModuleState, expectedPreApply.moduleState);
  const expectedFailureCompletedStepIds =
    uniqueStringArray(expectedPreApply.moduleState.completedStepIds) && uniqueStringArray(preStepIds)
      ? Array.from(new Set([...expectedPreApply.moduleState.completedStepIds, ...preStepIds]))
      : [];
  const validFailureState = postFinalCheckpoint
    ? failureState?.expected === "post-final" &&
      validPreApplyLevel &&
      preApplyBaselineMatches &&
      validFailureItemSnapshots &&
      validFailureModuleSnapshots &&
      failureState.draftPresent === false &&
      failureState.observedLevel === definition.targetLevel &&
      failureState.stateLastTargetLevel === definition.targetLevel &&
      finalModuleStateMatches(failureState.observedModuleState, {
        actorId: smokeCase?.actor?.id,
        targetLevel: definition.targetLevel,
        expectedStepIds: expectedFailureCompletedStepIds,
        expectedExistingCharacterHistory: expectedPreApply.moduleState.existingCharacterHistory,
        expectedAppliedSpellRarityAttestations: definition.expectedAppliedSpellRarityAttestations ?? [],
      })
    : failureState?.expected === "pre-final" &&
      validPreApplyLevel &&
      preApplyBaselineMatches &&
      validFailureItemSnapshots &&
      validFailureModuleSnapshots &&
      failureState.draftPresent === true &&
      failureState.draftMatchesAttempt === true &&
      failureState.observedLevel === failureState.preApplyLevel &&
      failureState.stateLastTargetLevel === failureState.observedModuleState.lastTargetLevel &&
      JSON.stringify(failureState.observedModuleState) === JSON.stringify(failureState.preApplyModuleState);
  if (!validFailureState) {
    findings.push(
      finding(
        "apply-safety-state-mismatch",
        subject,
        "Apply safety failure state does not match its pre-final or post-final checkpoint boundary."
      )
    );
  }
  if (evidence.failureKind !== "checkpoint-hook") {
    findings.push(
      finding(
        "apply-safety-failure-kind-mismatch",
        subject,
        "Apply safety evidence must prove a failure thrown by the requested checkpoint hook."
      )
    );
  }
  if (!nonEmptyString(evidence.message) || !evidence.message.includes(`at ${requestedTarget.checkpointId}`)) {
    findings.push(
      finding(
        "apply-safety-error-mismatch",
        subject,
        "Apply safety error must identify the exact injected checkpoint."
      )
    );
  }

  if (!Array.isArray(evidence.completedReceipts)) {
    findings.push(
      finding(
        "invalid-apply-safety-receipts",
        subject,
        "Apply safety evidence must contain structured completed phase receipts."
      )
    );
  } else {
    const completedPhases = [];
    for (const receipt of evidence.completedReceipts) {
      findings.push(...applyReceiptFindings(receipt, subject, "completed"));
      if (nonEmptyString(receipt?.phase)) completedPhases.push(receipt.phase);
    }
    const completedPhaseCount =
      APPLY_PHASE_IDS.indexOf(expected.phase) +
      (expected.kind === "phase" && expected.boundary === "after" ? 1 : 0);
    const expectedCompletedPhases = APPLY_PHASE_IDS.slice(0, completedPhaseCount);
    if (
      new Set(completedPhases).size !== completedPhases.length ||
      JSON.stringify(completedPhases) !== JSON.stringify(expectedCompletedPhases)
    ) {
      findings.push(
        finding(
          "apply-safety-completed-receipt-mismatch",
          subject,
          "Completed receipts must exactly cover the ordered phases before the interrupted checkpoint."
        )
      );
    }
    const expectedReceiptCounts = definition.expectedCompletedReceiptCounts;
    const configuredPhases = Object.keys(expectedReceiptCounts);
    if (JSON.stringify(configuredPhases) !== JSON.stringify(expectedCompletedPhases)) {
      findings.push(
        finding(
          "invalid-apply-safety-receipt-definition",
          subject,
          "Apply safety definitions must pin receipt counts for every completed phase in order."
        )
      );
    } else {
      for (const receipt of evidence.completedReceipts) {
        const receiptPhase = receipt?.phase;
        const expectedCounts = nonEmptyString(receiptPhase) ? expectedReceiptCounts[receiptPhase] : null;
        const validCounts =
          expectedCounts &&
          [expectedCounts.created, expectedCounts.deleted, expectedCounts.updated].every(
            (count) => Number.isSafeInteger(count) && count >= 0
          );
        if (
          !validCounts ||
          receipt?.createdItemIds?.length !== expectedCounts.created ||
          receipt?.deletedItemIds?.length !== expectedCounts.deleted ||
          receipt?.updatedItemIds?.length !== expectedCounts.updated
        ) {
          findings.push(
            finding(
              "apply-safety-receipt-count-mismatch",
              `${subject}:${String(receiptPhase ?? "invalid")}`,
              `Apply safety receipt ${String(receiptPhase ?? "invalid")} does not match its pinned mutation counts.`
            )
          );
        }
      }
    }
    findings.push(
      ...applyReceiptIdentityFindings(
        evidence.completedReceipts,
        definition.expectedCompletedReceiptIdentities,
        smokeCase?.actor?.items,
        subject
      )
    );
  }
  findings.push(...applyReceiptFindings(evidence.partialReceipt, subject, "partial"));
  if (evidence.partialReceipt?.phase !== expected.phase) {
    findings.push(
      finding(
        "apply-safety-partial-phase-mismatch",
        subject,
        "Partial receipt phase must match the interrupted checkpoint phase."
      )
    );
  }
  const partialItemDeltaFields = [
    evidence.partialReceipt?.createdItemIds,
    evidence.partialReceipt?.deletedItemIds,
    evidence.partialReceipt?.updatedItemIds,
  ];
  const partialMustHaveNoItemDelta =
    expected.kind === "write" || (expected.kind === "phase" && expected.boundary === "before");
  if (
    partialMustHaveNoItemDelta &&
    partialItemDeltaFields.some((entries) => !Array.isArray(entries) || entries.length > 0)
  ) {
    findings.push(
      finding(
        "apply-safety-partial-item-boundary-mismatch",
        subject,
        "A phase-before or final-write partial receipt cannot claim item mutations at that boundary."
      )
    );
  }
  const confirmedFinalPaths = Array.isArray(evidence.partialReceipt?.actorUpdatePaths)
    ? evidence.partialReceipt.actorUpdatePaths
    : [];
  const finalPathsMatch = postFinalCheckpoint
    ? uniqueStringArray(confirmedFinalPaths) &&
      JSON.stringify([...confirmedFinalPaths].sort()) ===
        JSON.stringify([...definition.expectedFinalActorUpdatePaths].sort())
    : confirmedFinalPaths.length === 0;
  if (!finalPathsMatch) {
    findings.push(
      finding(
        "apply-safety-final-write-receipt-mismatch",
        subject,
        "Apply safety receipt does not match whether the final actor write had converged."
      )
    );
  }
  findings.push(
    ...applyReceiptStateFindings({
      completedReceipts: evidence.completedReceipts,
      changedItemIds: failureState?.changedItemIds,
      expected,
      observedItemIds: failureState?.observedItemIds,
      partialReceipt: evidence.partialReceipt,
      preApplyItemIds: failureState?.preApplyItemIds,
      subject,
    })
  );
  const retryPlanStepIds = evidence.retryPlan?.stepIds;
  const retryPlanSourceStepIds = postFinalCheckpoint ? preStepIds : failureState?.recoveredPlanStepIds;
  const retryPlanValid =
    evidence.retryPlan?.strategy === (postFinalCheckpoint ? "lost-ack-replay" : "rebuild-from-recovered-draft") &&
    uniqueStringArray(preStepIds) &&
    uniqueStringArray(retryPlanStepIds) &&
    uniqueStringArray(retryPlanSourceStepIds) &&
    JSON.stringify(preStepIds) === JSON.stringify(definition.expectedPreStepIds) &&
    JSON.stringify(retryPlanStepIds) === JSON.stringify(definition.expectedRetryStepIds) &&
    JSON.stringify(retryPlanStepIds) === JSON.stringify(retryPlanSourceStepIds);
  const expectedCompletedStepIds =
    uniqueStringArray(expectedPreApply.moduleState.completedStepIds) &&
    uniqueStringArray(preStepIds) &&
    uniqueStringArray(retryPlanStepIds)
      ? Array.from(
          new Set([
            ...expectedPreApply.moduleState.completedStepIds,
            ...preStepIds,
            ...retryPlanStepIds,
          ])
        )
      : [];
  const finalActorItemIds = Array.isArray(smokeCase?.actor?.items)
    ? smokeCase.actor.items.map((item) => item?.id)
    : null;
  const retryItemSnapshotsValid =
    uniqueStringArray(evidence.retry?.preRetryItemIds) &&
    uniqueStringArray(evidence.retry?.postRetryItemIds) &&
    uniqueStringArray(finalActorItemIds) &&
    JSON.stringify(evidence.retry.preRetryItemIds) ===
      JSON.stringify([...(failureState?.observedItemIds ?? [])].sort()) &&
    JSON.stringify(evidence.retry.postRetryItemIds) === JSON.stringify([...finalActorItemIds].sort());
  const retryItemOutcomeValid = retryItemSnapshotsValid;
  const finalActorStateValid =
    smokeCase?.actor?.moduleDraftAfterApply === null &&
    smokeCase?.actor?.levelAfterApply === definition.targetLevel &&
    finalModuleStateMatches(smokeCase?.actor?.moduleStateAfterApply, {
      actorId: smokeCase?.actor?.id,
      targetLevel: definition.targetLevel,
      expectedStepIds: expectedCompletedStepIds,
      expectedExistingCharacterHistory: expectedPreApply.moduleState.existingCharacterHistory,
      expectedAppliedSpellRarityAttestations: definition.expectedAppliedSpellRarityAttestations ?? [],
    }) &&
    Array.isArray(smokeCase?.evidence?.rerunStepIds) &&
    smokeCase.evidence.rerunStepIds.length === 0;
  if (
    evidence.retry?.lifecycleKind !== "applied" ||
    evidence.retry?.draftCleared !== true ||
    evidence.retry?.targetLevelReached !== true ||
    evidence.retry?.rerunStepCount !== 0 ||
    !retryPlanValid ||
    !retryItemOutcomeValid ||
    !finalActorStateValid
  ) {
    findings.push(
      finding(
        "apply-safety-retry-mismatch",
        subject,
        "Apply safety retry must converge to one applied, cleared, target-level result with no rerun steps."
      )
    );
  }
  return findings;
}

function checkpointEvidenceFindings(value, expected, subject, label) {
  const parsed = parseCheckpointId(value?.checkpointId);
  const commonMatches =
    parsed &&
    value.checkpointId === expected.checkpointId &&
    value.kind === expected.kind &&
    value.phase === expected.phase &&
    value.boundary === expected.boundary;
  const detailMatches =
    expected.kind === "phase"
      ? value?.operation === null && value?.ordinal === null
      : value?.operation === expected.operation && value?.ordinal === expected.ordinal;
  if (commonMatches && detailMatches) return [];
  return [
    finding(
      `invalid-apply-safety-${label}-checkpoint`,
      subject,
      `Apply safety ${label} checkpoint does not match the requested structured boundary.`
    ),
  ];
}

function applyReceiptFindings(value, subject, kind) {
  const valid =
    value &&
    VALID_APPLY_PHASES.has(value.phase) &&
    [value.createdItemIds, value.deletedItemIds, value.updatedItemIds, value.actorUpdatePaths].every(
      (entries) => uniqueStringArray(entries)
    );
  if (!valid) {
    return [
      finding(
        `invalid-apply-safety-${kind}-receipt`,
        subject,
        `Apply safety ${kind} receipt is missing a phase or string identity arrays.`
      ),
    ];
  }

  const findings = [];
  const mutationSets = [
    new Set(value.createdItemIds),
    new Set(value.deletedItemIds),
    new Set(value.updatedItemIds),
  ];
  if (
    [...mutationSets[0]].some((itemId) => mutationSets[1].has(itemId) || mutationSets[2].has(itemId)) ||
    [...mutationSets[1]].some((itemId) => mutationSets[2].has(itemId))
  ) {
    findings.push(
      finding(
        "apply-safety-overlapping-receipt-items",
        `${subject}:${value.phase}`,
        `Apply safety receipt ${value.phase} places one item in multiple mutation buckets.`
      )
    );
  }
  if (value.phase !== "finalize-actor" && value.actorUpdatePaths.length > 0) {
    findings.push(
      finding(
        "apply-safety-unexpected-actor-update-paths",
        `${subject}:${value.phase}`,
        "Only the finalize-actor receipt may claim actor update paths."
      )
    );
  }
  return findings;
}

function applyReceiptIdentityFindings(receipts, expectedByPhase, actorItems, subject) {
  if (!Array.isArray(receipts) || !Array.isArray(actorItems)) {
    return [
      finding(
        "invalid-apply-safety-receipt-identities",
        subject,
        "Apply safety receipt identity checks require receipt and actor item arrays."
      ),
    ];
  }

  const itemsById = new Map(actorItems.map((item) => [item?.id, item]));
  const findings = [];
  const buckets = [
    ["created", "createdItemIds"],
    ["deleted", "deletedItemIds"],
    ["updated", "updatedItemIds"],
  ];
  for (const receipt of receipts) {
    if (applyReceiptFindings(receipt, subject, "completed").length > 0) continue;
    const expected = expectedByPhase[receipt.phase] ?? {};
    for (const [expectedKey, receiptKey] of buckets) {
      const expectedIdentities = expected[expectedKey] ?? [];
      if (!uniqueStringArray(expectedIdentities)) {
        findings.push(
          finding(
            "invalid-apply-safety-receipt-identity-definition",
            `${subject}:${receipt.phase}:${expectedKey}`,
            `Pinned ${receipt.phase} ${expectedKey} identities must be a unique string array.`
          )
        );
        continue;
      }
      const actualIdentities = [];
      for (const itemId of receipt[receiptKey]) {
        const item = itemsById.get(itemId);
        if (!item) {
          findings.push(
            finding(
              "missing-apply-safety-receipt-item-identity",
              `${subject}:${receipt.phase}:${itemId}`,
              `Receipt item ${itemId} has no final actor identity evidence.`
            )
          );
          continue;
        }
        actualIdentities.push(receiptItemIdentity(item));
      }
      if (
        JSON.stringify(actualIdentities.sort()) !== JSON.stringify([...expectedIdentities].sort())
      ) {
        findings.push(
          finding(
            "apply-safety-receipt-identity-mismatch",
            `${subject}:${receipt.phase}:${expectedKey}`,
            `Receipt ${receipt.phase} ${expectedKey} items do not match their pinned semantic identities.`
          )
        );
      }
    }
  }
  return findings;
}

function receiptItemIdentity(item) {
  return [item?.type ?? "", item?.slotId ?? "", item?.sourceId ?? "", item?.name ?? ""].join("|");
}

function outcomeItemIdentity(item, allItems) {
  const relatedIdentity = (value) => {
    if (!nonEmptyString(value)) return "";
    const related = allItems.find((candidate) => candidate?.id === value);
    if (!related) return `literal:${value}`;
    return nonEmptyString(related.sourceId)
      ? `source:${related.sourceId}`
      : `item:${related.type ?? ""}:${related.slotId ?? ""}:${related.name ?? ""}`;
  };
  return [
    receiptItemIdentity(item),
    `destination=${item?.destinationKey ?? ""}`,
    `location=${relatedIdentity(item?.location)}`,
    `training=${item?.trainingKey ?? ""}`,
    `grant=${Array.isArray(item?.grantAncestryIds) ? item.grantAncestryIds.map(relatedIdentity).join(">") : ""}`,
    `container=${relatedIdentity(item?.containerId)}`,
    `quantity=${item?.quantity ?? ""}`,
    `physical=${item?.isPhysical ?? ""}`,
    `currency=${item?.isCurrency ?? ""}`,
  ].join("::");
}

function applyReceiptStateFindings({
  changedItemIds,
  completedReceipts,
  expected,
  observedItemIds,
  partialReceipt,
  preApplyItemIds,
  subject,
}) {
  if (
    !Array.isArray(completedReceipts) ||
    completedReceipts.some((receipt) => applyReceiptFindings(receipt, subject, "completed").length > 0) ||
    !uniqueStringArray(changedItemIds) ||
    !uniqueStringArray(preApplyItemIds) ||
    !uniqueStringArray(observedItemIds) ||
    applyReceiptFindings(partialReceipt, subject, "partial").length > 0
  ) {
    return [
      finding(
        "invalid-apply-safety-item-snapshots",
        subject,
        "Apply safety receipts require unique before/failure item snapshots and a structured partial receipt."
      ),
    ];
  }

  const phaseAfter = expected.kind === "phase" && expected.boundary === "after";
  if (
    phaseAfter &&
    JSON.stringify(completedReceipts.at(-1) ?? null) !== JSON.stringify(partialReceipt)
  ) {
    return [
      finding(
        "apply-safety-after-receipt-mismatch",
        subject,
        "A phase-after partial receipt must repeat the already-completed phase receipt exactly."
      ),
    ];
  }

  const findings = [];
  const itemIds = new Set(preApplyItemIds);
  const receipts = phaseAfter ? completedReceipts : [...completedReceipts, partialReceipt];
  const reportedUpdatedItemIds = new Set();
  for (const receipt of receipts) {
    for (const itemId of receipt.deletedItemIds) {
      if (!itemIds.delete(itemId)) {
        findings.push(
          finding(
            "apply-safety-impossible-deleted-item",
            `${subject}:${receipt.phase}:${itemId}`,
            `Receipt ${receipt.phase} deletes item ${itemId}, which was not present.`
          )
        );
      }
    }
    for (const itemId of receipt.createdItemIds) {
      if (itemIds.has(itemId)) {
        findings.push(
          finding(
            "apply-safety-impossible-created-item",
            `${subject}:${receipt.phase}:${itemId}`,
            `Receipt ${receipt.phase} creates item ${itemId}, which was already present.`
          )
        );
      }
      itemIds.add(itemId);
    }
    for (const itemId of receipt.updatedItemIds) {
      reportedUpdatedItemIds.add(itemId);
      if (!itemIds.has(itemId)) {
        findings.push(
          finding(
            "apply-safety-impossible-updated-item",
            `${subject}:${receipt.phase}:${itemId}`,
            `Receipt ${receipt.phase} updates item ${itemId}, which was not present.`
          )
        );
      }
    }
  }
  for (const itemId of changedItemIds) {
    if (!reportedUpdatedItemIds.has(itemId)) {
      findings.push(
        finding(
          "apply-safety-missing-updated-item-receipt",
          `${subject}:${itemId}`,
          `Actor item ${itemId} changed by the failed Apply but no receipt reported the update.`
        )
      );
    }
  }
  if (JSON.stringify([...itemIds].sort()) !== JSON.stringify([...observedItemIds].sort())) {
    findings.push(
      finding(
        "apply-safety-item-reconciliation-mismatch",
        subject,
        "Apply safety receipts do not reconcile the pre-apply and observed failure item sets."
      )
    );
  }
  return findings;
}

function validModuleStateSnapshot(value) {
  return (
    value &&
    typeof value === "object" &&
    exactObjectKeys(value, MODULE_STATE_KEYS) &&
    value.version === 4 &&
    (value.completedAcquisitionManifest === null ||
      (value.completedAcquisitionManifest &&
        typeof value.completedAcquisitionManifest === "object" &&
        !Array.isArray(value.completedAcquisitionManifest))) &&
    typeof value.completedAcquisitionManifestCorrupt === "boolean" &&
    (value.lastAppliedAt === null ||
      (nonEmptyString(value.lastAppliedAt) && Number.isFinite(Date.parse(value.lastAppliedAt)))) &&
    (value.lastTargetLevel === null ||
      (Number.isSafeInteger(value.lastTargetLevel) && value.lastTargetLevel >= 1)) &&
    uniqueStringArray(value.completedStepIds) &&
    validAppliedSpellRarityAttestations(value.lastAppliedSpellRarityAttestations)
  );
}

function validAppliedSpellRarityAttestations(value) {
  if (!Array.isArray(value)) return false;
  const identities = new Set();
  for (const attestation of value) {
    if (
      !exactObjectKeys(attestation, APPLIED_SPELL_ATTESTATION_KEYS) ||
      attestation.version !== 1 ||
      attestation.kind !== "spell-rarity-access" ||
      attestation.trust !== "player-attestation" ||
      attestation.status !== "attested" ||
      !boundedText(attestation.subjectLabel, 200) ||
      !["rules-access", "reported-gm-permission"].includes(attestation.claimedBasis) ||
      !boundedText(attestation.reason, 500) ||
      !boundedText(attestation.authorUserId, 200) ||
      !boundedText(attestation.authorName, 200) ||
      !nonEmptyString(attestation.attestedAt) ||
      !Number.isFinite(Date.parse(attestation.attestedAt)) ||
      !exactObjectKeys(attestation.subject, SPELL_ATTESTATION_SUBJECT_KEYS) ||
      !boundedText(attestation.subject.actorId, 200) ||
      !boundedText(attestation.subject.slotId, 200) ||
      !boundedText(attestation.subject.stepId, 200) ||
      !Number.isSafeInteger(attestation.subject.targetLevel) ||
      attestation.subject.targetLevel < 1 ||
      attestation.subject.targetLevel > 20 ||
      !Number.isSafeInteger(attestation.subject.stepLevel) ||
      attestation.subject.stepLevel < 1 ||
      attestation.subject.stepLevel > 20 ||
      !boundedText(attestation.subject.destinationKey, 200) ||
      !["common", "uncommon", "rare", "unique"].includes(attestation.subject.stepRarityCeiling) ||
      !["common", "uncommon", "rare", "unique"].includes(attestation.subject.worldRarityCeiling) ||
      !Array.isArray(attestation.selectedSpells) ||
      attestation.selectedSpells.length === 0
    ) {
      return false;
    }
    const identity = `${attestation.subject.actorId}:${attestation.subject.slotId}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    const spellUuids = new Set();
    for (const spell of attestation.selectedSpells) {
      const keys = spell && typeof spell === "object" && !Array.isArray(spell) ? Object.keys(spell) : [];
      if (
        !SPELL_SELECTION_REQUIRED_KEYS.every((key) => keys.includes(key)) ||
        keys.some((key) => !SPELL_SELECTION_ALLOWED_KEYS.includes(key)) ||
        spell.slotId !== attestation.subject.slotId ||
        !boundedText(spell.packId, 200) ||
        !boundedText(spell.documentId, 200) ||
        !boundedText(spell.uuid, 500) ||
        spell.uuid !== `Compendium.${spell.packId}.Item.${spell.documentId}` ||
        spell.itemType !== "spell" ||
        spell.featType !== null ||
        !boundedText(spell.name, 200) ||
        (spell.level !== null &&
          (!Number.isSafeInteger(spell.level) || spell.level < 0 || spell.level > 10)) ||
        (Object.hasOwn(spell, "slug") &&
          spell.slug !== null &&
          !boundedText(spell.slug, 200)) ||
        spellUuids.has(spell.uuid)
      ) {
        return false;
      }
      spellUuids.add(spell.uuid);
    }
  }
  return true;
}

function validExpectedPreApplyBaseline(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isSafeInteger(value.level) &&
    value.level >= 1 &&
    Number.isSafeInteger(value.itemCount) &&
    value.itemCount >= 0 &&
    validModuleStateSnapshot(value.moduleState)
  );
}

function exactModuleStateMatches(value, expected) {
  return (
    validModuleStateSnapshot(value) &&
    validModuleStateSnapshot(expected) &&
    value.version === expected.version &&
    value.lastAppliedAt === expected.lastAppliedAt &&
    value.lastTargetLevel === expected.lastTargetLevel &&
    JSON.stringify([...value.completedStepIds].sort()) ===
      JSON.stringify([...expected.completedStepIds].sort()) &&
    structuredValueEquals(value.existingCharacterHistory, expected.existingCharacterHistory) &&
    structuredValueEquals(
      value.lastAppliedSpellRarityAttestations,
      expected.lastAppliedSpellRarityAttestations
    ) &&
    structuredValueEquals(value.completedAcquisitionManifest, expected.completedAcquisitionManifest) &&
    value.completedAcquisitionManifestCorrupt === expected.completedAcquisitionManifestCorrupt
  );
}

function finalModuleStateMatches(
  value,
  {
    actorId,
    targetLevel,
    expectedStepIds,
    expectedExistingCharacterHistory,
    expectedAppliedSpellRarityAttestations,
  }
) {
  return (
    validModuleStateSnapshot(value) &&
    nonEmptyString(actorId) &&
    nonEmptyString(value.lastAppliedAt) &&
    Number.isFinite(Date.parse(value.lastAppliedAt)) &&
    value.version === 4 &&
    value.completedAcquisitionManifest === null &&
    value.completedAcquisitionManifestCorrupt === false &&
    value.lastTargetLevel === targetLevel &&
    uniqueStringArray(expectedStepIds) &&
    expectedStepIds.length > 0 &&
    JSON.stringify([...expectedStepIds].sort()) === JSON.stringify([...value.completedStepIds].sort()) &&
    structuredValueEquals(value.existingCharacterHistory, expectedExistingCharacterHistory) &&
    appliedSpellRarityAttestationsMatch(
      value.lastAppliedSpellRarityAttestations,
      actorId,
      targetLevel,
      expectedStepIds,
      expectedAppliedSpellRarityAttestations
    )
  );
}

function appliedSpellRarityAttestationsMatch(value, actorId, targetLevel, expectedStepIds, expected) {
  if (!validAppliedSpellRarityAttestations(value) || !Array.isArray(expected)) return false;
  if (value.length !== expected.length) return false;
  const expectedBySlotId = new Map();
  for (const entry of expected) {
    if (
      !exactObjectKeys(entry, EXPECTED_SPELL_ATTESTATION_KEYS) ||
      !boundedText(entry.slotId, 200) ||
      !boundedText(entry.stepId, 200) ||
      !boundedText(entry.destinationKey, 200) ||
      !Number.isSafeInteger(entry.stepLevel) ||
      entry.stepLevel < 1 ||
      entry.stepLevel > 20 ||
      !["common", "uncommon", "rare", "unique"].includes(entry.stepRarityCeiling) ||
      !["common", "uncommon", "rare", "unique"].includes(entry.worldRarityCeiling) ||
      !["rules-access", "reported-gm-permission"].includes(entry.claimedBasis) ||
      !boundedText(entry.reason, 500) ||
      !validExpectedSpellSelections(entry.selectedSpells) ||
      expectedBySlotId.has(entry.slotId)
    ) {
      return false;
    }
    expectedBySlotId.set(entry.slotId, entry);
  }
  return value.every((attestation) => {
    const expectedAttestation = expectedBySlotId.get(attestation.subject.slotId);
    return (
      expectedAttestation !== undefined &&
      attestation.subject.actorId === actorId &&
      attestation.subject.targetLevel === targetLevel &&
      attestation.subject.stepId === expectedAttestation.stepId &&
      attestation.subject.stepLevel === expectedAttestation.stepLevel &&
      attestation.subject.destinationKey === expectedAttestation.destinationKey &&
      attestation.subject.stepRarityCeiling === expectedAttestation.stepRarityCeiling &&
      attestation.subject.worldRarityCeiling === expectedAttestation.worldRarityCeiling &&
      expectedStepIds.includes(attestation.subject.stepId) &&
      expectedStepIds.includes(attestation.subject.slotId) &&
      attestation.claimedBasis === expectedAttestation.claimedBasis &&
      attestation.reason === expectedAttestation.reason &&
      structuredValueEquals(
        attestation.selectedSpells
          .map(({ uuid, name, level }) => ({ uuid, name, level }))
          .sort((left, right) => left.uuid.localeCompare(right.uuid)),
        [...expectedAttestation.selectedSpells].sort((left, right) => left.uuid.localeCompare(right.uuid))
      )
    );
  });
}

function validExpectedSpellSelections(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (selection) =>
        exactObjectKeys(selection, EXPECTED_SPELL_SELECTION_KEYS) &&
        boundedText(selection.uuid, 500) &&
        boundedText(selection.name, 200) &&
        (selection.level === null ||
          (Number.isSafeInteger(selection.level) && selection.level >= 0 && selection.level <= 10))
    ) &&
    new Set(value.map((selection) => selection.uuid)).size === value.length
  );
}

function spellRarityAttestationReviewLine(attestation) {
  const basis =
    attestation.claimedBasis === "rules-access"
      ? "Character or rules Access"
      : "GM permission reported by player";
  const spells = attestation.selectedSpells.map((spell) => spell.name).join(", ") || "no selected spells";
  return `Player attestation — not GM authorization: ${attestation.subjectLabel}; ${basis}; ${spells}; recorded by ${attestation.authorName} at ${attestation.attestedAt}; reason: ${attestation.reason}`;
}

function structuredValueEquals(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => structuredValueEquals(entry, right[index]))
    );
  }
  if (!left || typeof left !== "object" || !right || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    JSON.stringify(leftKeys) === JSON.stringify(rightKeys) &&
    leftKeys.every((key) => structuredValueEquals(left[key], right[key]))
  );
}

function uniqueStringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length;
}

function nonEmptyUniqueStringArray(value) {
  return uniqueStringArray(value) && value.length > 0;
}

function parseCheckpointId(value) {
  if (!nonEmptyString(value)) return null;
  const parts = value.split(":");
  if (parts.length === 3 && parts[0] === "phase" && VALID_APPLY_PHASES.has(parts[1])) {
    const boundary = parts[2];
    if (boundary !== "before" && boundary !== "after") return null;
    return { checkpointId: value, kind: "phase", phase: parts[1], boundary, operation: null };
  }
  if (parts.length === 3 && parts[0] === "write" && VALID_APPLY_WRITE_OPERATIONS.has(parts[1])) {
    const boundary = parts[2];
    if (boundary !== "before" && boundary !== "after") return null;
    return { checkpointId: value, kind: "write", phase: "finalize-actor", boundary, operation: parts[1] };
  }
  return null;
}

function actorEvidenceFindings(actorEvidence, expectations) {
  if (!actorEvidence) return [];
  const findings = [];
  const actorSubject = String(actorEvidence.id ?? "actor");
  if (!nonEmptyString(actorEvidence.id)) {
    findings.push(finding("missing-actor-id", actorSubject, "Actor evidence must include the observed Foundry actor ID."));
  }
  const authority = actorEvidence.authority;
  const validAuthority =
    exactObjectKeys(authority, ACTOR_AUTHORITY_KEYS) &&
    [authority.explicitOwnershipLevel, authority.defaultOwnershipLevel].every(
      (level) => Number.isSafeInteger(level) && level >= 0 && level <= 3
    ) &&
    [authority.canUpdate, authority.isOwner, authority.ownerPermission].every((value) => typeof value === "boolean");
  if (!validAuthority) {
    findings.push(
      finding(
        "invalid-actor-authority",
        actorSubject,
        "Actor evidence must include a complete Foundry ownership and update-authority snapshot."
      )
    );
  } else if (authority.canUpdate !== true || authority.isOwner !== true || authority.ownerPermission !== true) {
    findings.push(
      finding(
        "insufficient-actor-authority",
        actorSubject,
        "The smoke actor must be updateable and owned by the user executing the case."
      )
    );
  }
  if (!Array.isArray(actorEvidence.items) || actorEvidence.itemCount !== actorEvidence.items.length) {
    findings.push(
      finding(
        "invalid-actor-item-envelope",
        actorSubject,
        "Actor evidence must include an item array and its exact observed item count."
      )
    );
  }
  if (!Number.isSafeInteger(actorEvidence.currencyCopper) || actorEvidence.currencyCopper < 0) {
    findings.push(
      finding(
        "invalid-actor-currency",
        String(actorEvidence.id ?? "actor"),
        "Actor aggregate currency must be a finite, nonnegative copper integer."
      )
    );
  }
  const sourceEvidence = buildActorSourceEvidence(actorEvidence, expectations);
  actorEvidence.sourceGroups = sourceEvidence.sourceGroups;
  actorEvidence.sourceIdentityConflicts = sourceEvidence.findings;
  findings.push(...sourceEvidence.findings);
  return findings;
}

function definitionActorOutcomeFindings(actorEvidence, definition) {
  const configured =
    definition?.expectedItemCount !== undefined ||
    definition?.expectedItemIdentities !== undefined ||
    definition?.expectedItemSemanticIdentities !== undefined ||
    definition?.expectedItemNameCounts !== undefined ||
    definition?.expectedSkillRanks !== undefined ||
    definition?.expectedExactSkillRanks !== undefined ||
    definition?.expectedAbilityBoosts !== undefined ||
    definition?.expectedBoostBatchCounts !== undefined;
  if (!configured) return [];

  const subject = String(definition?.id ?? actorEvidence?.id ?? "actor");
  const items = actorEvidence?.items;
  const findings = [];
  if (!Array.isArray(items)) {
    return [finding("invalid-defined-actor-outcome", subject, "Defined actor outcomes require an item array.")];
  }

  if (definition.expectedItemCount !== undefined) {
    if (!Number.isSafeInteger(definition.expectedItemCount) || definition.expectedItemCount < 0) {
      findings.push(
        finding("invalid-defined-item-count", subject, "Expected actor item count must be a nonnegative integer.")
      );
    } else if (items.length !== definition.expectedItemCount || actorEvidence.itemCount !== items.length) {
      findings.push(
        finding(
          "defined-item-count-mismatch",
          subject,
          `Actor item evidence does not match the pinned count ${definition.expectedItemCount}.`
        )
      );
    }
  }

  if (definition.expectedItemIdentities !== undefined) {
    const expectedIdentities = definition.expectedItemIdentities;
    const actualIdentities = items.map(receiptItemIdentity).sort();
    if (
      !uniqueStringArray(expectedIdentities) ||
      JSON.stringify(actualIdentities) !== JSON.stringify([...expectedIdentities].sort())
    ) {
      findings.push(
        finding(
          "defined-item-identity-mismatch",
          subject,
          "Actor items do not match the pinned final type, slot, source, and name identities."
        )
      );
    }
  }

  if (definition.expectedItemSemanticIdentities !== undefined) {
    const expectedIdentities = definition.expectedItemSemanticIdentities;
    const actualIdentities = items.map((item) => outcomeItemIdentity(item, items)).sort();
    if (
      !uniqueStringArray(expectedIdentities) ||
      JSON.stringify(actualIdentities) !== JSON.stringify([...expectedIdentities].sort())
    ) {
      findings.push(
        finding(
          "defined-item-semantic-identity-mismatch",
          subject,
          "Actor items do not match the pinned placement, training, grant, container, and quantity identities."
        )
      );
    }
  }

  for (const [name, expectedCount] of Object.entries(definition.expectedItemNameCounts ?? {})) {
    const actualCount = items.filter((item) => item?.name === name).length;
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || actualCount !== expectedCount) {
      findings.push(
        finding(
          "defined-item-name-count-mismatch",
          `${subject}:${name}`,
          `Actor item count for ${name} does not match its pinned outcome.`
        )
      );
    }
  }

  for (const [slug, expectedRank] of Object.entries(definition.expectedSkillRanks ?? {})) {
    if (
      !Number.isSafeInteger(expectedRank) ||
      expectedRank < 0 ||
      actorEvidence?.skillRanks?.[slug] !== expectedRank
    ) {
      findings.push(
        finding(
          "defined-skill-rank-mismatch",
          `${subject}:${slug}`,
          `Actor skill rank ${slug} does not match its pinned outcome.`
        )
      );
    }
  }

  if (definition.expectedExactSkillRanks !== undefined) {
    const actualSkillRanks = actorEvidence?.skillRanks;
    if (
      !validExactSkillRanks(definition.expectedExactSkillRanks) ||
      !validExactSkillRanks(actualSkillRanks) ||
      !structuredValueEquals(
        Object.fromEntries(Object.entries(actualSkillRanks).sort(([left], [right]) => left.localeCompare(right))),
        Object.fromEntries(
          Object.entries(definition.expectedExactSkillRanks).sort(([left], [right]) => left.localeCompare(right))
        )
      )
    ) {
      findings.push(
        finding(
          "defined-exact-skill-ranks-mismatch",
          subject,
          "Actor skill ranks do not match the pinned complete skill-rank outcome."
        )
      );
    }
  }

  if (
    definition.expectedAbilityBoosts !== undefined &&
    !abilityBoostStatesEqual(actorEvidence?.abilityBoosts, definition.expectedAbilityBoosts)
  ) {
    findings.push(
      finding(
        "defined-ability-boosts-mismatch",
        subject,
        "Actor ability boosts do not match the pinned complete boost outcome."
      )
    );
  }

  for (const [batchLevel, expectedCount] of Object.entries(definition.expectedBoostBatchCounts ?? {})) {
    const boosts = actorEvidence?.abilityBoosts?.[batchLevel];
    if (
      !Number.isSafeInteger(expectedCount) ||
      expectedCount < 0 ||
      !Array.isArray(boosts) ||
      boosts.length !== expectedCount
    ) {
      findings.push(
        finding(
          "defined-boost-count-mismatch",
          `${subject}:${batchLevel}`,
          `Actor boost batch ${batchLevel} does not match its pinned outcome.`
        )
      );
    }
  }

  return findings;
}

function exactObjectKeys(value, expectedKeys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function validExactSkillRanks(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([slug, rank]) => nonEmptyString(slug) && Number.isSafeInteger(rank) && rank >= 0
    )
  );
}

function validAbilityBoostState(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, entry]) =>
        nonEmptyString(key) &&
        (nonEmptyString(entry) || (uniqueStringArray(entry) && entry.every((ability) => nonEmptyString(ability))))
    )
  );
}

function abilityBoostStatesEqual(actual, expected) {
  if (!validAbilityBoostState(actual) || !validAbilityBoostState(expected)) return false;
  const normalize = (value) =>
    Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, Array.isArray(entry) ? [...entry].sort() : entry])
    );
  return structuredValueEquals(normalize(actual), normalize(expected));
}

function itemShapeFindings(item, allItems) {
  const findings = [];
  const subject = String(item?.id ?? item?.name ?? "item");
  const hasCompleteEnvelope = ITEM_EVIDENCE_KEYS.every((field) => Object.hasOwn(item ?? {}, field));
  if (!hasCompleteEnvelope) {
    findings.push(
      finding(
        "incomplete-item-evidence",
        subject,
        "Every observed item must include the complete nullable identity, placement, quantity, and acquisition envelope."
      )
    );
  }
  if (!nonEmptyString(item?.id)) {
    findings.push(finding("missing-item-id", subject, "Every observed item must have an actual Foundry item ID."));
  }
  if (!nonEmptyString(item?.name) || !nonEmptyString(item?.type)) {
    findings.push(finding("invalid-item-document-identity", subject, "Every observed item needs a name and document type."));
  }
  if (item?.sourceId !== null && !nonEmptyString(item?.sourceId)) {
    findings.push(finding("invalid-item-source-id", subject, "Item source ID must be a nonempty string or null."));
  }
  for (const field of ["slotId", "destinationKey", "trainingKey", "location", "containerId", "grantedById"]) {
    if (item?.[field] !== null && !nonEmptyString(item?.[field])) {
      findings.push(
        finding("invalid-item-nullable-identity", `${subject}:${field}`, `Item ${field} must be a nonempty string or null.`)
      );
    }
  }
  if (typeof item?.isPhysical !== "boolean" || typeof item?.isCurrency !== "boolean") {
    findings.push(
      finding("invalid-item-kind-evidence", subject, "Item physical and currency facts must be explicit booleans.")
    );
  }
  if (item?.isCurrency === true && item?.isPhysical !== true) {
    findings.push(
      finding("invalid-currency-item-kind", subject, "A currency item must be an explicit physical document.")
    );
  }
  if (!uniqueStringArray(item?.grantAncestryIds)) {
    findings.push(
      finding("invalid-grant-ancestry", subject, "Item grant ancestry must be a unique array of observed item IDs.")
    );
  } else {
    findings.push(...grantAncestryFindings(item, allItems));
  }
  if (item?.isPhysical === true && (!Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    findings.push(
      finding("invalid-item-quantity", subject, `Physical item ${subject} must have a positive integer quantity.`)
    );
  }
  if (item?.isPhysical === false && item?.quantity !== null) {
    findings.push(
      finding("invalid-nonphysical-quantity", subject, `Nonphysical item ${subject} must record null quantity.`)
    );
  }
  if (item?.containerId !== null && item?.containerId !== undefined) {
    if (!nonEmptyString(item.containerId) || !allItems.some((candidate) => candidate.id === item.containerId)) {
      findings.push(
        finding(
          "invalid-container-id",
          subject,
          `Item ${subject} references a container that is not present in the observed actor inventory.`
        )
      );
    }
  }
  if (item?.acquisition !== null && item?.acquisition !== undefined) {
    const acquisition = item.acquisition;
    if (item.isPhysical !== true || item.isCurrency === true || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      findings.push(
        finding(
          "invalid-acquisition-item-kind",
          subject,
          `Acquisition item ${subject} must be a non-currency physical document with positive integer quantity.`
        )
      );
    }
    for (const field of ["draftId", "batchId", "lineId", "entryId"]) {
      if (!nonEmptyString(acquisition[field])) {
        findings.push(
          finding(
            "incomplete-acquisition-identity",
            `${subject}:${field}`,
            `Acquisition item ${subject} is missing ${field}.`
          )
        );
      }
    }
    if (!VALID_STACKING_INTENTS.has(acquisition.stackingIntent)) {
      findings.push(
        finding(
          "invalid-stacking-intent",
          subject,
          `Acquisition item ${subject} must declare aggregate or separate stacking intent.`
        )
      );
    }
    if (!nonEmptyString(item.sourceId)) {
      findings.push(
        finding(
          "missing-acquisition-source",
          subject,
          `Acquisition item ${subject} must retain its source UUID.`
        )
      );
    }
  }
  return findings;
}

function grantAncestryFindings(item, allItems) {
  const findings = [];
  const subject = String(item?.id ?? item?.name ?? "item");
  const ancestry = item.grantAncestryIds;
  const itemsById = new Map(allItems.map((candidate) => [candidate?.id, candidate]));
  if (item.grantedById === null) {
    if (ancestry.length > 0) {
      findings.push(
        finding(
          "orphaned-grant-ancestry",
          subject,
          `Item ${subject} records grant ancestry without a direct granted-by item.`
        )
      );
    }
    return findings;
  }
  if (!nonEmptyString(item.grantedById) || ancestry[0] !== item.grantedById) {
    findings.push(
      finding(
        "grant-parent-mismatch",
        subject,
        `Item ${subject} grant ancestry must begin with its direct granted-by item.`
      )
    );
  }
  for (const [index, ancestorId] of ancestry.entries()) {
    const ancestor = itemsById.get(ancestorId);
    if (!ancestor || ancestorId === item.id) {
      findings.push(
        finding(
          "missing-grant-ancestor",
          `${subject}:${ancestorId}`,
          `Item ${subject} references a grant ancestor that is absent or self-referential.`
        )
      );
      continue;
    }
    const expectedNextId = ancestry[index + 1] ?? null;
    if ((ancestor.grantedById ?? null) !== expectedNextId) {
      findings.push(
        finding(
          "grant-ancestry-chain-mismatch",
          `${subject}:${ancestorId}`,
          `Item ${subject} grant ancestry does not match the observed parent chain.`
        )
      );
    }
  }
  return findings;
}

function duplicateRuntimeIdentityFindings(items) {
  const findings = [];
  for (const [field, code, label] of [
    ["id", "duplicate-item-id", "actual item ID"],
    ["acquisition.entryId", "duplicate-acquisition-entry", "acquisition entry ID"],
  ]) {
    const values = new Map();
    for (const item of items) {
      const value = field === "id" ? item.id : item.acquisition?.entryId;
      if (!nonEmptyString(value)) continue;
      const count = values.get(value) ?? 0;
      values.set(value, count + 1);
    }
    for (const [value, count] of values) {
      if (count > 1) {
        findings.push(finding(code, value, `Observed ${label} ${value} ${count} times.`));
      }
    }
  }
  return findings;
}

function stackingFindings(sourceId, sourceItems) {
  const findings = [];
  const acquisitionGroups = new Map();
  for (const item of sourceItems) {
    const acquisition = item.acquisition;
    if (!acquisition || !nonEmptyString(acquisition.batchId) || !nonEmptyString(acquisition.lineId)) continue;
    const key = `${acquisition.batchId}:${acquisition.lineId}`;
    const group = acquisitionGroups.get(key) ?? [];
    group.push(item);
    acquisitionGroups.set(key, group);
  }
  for (const [key, items] of acquisitionGroups) {
    if (items.length > 1 && items.some((item) => item.acquisition.stackingIntent === "aggregate")) {
      findings.push(
        finding(
          "aggregate-stack-split",
          `${sourceId}:${key}`,
          `Aggregate acquisition line ${key} for ${sourceId} materialized as ${items.length} documents.`
        )
      );
    }
  }
  return findings;
}

function sourceExpectationFindings(sourceGroups, expectation) {
  const findings = [];
  const sourceId = expectation?.sourceId;
  if (!nonEmptyString(sourceId)) {
    return [finding("invalid-source-expectation", "missing-source", "A source-group expectation needs a source ID.")];
  }
  const group = sourceGroups.find((candidate) => candidate.sourceId === sourceId);
  if (!group) {
    return [finding("missing-expected-source", sourceId, `Expected source ${sourceId} was not observed.`)];
  }
  if (Number.isSafeInteger(expectation.documentCount) && group.documentCount !== expectation.documentCount) {
    findings.push(
      finding(
        "source-document-count-mismatch",
        sourceId,
        `Source ${sourceId} produced ${group.documentCount} documents; expected ${expectation.documentCount}.`
      )
    );
  }
  if (Number.isSafeInteger(expectation.totalQuantity) && group.totalQuantity !== expectation.totalQuantity) {
    findings.push(
      finding(
        "source-quantity-mismatch",
        sourceId,
        `Source ${sourceId} produced quantity ${group.totalQuantity}; expected ${expectation.totalQuantity}.`
      )
    );
  }
  if (expectation.stackingIntent === "aggregate" && group.documentCount !== 1) {
    findings.push(
      finding(
        "source-stacking-mismatch",
        sourceId,
        `Source ${sourceId} was expected to aggregate into one document.`
      )
    );
  }
  return findings;
}

function acquisitionEnvelopeFindings(smokeCase) {
  const acquisition = smokeCase?.evidence?.acquisition;
  const subject = String(smokeCase?.id ?? "case");
  if (!exactObjectKeys(acquisition, ACQUISITION_EVIDENCE_KEYS)) {
    return [
      finding(
        "invalid-acquisition-envelope",
        subject,
        "Every smoke case must include the complete nullable acquisition evidence envelope."
      ),
    ];
  }

  const findings = [];
  if (!exactObjectKeys(acquisition.currency, ACQUISITION_CURRENCY_KEYS)) {
    findings.push(
      finding(
        "invalid-acquisition-currency-envelope",
        subject,
        "Acquisition evidence must include every nullable currency ledger field."
      )
    );
  } else if (
    Object.values(acquisition.currency).some(
      (value) => value !== null && (!Number.isSafeInteger(value) || value < 0)
    )
  ) {
    findings.push(
      finding(
        "invalid-acquisition-currency-envelope-value",
        subject,
        "Nullable acquisition currency fields must be null or nonnegative copper integers."
      )
    );
  }
  for (const field of ["policy", "manifest", "failureSnapshot"]) {
    const value = acquisition[field];
    if (value !== null && (!value || typeof value !== "object" || Array.isArray(value))) {
      findings.push(
        finding(
          "invalid-acquisition-envelope-value",
          `${subject}:${field}`,
          `Acquisition ${field} must be a structured object or null.`
        )
      );
    }
  }
  return findings;
}

function acquisitionEvidenceFindings(smokeCase) {
  const acquisition = smokeCase?.evidence?.acquisition;
  const subject = String(smokeCase?.id ?? "acquisition-case");
  if (!acquisition || typeof acquisition !== "object") {
    return [finding("missing-acquisition-evidence", subject, "Acquisition smoke evidence is missing.")];
  }
  const findings = [];
  for (const field of ["source", "version", "fingerprint"]) {
    if (!nonEmptyString(acquisition.policy?.[field])) {
      findings.push(
        finding("missing-policy-provenance", `${subject}:${field}`, `Acquisition policy is missing ${field}.`)
      );
    }
  }
  for (const field of [
    "preCopper",
    "budgetCopper",
    "targetCopper",
    "observedCopper",
    "spentCopper",
    "remainingCopper",
  ]) {
    const value = acquisition.currency?.[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      findings.push(
        finding(
          "invalid-acquisition-currency",
          `${subject}:${field}`,
          `Acquisition currency field ${field} must be a nonnegative copper integer.`
        )
      );
    }
  }
  const currency = acquisition.currency ?? {};
  if (
    Number.isSafeInteger(currency.budgetCopper) &&
    Number.isSafeInteger(currency.spentCopper) &&
    Number.isSafeInteger(currency.remainingCopper) &&
    currency.spentCopper + currency.remainingCopper !== currency.budgetCopper
  ) {
    findings.push(
      finding(
        "currency-ledger-mismatch",
        subject,
        `Spent ${currency.spentCopper} plus remaining ${currency.remainingCopper} does not equal budget ${currency.budgetCopper}.`
      )
    );
  }
  if (
    Number.isSafeInteger(currency.preCopper) &&
    Number.isSafeInteger(currency.remainingCopper) &&
    Number.isSafeInteger(currency.targetCopper) &&
    currency.preCopper + currency.remainingCopper !== currency.targetCopper
  ) {
    findings.push(
      finding(
        "currency-absolute-target-mismatch",
        subject,
        `Pre-apply ${currency.preCopper} plus remaining ${currency.remainingCopper} does not equal absolute target ${currency.targetCopper}.`
      )
    );
  }
  const failureSnapshotPresent = acquisition.failureSnapshot !== null && acquisition.failureSnapshot !== undefined;
  if (
    !failureSnapshotPresent &&
    Number.isSafeInteger(currency.targetCopper) &&
    Number.isSafeInteger(currency.observedCopper) &&
    currency.targetCopper !== currency.observedCopper
  ) {
    findings.push(
      finding(
        "currency-target-mismatch",
        subject,
        `Observed currency ${currency.observedCopper} does not equal target currency ${currency.targetCopper}.`
      )
    );
  }
  if (
    Number.isSafeInteger(currency.observedCopper) &&
    Number.isSafeInteger(smokeCase.actor?.currencyCopper) &&
    currency.observedCopper !== smokeCase.actor.currencyCopper
  ) {
    findings.push(
      finding(
        "actor-currency-mismatch",
        subject,
        `Acquisition observed ${currency.observedCopper} copper but the actor snapshot contains ${smokeCase.actor.currencyCopper}.`
      )
    );
  }
  if (!failureSnapshotPresent) {
    for (const field of ["id", "batchId"]) {
      if (!nonEmptyString(acquisition.manifest?.[field])) {
        findings.push(
          finding("missing-manifest-identity", `${subject}:${field}`, `Successful acquisition is missing manifest ${field}.`)
        );
      }
    }
    if (!Number.isSafeInteger(acquisition.manifest?.schemaVersion) || acquisition.manifest.schemaVersion < 1) {
      findings.push(
        finding(
          "invalid-manifest-version",
          subject,
          "Successful acquisition needs a positive manifest schema version."
        )
      );
    }
    if (!Array.isArray(acquisition.manifest?.entries)) {
      findings.push(
        finding("missing-manifest-entries", subject, "Successful acquisition needs canonical manifest entries.")
      );
    } else {
      findings.push(...manifestReconciliationFindings(smokeCase.actor?.items ?? [], acquisition.manifest, subject));
    }
  } else {
    for (const field of [
      "point",
      "batchId",
      "afterItemIndex",
      "currencyOperationIndex",
      "message",
      "actualItemIds",
      "observedCurrencyCopper",
      "manifestId",
    ]) {
      if (!Object.hasOwn(acquisition.failureSnapshot, field)) {
        findings.push(
          finding(
            "incomplete-failure-snapshot",
            `${subject}:${field}`,
            `Acquisition failure snapshot is missing ${field}.`
          )
        );
      }
    }
    if (!nonEmptyString(acquisition.failureSnapshot.point) || !nonEmptyString(acquisition.failureSnapshot.message)) {
      findings.push(
        finding(
          "invalid-failure-snapshot",
          subject,
          "Acquisition failure snapshot needs a stable point and nonempty message."
        )
      );
    }
    if (!nonEmptyString(acquisition.failureSnapshot.batchId)) {
      findings.push(
        finding("invalid-failure-batch", subject, "Acquisition failure snapshot needs the attempted batch ID.")
      );
    }
    const validFailurePoints = new Set([
      "item-after",
      "currency-before",
      "currency-after",
      "final-state-before",
      "final-state-after",
    ]);
    if (!validFailurePoints.has(acquisition.failureSnapshot.point)) {
      findings.push(
        finding(
          "invalid-failure-point",
          subject,
          "Acquisition failure point must identify a supported item, currency, or final-state boundary."
        )
      );
    }
    if (
      acquisition.failureSnapshot.afterItemIndex !== null &&
      (!Number.isSafeInteger(acquisition.failureSnapshot.afterItemIndex) ||
        acquisition.failureSnapshot.afterItemIndex < 0)
    ) {
      findings.push(
        finding(
          "invalid-failure-item-index",
          subject,
          "Acquisition failure snapshot item index must be null or a nonnegative integer."
        )
      );
    }
    const itemPoint = acquisition.failureSnapshot.point === "item-after";
    if (
      itemPoint !==
      (Number.isSafeInteger(acquisition.failureSnapshot.afterItemIndex) &&
        acquisition.failureSnapshot.afterItemIndex >= 1)
    ) {
      findings.push(
        finding(
          "failure-item-index-mismatch",
          subject,
          "Only an item-after failure uses a positive after-item index."
        )
      );
    }
    const currencyPoint = acquisition.failureSnapshot.point === "currency-after";
    if (
      currencyPoint !==
      (Number.isSafeInteger(acquisition.failureSnapshot.currencyOperationIndex) &&
        acquisition.failureSnapshot.currencyOperationIndex >= 1)
    ) {
      findings.push(
        finding(
          "failure-currency-index-mismatch",
          subject,
          "Only a currency-after failure uses a positive currency-operation index."
        )
      );
    }
    if (
      !Array.isArray(acquisition.failureSnapshot.actualItemIds) ||
      acquisition.failureSnapshot.actualItemIds.some((id) => !nonEmptyString(id))
    ) {
      findings.push(
        finding(
          "invalid-failure-item-ids",
          subject,
          "Acquisition failure snapshot must contain actual item IDs."
        )
      );
    }
    if (
      Array.isArray(acquisition.failureSnapshot.actualItemIds) &&
      itemPoint &&
      Number.isSafeInteger(acquisition.failureSnapshot.afterItemIndex) &&
      acquisition.failureSnapshot.actualItemIds.length !== acquisition.failureSnapshot.afterItemIndex
    ) {
      findings.push(
        finding(
          "failure-item-count-mismatch",
          subject,
          "An item-after snapshot must contain exactly the item IDs created through that checkpoint."
        )
      );
    }
    if (Array.isArray(acquisition.failureSnapshot.actualItemIds)) {
      findings.push(...failureItemSnapshotFindings(smokeCase.actor?.items ?? [], acquisition.failureSnapshot, subject));
    }
    if (
      !Number.isSafeInteger(acquisition.failureSnapshot.observedCurrencyCopper) ||
      acquisition.failureSnapshot.observedCurrencyCopper < 0
    ) {
      findings.push(
        finding(
          "invalid-failure-currency",
          subject,
          "Acquisition failure snapshot must contain nonnegative observed copper."
        )
      );
    }
    if (
      Number.isSafeInteger(acquisition.failureSnapshot.observedCurrencyCopper) &&
      acquisition.failureSnapshot.observedCurrencyCopper !== currency.observedCopper
    ) {
      findings.push(
        finding(
          "failure-currency-snapshot-mismatch",
          subject,
          "Failure snapshot currency must equal the acquisition and actor observations."
        )
      );
    }
    if (
      ["item-after", "currency-before"].includes(acquisition.failureSnapshot.point) &&
      Number.isSafeInteger(currency.preCopper) &&
      Number.isSafeInteger(currency.observedCopper) &&
      currency.preCopper !== currency.observedCopper
    ) {
      findings.push(
        finding(
          "pre-currency-mutation-mismatch",
          subject,
          "Item and before-currency failures must leave aggregate currency at its pre-apply value."
        )
      );
    }
    if (
      ["final-state-before", "final-state-after"].includes(acquisition.failureSnapshot.point) &&
      Number.isSafeInteger(currency.targetCopper) &&
      Number.isSafeInteger(currency.observedCopper) &&
      currency.targetCopper !== currency.observedCopper
    ) {
      findings.push(
        finding(
          "final-state-currency-mismatch",
          subject,
          "Final-state failures require already-converged currency."
        )
      );
    }
    const manifestId = acquisition.failureSnapshot.manifestId;
    if (
      acquisition.failureSnapshot.point === "final-state-after"
        ? !nonEmptyString(manifestId)
        : manifestId !== null
    ) {
      findings.push(
        finding(
          "failure-manifest-state-mismatch",
          subject,
          "Only a final-state-after lost acknowledgement may observe a completed manifest ID."
        )
      );
    }
  }
  return uniqueFindings(findings);
}

function classificationFindings(smokeCase) {
  return (Array.isArray(smokeCase.classifications) ? smokeCase.classifications : []).map((message) =>
    finding("manual-classification", String(message), String(message))
  );
}

function applyFindingReviews(findings, reviews) {
  const reviewsById = new Map();
  for (const review of reviews) {
    if (
      nonEmptyString(review?.findingId) &&
      review.reviewerRole === "gm" &&
      nonEmptyString(review.reviewedAt) &&
      Number.isFinite(Date.parse(review.reviewedAt)) &&
      nonEmptyString(review.reason)
    ) {
      reviewsById.set(review.findingId, {
        reviewerRole: "gm",
        reviewedAt: review.reviewedAt,
        reason: review.reason,
      });
    }
  }
  return findings.map((entry) => ({
    ...entry,
    review: REVIEWABLE_FINDING_CODES.has(entry.code) ? (reviewsById.get(entry.id) ?? null) : null,
  }));
}

function reviewRecordFindings(findings, reviews, reviewingUserIsGM) {
  const findingIds = new Set(findings.map((entry) => entry.id));
  const reviewableFindingIds = new Set(
    findings.filter((entry) => REVIEWABLE_FINDING_CODES.has(entry.code)).map((entry) => entry.id)
  );
  const seenReviewIds = new Set();
  const reviewFindings = [];
  if (reviews.length > 0 && reviewingUserIsGM !== true) {
    reviewFindings.push(
      finding(
        "non-gm-review-session",
        "review-session",
        "Finding reviews can qualify only when the evidence run is executed by a current GM."
      )
    );
  }
  for (const [index, review] of reviews.entries()) {
    const subject = nonEmptyString(review?.findingId) ? review.findingId : `review-${index + 1}`;
    const valid =
      nonEmptyString(review?.findingId) &&
      review.reviewerRole === "gm" &&
      nonEmptyString(review.reviewedAt) &&
      Number.isFinite(Date.parse(review.reviewedAt)) &&
      nonEmptyString(review.reason);
    if (!valid) {
      reviewFindings.push(
        finding(
          "invalid-review-record",
          subject,
          "Finding reviews require an exact finding ID, GM role, timestamp, and rationale."
        )
      );
      continue;
    }
    if (!findingIds.has(review.findingId)) {
      reviewFindings.push(
        finding("unused-review-record", subject, `Review ${review.findingId} does not match an observed finding.`)
      );
    } else if (!reviewableFindingIds.has(review.findingId)) {
      reviewFindings.push(
        finding(
          "non-reviewable-review-record",
          subject,
          `Review ${review.findingId} targets structural evidence that cannot be waived.`
        )
      );
    }
    if (seenReviewIds.has(review.findingId)) {
      reviewFindings.push(
        finding("duplicate-review-record", subject, `Review ${review.findingId} is recorded more than once.`)
      );
    }
    seenReviewIds.add(review.findingId);
  }
  return reviewFindings;
}

function semanticItemIdentity(item) {
  if (item.acquisition) {
    return `acquisition:${item.acquisition.batchId ?? "?"}:${item.acquisition.lineId ?? "?"}:${item.acquisition.entryId ?? "?"}`;
  }
  if (Array.isArray(item.grantAncestryIds) && item.grantAncestryIds.length > 0) {
    return `grant:${item.grantAncestryIds.join(">")}`;
  }
  if (item.type === "spell") {
    return `spell:${item.destinationKey ?? item.location ?? "unplaced"}`;
  }
  if (nonEmptyString(item.slotId)) {
    return `wayfinder:${item.slotId}:${item.trainingKey ?? ""}`;
  }
  return "unscoped";
}

function finding(code, subject, message) {
  const identity = `${code}:${subject}:${message}`;
  return {
    id: `wf-smoke:${code}:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`,
    code,
    subject,
    message,
  };
}

function uniqueFindings(findings) {
  return [...new Map(findings.map((entry) => [entry.id, entry])).values()];
}

function summarizeCases(cases) {
  return {
    classified: cases.filter((entry) => entry.status === "classified").length,
    failed: cases.filter((entry) => entry.status === "fail").length,
    passed: cases.filter((entry) => entry.status === "pass").length,
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedText(value, maximumLength) {
  return nonEmptyString(value) && value.trim().length <= maximumLength;
}

function manifestReconciliationFindings(items, manifest, subject) {
  const findings = [];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const entriesById = new Map();
  for (const entry of manifest.entries) {
    const entryId = entry?.entryId;
    if (!nonEmptyString(entryId) || entriesById.has(entryId)) {
      findings.push(
        finding(
          "invalid-manifest-entry-id",
          `${subject}:${String(entryId)}`,
          "Manifest entry IDs must be present and unique."
        )
      );
      continue;
    }
    entriesById.set(entryId, entry);
    for (const field of ["lineId", "sourceId"]) {
      if (!nonEmptyString(entry[field])) {
        findings.push(
          finding(
            "incomplete-manifest-entry",
            `${subject}:${entryId}:${field}`,
            `Manifest entry ${entryId} is missing ${field}.`
          )
        );
      }
    }
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 1) {
      findings.push(
        finding(
          "invalid-manifest-quantity",
          `${subject}:${entryId}`,
          `Manifest entry ${entryId} needs a positive integer quantity.`
        )
      );
    }
    if (!nonEmptyUniqueStringArray(entry.actualItemIds)) {
      findings.push(
        finding(
          "missing-manifest-item-ids",
          `${subject}:${entryId}`,
          `Manifest entry ${entryId} needs unique observed actor item IDs.`
        )
      );
      continue;
    }
    let observedQuantity = 0;
    for (const itemId of entry.actualItemIds) {
      const item = itemsById.get(itemId);
      if (!item) {
        findings.push(
          finding(
            "missing-manifest-item",
            `${subject}:${entryId}:${itemId}`,
            `Manifest entry ${entryId} references actor item ${itemId}, which was not observed.`
          )
        );
        continue;
      }
      observedQuantity += Number.isSafeInteger(item.quantity) ? item.quantity : 0;
      const identity = item.acquisition;
      if (
        identity?.batchId !== manifest.batchId ||
        identity?.lineId !== entry.lineId ||
        identity?.entryId !== entry.entryId ||
        item.sourceId !== entry.sourceId
      ) {
        findings.push(
          finding(
            "manifest-item-identity-mismatch",
            `${subject}:${entryId}:${itemId}`,
            `Actor item ${itemId} does not match manifest batch, line, entry, and source identity.`
          )
        );
      }
      if ((item.containerId ?? null) !== (entry.containerId ?? null)) {
        findings.push(
          finding(
            "manifest-container-mismatch",
            `${subject}:${entryId}:${itemId}`,
            `Actor item ${itemId} does not match manifest container identity.`
          )
        );
      }
      if (JSON.stringify(item.grantAncestryIds ?? []) !== JSON.stringify(entry.grantAncestryIds ?? [])) {
        findings.push(
          finding(
            "manifest-grant-ancestry-mismatch",
            `${subject}:${entryId}:${itemId}`,
            `Actor item ${itemId} does not match manifest grant ancestry.`
          )
        );
      }
    }
    if (Number.isSafeInteger(entry.quantity) && observedQuantity !== entry.quantity) {
      findings.push(
        finding(
          "manifest-quantity-mismatch",
          `${subject}:${entryId}`,
          `Manifest entry ${entryId} records quantity ${entry.quantity}, but observed ${observedQuantity}.`
        )
      );
    }
  }

  for (const item of items) {
    if (item.acquisition?.batchId !== manifest.batchId) continue;
    const entry = entriesById.get(item.acquisition.entryId);
    if (!entry || !entry.actualItemIds?.includes(item.id)) {
      findings.push(
        finding(
          "unmanifested-acquisition-item",
          `${subject}:${item.id}`,
          `Batch item ${item.id} is not represented by its canonical manifest entry.`
        )
      );
    }
  }
  return findings;
}

function failureItemSnapshotFindings(items, snapshot, subject) {
  const findings = [];
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const uniqueIds = new Set(snapshot.actualItemIds);
  if (uniqueIds.size !== snapshot.actualItemIds.length) {
    findings.push(
      finding(
        "duplicate-failure-item-id",
        subject,
        "Acquisition failure snapshot actual item IDs must be unique."
      )
    );
  }
  for (const itemId of uniqueIds) {
    const item = itemsById.get(itemId);
    if (!item) {
      findings.push(
        finding(
          "missing-failure-item",
          `${subject}:${itemId}`,
          `Acquisition failure snapshot references actor item ${itemId}, which was not observed.`
        )
      );
      continue;
    }
    const identity = item.acquisition;
    if (
      item.isPhysical !== true ||
      item.isCurrency === true ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      !identity ||
      identity.batchId !== snapshot.batchId ||
      !nonEmptyString(identity.lineId) ||
      !nonEmptyString(identity.entryId) ||
      !nonEmptyString(item.sourceId)
    ) {
      findings.push(
        finding(
          "failure-item-identity-mismatch",
          `${subject}:${itemId}`,
          `Failure item ${itemId} does not retain complete identity for batch ${snapshot.batchId}.`
        )
      );
    }
  }
  const observedBatchItemIds = items
    .filter((item) => item.acquisition?.batchId === snapshot.batchId)
    .map((item) => item.id)
    .sort();
  const snapshotItemIds = [...uniqueIds].sort();
  if (JSON.stringify(observedBatchItemIds) !== JSON.stringify(snapshotItemIds)) {
    findings.push(
      finding(
        "failure-batch-item-set-mismatch",
        subject,
        "Failure snapshot item IDs do not exactly match the observed partial batch."
      )
    );
  }
  return findings;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(String(value));
    else seen.add(value);
  }
  return [...duplicates].sort();
}
