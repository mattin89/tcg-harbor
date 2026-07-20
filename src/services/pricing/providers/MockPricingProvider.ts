import { BasePricingProvider, type BasePricingProviderOptions } from "../BasePricingProvider";
import { DEMO_PRICING_FIXTURES, type MockPricingFixture } from "../demoFixtures";
import { buildNormalizedQuote } from "../normalization";
import type {
  LivePricingProviderId,
  PricingProvider,
  PricingRequest,
  PricingResult,
} from "../types";

export interface MockPricingProviderOptions extends BasePricingProviderOptions {
  provider: LivePricingProviderId;
  fixtures?: readonly MockPricingFixture[];
}

function sameText(left: string | undefined, right: string | undefined): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

export class MockPricingProvider extends BasePricingProvider {
  readonly provider: LivePricingProviderId;
  readonly dataMode = "demo" as const;
  private readonly fixtures: readonly MockPricingFixture[];

  constructor(options: MockPricingProviderOptions) {
    super(options);
    this.provider = options.provider;
    this.fixtures = options.fixtures ?? DEMO_PRICING_FIXTURES;
  }

  protected async fetchAndNormalize(request: PricingRequest): Promise<PricingResult> {
    const fetchedAt = new Date().toISOString();
    const fixture = this.fixtures.find(
      (candidate) =>
        candidate.provider === this.provider &&
        candidate.catalogItemId === request.catalogItemId &&
        candidate.providerProductId === request.providerProductId &&
        candidate.catalogItemType === request.catalogItemType &&
        sameText(candidate.setCode, request.setCode) &&
        sameText(candidate.cardNumber, request.cardNumber) &&
        sameText(candidate.variant, request.variant) &&
        sameText(candidate.language, request.language) &&
        sameText(candidate.condition, request.condition),
    );

    const region = this.provider === "cardmarket" ? "EU" : "US";
    const currency = this.provider === "cardmarket" ? "EUR" : "USD";
    const quote = buildNormalizedQuote({
      provider: this.provider,
      region,
      currency,
      dataMode: this.dataMode,
      request,
      fetchedAt,
      providerTimestamp: fixture?.asOf ?? null,
      primaryPriceField: fixture?.primaryPriceField ?? null,
      priceFields: fixture?.priceFields ?? {},
      sourceLabel: "Demo market data — not live provider data",
      rawProviderMetadata: {
        fixtureId: fixture?.fixtureId ?? null,
        fixtureFound: Boolean(fixture),
        liveProviderRequestMade: false,
      },
    });

    return {
      quote,
      rawResponse: {
        provider: this.provider,
        providerProductId: request.providerProductId,
        fetchedAt,
        payload: fixture
          ? { ...fixture, notice: "Illustrative demo fixture; no provider request was made." }
          : { notice: "No explicit fixture matched; price is unavailable." },
      },
      cache: "miss",
    };
  }
}

export function createDemoPricingProviders(
  fixtures: readonly MockPricingFixture[] = DEMO_PRICING_FIXTURES,
): Readonly<Record<LivePricingProviderId, PricingProvider>> {
  return {
    cardmarket: new MockPricingProvider({ provider: "cardmarket", fixtures }),
    tcgplayer: new MockPricingProvider({ provider: "tcgplayer", fixtures }),
  };
}
