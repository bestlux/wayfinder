import type { AcquisitionStackingIntent } from "./acquisition-types.js";
import {
  type ClassGrantReconciliationResultV1,
  isClassGrantReconciliationConsistentForPlan,
  type PreparedClassGrantPlanV1,
} from "./class-grant-reconciliation.js";
import type { EquipmentHigherLevelStartEvidence } from "./equipment-policy.js";

export interface AcquisitionIdentityV1 {
  readonly draftId: string;
  readonly batchId: string;
  readonly lineId: string;
  readonly entryId: string;
  readonly plannedGrantId: string | null;
  readonly stackingIntent: AcquisitionStackingIntent;
}

export interface EconomicPhysicalItemV1 {
  readonly itemId: string;
  readonly type: string;
  readonly sourceUuid: string | null;
  readonly quantity: number;
  readonly containerId: string | null;
  readonly acquisitionIdentity: AcquisitionIdentityV1 | null;
}

export interface EconomicBaselineV1 {
  readonly version: 1;
  readonly actorId: string;
  readonly capturedAt: string;
  readonly currencyCopper: number;
  readonly physicalItems: readonly EconomicPhysicalItemV1[];
  readonly fingerprint: string;
}

export interface EconomicRetryExpectation {
  readonly draftId: string;
  readonly batchId: string;
  readonly expectedCurrencyCopper: number;
  readonly expectedEntries: readonly {
    readonly entryId: string;
    readonly lineId: string;
    readonly sourceUuid: string;
    readonly quantity: number;
    readonly containerId: string | null;
    readonly stackingIntent: AcquisitionStackingIntent;
  }[];
}

export interface EconomicHistoryFacts {
  readonly previousCharacterAppliedAt: string | null;
  readonly previousTargetLevel: number | null;
  readonly completedAcquisitionManifestId: string | null;
}

export type EconomicHandoffReason =
  | { readonly code: "foreign-physical-items"; readonly itemIds: readonly string[] }
  | { readonly code: "nonzero-currency"; readonly copper: number }
  | { readonly code: "unresolved-class-grant"; readonly grantIds: readonly string[] }
  | { readonly code: "ambiguous-class-grant"; readonly grantIds: readonly string[] };

export interface EconomicHandoffV1 {
  readonly version: 1;
  readonly kind: "pf2e-sheet";
  readonly baselineFingerprint: string;
  readonly reasons: readonly EconomicHandoffReason[];
}

export type EconomicAdmissionResult =
  | { readonly kind: "eligible-empty"; readonly baseline: EconomicBaselineV1 }
  | {
      readonly kind: "eligible-retry";
      readonly baseline: EconomicBaselineV1;
      readonly entryIds: readonly string[];
    }
  | { readonly kind: "handoff"; readonly baseline: EconomicBaselineV1; readonly handoff: EconomicHandoffV1 }
  | {
      readonly kind: "blocked";
      readonly baseline: EconomicBaselineV1;
      readonly code:
        | "completed-acquisition"
        | "prior-character-outcome"
        | "higher-level-start-context-missing"
        | "higher-level-start-context-mismatch"
        | "retry-identity-mismatch";
      readonly message: string;
    };

export interface EconomicBaselineDifference {
  readonly code: "actor" | "currency" | "physical-items";
  readonly message: string;
}

export function createEconomicBaseline(args: {
  actorId: string;
  capturedAt: string;
  currencyCopper: number;
  physicalItems: readonly EconomicPhysicalItemV1[];
}): EconomicBaselineV1 {
  if (!nonEmpty(args.actorId) || !validTimestamp(args.capturedAt) || !validCopper(args.currencyCopper)) {
    throw new TypeError("The economic baseline subject, timestamp, or currency is invalid.");
  }
  const physicalItems = args.physicalItems.map(normalizeEconomicPhysicalItem);
  if (physicalItems.some((item) => !item)) {
    throw new TypeError("The economic baseline contains an invalid physical item.");
  }
  const normalizedItems = physicalItems as EconomicPhysicalItemV1[];
  normalizedItems.sort((left, right) => left.itemId.localeCompare(right.itemId));
  if (new Set(normalizedItems.map((item) => item.itemId)).size !== normalizedItems.length) {
    throw new TypeError("The economic baseline contains duplicate physical item IDs.");
  }
  const material = {
    version: 1 as const,
    actorId: args.actorId,
    currencyCopper: args.currencyCopper,
    physicalItems: normalizedItems,
  };
  return {
    ...material,
    capturedAt: args.capturedAt,
    fingerprint: economicBaselineFingerprint(material),
  };
}

export function normalizeEconomicBaseline(raw: unknown): EconomicBaselineV1 | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.physicalItems)) return null;
  try {
    const normalized = createEconomicBaseline({
      actorId: typeof raw.actorId === "string" ? raw.actorId : "",
      capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : "",
      currencyCopper: typeof raw.currencyCopper === "number" ? raw.currencyCopper : Number.NaN,
      physicalItems: raw.physicalItems as EconomicPhysicalItemV1[],
    });
    return typeof raw.fingerprint === "string" && raw.fingerprint === normalized.fingerprint ? normalized : null;
  } catch {
    return null;
  }
}

export function normalizeEconomicHandoff(raw: unknown): EconomicHandoffV1 | null {
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    raw.kind !== "pf2e-sheet" ||
    !nonEmpty(raw.baselineFingerprint) ||
    !Array.isArray(raw.reasons)
  ) {
    return null;
  }
  const reasons = raw.reasons.map(normalizeHandoffReason);
  if (reasons.length === 0 || reasons.some((reason) => !reason)) return null;
  return {
    version: 1,
    kind: "pf2e-sheet",
    baselineFingerprint: raw.baselineFingerprint,
    reasons: reasons as EconomicHandoffReason[],
  };
}

export function evaluateEconomicAdmission(args: {
  baseline: EconomicBaselineV1;
  draftId: string;
  batchId: string;
  targetLevel: number;
  higherLevelStartEvidence: EquipmentHigherLevelStartEvidence;
  history: EconomicHistoryFacts;
  retryExpectation?: EconomicRetryExpectation | null;
  classGrantReconciliation: ClassGrantReconciliationResultV1;
  preparedClassGrantPlan: PreparedClassGrantPlanV1;
}): EconomicAdmissionResult {
  const { baseline } = args;
  if (
    baseline.actorId.length === 0 ||
    !nonEmpty(args.draftId) ||
    !nonEmpty(args.batchId) ||
    !Number.isInteger(args.targetLevel) ||
    args.targetLevel < 1 ||
    args.targetLevel > 20
  ) {
    throw new TypeError("Economic admission requires a valid actor, acquisition identity, and target level.");
  }
  if (args.history.completedAcquisitionManifestId) {
    return blocked(
      baseline,
      "completed-acquisition",
      "This actor already has a completed starting-equipment manifest."
    );
  }
  if (args.history.previousCharacterAppliedAt) {
    return blocked(
      baseline,
      "prior-character-outcome",
      "This actor already has a completed Wayfinder character outcome and cannot receive starting wealth again."
    );
  }
  if (args.targetLevel > 1) {
    const startProblem = higherLevelStartProblem(
      args.higherLevelStartEvidence,
      baseline.actorId,
      args.draftId,
      args.targetLevel
    );
    if (startProblem) return blocked(baseline, startProblem.code, startProblem.message);
  }

  const reconciliation = args.classGrantReconciliation;
  if (
    !isClassGrantReconciliationConsistentForPlan(reconciliation, args.preparedClassGrantPlan) ||
    args.preparedClassGrantPlan.subject.actorId !== baseline.actorId ||
    args.preparedClassGrantPlan.subject.draftId !== args.draftId ||
    args.preparedClassGrantPlan.subject.batchId !== args.batchId ||
    args.preparedClassGrantPlan.subject.targetLevel !== args.targetLevel
  ) {
    throw new TypeError("The class-grant reconciliation belongs to another draft or batch.");
  }
  const unresolved = uniqueSorted(reconciliation.unresolvedGrantIds);
  const ambiguous = uniqueSorted(reconciliation.ambiguousGrantIds);
  const ignoredClassGrantItemIds = new Set(reconciliation.ignoredItemIds);
  const retry = args.retryExpectation ?? null;
  if (retry && (retry.draftId !== args.draftId || retry.batchId !== args.batchId)) {
    return blocked(baseline, "retry-identity-mismatch", "The retry expectation belongs to a different draft or batch.");
  }

  const retryEntries = new Map(retry?.expectedEntries.map((entry) => [entry.entryId, entry]) ?? []);
  if (retry && retryEntries.size !== retry.expectedEntries.length) {
    return blocked(baseline, "retry-identity-mismatch", "The retry expectation contains duplicate entry identities.");
  }
  const observedRetryEntries: string[] = [];
  const foreignItemIds: string[] = [];
  for (const item of baseline.physicalItems) {
    if (ignoredClassGrantItemIds.has(item.itemId)) continue;
    const identity = item.acquisitionIdentity;
    const expected = identity ? retryEntries.get(identity.entryId) : null;
    if (
      retry &&
      identity?.draftId === args.draftId &&
      identity.batchId === args.batchId &&
      expected?.lineId === identity.lineId &&
      expected.stackingIntent === identity.stackingIntent &&
      expected.sourceUuid === item.sourceUuid &&
      expected.quantity === item.quantity &&
      expected.containerId === item.containerId &&
      !observedRetryEntries.includes(identity.entryId)
    ) {
      observedRetryEntries.push(identity.entryId);
      continue;
    }
    foreignItemIds.push(item.itemId);
  }

  const handoffReasons: EconomicHandoffReason[] = [];
  if (foreignItemIds.length > 0) {
    handoffReasons.push({ code: "foreign-physical-items", itemIds: uniqueSorted(foreignItemIds) });
  }
  if (unresolved.length > 0) handoffReasons.push({ code: "unresolved-class-grant", grantIds: unresolved });
  if (ambiguous.length > 0) handoffReasons.push({ code: "ambiguous-class-grant", grantIds: ambiguous });
  const retryCurrencyMatches =
    !!retry && observedRetryEntries.length > 0 && baseline.currencyCopper === retry.expectedCurrencyCopper;
  if (baseline.currencyCopper !== 0 && !retryCurrencyMatches) {
    handoffReasons.push({ code: "nonzero-currency", copper: baseline.currencyCopper });
  }
  if (handoffReasons.length > 0) {
    return {
      kind: "handoff",
      baseline,
      handoff: { version: 1, kind: "pf2e-sheet", baselineFingerprint: baseline.fingerprint, reasons: handoffReasons },
    };
  }
  if (retry && observedRetryEntries.length > 0) {
    return { kind: "eligible-retry", baseline, entryIds: uniqueSorted(observedRetryEntries) };
  }
  return { kind: "eligible-empty", baseline };
}

export function compareEconomicBaselines(
  reviewed: EconomicBaselineV1,
  current: EconomicBaselineV1
): EconomicBaselineDifference[] {
  const differences: EconomicBaselineDifference[] = [];
  if (reviewed.actorId !== current.actorId) {
    differences.push({ code: "actor", message: "The reviewed economic baseline belongs to another actor." });
  }
  if (reviewed.currencyCopper !== current.currencyCopper) {
    differences.push({ code: "currency", message: "Actor currency changed after equipment review." });
  }
  if (canonicalJson(reviewed.physicalItems) !== canonicalJson(current.physicalItems)) {
    differences.push({ code: "physical-items", message: "Actor physical inventory changed after equipment review." });
  }
  return differences;
}

export async function executeWithEconomicBaselineRevalidation<T>(args: {
  reviewed: EconomicBaselineV1;
  captureCurrent: () => EconomicBaselineV1 | Promise<EconomicBaselineV1>;
  write: () => T | Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; differences: readonly EconomicBaselineDifference[] }> {
  const current = await args.captureCurrent();
  const differences = compareEconomicBaselines(args.reviewed, current);
  if (differences.length > 0) return { ok: false, differences };
  return { ok: true, value: await args.write() };
}

export function normalizeAcquisitionIdentity(raw: unknown): AcquisitionIdentityV1 | null {
  if (
    !isRecord(raw) ||
    !nonEmpty(raw.draftId) ||
    !nonEmpty(raw.batchId) ||
    !nonEmpty(raw.lineId) ||
    !nonEmpty(raw.entryId) ||
    (raw.plannedGrantId !== null && !nonEmpty(raw.plannedGrantId)) ||
    (raw.stackingIntent !== "aggregate" && raw.stackingIntent !== "separate")
  ) {
    return null;
  }
  const plannedGrantId = raw.plannedGrantId === null ? null : String(raw.plannedGrantId);
  return {
    draftId: raw.draftId,
    batchId: raw.batchId,
    lineId: raw.lineId,
    entryId: raw.entryId,
    plannedGrantId,
    stackingIntent: raw.stackingIntent,
  };
}

function normalizeEconomicPhysicalItem(raw: unknown): EconomicPhysicalItemV1 | null {
  if (
    !isRecord(raw) ||
    !nonEmpty(raw.itemId) ||
    !nonEmpty(raw.type) ||
    !Number.isInteger(raw.quantity) ||
    (raw.quantity as number) < 0 ||
    (raw.sourceUuid !== null && typeof raw.sourceUuid !== "string") ||
    (raw.containerId !== null && typeof raw.containerId !== "string")
  ) {
    return null;
  }
  const acquisitionIdentity =
    raw.acquisitionIdentity === null ? null : normalizeAcquisitionIdentity(raw.acquisitionIdentity);
  if (raw.acquisitionIdentity !== null && !acquisitionIdentity) return null;
  return {
    itemId: raw.itemId,
    type: raw.type,
    sourceUuid: raw.sourceUuid as string | null,
    quantity: raw.quantity as number,
    containerId: raw.containerId as string | null,
    acquisitionIdentity,
  };
}

function normalizeHandoffReason(raw: unknown): EconomicHandoffReason | null {
  if (!isRecord(raw)) return null;
  if (raw.code === "nonzero-currency") {
    return validCopper(raw.copper as number) && (raw.copper as number) > 0
      ? { code: raw.code, copper: raw.copper as number }
      : null;
  }
  if (
    raw.code !== "foreign-physical-items" &&
    raw.code !== "unresolved-class-grant" &&
    raw.code !== "ambiguous-class-grant"
  ) {
    return null;
  }
  const field = raw.code === "foreign-physical-items" ? "itemIds" : "grantIds";
  const values = raw[field];
  if (!Array.isArray(values) || values.some((value) => !nonEmpty(value))) return null;
  const normalized = uniqueSorted(values as string[]);
  return normalized.length > 0
    ? raw.code === "foreign-physical-items"
      ? { code: raw.code, itemIds: normalized }
      : { code: raw.code, grantIds: normalized }
    : null;
}

function higherLevelStartProblem(
  evidence: EquipmentHigherLevelStartEvidence,
  actorId: string,
  draftId: string,
  targetLevel: number
): {
  code: "higher-level-start-context-missing" | "higher-level-start-context-mismatch";
  message: string;
} | null {
  if (evidence.kind === "not-required") {
    return {
      code: "higher-level-start-context-missing",
      message: "A higher-level new or replacement character requires a persisted start-context claim.",
    };
  }
  const subject = evidence.kind === "gm-confirmation" ? evidence.judgment : evidence;
  if (subject.actorId !== actorId || subject.draftId !== draftId || subject.targetLevel !== targetLevel) {
    return {
      code: "higher-level-start-context-mismatch",
      message: "The higher-level start-context claim does not match this actor, draft, and target level.",
    };
  }
  const startKind = evidence.startKind;
  if (startKind !== "new-campaign" && startKind !== "replacement-character") {
    return {
      code: "higher-level-start-context-mismatch",
      message: "The higher-level start-context claim has an invalid purpose.",
    };
  }
  return null;
}

function blocked(
  baseline: EconomicBaselineV1,
  code: Extract<EconomicAdmissionResult, { kind: "blocked" }>["code"],
  message: string
): Extract<EconomicAdmissionResult, { kind: "blocked" }> {
  return { kind: "blocked", baseline, code, message };
}

function economicBaselineFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `economic-baseline-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(nonEmpty))].sort((left, right) => left.localeCompare(right));
}

function validCopper(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: string): boolean {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
