export type LivePricingProviderId = "cardmarket" | "tcgplayer";

export type CatalogItemType = "card" | "sealed-product";
export type MarketRegion = "EU" | "US";
export type QuoteCurrency = "EUR" | "USD";
export type QuoteDataMode = "live" | "demo";
export type QuoteFreshnessState = "fresh" | "stale" | "expired" | "unavailable";

/**
 * Provider requests intentionally contain stable catalog facts and no display-name
 * fallback. A caller should map its internal item to a licensed provider listing
 * before asking for a quote.
 */
export interface PricingRequest {
  catalogItemId: string;
  catalogItemType: CatalogItemType;
  providerProductId: string;
  setCode?: string;
  cardNumber?: string;
  variant?: string;
  language: string;
  condition: string;
}

export interface QuoteFreshness {
  state: QuoteFreshnessState;
  ageMs: number | null;
  staleAfterMs: number;
  expiresAfterMs: number;
}

export interface CurrencyConversion {
  fromCurrency: QuoteCurrency;
  toCurrency: QuoteCurrency;
  rate: number;
  rateTimestamp: string;
  convertedMarketValue: number;
  source: string;
}

/**
 * A provider-neutral quote. `marketValue` is nullable by design: unavailable
 * pricing must never silently become zero. Provider-native values are retained
 * in `priceFields`; conversions are separately attributed in `conversion`.
 */
export interface NormalizedPriceQuote {
  catalogItemId: string;
  catalogItemType: CatalogItemType;
  provider: LivePricingProviderId;
  providerProductId: string;
  region: MarketRegion;
  currency: QuoteCurrency;
  marketValue: number | null;
  primaryPriceField: string | null;
  priceFields: Readonly<Record<string, number | null>>;
  condition: string;
  language: string;
  variant: string | null;
  providerTimestamp: string | null;
  fetchedAt: string;
  freshness: QuoteFreshness;
  dataMode: QuoteDataMode;
  sourceLabel: string;
  conversion?: CurrencyConversion;
  /** Small, non-sensitive descriptors suitable for logs or persistence. */
  rawProviderMetadata: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * The unmodified licensed-provider payload is kept beside, not blended into,
 * the normalized quote. Persistence layers can protect or omit it independently.
 */
export interface RawProviderResponse<TPayload = unknown> {
  provider: LivePricingProviderId;
  providerProductId: string;
  fetchedAt: string;
  payload: TPayload;
}

export interface PricingResult<TPayload = unknown> {
  quote: NormalizedPriceQuote;
  rawResponse: RawProviderResponse<TPayload>;
  cache: "hit" | "miss" | "coalesced";
}

export interface PricingQueryOptions {
  signal?: AbortSignal;
  bypassCache?: boolean;
}

export interface PricingProvider {
  readonly provider: LivePricingProviderId;
  readonly dataMode: QuoteDataMode;
  getQuote(request: PricingRequest, options?: PricingQueryOptions): Promise<PricingResult>;
  getQuotes(requests: readonly PricingRequest[], options?: PricingQueryOptions): Promise<PricingResult[]>;
}

export interface ProviderTransport<TResponse> {
  /**
   * Implement this in a server route/function using an authorized provider API.
   * Never construct the transport with a secret in browser-delivered code.
   */
  fetchQuote(request: PricingRequest, signal?: AbortSignal): Promise<TResponse>;
}

export interface PriceSnapshot {
  catalogItemId: string;
  provider: LivePricingProviderId;
  currency: QuoteCurrency;
  unitMarketValue: number | null;
  quantity: number;
  capturedAt: string;
  dataMode: QuoteDataMode;
}

export function pricingRequestKey(provider: LivePricingProviderId, request: PricingRequest): string {
  return [
    provider,
    request.catalogItemType,
    request.catalogItemId,
    request.providerProductId,
    request.setCode ?? "",
    request.cardNumber ?? "",
    request.variant ?? "",
    request.language,
    request.condition,
  ]
    .map((part) => encodeURIComponent(part.trim().toLowerCase()))
    .join(":");
}

export function assertValidPricingRequest(request: PricingRequest): void {
  const required: Array<[string, string]> = [
    ["catalogItemId", request.catalogItemId],
    ["providerProductId", request.providerProductId],
    ["language", request.language],
    ["condition", request.condition],
  ];

  for (const [field, value] of required) {
    if (!value.trim()) {
      throw new TypeError(`Pricing request ${field} must not be empty.`);
    }
  }

  if (request.catalogItemType === "card" && !request.cardNumber?.trim()) {
    throw new TypeError("Card pricing requests require a stable cardNumber.");
  }
}

