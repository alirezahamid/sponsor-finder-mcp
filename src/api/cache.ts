/**
 * Minimal in-process TTL cache backed by a plain `Map` (spec §7).
 *
 * Web-standard only — no timers, no Redis. Entries expire lazily on read using
 * `Date.now()`. Suitable for the two low-cardinality caches we need: `/status`
 * (~10 min) and `/filters` (~1 h). On Cloudflare Workers a fresh instance is
 * created per isolate; that is fine — the cache is a best-effort optimisation,
 * not a correctness requirement.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Return the cached value, or compute + cache it via `loader` on a miss.
   * Concurrent misses share a single in-flight promise so we never fire two
   * identical upstream requests at once (request coalescing).
   */
  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  private readonly inFlight = new Map<string, Promise<T>>();
}
