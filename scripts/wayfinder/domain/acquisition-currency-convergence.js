export const ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION = 1;
export function createAcquisitionCurrencyConvergenceWitness(args) {
    const material = {
        version: ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION,
        actorId: args.actorId,
        draftId: args.draftId,
        batchId: args.batchId,
        manifestId: args.manifestId,
        ledgerDigest: args.ledgerDigest,
        baselineFingerprint: args.baselineFingerprint,
        preCopper: args.preCopper,
        targetCopper: args.targetCopper,
        observedCopper: args.observedCopper,
        phase: "acquisition-currency",
        operation: "currency-convergence",
        boundary: "after",
        ordinal: 1,
        verifiedAt: args.verifiedAt,
    };
    assertMaterial(material);
    return Object.freeze({ ...material, fingerprint: fingerprint(material) });
}
export function normalizeAcquisitionCurrencyConvergenceWitness(raw) {
    if (!isRecord(raw))
        return null;
    const material = {
        version: raw.version,
        actorId: raw.actorId,
        draftId: raw.draftId,
        batchId: raw.batchId,
        manifestId: raw.manifestId,
        ledgerDigest: raw.ledgerDigest,
        baselineFingerprint: raw.baselineFingerprint,
        preCopper: raw.preCopper,
        targetCopper: raw.targetCopper,
        observedCopper: raw.observedCopper,
        phase: raw.phase,
        operation: raw.operation,
        boundary: raw.boundary,
        ordinal: raw.ordinal,
        verifiedAt: raw.verifiedAt,
    };
    try {
        assertMaterial(material);
    }
    catch {
        return null;
    }
    if (raw.fingerprint !== fingerprint(material))
        return null;
    return Object.freeze({ ...material, fingerprint: raw.fingerprint });
}
export function acquisitionCurrencyConvergenceWitnessMatches(witness, expected) {
    return (witness.actorId === expected.actorId &&
        witness.draftId === expected.draftId &&
        witness.batchId === expected.batchId &&
        witness.manifestId === expected.manifestId &&
        witness.ledgerDigest === expected.ledgerDigest &&
        witness.baselineFingerprint === expected.baselineFingerprint &&
        witness.preCopper === expected.preCopper &&
        witness.targetCopper === expected.targetCopper &&
        witness.observedCopper === expected.targetCopper);
}
function assertMaterial(material) {
    if (material.version !== ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION ||
        !nonEmpty(material.actorId) ||
        !nonEmpty(material.draftId) ||
        !nonEmpty(material.batchId) ||
        !nonEmpty(material.manifestId) ||
        !nonEmpty(material.ledgerDigest) ||
        !nonEmpty(material.baselineFingerprint) ||
        !safeCopper(material.preCopper) ||
        !safeCopper(material.targetCopper) ||
        material.observedCopper !== material.targetCopper ||
        material.phase !== "acquisition-currency" ||
        material.operation !== "currency-convergence" ||
        material.boundary !== "after" ||
        material.ordinal !== 1 ||
        !validTimestamp(material.verifiedAt)) {
        throw new TypeError("Acquisition currency convergence evidence is malformed.");
    }
}
function fingerprint(material) {
    const text = canonicalJson(material);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `wf-currency-convergence-fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function canonicalJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("Currency convergence evidence cannot contain non-finite numbers.");
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (isRecord(value)) {
        if (Object.values(value).some((entry) => entry === undefined)) {
            throw new TypeError("Currency convergence evidence cannot contain undefined values.");
        }
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`;
    }
    throw new TypeError("Currency convergence evidence contains unsupported data.");
}
function safeCopper(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function validTimestamp(value) {
    return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=acquisition-currency-convergence.js.map