type Task<T = unknown> = {
  id: string;
  type: string;
  payload: unknown;
  priority: "high" | "normal" | "low";
  retries: number;
  maxRetries: number;
  createdAt: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TaskHandler = (payload: unknown) => Promise<unknown>;

export class TaskQueue {
  private high: Task[] = [];
  private normal: Task[] = [];
  private low: Task[] = [];
  private running = false;
  private destroyed = false;
  private handlers = new Map<string, TaskHandler>();
  private taskCounter = 0;

  register(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  add<T = unknown>(
    type: string,
    payload: unknown,
    priority: "high" | "normal" | "low" = "normal",
    maxRetries = 1,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = {
        id: `${type}_${++this.taskCounter}`,
        type,
        payload,
        priority,
        retries: 0,
        maxRetries,
        createdAt: Date.now(),
        resolve: resolve as (value: T) => void,
        reject,
      };
      this.enqueue(task);
      this.processNext();
    });
  }

  private enqueue(task: Task): void {
    if (task.priority === "high") this.high.push(task);
    else if (task.priority === "low") this.low.push(task);
    else this.normal.push(task);
  }

  private dequeue(): Task | undefined {
    if (this.high.length > 0) return this.high.shift();
    if (this.normal.length > 0) return this.normal.shift();
    return this.low.shift();
  }

  private async processNext(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;

    while (!this.destroyed) {
      const task = this.dequeue();
      if (!task) break;

      const handler = this.handlers.get(task.type);
      if (!handler) {
        task.reject(new Error(`No handler registered for task type: ${task.type}`));
        continue;
      }

      try {
        const result = await handler(task.payload);
        task.resolve(result);
      } catch (err) {
        if (task.retries < task.maxRetries) {
          task.retries++;
          task.createdAt = Date.now();
          this.enqueue(task);
        } else {
          task.reject(err);
        }
      }
    }

    this.running = false;
  }

  size(): number {
    return this.high.length + this.normal.length + this.low.length;
  }

  destroy(): void {
    this.destroyed = true;
    const rejectAll = (q: Task[]) => {
      while (q.length > 0) {
        q.shift()?.reject(new Error("Queue destroyed"));
      }
    };
    rejectAll(this.high);
    rejectAll(this.normal);
    rejectAll(this.low);
  }
}
