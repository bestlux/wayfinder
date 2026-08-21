import type { EffectiveBuildState } from "../../build-state.js";
import { MODULE_ID } from "../../constants.js";
import type { ActorSnapshot, DraftState, ProgressionPlan } from "../../types.js";
import type { WayfinderStepEvaluation } from "../domain/step-evaluation.js";

export const ACTOR_RENDER_FOUNDATION_SCHEMA = "wayfinder-actor-render-foundation-v1";

export interface ActorRenderFoundation {
  readonly plan: ProgressionPlan;
  readonly effectiveBuildState: EffectiveBuildState;
  readonly nonEquipmentEvaluations: ReadonlyMap<string, WayfinderStepEvaluation>;
}

export interface ActorRenderFoundationKeyInput {
  readonly actor: object;
  readonly snapshot: ActorSnapshot;
  readonly draft: DraftState;
  readonly recentlyInvalidatedStepIds: ReadonlySet<string>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly sourceGeneration: number;
  readonly planSchema?: string;
}

export interface ActorRenderFoundationLanguageSettings {
  readonly languageConfiguration: Readonly<Record<string, unknown>> | null;
  readonly unavailableCampaignLanguages: readonly string[];
}

interface CacheEntry<Value> {
  readonly key: string;
  readonly revision: number;
  readonly pending: Promise<Value> | null;
  readonly value: Value | null;
}

export class ActorRenderFoundationCache<Value> {
  readonly #entries = new WeakMap<object, CacheEntry<Value>>();

  resolve(actor: object, key: string, build: () => Promise<Value>): Promise<Value> {
    const current = this.#entries.get(actor);
    if (current?.key === key) {
      if (current.value !== null) return Promise.resolve(current.value);
      if (current.pending !== null) return current.pending;
    }

    const revision = (current?.revision ?? 0) + 1;
    const pending: Promise<Value> = Promise.resolve()
      .then(build)
      .then(
        (value) => {
          const latest = this.#entries.get(actor);
          if (latest?.key === key && latest.revision === revision && latest.pending === pending) {
            this.#entries.set(actor, { key, revision, pending: null, value });
          }
          return value;
        },
        (error: unknown) => {
          const latest = this.#entries.get(actor);
          if (latest?.key === key && latest.revision === revision && latest.pending === pending) {
            this.#entries.delete(actor);
          }
          throw error;
        }
      );
    this.#entries.set(actor, { key, revision, pending, value: null });
    return pending;
  }

  invalidate(actor: object): void {
    this.#entries.delete(actor);
  }
}

export const actorRenderFoundationCache = new ActorRenderFoundationCache<ActorRenderFoundation>();

let buildSourceGeneration = 0;
let sourceHooksRegistered = false;
let onBuildSourceChange: (() => void) | null = null;

export function registerActorRenderFoundationSourceInvalidation(onChange: () => void): void {
  onBuildSourceChange = onChange;
  registerBuildSourceHooks();
}

export function getActorRenderFoundationSourceGeneration(): number {
  registerBuildSourceHooks();
  return buildSourceGeneration;
}

export function noteActorRenderFoundationSourceChange(document: unknown): boolean {
  if (!isRecord(document) || !nonEmpty(document.pack)) {
    return false;
  }
  buildSourceGeneration += 1;
  return true;
}

export function handleActorRenderFoundationSourceChange(document: unknown): boolean {
  const changed = noteActorRenderFoundationSourceChange(document);
  if (changed) onBuildSourceChange?.();
  return changed;
}

export function buildActorRenderFoundationKey(input: ActorRenderFoundationKeyInput): string {
  return stableJson({
    schema: input.planSchema ?? ACTOR_RENDER_FOUNDATION_SCHEMA,
    targetLevel: input.draft.targetLevel,
    actor: actorBuildMaterial(input.actor, input.snapshot),
    draft: buildRelevantDraft(input.draft),
    invalidatedStepIds: [...input.recentlyInvalidatedStepIds].sort(),
    settings: input.settings,
    sourceGeneration: input.sourceGeneration,
  });
}

export function buildActorRenderFoundationLanguageSettings(
  languageConfiguration: unknown,
  unavailableCampaignLanguages: unknown
): ActorRenderFoundationLanguageSettings {
  const unavailable =
    unavailableCampaignLanguages instanceof Set
      ? [...unavailableCampaignLanguages]
      : Array.isArray(unavailableCampaignLanguages)
        ? unavailableCampaignLanguages
        : [];
  return {
    languageConfiguration: isRecord(languageConfiguration) ? { ...languageConfiguration } : null,
    unavailableCampaignLanguages: Array.from(
      new Set(unavailable.filter((entry): entry is string => typeof entry === "string"))
    ).sort(),
  };
}

function registerBuildSourceHooks(): void {
  if (sourceHooksRegistered) return;
  const hooks = (globalThis as { Hooks?: { on?: (event: string, callback: (document: unknown) => void) => void } })
    .Hooks;
  if (typeof hooks?.on !== "function") return;
  const note = (document: unknown): void => {
    handleActorRenderFoundationSourceChange(document);
  };
  hooks.on("createItem", note);
  hooks.on("updateItem", note);
  hooks.on("deleteItem", note);
  sourceHooksRegistered = true;
}

function actorBuildMaterial(actor: object, snapshot: ActorSnapshot): unknown {
  const candidate = actor as {
    _source?: { system?: unknown; flags?: unknown };
    system?: unknown;
    flags?: unknown;
    items?: unknown;
  };
  return {
    snapshot,
    system: candidate._source?.system ?? candidate.system ?? null,
    flags: buildRelevantActorFlags(candidate._source?.flags ?? candidate.flags),
    items: actorItemSources(candidate.items),
  };
}

function buildRelevantActorFlags(value: unknown): unknown {
  if (!isRecord(value)) return value ?? null;
  const flags = { ...value };
  const wayfinder = flags[MODULE_ID];
  if (isRecord(wayfinder)) {
    const moduleFlags = { ...wayfinder };
    delete moduleFlags.draft;
    flags[MODULE_ID] = moduleFlags;
  }
  return flags;
}

function actorItemSources(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.contents) ? value.contents : [];
  return items
    .map((item) => {
      if (!isRecord(item)) return item;
      return item._source ?? item;
    })
    .sort((left, right) => stableJson(itemIdentity(left)).localeCompare(stableJson(itemIdentity(right))));
}

function itemIdentity(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { id: value._id ?? value.id ?? null, type: value.type ?? null, name: value.name ?? null };
}

function buildRelevantDraft(draft: DraftState): unknown {
  const {
    acquisition: _acquisition,
    acquisitionCorrupt: _acquisitionCorrupt,
    equipmentPolicyRequests: _equipmentPolicyRequests,
    applyAttemptStepIds: _applyAttemptStepIds,
    applyCompletedStepIds: _applyCompletedStepIds,
    applyRecoveryActorUpdate: _applyRecoveryActorUpdate,
    applySpellRarityAttestations: _applySpellRarityAttestations,
    updatedAt: _updatedAt,
    ...buildDraft
  } = draft;
  return buildDraft;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value, new WeakSet<object>()));
}

function stableValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, ancestors));
  if (!isRecord(value)) return String(value);
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const normalized = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key], ancestors)])
  );
  ancestors.delete(value);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
