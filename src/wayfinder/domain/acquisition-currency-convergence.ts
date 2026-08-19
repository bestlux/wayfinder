export const ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION = 1 as const;

export interface AcquisitionCurrencyConvergenceWitnessV1 {
  readonly version: typeof ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION;
  readonly actorId: string;
  readonly draftId: string;
  readonly batchId: string;
  readonly manifestId: string;
  readonly ledgerDigest: string;
  readonly baselineFingerprint: string;
  readonly preCopper: number;
  readonly targetCopper: number;
  readonly observedCopper: number;
  readonly phase: "acquisition-currency";
  readonly operation: "currency-convergence";
  readonly boundary: "after";
  readonly ordinal: 1;
  readonly verifiedAt: string;
  readonly fingerprint: string;
}

type CurrencyConvergenceMaterial = Omit<AcquisitionCurrencyConvergenceWitnessV1, "fingerprint">;

export function createAcquisitionCurrencyConvergenceWitness(args: {
  readonly actorId: string;
  readonly draftId: string;
  readonly batchId: string;
  readonly manifestId: string;
  readonly ledgerDigest: string;
  readonly baselineFingerprint: string;
  readonly preCopper: number;
  readonly targetCopper: number;
  readonly observedCopper: number;
  readonly verifiedAt: string;
}): AcquisitionCurrencyConvergenceWitnessV1 {
  const material: CurrencyConvergenceMaterial = {
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

export function normalizeAcquisitionCurrencyConvergenceWitness(
  raw: unknown
): AcquisitionCurrencyConvergenceWitnessV1 | null {
  if (!isRecord(raw)) return null;
  const material: CurrencyConvergenceMaterial = {
    version: raw.version as 1,
    actorId: raw.actorId as string,
    draftId: raw.draftId as string,
    batchId: raw.batchId as string,
    manifestId: raw.manifestId as string,
    ledgerDigest: raw.ledgerDigest as string,
    baselineFingerprint: raw.baselineFingerprint as string,
    preCopper: raw.preCopper as number,
    targetCopper: raw.targetCopper as number,
    observedCopper: raw.observedCopper as number,
    phase: raw.phase as "acquisition-currency",
    operation: raw.operation as "currency-convergence",
    boundary: raw.boundary as "after",
    ordinal: raw.ordinal as 1,
    verifiedAt: raw.verifiedAt as string,
  };
  try {
    assertMaterial(material);
  } catch {
    return null;
  }
  if (raw.fingerprint !== fingerprint(material)) return null;
  return Object.freeze({ ...material, fingerprint: raw.fingerprint as string });
}

export function acquisitionCurrencyConvergenceWitnessMatches(
  witness: AcquisitionCurrencyConvergenceWitnessV1,
  expected: {
    readonly actorId: string;
    readonly draftId: string;
    readonly batchId: string;
    readonly manifestId: string;
    readonly ledgerDigest: string;
    readonly baselineFingerprint: string;
    readonly preCopper: number;
    readonly targetCopper: number;
  }
): boolean {
  return (
    witness.actorId === expected.actorId &&
    witness.draftId === expected.draftId &&
    witness.batchId === expected.batchId &&
    witness.manifestId === expected.manifestId &&
    witness.ledgerDigest === expected.ledgerDigest &&
    witness.baselineFingerprint === expected.baselineFingerprint &&
    witness.preCopper === expected.preCopper &&
    witness.targetCopper === expected.targetCopper &&
    witness.observedCopper === expected.targetCopper
  );
}

function assertMaterial(material: CurrencyConvergenceMaterial): void {
  if (
    material.version !== ACQUISITION_CURRENCY_CONVERGENCE_WITNESS_VERSION ||
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
    !validTimestamp(material.verifiedAt)
  ) {
    throw new TypeError("Acquisition currency convergence evidence is malformed.");
  }
}

function fingerprint(material: CurrencyConvergenceMaterial): string {
  const text = canonicalJson(material);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `wf-currency-convergence-fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Currency convergence evidence cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
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

function safeCopper(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
