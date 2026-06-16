type QueueTask<T> = {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  fn: () => Promise<T>;
};

class ArtworkQueue {
  private queues = new Map<string, QueueTask<any>[]>();
  private processing = new Map<string, boolean>();
  private lastRequest = new Map<string, number>();
  private cancelTokens = new Map<string, AbortController>();

  enqueue<T>(
    provider: string,
    paceMs: number,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(provider)) this.queues.set(provider, []);
      this.queues.get(provider)!.push({
        resolve,
        reject,
        fn: () => fn(this.cancelTokens.get(provider)!.signal),
      });

      if (!this.processing.get(provider)) {
        this.cancelTokens.set(provider, new AbortController());
        this.processNext(provider, paceMs);
      }
    });
  }

  private async processNext(provider: string, paceMs: number) {
    this.processing.set(provider, true);
    const queue = this.queues.get(provider)!;

    while (queue.length > 0) {
      const signal = this.cancelTokens.get(provider)?.signal;
      if (signal?.aborted) break;

      const now = Date.now();
      const last = this.lastRequest.get(provider) || 0;
      const wait = Math.max(0, paceMs - (now - last));
      if (wait > 0) {
        await this.delay(wait);
        if (signal?.aborted) break;
      } else {
        // Always yield so clearPending can cancel before execution
        await this.delay(0);
        if (signal?.aborted) break;
      }

      if (queue.length === 0) break;

      const task = queue.shift()!;

      try {
        this.lastRequest.set(provider, Date.now());
        const result = await task.fn();
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }

    this.processing.set(provider, false);
  }

  clearPending(provider: string) {
    const token = this.cancelTokens.get(provider);
    if (token) {
      token.abort();
      this.cancelTokens.delete(provider);
    }
    const queue = this.queues.get(provider);
    if (queue) {
      for (const task of queue) {
        task.reject(new Error("queue cleared"));
      }
      queue.length = 0;
    }
    this.processing.set(provider, false);
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const artworkQueue = new ArtworkQueue();
