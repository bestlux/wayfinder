import { createHash } from "node:crypto";

export const SMOKE_EVIDENCE_SCHEMA_VERSION = 2;

const VALID_STACKING_INTENTS = new Set(["aggregate", "separate"]);

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
    typeof user.isGM !== "boolean"
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

function actorEvidenceFindings(actorEvidence, expectations) {
  if (!actorEvidence) return [];
  const findings = [];
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

function itemShapeFindings(item, allItems) {
  const findings = [];
  const subject = String(item?.id ?? item?.name ?? "item");
  if (!nonEmptyString(item?.id)) {
    findings.push(finding("missing-item-id", subject, "Every observed item must have an actual Foundry item ID."));
  }
  if (item?.isPhysical === true && (!Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    findings.push(
      finding("invalid-item-quantity", subject, `Physical item ${subject} must have a positive integer quantity.`)
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
  return findings.map((entry) => ({ ...entry, review: reviewsById.get(entry.id) ?? null }));
}

function reviewRecordFindings(findings, reviews, reviewingUserIsGM) {
  const findingIds = new Set(findings.map((entry) => entry.id));
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
    if (!Array.isArray(entry.actualItemIds) || entry.actualItemIds.length === 0) {
      findings.push(
        finding(
          "missing-manifest-item-ids",
          `${subject}:${entryId}`,
          `Manifest entry ${entryId} needs observed actor item IDs.`
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
