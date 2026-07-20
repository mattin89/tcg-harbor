import { calculateFreshness } from "./freshness";
import type {
  CatalogItemType,
  LivePricingProviderId,
  MarketRegion,
  NormalizedPriceQuote,
  PricingRequest,
  QuoteCurrency,
  QuoteDataMode,
} from "./types";

export function optionalMoney(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function optionalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export interface BuildNormalizedQuoteInput {
  provider: LivePricingProviderId;
  region: MarketRegion;
  currency: QuoteCurrency;
  dataMode: QuoteDataMode;
  request: PricingRequest;
  fetchedAt: string;
  providerTimestamp: string | null;
  primaryPriceField: string | null;
  priceFields: Readonly<Record<string, number | null>>;
  sourceLabel: string;
  rawProviderMetadata?: Readonly<Record<string, string | number | boolean | null>>;
  catalogItemType?: CatalogItemType;
}

export function buildNormalizedQuote(input: BuildNormalizedQuoteInput): NormalizedPriceQuote {
  const marketValue = input.primaryPriceField
    ? (input.priceFields[input.primaryPriceField] ?? null)
    : null;
  const freshnessTimestamp = input.providerTimestamp ?? input.fetchedAt;

  return {
    catalogItemId: input.request.catalogItemId,
    catalogItemType: input.catalogItemType ?? input.request.catalogItemType,
    provider: input.provider,
    providerProductId: input.request.providerProductId,
    region: input.region,
    currency: input.currency,
    marketValue,
    primaryPriceField: input.primaryPriceField,
    priceFields: input.priceFields,
    condition: input.request.condition,
    language: input.request.language,
    variant: input.request.variant?.trim() || null,
    providerTimestamp: input.providerTimestamp,
    fetchedAt: input.fetchedAt,
    freshness: calculateFreshness(freshnessTimestamp, marketValue),
    dataMode: input.dataMode,
    sourceLabel: input.sourceLabel,
    rawProviderMetadata: input.rawProviderMetadata ?? {},
  };
}

export function firstAvailablePriceField(
  priceFields: Readonly<Record<string, number | null>>,
  preferredFields: readonly string[],
): string | null {
  return preferredFields.find((field) => priceFields[field] !== null && priceFields[field] !== undefined) ?? null;
}

