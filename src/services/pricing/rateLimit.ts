export class PricingRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Pricing provider rate limit reached. Retry in ${retryAfterMs} ms.`);
    this.name = "PricingRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface PricingRateLimiter {
  acquire(scope: string): Promise<void>;
}

export interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

/**
 * A non-blocking local guard that fails fast instead of creating an unbounded
 * request queue. Configure an additional distributed limit at the server edge.
 */
export class FixedWindowPricingRateLimiter implements PricingRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: FixedWindowRateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.windowMs < 1) {
      throw new TypeError("Rate limiter requires a positive maxRequests and windowMs.");
    }
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  async acquire(scope: string): Promise<void> {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.windows.get(scope) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.maxRequests) {
      const retryAfterMs = Math.max(1, recent[0] + this.windowMs - now);
      this.windows.set(scope, recent);
      throw new PricingRateLimitError(retryAfterMs);
    }

    recent.push(now);
    this.windows.set(scope, recent);
  }
}

export class NoopPricingRateLimiter implements PricingRateLimiter {
  async acquire(): Promise<void> {
    return Promise.resolve();
  }
}

