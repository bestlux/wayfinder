import { cloneData } from "../../shared/cloning.js";
const DEFAULT_DEBOUNCE_MS = 300;
export class DraftPersistenceCoordinator {
    #saveDraft;
    #debounceMs;
    #onStateChange;
    #state = createSaveState("idle", 0, 0, null);
    #pending = null;
    #latestSnapshot = null;
    #timer = null;
    #drainPromise = null;
    #generation = 0;
    #accepting = true;
    #disposed = false;
    #lastFingerprint = null;
    constructor(options) {
        this.#saveDraft = options.saveDraft;
        this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.#onStateChange = options.onStateChange;
    }
    get state() {
        return { ...this.#state };
    }
    initialize(draft) {
        if (this.#latestSnapshot || this.#state.revision > 0) {
            return;
        }
        const snapshot = cloneData(draft);
        const fingerprint = draftFingerprint(snapshot);
        this.#lastFingerprint = fingerprint;
        this.#latestSnapshot = {
            revision: 0,
            generation: this.#generation,
            fingerprint,
            draft: snapshot,
        };
    }
    schedule(draft) {
        this.#assertUsable();
        if (!this.#accepting) {
            throw new Error("Wayfinder draft persistence is paused.");
        }
        const snapshot = cloneData(draft);
        const fingerprint = draftFingerprint(snapshot);
        if (fingerprint === this.#lastFingerprint) {
            return this.#state.revision;
        }
        const revision = this.#state.revision + 1;
        const pending = {
            revision,
            generation: this.#generation,
            fingerprint,
            draft: snapshot,
        };
        this.#pending = pending;
        this.#latestSnapshot = pending;
        this.#lastFingerprint = fingerprint;
        this.#setState(createSaveState("saving", revision, this.#state.durableRevision, null));
        this.#armTimer();
        return revision;
    }
    async flush() {
        this.#assertUsable();
        this.#clearTimer();
        await this.#ensureDrain();
    }
    async retry() {
        this.#assertUsable();
        if (!this.#pending) {
            return;
        }
        this.#setState(createSaveState("saving", this.#state.revision, this.#state.durableRevision, null));
        await this.flush();
    }
    async pauseAndFlush() {
        this.#assertUsable();
        this.#accepting = false;
        await this.flush();
    }
    resume() {
        this.#assertUsable();
        this.#accepting = true;
    }
    async discardAndRun(operation) {
        this.#assertUsable();
        const recoverable = this.#latestSnapshot ? clonePending(this.#latestSnapshot) : null;
        this.#accepting = false;
        this.#invalidatePending();
        const drain = this.#drainPromise;
        if (drain !== null) {
            await drain.catch(() => undefined);
        }
        try {
            await operation();
        }
        catch (error) {
            this.#accepting = true;
            if (recoverable) {
                const restored = {
                    ...recoverable,
                    generation: this.#generation,
                    revision: this.#state.revision + 1,
                };
                this.#pending = restored;
                this.#latestSnapshot = restored;
                this.#lastFingerprint = restored.fingerprint;
                this.#setState(createSaveState("error", restored.revision, this.#state.durableRevision, errorMessage(error)));
            }
            throw error;
        }
    }
    reset(draft) {
        this.#assertUsable();
        this.#invalidatePending();
        const snapshot = cloneData(draft);
        const fingerprint = draftFingerprint(snapshot);
        this.#latestSnapshot = {
            revision: 0,
            generation: this.#generation,
            fingerprint,
            draft: snapshot,
        };
        this.#lastFingerprint = fingerprint;
        this.#accepting = true;
        this.#setState(createSaveState("idle", 0, 0, null));
    }
    completeTerminalOperation() {
        this.#assertUsable();
        this.#accepting = false;
        this.#invalidatePending();
        this.#latestSnapshot = null;
        this.#lastFingerprint = null;
        this.#setState(createSaveState("idle", 0, 0, null));
    }
    dispose() {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        this.#accepting = false;
        this.#invalidatePending();
        this.#latestSnapshot = null;
    }
    #armTimer() {
        this.#clearTimer();
        const generation = this.#generation;
        this.#timer = setTimeout(() => {
            this.#timer = null;
            if (generation !== this.#generation || this.#disposed) {
                return;
            }
            void this.#ensureDrain().catch(() => undefined);
        }, this.#debounceMs);
    }
    #clearTimer() {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
    async #ensureDrain() {
        if (this.#drainPromise !== null) {
            return this.#drainPromise;
        }
        if (!this.#pending) {
            return;
        }
        const generation = this.#generation;
        const drain = this.#drain(generation);
        this.#drainPromise = drain;
        try {
            await drain;
        }
        finally {
            if (this.#drainPromise === drain) {
                this.#drainPromise = null;
            }
        }
    }
    async #drain(generation) {
        while (generation === this.#generation && !this.#disposed) {
            const pending = this.#pending;
            if (!pending || pending.generation !== generation) {
                return;
            }
            this.#pending = null;
            this.#clearTimer();
            this.#setState(createSaveState("saving", this.#state.revision, this.#state.durableRevision, null));
            try {
                await this.#saveDraft(cloneData(pending.draft));
            }
            catch (error) {
                if (generation === this.#generation && !this.#disposed) {
                    const newerPending = this.#pending;
                    if (!newerPending || newerPending.revision < pending.revision) {
                        this.#pending = pending;
                    }
                    this.#setState(createSaveState("error", this.#state.revision, this.#state.durableRevision, errorMessage(error)));
                }
                throw error;
            }
            if (generation !== this.#generation || this.#disposed) {
                return;
            }
            const durableRevision = Math.max(this.#state.durableRevision, pending.revision);
            const phase = this.#pending ? "saving" : "saved";
            this.#setState(createSaveState(phase, this.#state.revision, durableRevision, null));
        }
    }
    #invalidatePending() {
        this.#generation += 1;
        this.#clearTimer();
        this.#pending = null;
    }
    #setState(state) {
        if (state.phase === this.#state.phase &&
            state.revision === this.#state.revision &&
            state.durableRevision === this.#state.durableRevision &&
            state.message === this.#state.message) {
            return;
        }
        this.#state = state;
        this.#onStateChange?.({ ...state });
    }
    #assertUsable() {
        if (this.#disposed) {
            throw new Error("Wayfinder draft persistence is disposed.");
        }
    }
}
function createSaveState(phase, revision, durableRevision, message) {
    return {
        phase,
        revision,
        durableRevision,
        retryable: phase === "error",
        message,
    };
}
function clonePending(pending) {
    return {
        ...pending,
        draft: cloneData(pending.draft),
    };
}
function draftFingerprint(draft) {
    return JSON.stringify(draft);
}
function errorMessage(error) {
    return error instanceof Error && error.message ? error.message : "Wayfinder could not save this draft.";
}
//# sourceMappingURL=draft-persistence-service.js.map