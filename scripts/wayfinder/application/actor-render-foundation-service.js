import { MODULE_ID } from "../../constants.js";
export const ACTOR_RENDER_FOUNDATION_SCHEMA = "wayfinder-actor-render-foundation-v1";
export class ActorRenderFoundationCache {
    #entries = new WeakMap();
    resolve(actor, key, build) {
        const current = this.#entries.get(actor);
        if (current?.key === key) {
            if (current.value !== null)
                return Promise.resolve(current.value);
            if (current.pending !== null)
                return current.pending;
        }
        const revision = (current?.revision ?? 0) + 1;
        const pending = Promise.resolve()
            .then(build)
            .then((value) => {
            const latest = this.#entries.get(actor);
            if (latest?.key === key && latest.revision === revision && latest.pending === pending) {
                this.#entries.set(actor, { key, revision, pending: null, value });
            }
            return value;
        }, (error) => {
            const latest = this.#entries.get(actor);
            if (latest?.key === key && latest.revision === revision && latest.pending === pending) {
                this.#entries.delete(actor);
            }
            throw error;
        });
        this.#entries.set(actor, { key, revision, pending, value: null });
        return pending;
    }
    invalidate(actor) {
        this.#entries.delete(actor);
    }
}
export const actorRenderFoundationCache = new ActorRenderFoundationCache();
let buildSourceGeneration = 0;
let sourceHooksRegistered = false;
let onBuildSourceChange = null;
export function registerActorRenderFoundationSourceInvalidation(onChange) {
    onBuildSourceChange = onChange;
    registerBuildSourceHooks();
}
export function getActorRenderFoundationSourceGeneration() {
    registerBuildSourceHooks();
    return buildSourceGeneration;
}
export function noteActorRenderFoundationSourceChange(document) {
    if (!isRecord(document) || !nonEmpty(document.pack)) {
        return false;
    }
    buildSourceGeneration += 1;
    return true;
}
export function handleActorRenderFoundationSourceChange(document) {
    const changed = noteActorRenderFoundationSourceChange(document);
    if (changed)
        onBuildSourceChange?.();
    return changed;
}
export function buildActorRenderFoundationKey(input) {
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
export function buildActorRenderFoundationLanguageSettings(languageConfiguration, unavailableCampaignLanguages) {
    const unavailable = unavailableCampaignLanguages instanceof Set
        ? [...unavailableCampaignLanguages]
        : Array.isArray(unavailableCampaignLanguages)
            ? unavailableCampaignLanguages
            : [];
    return {
        languageConfiguration: isRecord(languageConfiguration) ? { ...languageConfiguration } : null,
        unavailableCampaignLanguages: Array.from(new Set(unavailable.filter((entry) => typeof entry === "string"))).sort(),
    };
}
function registerBuildSourceHooks() {
    if (sourceHooksRegistered)
        return;
    const hooks = globalThis
        .Hooks;
    if (typeof hooks?.on !== "function")
        return;
    const note = (document) => {
        handleActorRenderFoundationSourceChange(document);
    };
    hooks.on("createItem", note);
    hooks.on("updateItem", note);
    hooks.on("deleteItem", note);
    sourceHooksRegistered = true;
}
function actorBuildMaterial(actor, snapshot) {
    const candidate = actor;
    return {
        snapshot,
        system: candidate._source?.system ?? candidate.system ?? null,
        flags: buildRelevantActorFlags(candidate._source?.flags ?? candidate.flags),
        items: actorItemSources(candidate.items),
    };
}
function buildRelevantActorFlags(value) {
    if (!isRecord(value))
        return value ?? null;
    const flags = { ...value };
    const wayfinder = flags[MODULE_ID];
    if (isRecord(wayfinder)) {
        const moduleFlags = { ...wayfinder };
        delete moduleFlags.draft;
        flags[MODULE_ID] = moduleFlags;
    }
    return flags;
}
function actorItemSources(value) {
    const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.contents) ? value.contents : [];
    return items
        .map((item) => {
        if (!isRecord(item))
            return item;
        return item._source ?? item;
    })
        .sort((left, right) => stableJson(itemIdentity(left)).localeCompare(stableJson(itemIdentity(right))));
}
function itemIdentity(value) {
    if (!isRecord(value))
        return value;
    return { id: value._id ?? value.id ?? null, type: value.type ?? null, name: value.name ?? null };
}
function buildRelevantDraft(draft) {
    const { acquisition: _acquisition, acquisitionCorrupt: _acquisitionCorrupt, equipmentPolicyRequests: _equipmentPolicyRequests, applyAttemptStepIds: _applyAttemptStepIds, applyCompletedStepIds: _applyCompletedStepIds, applyRecoveryActorUpdate: _applyRecoveryActorUpdate, applySpellRarityAttestations: _applySpellRarityAttestations, updatedAt: _updatedAt, ...buildDraft } = draft;
    return buildDraft;
}
function stableJson(value) {
    return JSON.stringify(stableValue(value, new WeakSet()));
}
function stableValue(value, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol")
        return null;
    if (Array.isArray(value))
        return value.map((entry) => stableValue(entry, ancestors));
    if (!isRecord(value))
        return String(value);
    if (ancestors.has(value))
        return "[Circular]";
    ancestors.add(value);
    const normalized = Object.fromEntries(Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key], ancestors)]));
    ancestors.delete(value);
    return normalized;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
//# sourceMappingURL=actor-render-foundation-service.js.map