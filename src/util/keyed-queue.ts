export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly depths = new Map<string, number>();

  constructor(private readonly maxDepthPerKey = 100) {}

  depth(key: string): number {
    return this.depths.get(key) ?? 0;
  }

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const depth = this.depth(key);
    if (depth >= this.maxDepthPerKey) {
      throw new Error(`Queue limit reached for ${key}`);
    }

    this.depths.set(key, depth + 1);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => next);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      const remaining = (this.depths.get(key) ?? 1) - 1;
      if (remaining <= 0) {
        this.depths.delete(key);
        if (this.tails.get(key) === tail) this.tails.delete(key);
      } else {
        this.depths.set(key, remaining);
      }
    }
  }
}
