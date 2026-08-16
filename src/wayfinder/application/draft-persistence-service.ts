import { cloneData } from "../../shared/cloning.js";
import type { DraftState } from "../../types.js";

export type DraftSavePhase = "idle" | "saving" | "saved" | "error";

export interface DraftSaveState {
  phase: DraftSavePhase;
  revision: number;
  durableRevision: number;
  retryable: boolean;
  message: string | null;
}

export interface DraftPersistenceCoordinatorOptions {
  saveDraft: (draft: DraftState) => Promise<void>;
  debounceMs?: number;
  onStateChange?: (state: DraftSaveState) => void;
}

interface PendingDraftSave {
  revision: number;
  generation: number;
  fingerprint: string;
  draft: DraftState;
}

const DEFAULT_DEBOUNCE_MS = 300;

export class DraftPersistenceCoordinator {
  readonly #saveDraft: (draft: DraftState) => Promise<void>;
  readonly #debounceMs: number;
  readonly #onStateChange: ((state: DraftSaveState) => void) | undefined;
  #state: DraftSaveState = createSaveState("idle", 0, 0, null);
  #pending: PendingDraftSave | null = null;
  #latestSnapshot: PendingDraftSave | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #drainPromise: Promise<void> | null = null;
  #generation = 0;
  #accepting = true;
  #disposed = false;
  #lastFingerprint: string | null = null;

  constructor(options: DraftPersistenceCoordinatorOptions) {
    this.#saveDraft = options.saveDraft;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#onStateChange = options.onStateChange;
  }

  get state(): DraftSaveState {
    return { ...this.#state };
  }

  initialize(draft: DraftState): void {
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

  schedule(draft: DraftState): number {
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
    const pending: PendingDraftSave = {
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

  async flush(): Promise<void> {
    this.#assertUsable();
    this.#clearTimer();
    await this.#ensureDrain();
  }

  async retry(): Promise<void> {
    this.#assertUsable();
    if (!this.#pending) {
      return;
    }

    this.#setState(createSaveState("saving", this.#state.revision, this.#state.durableRevision, null));
    await this.flush();
  }

  async pauseAndFlush(): Promise<void> {
    this.#assertUsable();
    this.#accepting = false;
    await this.flush();
  }

  resume(): void {
    this.#assertUsable();
    this.#accepting = true;
  }

  async discardAndRun(operation: () => Promise<void>): Promise<void> {
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
    } catch (error) {
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

  reset(draft: DraftState): void {
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

  completeTerminalOperation(): void {
    this.#assertUsable();
    this.#accepting = false;
    this.#invalidatePending();
    this.#latestSnapshot = null;
    this.#lastFingerprint = null;
    this.#setState(createSaveState("idle", 0, 0, null));
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#accepting = false;
    this.#invalidatePending();
    this.#latestSnapshot = null;
  }

  #armTimer(): void {
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

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #ensureDrain(): Promise<void> {
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
    } finally {
      if (this.#drainPromise === drain) {
        this.#drainPromise = null;
      }
    }
  }

  async #drain(generation: number): Promise<void> {
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
      } catch (error) {
        if (generation === this.#generation && !this.#disposed) {
          const newerPending = this.#pending as PendingDraftSave | null;
          if (!newerPending || newerPending.revision < pending.revision) {
            this.#pending = pending;
          }
          this.#setState(
            createSaveState("error", this.#state.revision, this.#state.durableRevision, errorMessage(error))
          );
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

  #invalidatePending(): void {
    this.#generation += 1;
    this.#clearTimer();
    this.#pending = null;
  }

  #setState(state: DraftSaveState): void {
    if (
      state.phase === this.#state.phase &&
      state.revision === this.#state.revision &&
      state.durableRevision === this.#state.durableRevision &&
      state.message === this.#state.message
    ) {
      return;
    }

    this.#state = state;
    this.#onStateChange?.({ ...state });
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("Wayfinder draft persistence is disposed.");
    }
  }
}

function createSaveState(
  phase: DraftSavePhase,
  revision: number,
  durableRevision: number,
  message: string | null
): DraftSaveState {
  return {
    phase,
    revision,
    durableRevision,
    retryable: phase === "error",
    message,
  };
}

function clonePending(pending: PendingDraftSave): PendingDraftSave {
  return {
    ...pending,
    draft: cloneData(pending.draft),
  };
}

function draftFingerprint(draft: DraftState): string {
  return JSON.stringify(draft);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Wayfinder could not save this draft.";
}
