export interface PickerSearchRequest {
  readonly viewRevision: number;
  readonly sourceRevision: number;
  readonly stepId: string;
  readonly query: string;
}

export interface PickerSearchRenderContext {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}

interface PickerSearchSchedulerOptions {
  delayMs: number;
  render: (request: PickerSearchRequest, context: PickerSearchRenderContext) => Promise<void>;
  onError?: (error: unknown, request: PickerSearchRequest) => void;
  /**
   * Start the latest settled request without waiting for obsolete work to finish.
   * The replaced render is aborted cooperatively through its context signal.
   */
  preemptInFlight?: boolean;
}

export class PickerSearchScheduler {
  readonly #delayMs: number;
  readonly #render: PickerSearchSchedulerOptions["render"];
  readonly #onError: NonNullable<PickerSearchSchedulerOptions["onError"]>;
  readonly #preemptInFlight: boolean;
  #viewRevision = 0;
  #sourceRevision = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: PickerSearchRequest | null = null;
  #ready = false;
  #inFlight = new Map<number, AbortController>();
  #disposed = false;

  constructor(options: PickerSearchSchedulerOptions) {
    this.#delayMs = Math.max(0, options.delayMs);
    this.#render = options.render;
    this.#onError = options.onError ?? (() => undefined);
    this.#preemptInFlight = options.preemptInFlight === true;
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
    if (this.#preemptInFlight) this.#abortInFlight();
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
    this.#abortInFlight();
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #drain(): Promise<void> {
    if (this.#disposed || (!this.#preemptInFlight && this.#inFlight.size > 0) || !this.#ready || !this.#pending) {
      return;
    }

    const request = this.#pending;
    this.#pending = null;
    this.#ready = false;
    const controller = new AbortController();
    this.#inFlight.set(request.viewRevision, controller);
    try {
      await this.#render(request, {
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted && this.isCurrent(request),
      });
    } catch (error) {
      if (!controller.signal.aborted && this.isCurrent(request)) {
        this.#onError(error, request);
      }
    } finally {
      if (this.#inFlight.get(request.viewRevision) === controller) {
        this.#inFlight.delete(request.viewRevision);
      }
      if (!this.#preemptInFlight && this.#ready && this.#pending) {
        void this.#drain();
      }
    }
  }

  #abortInFlight(): void {
    for (const controller of this.#inFlight.values()) controller.abort();
  }
}
