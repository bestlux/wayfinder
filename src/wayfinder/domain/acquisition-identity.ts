import { acquisitionPreAggregationMaterial, aggregateRequestedQuantity } from "./acquisition-aggregation.js";
import { normalizeAcquisitionDraft } from "./acquisition-draft.js";
import {
  createAcquisitionPriceSnapshot,
  evaluateAcquisitionCompletion,
  evaluateAcquisitionLedger,
} from "./acquisition-ledger.js";
import type {
  AcquisitionDisposition,
  AcquisitionDraftState,
  AcquisitionFunding,
  AcquisitionLedgerResult,
  AcquisitionLinePolicyDecision,
  AcquisitionMaterialFacts,
  AcquisitionPriceSnapshot,
  AcquisitionStackingIntent,
} from "./acquisition-types.js";
import { assertPreparedClassGrantPlanMatches, type PreparedClassGrantPlanV1 } from "./class-grant-reconciliation.js";

export interface AcquisitionIdentitySeedV1 {
  readonly draftId: string;
  readonly batchId: string;
  readonly manifestId: string;
}

export interface PlannedAcquisitionItemV1 {
  readonly plannedItemId: string;
  readonly ownedContainerId: string | null;
  readonly sourceUuid: string;
  readonly quantity: number;
  readonly plannedContainerId: string | null;
}

export interface PreparedAcquisitionEntryV1 {
  readonly entryId: string;
  readonly preAggregationKey: string;
  readonly lineIds: readonly string[];
  readonly sourceUuid: string;
  readonly documentFingerprint: string;
  readonly priceFingerprint: string;
  readonly quantity: number;
  readonly stackingIntent: AcquisitionStackingIntent;
  readonly funding: AcquisitionFunding;
  readonly resolvedAllowanceId: string | null;
  readonly policyDecision: AcquisitionLinePolicyDecision;
  readonly price: AcquisitionPriceSnapshot;
  readonly plannedItems: readonly PlannedAcquisitionItemV1[];
}

export interface PreparedAcquisitionIdentityPlanV1 {
  readonly version: 1;
  readonly subject: {
    readonly actorId: string;
    readonly draftId: string;
    readonly batchId: string;
    readonly manifestId: string;
    readonly targetLevel: number;
  };
  readonly policyFingerprint: string;
  readonly disposition: AcquisitionDisposition;
  readonly materialFacts: AcquisitionMaterialFacts;
  readonly ledger: {
    readonly budgetCopper: number;
    readonly spentCopper: number;
    readonly remainingCopper: number;
    readonly unusedAllowanceIds: readonly string[];
  };
  readonly ledgerDigest: string;
  readonly entries: readonly PreparedAcquisitionEntryV1[];
  readonly fingerprint: string;
}

const preparedIdentityPlans = new WeakSet<object>();

export function mintAcquisitionIdentitySeed(randomUuid: () => string = defaultRandomUuid): AcquisitionIdentitySeedV1 {
  const suffixes = [randomUuid(), randomUuid(), randomUuid()];
  if (new Set(suffixes.map((value) => String(value).trim().toLowerCase())).size !== 3) {
    throw new Error("Acquisition identity generation returned duplicate identities.");
  }
  const draftId = prefixedOpaqueId("wf-draft", suffixes[0]!);
  const batchId = prefixedOpaqueId("wf-batch", suffixes[1]!);
  const manifestId = prefixedOpaqueId("wf-manifest", suffixes[2]!);
  return { draftId, batchId, manifestId };
}

export function mintAcquisitionLineId(randomUuid: () => string = defaultRandomUuid): string {
  return prefixedOpaqueId("wf-line", randomUuid());
}

export async function derivePlannedContainerId(args: {
  readonly batchId: string;
  readonly parentEntryId: string;
  readonly expansionPath: string;
}): Promise<string> {
  if (!nonEmpty(args.batchId) || !nonEmpty(args.parentEntryId) || !nonEmpty(args.expansionPath)) {
    throw new TypeError("Planned container identity requires a batch, parent entry, and expansion path.");
  }
  return digest("wf-planned-container", { version: 1, ...args });
}

export async function prepareAcquisitionIdentityPlan(args: {
  readonly actorId: string;
  readonly draft: AcquisitionDraftState;
  readonly ledger: AcquisitionLedgerResult;
  readonly classGrantPlan: PreparedClassGrantPlanV1;
}): Promise<PreparedAcquisitionIdentityPlanV1> {
  const actorId = args.actorId;
  const draft = normalizeAcquisitionDraft(structuredClone(args.draft));
  if (!draft) throw new TypeError("Acquisition identity preparation requires canonical draft state.");
  const classGrantPlan = args.classGrantPlan;
  const ledger = evaluateAcquisitionLedger(draft, classGrantPlan);
  if (!nonEmpty(actorId) || !ledger.valid || !ledger.materialFacts || !draft.policySnapshot || !draft.baseline) {
    throw new TypeError("Acquisition identity preparation requires a valid reviewed ledger and economic baseline.");
  }
  if (!evaluateAcquisitionCompletion(draft, ledger).complete) {
    throw new TypeError("Acquisition identity preparation requires a completed review disposition.");
  }
  assertPreparedClassGrantPlanMatches({
    plan: classGrantPlan,
    actorId,
    draftId: draft.draftId,
    batchId: draft.batchId,
    targetLevel: draft.targetLevel,
    persistedGrants: draft.plannedClassGrants,
  });
  if (
    draft.policySnapshot.material.subject.actorId !== actorId ||
    draft.policySnapshot.material.subject.draftId !== draft.draftId ||
    draft.policySnapshot.material.subject.targetLevel !== draft.targetLevel
  ) {
    throw new TypeError("The acquisition identity subject does not match the reviewed equipment policy.");
  }

  const ledgerLines = new Map(ledger.lines.map((line) => [line.lineId, line]));
  if (ledgerLines.size !== draft.lines.length || draft.lines.some((line) => !ledgerLines.has(line.lineId))) {
    throw new TypeError("The acquisition ledger does not cover every logical line exactly once.");
  }

  const grouped = new Map<string, AcquisitionDraftState["lines"][number][]>();
  for (const line of draft.lines) {
    const resolved = ledgerLines.get(line.lineId)!;
    const aggregationMaterial = acquisitionPreAggregationMaterial(line, resolved.resolvedAllowanceId);
    const key = await digest("wf-preagg", aggregationMaterial);
    const current = grouped.get(key) ?? [];
    current.push(line);
    grouped.set(key, current);
  }

  const entries: PreparedAcquisitionEntryV1[] = [];
  for (const [preAggregationKey, unsortedLines] of grouped) {
    const lines = [...unsortedLines].sort((left, right) => left.lineId.localeCompare(right.lineId));
    const first = lines[0]!;
    const firstLedger = ledgerLines.get(first.lineId)!;
    const quantity = lines.reduce((total, line) => safeAdd(total, line.price.materializedQuantity), 0);
    const requestedQuantity = aggregateRequestedQuantity(lines.map((line) => line.price));
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new RangeError("The prepared acquisition quantity is outside safe integer arithmetic.");
    }
    const lineIds = lines.map((line) => line.lineId);
    const entryId = await digest("wf-entry", {
      version: 1,
      batchId: draft.batchId,
      preAggregationKey,
      lineIds,
    });
    const plannedItemId = await digest("wf-planned-item", {
      version: 1,
      batchId: draft.batchId,
      entryId,
      expansionPath: "root",
    });
    entries.push({
      entryId,
      preAggregationKey,
      lineIds,
      sourceUuid: first.sourceUuid,
      documentFingerprint: first.documentFingerprint,
      priceFingerprint: first.priceFingerprint,
      quantity,
      stackingIntent: first.stackingIntent,
      funding: structuredClone(first.funding),
      resolvedAllowanceId: firstLedger.resolvedAllowanceId,
      policyDecision: structuredClone(first.policyDecision),
      price: combinedPrice(first.price, requestedQuantity, quantity),
      plannedItems: [
        {
          plannedItemId,
          ownedContainerId: null,
          sourceUuid: first.sourceUuid,
          quantity,
          plannedContainerId: null,
        },
      ],
    });
  }
  entries.sort((left, right) => left.entryId.localeCompare(right.entryId));

  const subject = {
    actorId,
    draftId: draft.draftId,
    batchId: draft.batchId,
    manifestId: draft.manifestId,
    targetLevel: draft.targetLevel,
  };
  const ledgerDigest = await digest("wf-ledger", {
    version: 1,
    materialFacts: ledger.materialFacts,
    budgetCopper: ledger.budgetCopper,
    spentCopper: ledger.spentCopper,
    remainingCopper: ledger.remainingCopper,
    lines: [...ledger.lines].sort((left, right) => left.lineId.localeCompare(right.lineId)),
    unusedAllowanceIds: [...ledger.unusedAllowanceIds].sort(),
    classGrants: classGrantPlan.grants,
  });
  const material = {
    version: 1 as const,
    subject,
    policyFingerprint: draft.policySnapshot.fingerprint,
    disposition: structuredClone(draft.disposition),
    materialFacts: structuredClone(ledger.materialFacts),
    ledger: {
      budgetCopper: ledger.budgetCopper,
      spentCopper: ledger.spentCopper,
      remainingCopper: ledger.remainingCopper,
      unusedAllowanceIds: [...ledger.unusedAllowanceIds].sort(),
    },
    ledgerDigest,
    entries,
  };
  const plan = deepFreezeData({
    ...material,
    subject: { ...subject },
    entries: entries.map(freezeEntry),
    fingerprint: await digest("wf-identity-plan", material),
  });
  preparedIdentityPlans.add(plan);
  return plan;
}

export function isPreparedAcquisitionIdentityPlan(value: unknown): value is PreparedAcquisitionIdentityPlanV1 {
  return isRecord(value) && preparedIdentityPlans.has(value);
}

export function assertPreparedAcquisitionIdentityPlanMatches(args: {
  readonly plan: PreparedAcquisitionIdentityPlanV1;
  readonly actorId: string;
  readonly draft: AcquisitionDraftState;
}): void {
  const { plan, actorId, draft } = args;
  if (!isPreparedAcquisitionIdentityPlan(plan)) {
    throw new TypeError("Acquisition identity authority must be freshly prepared.");
  }
  if (
    plan.subject.actorId !== actorId ||
    plan.subject.draftId !== draft.draftId ||
    plan.subject.batchId !== draft.batchId ||
    plan.subject.manifestId !== draft.manifestId ||
    plan.subject.targetLevel !== draft.targetLevel
  ) {
    throw new TypeError("The prepared acquisition identity belongs to another subject.");
  }
  if (canonicalJson(plan.disposition) !== canonicalJson(draft.disposition)) {
    throw new TypeError("The prepared acquisition identity no longer matches the reviewed disposition.");
  }
  const current = normalizeAcquisitionDraft(structuredClone(draft));
  if (!current) throw new TypeError("The current acquisition draft is malformed.");
  const resolvedAllowances = new Map<string, string>();
  for (const entry of plan.entries) {
    if (!entry.resolvedAllowanceId) continue;
    for (const lineId of entry.lineIds) resolvedAllowances.set(lineId, entry.resolvedAllowanceId);
  }
  const currentFacts = captureCurrentMaterialFacts(current, resolvedAllowances);
  if (!currentFacts || canonicalJson(currentFacts) !== canonicalJson(plan.materialFacts)) {
    throw new TypeError("The prepared acquisition identity no longer matches the current reviewed material.");
  }
}

function captureCurrentMaterialFacts(
  draft: AcquisitionDraftState,
  resolvedAllowances: ReadonlyMap<string, string>
): AcquisitionMaterialFacts | null {
  if (!draft.policySnapshot || !draft.baseline) return null;
  return {
    targetLevel: draft.targetLevel,
    recipe: structuredClone(draft.recipe),
    policyFingerprint: draft.policySnapshot.fingerprint,
    policyMaterial: structuredClone(draft.policySnapshot.material),
    baseline: structuredClone(draft.baseline),
    plannedClassGrants: structuredClone(draft.plannedClassGrants),
    lines: draft.lines
      .map((line) => ({
        lineId: line.lineId,
        sourceUuid: line.sourceUuid,
        documentFingerprint: line.documentFingerprint,
        priceFingerprint: line.priceFingerprint,
        itemLevel: line.itemLevel,
        requestedQuantity: line.price.requestedQuantity,
        stackingIntent: line.stackingIntent,
        permanence: line.permanence,
        componentKind: line.componentKind,
        policyDecision: structuredClone(line.policyDecision),
        funding: structuredClone(line.funding),
        resolvedAllowanceId: resolvedAllowances.get(line.lineId) ?? null,
      }))
      .sort((left, right) => left.lineId.localeCompare(right.lineId)),
  };
}

function combinedPrice(
  price: AcquisitionPriceSnapshot,
  requestedQuantity: number,
  materializedQuantity: number
): AcquisitionPriceSnapshot {
  const result = createAcquisitionPriceSnapshot({
    basePrice: structuredClone(price.basePrice),
    size: price.size,
    sizeSensitive: price.sizeSensitive,
    preciousMaterial: price.preciousMaterial,
    adjustedBulkPriceCopper: price.adjustedBulkPriceCopper,
    configurationPriceCopper: price.configurationPriceCopper,
    pricePer: price.pricePer,
    sourceQuantity: price.sourceQuantity,
    requestedQuantity,
  });
  if (!result.ok || result.value.materializedQuantity !== materializedQuantity) {
    throw new RangeError("Aggregated acquisition price cannot be represented safely.");
  }
  return result.value;
}

function freezeEntry(entry: PreparedAcquisitionEntryV1): PreparedAcquisitionEntryV1 {
  return Object.freeze({
    ...entry,
    lineIds: Object.freeze([...entry.lineIds]),
    funding: Object.freeze(structuredClone(entry.funding)),
    policyDecision: Object.freeze({ ...entry.policyDecision }),
    price: Object.freeze(structuredClone(entry.price)),
    plannedItems: Object.freeze(entry.plannedItems.map((item) => Object.freeze({ ...item }))),
  });
}

function deepFreezeData<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreezeData(child);
    Object.freeze(value);
  }
  return value;
}

async function digest(prefix: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-sha256-${hex}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical acquisition identity cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    if (Object.values(value).some((entry) => entry === undefined)) {
      throw new TypeError("Canonical acquisition identity cannot contain undefined values.");
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical acquisition identity contains an unsupported value.");
}

function prefixedOpaqueId(prefix: string, value: string): string {
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{7,}$/u.test(normalized)) {
    throw new TypeError("Acquisition identity generation returned an invalid opaque value.");
  }
  return `${prefix}-${normalized}`;
}

function defaultRandomUuid(): string {
  if (typeof crypto.randomUUID !== "function")
    throw new Error("Secure acquisition identity generation is unavailable.");
  return crypto.randomUUID();
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("Acquisition quantity exceeds safe integer arithmetic.");
  return result;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
