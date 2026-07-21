import { describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import {
  resolvePortfolioValuationV2,
  type DailyValuationCandidateV2,
} from '../domain/portfolioValuationV2';

function holding(overrides: Partial<DemoAsset> = {}): DemoAsset {
  return {
    id: 'holding-1',
    catalogId: 'catalog-1',
    kind: 'card',
    name: 'Test card',
    set: 'Test set',
    setCode: 'OP01',
    number: 'OP01-001',
    rarity: 'Rare',
    variant: 'Standard',
    language: 'English',
    condition: 'Near Mint',
    quantity: 2,
    addedAt: '2026-07-01T10:00:00.000Z',
    color: 'coral',
    quote: { cardmarket: 15, tcgplayer: 18 },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null },
    },
    acquisitionLots: [{
      id: 'lot-1',
      addedAt: '2026-07-01T10:00:00.000Z',
      quantity: 2,
      quoteAtAdd: { cardmarket: 10, tcgplayer: 12 },
    }],
    ...overrides,
  };
}

function daily(overrides: Partial<DailyValuationCandidateV2> = {}): DailyValuationCandidateV2 {
  return {
    provider: 'cardmarket',
    date: '2026-07-20',
    marketValue: 30,
    acquisitionValue: 20,
    itemCount: 1,
    unitCount: 2,
    pricedUnitCount: 2,
    acquisitionPricedUnitCount: 2,
    generatedAt: '2026-07-20T02:00:00.000Z',
    ...overrides,
  };
}

describe('portfolio valuation v2', () => {
  it('rejects a stale daily aggregate after the loaded quantity changes', () => {
    const result = resolvePortfolioValuationV2(
      [holding()],
      [daily({ unitCount: 1, marketValue: 999, acquisitionValue: 998 })],
      'cardmarket',
      'all',
    );

    expect(result.source).toBe('live_holdings');
    expect(result.acceptedSnapshotDate).toBeNull();
    expect(result.currentKnownValue).toBe(30);
    expect(result.acquisitionKnownValue).toBe(20);
  });

  it('requires both item and unit counts to match before accepting a daily aggregate', () => {
    const result = resolvePortfolioValuationV2(
      [holding()],
      [daily({ itemCount: 2, marketValue: 999 })],
      'cardmarket',
      'all',
    );

    expect(result.source).toBe('live_holdings');
    expect(result.currentKnownValue).toBe(30);
  });

  it('rejects a same-count aggregate generated before the latest acquisition', () => {
    const result = resolvePortfolioValuationV2(
      [holding({
        addedAt: '2026-07-20T03:00:00.000Z',
        acquisitionLots: [{
          id: 'lot-later',
          addedAt: '2026-07-20T03:00:00.000Z',
          quantity: 2,
          quoteAtAdd: { cardmarket: 10, tcgplayer: 12 },
        }],
      })],
      [daily({ marketValue: 999, acquisitionValue: 998 })],
      'cardmarket',
      'all',
    );

    expect(result.source).toBe('live_holdings');
    expect(result.currentKnownValue).toBe(30);
  });

  it('rejects a same-count daily aggregate older than the current provider source', () => {
    const result = resolvePortfolioValuationV2(
      [holding({
        sourceUpdatedAt: {
          cardmarket: '2026-07-21T02:45:28+02:00',
          optcg: '2026-07-21T00:00:00.000Z',
          tcgcsv: '2026-07-20T20:05:24.000Z',
        },
      })],
      [daily({
        marketValue: 999,
        acquisitionValue: 998,
        sourceObservedAt: '2026-07-20T02:45:28+02:00',
      })],
      'cardmarket',
      'all',
    );

    expect(result.source).toBe('live_holdings');
    expect(result.snapshotFallbackReason).toBe('stale_prices');
    expect(result.currentKnownValue).toBe(30);
    expect(result.acquisitionKnownValue).toBe(20);
  });

  it('keeps current and acquisition coverage separate for a matching partial snapshot', () => {
    const result = resolvePortfolioValuationV2(
      [holding()],
      [daily({ marketValue: 15, pricedUnitCount: 1, acquisitionPricedUnitCount: 2 })],
      'cardmarket',
      'all',
    );

    expect(result.source).toBe('daily_snapshot');
    expect(result.snapshotFallbackReason).toBe('none');
    expect(result.currentPricedQuantity).toBe(1);
    expect(result.acquisitionPricedQuantity).toBe(2);
    expect(result.currentComplete).toBe(false);
    expect(result.acquisitionComplete).toBe(true);
    expect(result.absoluteGrowth).toBeNull();
  });

  it('returns a zero-safe live valuation for an empty portfolio', () => {
    const result = resolvePortfolioValuationV2(
      [],
      [daily({ itemCount: 0, unitCount: 0, marketValue: 0, acquisitionValue: 0, pricedUnitCount: 0, acquisitionPricedUnitCount: 0 })],
      'cardmarket',
      'all',
    );

    expect(result).toMatchObject({
      source: 'live_holdings',
      empty: true,
      itemCount: 0,
      totalQuantity: 0,
      currentKnownValue: 0,
      acquisitionKnownValue: 0,
      absoluteGrowth: 0,
      percentageGrowth: null,
    });
  });
});
