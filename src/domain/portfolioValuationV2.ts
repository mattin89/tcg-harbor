import type { AssetKind, DemoAsset, Market } from '../data/demo';
import { summarizePortfolioGrowth } from './acquisitionGrowthV2';

export interface DailyValuationCandidateV2 {
  readonly provider: Market;
  readonly date: string;
  readonly marketValue: number | null;
  readonly acquisitionValue: number | null;
  readonly itemCount: number;
  readonly unitCount: number;
  readonly pricedUnitCount: number;
  readonly acquisitionPricedUnitCount: number;
  /** Latest provider observation included in this aggregate, when available. */
  readonly sourceObservedAt?: string | null;
  /** Last time this aggregate was rebuilt, including same-day refreshes. */
  readonly generatedAt: string;
}

export interface ResolvedPortfolioValuationV2 {
  readonly source: 'daily_snapshot' | 'live_holdings';
  readonly acceptedSnapshotDate: string | null;
  readonly snapshotFallbackReason: 'none' | 'not_available' | 'holdings_changed' | 'stale_prices' | 'incomplete_snapshot';
  readonly empty: boolean;
  readonly itemCount: number;
  readonly totalQuantity: number;
  readonly currentKnownValue: number;
  readonly currentPricedQuantity: number;
  readonly currentComplete: boolean;
  readonly acquisitionKnownValue: number;
  readonly acquisitionPricedQuantity: number;
  readonly acquisitionComplete: boolean;
  readonly growthComplete: boolean;
  readonly absoluteGrowth: number | null;
  readonly percentageGrowth: number | null;
}

/**
 * Uses a stored daily aggregate only while it still describes the currently
 * loaded holdings. A quantity/item mutation immediately falls back to the live
 * lot and quote data until the next matching daily capture is available.
 */
export function resolvePortfolioValuationV2(
  assets: readonly DemoAsset[],
  dailySnapshots: readonly DailyValuationCandidateV2[],
  market: Market,
  kind: AssetKind | 'all',
): ResolvedPortfolioValuationV2 {
  const filtered = assets.filter((asset) => kind === 'all' || asset.kind === kind);
  const live = summarizePortfolioGrowth(filtered, market);
  const itemCount = filtered.length;
  const totalQuantity = filtered.reduce((sum, asset) => sum + asset.quantity, 0);
  const latestSnapshot = [...dailySnapshots]
    .filter((snapshot) => snapshot.provider === market)
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1);
  const latestAcquisitionTime = assets.reduce((latest, asset) => {
    const candidateTimes = [
      Date.parse(asset.addedAt),
      ...(asset.acquisitionLots ?? []).map((lot) => Date.parse(lot.addedAt)),
    ].filter(Number.isFinite);
    return Math.max(latest, ...candidateTimes);
  }, Number.NEGATIVE_INFINITY);
  const snapshotGeneratedTime = latestSnapshot
    ? Date.parse(latestSnapshot.generatedAt)
    : Number.NaN;
  const snapshotSourceObservedTime = latestSnapshot?.sourceObservedAt
    ? Date.parse(latestSnapshot.sourceObservedAt)
    : Number.NaN;
  const snapshotFreshnessTime = Number.isFinite(snapshotSourceObservedTime)
    ? snapshotSourceObservedTime
    : snapshotGeneratedTime;
  const latestProviderSourceTime = assets.reduce((latest, asset) => {
    const rawSource = market === 'cardmarket'
      ? asset.sourceUpdatedAt?.cardmarket
      : asset.sourceUpdatedAt?.tcgcsv ?? asset.sourceUpdatedAt?.optcg;
    const sourceTime = rawSource ? Date.parse(rawSource) : Number.NaN;
    return Number.isFinite(sourceTime) ? Math.max(latest, sourceTime) : latest;
  }, Number.NEGATIVE_INFINITY);
  const hasCandidateSnapshot = kind === 'all'
    && totalQuantity > 0
    && latestSnapshot !== undefined;
  const snapshotHoldingsMatch = hasCandidateSnapshot
    && latestSnapshot.itemCount === assets.length
    && latestSnapshot.unitCount === assets.reduce((sum, asset) => sum + asset.quantity, 0)
    && Number.isFinite(snapshotGeneratedTime)
    && snapshotGeneratedTime >= latestAcquisitionTime;
  const snapshotPricesAreCurrent = snapshotHoldingsMatch
    && (!Number.isFinite(latestProviderSourceTime)
      || (Number.isFinite(snapshotFreshnessTime) && snapshotFreshnessTime >= latestProviderSourceTime));
  const snapshotHasValues = snapshotPricesAreCurrent
    && latestSnapshot !== undefined
    && latestSnapshot.marketValue !== null
    && latestSnapshot.acquisitionValue !== null;
  const acceptedSnapshot = snapshotHasValues && latestSnapshot ? latestSnapshot : null;
  const snapshotMatchesHoldings = acceptedSnapshot !== null;
  const snapshotFallbackReason: ResolvedPortfolioValuationV2['snapshotFallbackReason'] = snapshotMatchesHoldings
    ? 'none'
    : !hasCandidateSnapshot
      ? 'not_available'
      : !snapshotHoldingsMatch
        ? 'holdings_changed'
        : !snapshotPricesAreCurrent
          ? 'stale_prices'
          : 'incomplete_snapshot';

  const currentKnownValue = snapshotMatchesHoldings
    ? acceptedSnapshot.marketValue!
    : live.currentKnownValue;
  const acquisitionKnownValue = snapshotMatchesHoldings
    ? acceptedSnapshot.acquisitionValue!
    : live.knownValue;
  const currentPricedQuantity = snapshotMatchesHoldings
    ? acceptedSnapshot.pricedUnitCount
    : live.currentPricedQuantity;
  const acquisitionPricedQuantity = snapshotMatchesHoldings
    ? acceptedSnapshot.acquisitionPricedUnitCount
    : live.pricedQuantity;
  const currentComplete = currentPricedQuantity === totalQuantity;
  const acquisitionComplete = acquisitionPricedQuantity === totalQuantity;
  const growthComplete = currentComplete && acquisitionComplete;
  const absoluteGrowth = growthComplete
    ? currentKnownValue - acquisitionKnownValue
    : null;
  const percentageGrowth = absoluteGrowth !== null && acquisitionKnownValue > 0
    ? (absoluteGrowth / acquisitionKnownValue) * 100
    : null;

  return {
    source: snapshotMatchesHoldings ? 'daily_snapshot' : 'live_holdings',
    acceptedSnapshotDate: snapshotMatchesHoldings ? acceptedSnapshot.date : null,
    snapshotFallbackReason,
    empty: totalQuantity === 0,
    itemCount,
    totalQuantity,
    currentKnownValue,
    currentPricedQuantity,
    currentComplete,
    acquisitionKnownValue,
    acquisitionPricedQuantity,
    acquisitionComplete,
    growthComplete,
    absoluteGrowth,
    percentageGrowth,
  };
}
