import { createHash } from "node:crypto";

import { wf51ReleaseOverlayRows } from "./wf51-release-overlay-cases.mjs";

const CATEGORY_KEYS = Object.freeze({
  roles: new Set(["executorRole", "isGM", "role", "userId", "authorUserId", "configuredBy"]),
  policy: new Set([
    "policy",
    "policySnapshot",
    "policyFingerprint",
    "definitionFingerprint",
    "recipeSelection",
    "startEvidence",
    "abp",
  ]),
  identities: new Set([
    "actorId",
    "requestId",
    "batchId",
    "lineId",
    "entryId",
    "plannedItemId",
    "plannedContainerId",
    "manifestId",
  ]),
  quantities: new Set(["quantity", "requestedQuantity", "materializedQuantity", "actualQuantity", "itemLevel"]),
  containers: new Set(["containerId", "actualContainerId", "ownedContainerId", "plannedContainerId"]),
  currency: new Set([
    "currencyCopper",
    "budgetCopper",
    "amountCopper",
    "targetCopper",
    "preCopper",
    "observedCopper",
    "unitPriceCopper",
    "linePriceCopper",
  ]),
  failures: new Set(["failure", "failures", "failureSnapshot", "partialReceipt", "error", "differences"]),
  manifests: new Set(["manifest", "durableManifest", "recoveredManifest", "completedAcquisitionManifest"]),
});

export function buildWf51AggregateRecords({ candidate, focusedCases, childSources }) {
  const focusedCaseResults = focusedCases?.cases ?? [];
  const focusedCleanup = focusedCases?.cleanup ?? null;
  const focused = {
    route: "focused",
    evidenceId: focusedCases?.evidenceId ?? null,
    qualified:
      focusedCaseResults.length > 0 &&
      focusedCaseResults.every((entry) => entry?.status === "pass") &&
      focusedCleanup?.attempted === true &&
      focusedCleanup.actorsMissingAfterCleanup === true &&
      focusedCleanup.actorCountRestored === true &&
      focusedCleanup.policyRestored === true &&
      focusedCleanup.judgmentsRestored === true &&
      focusedCleanup.abpRestored === true &&
      focusedCleanup.restorationFailures?.length === 0,
    resultSha256: digest(focusedCases),
    candidateSha: candidate.gitSha,
    servedScriptManifestSha256: candidate.servedScriptManifestSha256,
    result: { cases: focusedCaseResults, cleanup: focusedCleanup },
  };
  const sources = new Map([["focused", focused], ...childSources.map((entry) => [entry.route, entry])]);
  return wf51ReleaseOverlayRows.map((definition) => {
    const matched = definition.evidenceRefs.map((reference) => bindEvidenceReference(reference, sources));
    const combined = matched.flatMap((entry) => (entry.caseEvidence === null ? [] : [entry.caseEvidence]));
    return {
      number: definition.number,
      id: definition.id,
      status: matched.every((entry) => entry.qualified && entry.caseEvidence !== null) ? "pass" : "fail",
      definitionFingerprint: definition.definitionFingerprint,
      requiredEvidence: definition.requiredEvidence,
      evidenceRefs: matched.map(withoutCaseEvidence),
      evidence: summarizeEvidence(combined),
      candidateSha: candidate.gitSha,
      servedScriptManifestSha256: candidate.servedScriptManifestSha256,
      cleanupProvenance: matched.map((entry) => ({
        route: entry.route,
        evidenceId: entry.evidenceId,
        cleanup: entry.cleanup,
      })),
    };
  });
}

export function summarizeEvidence(values) {
  const found = Object.fromEntries(Object.keys(CATEGORY_KEYS).map((key) => [key, []]));
  for (const value of values) collectFacts(value, "$", found, new Set());
  return Object.fromEntries(
    Object.entries(found).map(([key, entries]) => [
      key,
      entries.length > 0
        ? { applicable: true, values: uniqueByJson(entries) }
        : { applicable: false, values: [], reason: "The bound route has no applicable evidence for this category." },
    ]),
  );
}

function bindEvidenceReference(reference, sources) {
  const source = sources.get(reference.route) ?? null;
  const matchedCase = source ? findCase(source.result, reference.caseId) : null;
  const caseEvidence = matchedCase
    ? { case: matchedCase, users: source?.result?.users ?? null, user: source?.result?.user ?? null }
    : null;
  return {
    route: reference.route,
    caseId: reference.caseId,
    evidenceId: source?.evidenceId ?? null,
    resultSha256: source?.resultSha256 ?? null,
    candidateSha: source?.candidateSha ?? null,
    servedScriptManifestSha256: source?.servedScriptManifestSha256 ?? null,
    qualified: source?.qualified === true && matchedCase?.status === "pass",
    caseEvidence,
    cleanup: source?.result?.cleanup ?? null,
  };
}

function withoutCaseEvidence(value) {
  const reference = { ...value };
  delete reference.caseEvidence;
  return reference;
}

function findCase(result, caseId) {
  const collections = [result?.cases, result?.locales, result?.scenarios, result?.executions];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const found = collection.find((entry) => entry?.id === caseId || entry?.caseId === caseId);
    if (found) return found;
  }
  return null;
}

function collectFacts(value, path, found, visited) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) collectFacts(value[index], `${path}[${index}]`, found, visited);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    for (const [category, keys] of Object.entries(CATEGORY_KEYS)) {
      if (keys.has(key) && meaningful(entry)) found[category].push({ path: `${path}.${key}`, value: entry });
    }
    collectFacts(entry, `${path}.${key}`, found, visited);
  }
}

function meaningful(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function uniqueByJson(entries) {
  const byValue = new Map();
  for (const entry of entries) byValue.set(JSON.stringify(entry), entry);
  return [...byValue.values()];
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}
