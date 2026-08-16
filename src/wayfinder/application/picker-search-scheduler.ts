export interface PickerSearchRequest {
  readonly viewRevision: number;
  readonly sourceRevision: number;
  readonly stepId: string;
  readonly query: string;
}

interface PickerSearchSchedulerOptions {
  delayMs: number;
  render: (request: PickerSearchRequest) => Promise<void>;
  onError?: (error: unknown, request: PickerSearchRequest) => void;
}

export class PickerSearchScheduler {
  readonly #delayMs: number;
  readonly #render: PickerSearchSchedulerOptions["render"];
  readonly #onError: NonNullable<PickerSearchSchedulerOptions["onError"]>;
  #viewRevision = 0;
  #sourceRevision = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: PickerSearchRequest | null = null;
  #ready = false;
  #inFlight = false;
  #disposed = false;

  constructor(options: PickerSearchSchedulerOptions) {
    this.#delayMs = Math.max(0, options.delayMs);
    this.#render = options.render;
    this.#onError = options.onError ?? (() => undefined);
  }

  get sourceRevision(): number {
    return this.#sourceRevision;
  }

  get viewRevision(): number {
    return this.#viewRevision;
  }

  schedule(stepId: string, query: string): PickerSearchRequest | null {
    if (this.#disposed) {
      return null;
    }

    const request: PickerSearchRequest = {
      viewRevision: ++this.#viewRevision,
      sourceRevision: this.#sourceRevision,
      stepId,
      query,
    };
    this.#pending = request;
    this.#ready = false;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#ready = true;
      void this.#drain();
    }, this.#delayMs);
    return request;
  }

  invalidateView(): void {
    if (this.#disposed) {
      return;
    }
    this.#invalidatePending();
  }

  invalidateSource(): number {
    if (this.#disposed) {
      return this.#sourceRevision;
    }
    this.#sourceRevision += 1;
    this.#invalidatePending();
    return this.#sourceRevision;
  }

  isCurrent(request: PickerSearchRequest): boolean {
    return (
      !this.#disposed && request.viewRevision === this.#viewRevision && request.sourceRevision === this.#sourceRevision
    );
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#invalidatePending();
    this.#disposed = true;
  }

  #invalidatePending(): void {
    this.#viewRevision += 1;
    this.#pending = null;
    this.#ready = false;
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #drain(): Promise<void> {
    if (this.#disposed || this.#inFlight || !this.#ready || !this.#pending) {
      return;
    }

    const request = this.#pending;
    this.#pending = null;
    this.#ready = false;
    this.#inFlight = true;
    try {
      await this.#render(request);
    } catch (error) {
      if (this.isCurrent(request)) {
        this.#onError(error, request);
      }
    } finally {
      this.#inFlight = false;
      if (this.#ready && this.#pending) {
        void this.#drain();
      }
    }
  }
}
