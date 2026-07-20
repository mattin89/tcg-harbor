import { BasePricingProvider, type BasePricingProviderOptions } from "../BasePricingProvider";
import {
  buildNormalizedQuote,
  firstAvailablePriceField,
  optionalIsoTimestamp,
  optionalMoney,
} from "../normalization";
import { assertServerOnlyCredentials } from "../serverBoundary";
import type { PricingRequest, PricingResult, ProviderTransport } from "../types";

/**
 * A stable intermediary contract for an authorized Cardmarket server adapter.
 * The adapter should copy only fields returned by the licensed integration; the
 * normalizer never fabricates a missing low/average/trend value.
 */
export interface CardmarketLicensedQuoteResponse {
  productId: string;
  currency: "EUR";
  updatedAt?: string | null;
  prices: {
    trend?: number | null;
    low?: number | null;
    average1Day?: number | null;
    average7Days?: number | null;
    average30Days?: number | null;
    foilTrend?: number | null;
  };
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CardmarketPricingProviderOptions extends BasePricingProviderOptions {
  transport: ProviderTransport<CardmarketLicensedQuoteResponse>;
  /** Guard input only. The transport owns server-side credential use. */
  serverCredentials?: { accessToken?: string; appToken?: string };
}

export class CardmarketPricingProvider extends BasePricingProvider {
  readonly provider = "cardmarket" as const;
  readonly dataMode = "live" as const;
  private readonly transport: ProviderTransport<CardmarketLicensedQuoteResponse>;

  constructor(options: CardmarketPricingProviderOptions) {
    assertServerOnlyCredentials("Cardmarket", options.serverCredentials);
    super(options);
    this.transport = options.transport;
  }

  protected async fetchAndNormalize(
    request: PricingRequest,
    signal?: AbortSignal,
  ): Promise<PricingResult<CardmarketLicensedQuoteResponse>> {
    const fetchedAt = new Date().toISOString();
    const response = await this.transport.fetchQuote(request, signal);
    if (response.productId !== request.providerProductId) {
      throw new Error("Cardmarket response productId did not match the requested stable mapping.");
    }
    if (response.currency !== "EUR") {
      throw new Error("Cardmarket response currency must be native EUR.");
    }
    const priceFields = {
      trend: optionalMoney(response.prices.trend),
      low: optionalMoney(response.prices.low),
      average1Day: optionalMoney(response.prices.average1Day),
      average7Days: optionalMoney(response.prices.average7Days),
      average30Days: optionalMoney(response.prices.average30Days),
      foilTrend: optionalMoney(response.prices.foilTrend),
    };
    const primaryPriceField = firstAvailablePriceField(priceFields, [
      "trend",
      "average1Day",
      "average7Days",
      "average30Days",
      "low",
    ]);

    return {
      quote: buildNormalizedQuote({
        provider: this.provider,
        region: "EU",
        currency: "EUR",
        dataMode: this.dataMode,
        request,
        fetchedAt,
        providerTimestamp: optionalIsoTimestamp(response.updatedAt),
        primaryPriceField,
        priceFields,
        sourceLabel: "Cardmarket licensed market data",
        rawProviderMetadata: response.metadata,
      }),
      rawResponse: {
        provider: this.provider,
        providerProductId: response.productId,
        fetchedAt,
        payload: response,
      },
      cache: "miss",
    };
  }
}
