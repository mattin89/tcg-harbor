import type { DemoAsset, Market } from '../data/demo';

export interface AcquisitionBasisSummary {
  /** Sum of acquisition-time market references that are known. */
  readonly knownValue: number;
  /** Null unless every currently held copy has an acquisition-time reference. */
  readonly value: number | null;
  readonly totalQuantity: number;
  readonly pricedQuantity: number;
  readonly complete: boolean;
}

/**
 * Values the copies that remain in a holding against their immutable
 * acquisition-time market references. Database removals are allocated FIFO,
 * so the remaining inventory is taken from the newest acquisition lots first.
 */
export function summarizeAcquisitionBasis(
  assets: readonly DemoAsset[],
  market: Market,
): AcquisitionBasisSummary {
  let knownValue = 0;
  let totalQuantity = 0;
  let pricedQuantity = 0;

  for (const asset of assets) {
    let remaining = asset.quantity;
    totalQuantity += remaining;

    const lots = [...(asset.acquisitionLots ?? [])]
      .sort((left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt));

    for (const lot of lots) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, lot.quantity);
      const unitValue = lot.quoteAtAdd[market];
      if (unitValue !== null && Number.isFinite(unitValue)) {
        knownValue += unitValue * allocated;
        pricedQuantity += allocated;
      }
      remaining -= allocated;
    }
  }

  const complete = pricedQuantity === totalQuantity;
  return {
    knownValue,
    value: complete ? knownValue : null,
    totalQuantity,
    pricedQuantity,
    complete,
  };
}

export interface PortfolioGrowthSummary extends AcquisitionBasisSummary {
  readonly currentKnownValue: number;
  readonly currentPricedQuantity: number;
  readonly currentComplete: boolean;
  readonly absoluteGrowth: number | null;
  readonly percentageGrowth: number | null;
}

export function summarizePortfolioGrowth(
  assets: readonly DemoAsset[],
  market: Market,
): PortfolioGrowthSummary {
  const basis = summarizeAcquisitionBasis(assets, market);
  let currentKnownValue = 0;
  let currentPricedQuantity = 0;

  for (const asset of assets) {
    const unitValue = asset.quote[market];
    if (unitValue === null || !Number.isFinite(unitValue)) continue;
    currentKnownValue += unitValue * asset.quantity;
    currentPricedQuantity += asset.quantity;
  }

  const currentComplete = currentPricedQuantity === basis.totalQuantity;
  const canCalculate = basis.complete && currentComplete;
  const absoluteGrowth = canCalculate ? currentKnownValue - basis.knownValue : null;
  const percentageGrowth = absoluteGrowth !== null && basis.knownValue > 0
    ? (absoluteGrowth / basis.knownValue) * 100
    : null;

  return {
    ...basis,
    currentKnownValue,
    currentPricedQuantity,
    currentComplete,
    absoluteGrowth,
    percentageGrowth,
  };
}
