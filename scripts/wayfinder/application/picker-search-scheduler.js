export class PickerSearchScheduler {
    #delayMs;
    #render;
    #onError;
    #viewRevision = 0;
    #sourceRevision = 0;
    #timer = null;
    #pending = null;
    #ready = false;
    #inFlight = false;
    #disposed = false;
    constructor(options) {
        this.#delayMs = Math.max(0, options.delayMs);
        this.#render = options.render;
        this.#onError = options.onError ?? (() => undefined);
    }
    get sourceRevision() {
        return this.#sourceRevision;
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
    }
    #clearTimer() {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }
    async #drain() {
        if (this.#disposed || this.#inFlight || !this.#ready || !this.#pending) {
            return;
        }
        const request = this.#pending;
        this.#pending = null;
        this.#ready = false;
        this.#inFlight = true;
        try {
            await this.#render(request);
        }
        catch (error) {
            if (this.isCurrent(request)) {
                this.#onError(error, request);
            }
        }
        finally {
            this.#inFlight = false;
            if (this.#ready && this.#pending) {
                void this.#drain();
            }
        }
    }
}
//# sourceMappingURL=picker-search-scheduler.js.map