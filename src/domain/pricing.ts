import { DomainError } from './errors';
import type {
  CatalogItemId,
  Currency,
  LanguageCode,
  MarketProvider,
  PriceQuote,
} from './types';

export const PROVIDER_NATIVE_MARKET: Readonly<
  Record<MarketProvider, { readonly currency: Currency; readonly region: 'EU' | 'US' }>
> = Object.freeze({
  cardmarket: Object.freeze({ currency: 'EUR', region: 'EU' }),
  tcgplayer: Object.freeze({ currency: 'USD', region: 'US' }),
});

export interface ProviderQuoteRequest {
  readonly catalogItemId: CatalogItemId;
  readonly providerProductId: string;
  readonly language: LanguageCode;
  readonly condition: string;
  readonly variant?: string;
}

/**
 * Server-side adapter boundary. Implementations may call licensed provider APIs,
 * while portfolio code only consumes normalized quotes/snapshots.
 */
export interface PricingProvider {
  readonly provider: MarketProvider | 'mock';
  getQuote(request: ProviderQuoteRequest): Promise<PriceQuote | null>;
}

export interface ProviderCatalogMapping {
  readonly catalogItemId: CatalogItemId;
  readonly provider: MarketProvider;
  readonly providerProductId: string;
  readonly setCode: string;
  readonly cardNumber?: string;
  readonly variant?: string;
  readonly language: LanguageCode;
  readonly condition: string;
}

export function assertNativeProviderCurrency(provider: MarketProvider, currency: Currency): void {
  if (PROVIDER_NATIVE_MARKET[provider].currency !== currency) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `${provider} values must be calculated in native ${PROVIDER_NATIVE_MARKET[provider].currency}; converted values must be labelled separately.`,
    );
  }
}

export function quoteIsUnavailable(quote: PriceQuote | null | undefined): boolean {
  return quote == null || quote.normalizedMarketValue == null || quote.freshness.state === 'unavailable';
}

export function quoteIsStale(quote: PriceQuote, at: Date = new Date()): boolean {
  if (quote.freshness.state === 'stale') return true;
  if (!quote.freshness.staleAfter) return false;
  return Date.parse(quote.freshness.staleAfter) <= at.getTime();
}

function quoteKey(request: ProviderQuoteRequest): string {
  return [
    request.catalogItemId,
    request.providerProductId,
    request.language,
    request.condition,
    request.variant ?? '',
  ].join('|');
}

/** A deterministic fixture adapter; its quotes always remain explicitly demo-labelled. */
export class MockPricingProvider implements PricingProvider {
  readonly provider = 'mock' as const;
  readonly #quotes: ReadonlyMap<string, PriceQuote>;

  constructor(entries: readonly { readonly request: ProviderQuoteRequest; readonly quote: PriceQuote }[]) {
    this.#quotes = new Map(
      entries.map(({ request, quote }) => [
        quoteKey(request),
        Object.freeze({
          ...quote,
          freshness: Object.freeze({ ...quote.freshness, state: 'demo' as const, isDemo: true }),
          rawProviderMetadata: Object.freeze({ ...quote.rawProviderMetadata }),
        }),
      ]),
    );
  }

  async getQuote(request: ProviderQuoteRequest): Promise<PriceQuote | null> {
    return this.#quotes.get(quoteKey(request)) ?? null;
  }
}
