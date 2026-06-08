type QueueTask<T> = {
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  fn: () => Promise<T>;
};

class ArtworkQueue {
  private queues = new Map<string, QueueTask<any>[]>();
  private processing = new Map<string, boolean>();
  private lastRequest = new Map<string, number>();
  private controller = new AbortController();

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
        fn: () => fn(this.controller.signal),
      });

      if (!this.processing.get(provider)) {
        this.processNext(provider, paceMs);
      }
    });
  }

  private async processNext(provider: string, paceMs: number) {
    this.processing.set(provider, true);
    const queue = this.queues.get(provider)!;

    while (queue.length > 0) {
      const task = queue.shift()!;

      const now = Date.now();
      const last = this.lastRequest.get(provider) || 0;
      const wait = Math.max(0, paceMs - (now - last));
      if (wait > 0) await this.delay(wait);

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

  abort() {
    this.controller.abort();
    this.controller = new AbortController();
  }

  clearPending(provider: string) {
    const queue = this.queues.get(provider);
    if (queue) {
      for (const task of queue) {
        task.reject(new Error("queue cleared"));
      }
      queue.length = 0;
    }
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

export const artworkQueue = new ArtworkQueue();
