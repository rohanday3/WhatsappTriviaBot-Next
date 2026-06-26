export class TtlSet {
  private readonly values = new Map<string, number>();

  constructor(private readonly ttlMs: number, private readonly maxSize = 20_000) {}

  hasOrAdd(value: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.values.has(value)) return true;
    this.values.set(value, now + this.ttlMs);
    if (this.values.size > this.maxSize) {
      const first = this.values.keys().next().value as string | undefined;
      if (first) this.values.delete(first);
    }
    return false;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.values) {
      if (expiresAt > now) break;
      this.values.delete(key);
    }
  }
}
