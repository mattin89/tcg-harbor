import { BasePricingProvider, type BasePricingProviderOptions } from "../BasePricingProvider";
import {
  buildNormalizedQuote,
  firstAvailablePriceField,
  optionalIsoTimestamp,
  optionalMoney,
} from "../normalization";
import { assertServerOnlyCredentials } from "../serverBoundary";
import type { PricingRequest, PricingResult, ProviderTransport } from "../types";

/** Server-normalized response from an authorized TCGPlayer integration. */
export interface TCGPlayerLicensedQuoteResponse {
  productId: string;
  currency: "USD";
  updatedAt?: string | null;
  prices: {
    market?: number | null;
    low?: number | null;
    mid?: number | null;
    high?: number | null;
    directLow?: number | null;
  };
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TCGPlayerPricingProviderOptions extends BasePricingProviderOptions {
  transport: ProviderTransport<TCGPlayerLicensedQuoteResponse>;
  /** Guard input only. The transport owns server-side credential use. */
  serverCredentials?: { publicKey?: string; privateKey?: string; bearerToken?: string };
}

export class TCGPlayerPricingProvider extends BasePricingProvider {
  readonly provider = "tcgplayer" as const;
  readonly dataMode = "live" as const;
  private readonly transport: ProviderTransport<TCGPlayerLicensedQuoteResponse>;

  constructor(options: TCGPlayerPricingProviderOptions) {
    assertServerOnlyCredentials("TCGPlayer", options.serverCredentials);
    super(options);
    this.transport = options.transport;
  }

  protected async fetchAndNormalize(
    request: PricingRequest,
    signal?: AbortSignal,
  ): Promise<PricingResult<TCGPlayerLicensedQuoteResponse>> {
    const fetchedAt = new Date().toISOString();
    const response = await this.transport.fetchQuote(request, signal);
    if (response.productId !== request.providerProductId) {
      throw new Error("TCGPlayer response productId did not match the requested stable mapping.");
    }
    if (response.currency !== "USD") {
      throw new Error("TCGPlayer response currency must be native USD.");
    }
    const priceFields = {
      market: optionalMoney(response.prices.market),
      low: optionalMoney(response.prices.low),
      mid: optionalMoney(response.prices.mid),
      high: optionalMoney(response.prices.high),
      directLow: optionalMoney(response.prices.directLow),
    };
    const primaryPriceField = firstAvailablePriceField(priceFields, ["market", "mid", "low"]);

    return {
      quote: buildNormalizedQuote({
        provider: this.provider,
        region: "US",
        currency: "USD",
        dataMode: this.dataMode,
        request,
        fetchedAt,
        providerTimestamp: optionalIsoTimestamp(response.updatedAt),
        primaryPriceField,
        priceFields,
        sourceLabel: "TCGPlayer licensed market data",
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
