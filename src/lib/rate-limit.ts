/**
 * Sliding-window rate limiter kept in memory. Per server instance, so it's best-effort:
 * it stops floods and code guessing; per-assignment student limits are the hard guard.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Forget the oldest keys beyond this many, so memory stays bounded. */
    private readonly maxKeys = 20_000
  ) {}

  /** Record a hit for `key` and say whether it's within the limit. */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);
    // Re-insert so the Map's order tracks recency, then trim the stalest keys.
    this.hits.delete(key);
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return allowed;
  }
}

/** The client's IP from X-Forwarded-For (first entry), or "unknown". */
export function clientIpFrom(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || "unknown";
}
