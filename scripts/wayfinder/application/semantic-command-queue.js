export class SemanticCommandQueue {
    #tail = Promise.resolve();
    #barrierActive = false;
    #terminal = false;
    get barrierActive() {
        return this.#barrierActive;
    }
    get terminal() {
        return this.#terminal;
    }
    enqueue(command) {
        if (this.#barrierActive || this.#terminal) {
            return null;
        }
        return this.#append(command);
    }
    runBarrier(command) {
        if (this.#barrierActive || this.#terminal) {
            return null;
        }
        this.#barrierActive = true;
        const result = this.#append(command);
        return result.finally(() => {
            if (!this.#terminal) {
                this.#barrierActive = false;
            }
        });
    }
    async acquireBarrier() {
        while (this.#barrierActive && !this.#terminal) {
            await this.#tail;
            await Promise.resolve();
        }
        if (this.#terminal) {
            return "terminal";
        }
        this.#barrierActive = true;
        await this.#tail;
        return "acquired";
    }
    releaseBarrier() {
        if (!this.#terminal) {
            this.#barrierActive = false;
        }
    }
    completeTerminalOperation() {
        this.#terminal = true;
        this.#barrierActive = true;
    }
    #append(command) {
        const result = this.#tail.catch(() => undefined).then(command);
        this.#tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
//# sourceMappingURL=semantic-command-queue.js.map