import type { NormalizedPriceQuote, QuoteFreshness } from "./types";

export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
export const DEFAULT_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

export function calculateFreshness(
  timestamp: string | null,
  marketValue: number | null,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  expiresAfterMs = DEFAULT_EXPIRES_AFTER_MS,
): QuoteFreshness {
  if (marketValue === null || timestamp === null) {
    return { state: "unavailable", ageMs: null, staleAfterMs, expiresAfterMs };
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { state: "unavailable", ageMs: null, staleAfterMs, expiresAfterMs };
  }

  const ageMs = Math.max(0, nowMs - timestampMs);
  const state = ageMs > expiresAfterMs ? "expired" : ageMs > staleAfterMs ? "stale" : "fresh";
  return { state, ageMs, staleAfterMs, expiresAfterMs };
}

export function refreshQuoteFreshness(quote: NormalizedPriceQuote, nowMs = Date.now()): NormalizedPriceQuote {
  return {
    ...quote,
    freshness: calculateFreshness(
      quote.providerTimestamp ?? quote.fetchedAt,
      quote.marketValue,
      nowMs,
      quote.freshness.staleAfterMs,
      quote.freshness.expiresAfterMs,
    ),
  };
}

