export class SemanticCommandQueue {
  #tail: Promise<void> = Promise.resolve();
  #barrierActive = false;
  #pendingCommandCount = 0;
  #terminal = false;

  get barrierActive(): boolean {
    return this.#barrierActive;
  }

  get busy(): boolean {
    return this.#barrierActive || this.#pendingCommandCount > 0;
  }

  get terminal(): boolean {
    return this.#terminal;
  }

  enqueue<T>(command: () => Promise<T>): Promise<T> | null {
    if (this.#barrierActive || this.#terminal) {
      return null;
    }
    return this.#append(command);
  }

  runBarrier<T>(command: () => Promise<T>): Promise<T> | null {
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

  async acquireBarrier(): Promise<"acquired" | "terminal"> {
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

  releaseBarrier(): void {
    if (!this.#terminal) {
      this.#barrierActive = false;
    }
  }

  completeTerminalOperation(): void {
    this.#terminal = true;
    this.#barrierActive = true;
  }

  #append<T>(command: () => Promise<T>): Promise<T> {
    this.#pendingCommandCount += 1;
    const result = this.#tail.catch(() => undefined).then(command);
    const tracked = result.then(
      (value) => {
        this.#pendingCommandCount -= 1;
        return value;
      },
      (error: unknown) => {
        this.#pendingCommandCount -= 1;
        throw error;
      }
    );
    this.#tail = tracked.then(
      () => undefined,
      () => undefined
    );
    return tracked;
  }
}
