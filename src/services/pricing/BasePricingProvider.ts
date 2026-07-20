import { MemoryPricingCache, type PricingCache } from "./cache";
import { refreshQuoteFreshness } from "./freshness";
import {
  FixedWindowPricingRateLimiter,
  type PricingRateLimiter,
} from "./rateLimit";
import {
  assertValidPricingRequest,
  pricingRequestKey,
  type LivePricingProviderId,
  type PricingProvider,
  type PricingQueryOptions,
  type PricingRequest,
  type PricingResult,
  type QuoteDataMode,
} from "./types";

export interface BasePricingProviderOptions {
  cache?: PricingCache;
  cacheTtlMs?: number;
  rateLimiter?: PricingRateLimiter;
}

export abstract class BasePricingProvider implements PricingProvider {
  abstract readonly provider: LivePricingProviderId;
  abstract readonly dataMode: QuoteDataMode;

  private readonly cache: PricingCache;
  private readonly cacheTtlMs: number;
  private readonly rateLimiter: PricingRateLimiter;
  private readonly inFlight = new Map<string, Promise<PricingResult>>();

  protected constructor(options: BasePricingProviderOptions = {}) {
    this.cache = options.cache ?? new MemoryPricingCache();
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
    this.rateLimiter =
      options.rateLimiter ??
      new FixedWindowPricingRateLimiter({ maxRequests: 20, windowMs: 60 * 1000 });
  }

  async getQuote(request: PricingRequest, options: PricingQueryOptions = {}): Promise<PricingResult> {
    assertValidPricingRequest(request);
    const key = pricingRequestKey(this.provider, request);

    if (!options.bypassCache) {
      const cached = await this.cache.get(key);
      if (cached) {
        return {
          ...cached,
          quote: refreshQuoteFreshness(cached.quote),
          cache: "hit",
        };
      }

      const pending = this.inFlight.get(key);
      if (pending) {
        const result = await pending;
        return { ...result, quote: refreshQuoteFreshness(result.quote), cache: "coalesced" };
      }
    }

    const pending = this.fetchProtected(request, options);
    this.inFlight.set(key, pending);

    try {
      const result = await pending;
      await this.cache.set(key, result, this.cacheTtlMs);
      return result;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  async getQuotes(
    requests: readonly PricingRequest[],
    options: PricingQueryOptions = {},
  ): Promise<PricingResult[]> {
    const results: PricingResult[] = [];
    // Sequential batching respects provider quotas and makes partial retry simple.
    for (const request of requests) {
      results.push(await this.getQuote(request, options));
    }
    return results;
  }

  private async fetchProtected(
    request: PricingRequest,
    options: PricingQueryOptions,
  ): Promise<PricingResult> {
    if (options.signal?.aborted) throw options.signal.reason;
    await this.rateLimiter.acquire(this.provider);
    const result = await this.fetchAndNormalize(request, options.signal);

    if (result.quote.provider !== this.provider || result.quote.dataMode !== this.dataMode) {
      throw new Error(`Provider ${this.provider} returned a quote with inconsistent source metadata.`);
    }

    return { ...result, cache: "miss" };
  }

  protected abstract fetchAndNormalize(
    request: PricingRequest,
    signal?: AbortSignal,
  ): Promise<PricingResult>;
}

