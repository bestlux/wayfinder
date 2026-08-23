export class PickerSearchScheduler {
    #delayMs;
    #render;
    #onError;
    #preemptInFlight;
    #viewRevision = 0;
    #sourceRevision = 0;
    #timer = null;
    #pending = null;
    #ready = false;
    #inFlight = new Map();
    #disposed = false;
    constructor(options) {
        this.#delayMs = Math.max(0, options.delayMs);
        this.#render = options.render;
        this.#onError = options.onError ?? (() => undefined);
        this.#preemptInFlight = options.preemptInFlight === true;
    }
    get sourceRevision() {
        return this.#sourceRevision;
    }
    get viewRevision() {
        return this.#viewRevision;
    }
    schedule(stepId, query) {
        if (this.#disposed) {
            return null;
        }
        const request = {
            viewRevision: ++this.#viewRevision,
            sourceRevision: this.#sourceRevision,
            stepId,
            query,
        };
        this.#pending = request;
        this.#ready = false;
        if (this.#preemptInFlight)
            this.#abortInFlight();
        this.#clearTimer();
        this.#timer = setTimeout(() => {
            this.#timer = null;
            this.#ready = true;
            void this.#drain();
        }, this.#delayMs);
        return request;
    }
    invalidateView() {
        if (this.#disposed) {
            return;
        }
        this.#invalidatePending();
    }
    invalidateSource() {
        if (this.#disposed) {
            return this.#sourceRevision;
        }
        this.#sourceRevision += 1;
        this.#invalidatePending();
        return this.#sourceRevision;
    }
    isCurrent(request) {
        return (!this.#disposed && request.viewRevision === this.#viewRevision && request.sourceRevision === this.#sourceRevision);
    }
    dispose() {
        if (this.#disposed) {
            return;
        }
        this.#invalidatePending();
        this.#disposed = true;
    }
    #invalidatePending() {
        this.#viewRevision += 1;
        this.#pending = null;
        this.#ready = false;
        this.#clearTimer();
        this.#abortInFlight();
    }
    #clearTimer() {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
    async #drain() {
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
        }
        catch (error) {
            if (!controller.signal.aborted && this.isCurrent(request)) {
                this.#onError(error, request);
            }
        }
        finally {
            if (this.#inFlight.get(request.viewRevision) === controller) {
                this.#inFlight.delete(request.viewRevision);
            }
            if (!this.#preemptInFlight && this.#ready && this.#pending) {
                void this.#drain();
            }
        }
    }
    #abortInFlight() {
        for (const controller of this.#inFlight.values())
            controller.abort();
    }
}
//# sourceMappingURL=picker-search-scheduler.js.map