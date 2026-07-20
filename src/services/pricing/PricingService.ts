import type {
  LivePricingProviderId,
  PricingProvider,
  PricingQueryOptions,
  PricingRequest,
  PricingResult,
} from "./types";

export class PricingProviderNotConfiguredError extends Error {
  constructor(provider: LivePricingProviderId) {
    super(`Pricing provider '${provider}' is not configured.`);
    this.name = "PricingProviderNotConfiguredError";
  }
}

/** Small provider registry that keeps portfolio code independent of adapters. */
export class PricingService {
  private readonly providers: ReadonlyMap<LivePricingProviderId, PricingProvider>;

  constructor(providers: Iterable<PricingProvider> | Readonly<Record<LivePricingProviderId, PricingProvider>>) {
    const values = Symbol.iterator in Object(providers)
      ? Array.from(providers as Iterable<PricingProvider>)
      : Object.values(providers as Readonly<Record<LivePricingProviderId, PricingProvider>>);
    this.providers = new Map(values.map((provider) => [provider.provider, provider]));
  }

  getProvider(provider: LivePricingProviderId): PricingProvider {
    const configured = this.providers.get(provider);
    if (!configured) throw new PricingProviderNotConfiguredError(provider);
    return configured;
  }

  getQuote(
    provider: LivePricingProviderId,
    request: PricingRequest,
    options?: PricingQueryOptions,
  ): Promise<PricingResult> {
    return this.getProvider(provider).getQuote(request, options);
  }

  getQuotes(
    provider: LivePricingProviderId,
    requests: readonly PricingRequest[],
    options?: PricingQueryOptions,
  ): Promise<PricingResult[]> {
    return this.getProvider(provider).getQuotes(requests, options);
  }
}

