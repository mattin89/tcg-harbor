import { describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import {
  MARKET_COMPARISON_LIMIT,
  VERIFIED_TCGPLAYER_PRICE_SOURCE,
  compareCardMarkets,
  sanitizeMarketComparisonPriceFilter,
} from '../domain/marketComparison';

function makeAsset(id: string, overrides: Partial<DemoAsset> = {}): DemoAsset {
  const defaults: DemoAsset = {
    id,
    catalogId: `catalog-${id}`,
    kind: 'card',
    name: `Card ${id}`,
    set: 'Test Set',
    setCode: 'TST',
    number: id,
    rarity: 'Rare',
    variant: 'Base art',
    language: 'English',
    condition: 'Near mint',
    quantity: 0,
    addedAt: '2026-07-19T00:00:00.000Z',
    color: '#000000',
    printingId: `printing-${id}`,
    cardmarketProductId: 100_000,
    tcgplayerProductId: 200_000,
    usPriceSource: VERIFIED_TCGPLAYER_PRICE_SOURCE,
    quote: { cardmarket: 10, tcgplayer: 12 },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null },
    },
  };

  return { ...defaults, ...overrides };
}

describe('compareCardMarkets', () => {
  it('returns the 20 highest and 20 lowest converted price ratios', () => {
    const eurToUsdRate = 1.2;
    const assets = Array.from({ length: 45 }, (_, index) => {
      const ratio = index + 1;
      const id = String(ratio).padStart(2, '0');
      return makeAsset(id, {
        cardmarketProductId: 100_000 + ratio,
        tcgplayerProductId: 200_000 + ratio,
        quote: { cardmarket: 10, tcgplayer: 10 * eurToUsdRate * ratio },
      });
    });
    const inputOrder = assets.map((asset) => asset.id);

    const result = compareCardMarkets(assets, eurToUsdRate);

    expect(result.limit).toBe(MARKET_COMPARISON_LIMIT);
    expect(result.highest).toHaveLength(20);
    expect(result.lowest).toHaveLength(20);
    expect(result.highest.map((row) => row.ratio)).toEqual(
      Array.from({ length: 20 }, (_, index) => 45 - index),
    );
    expect(result.lowest.map((row) => row.ratio)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(result.highest[0]).toMatchObject({
      assetId: '45',
      cardmarketEur: 10,
      cardmarketUsd: 12,
      tcgplayerUsd: 540,
      ratio: 45,
      usPriceSource: VERIFIED_TCGPLAYER_PRICE_SOURCE,
    });
    expect(result.summary).toMatchObject({
      inputAssetCount: 45,
      cardAssetCount: 45,
      eligiblePrintingCount: 45,
      filteredEligiblePrintingCount: 45,
      excludedAssetCount: 0,
      excludedCardPrintingCount: 0,
    });
    expect(assets.map((asset) => asset.id)).toEqual(inputOrder);
  });

  it('uses exact-printing identity as a deterministic tie-breaker', () => {
    const assets = [
      makeAsset('b', { printingId: 'printing-b' }),
      makeAsset('c', { printingId: 'printing-c' }),
      makeAsset('a', { printingId: 'printing-a' }),
    ];

    const first = compareCardMarkets(assets, 1);
    const second = compareCardMarkets([...assets].reverse(), 1);

    expect(first.highest.map((row) => row.assetId)).toEqual(['a', 'b', 'c']);
    expect(first.lowest.map((row) => row.assetId)).toEqual(['a', 'b', 'c']);
    expect(second.highest).toEqual(first.highest);
    expect(second.lowest).toEqual(first.lowest);
  });

  it('requires exact provider IDs and TCGCSV provenance and reports every exclusion', () => {
    const assets = [
      makeAsset('eligible'),
      makeAsset('sealed', { kind: 'sealed' }),
      makeAsset('no-printing', { printingId: undefined }),
      makeAsset('no-cardmarket-id', { cardmarketProductId: undefined }),
      makeAsset('optcg-usd', { usPriceSource: 'OPTCG API', quote: { cardmarket: 10, tcgplayer: 999 } }),
      makeAsset('no-tcgplayer-id', { tcgplayerProductId: undefined }),
      makeAsset('bad-cardmarket-price', { quote: { cardmarket: 0, tcgplayer: 12 } }),
      makeAsset('bad-tcgplayer-price', { quote: { cardmarket: 10, tcgplayer: null } }),
      makeAsset('overflow-after-fx', { quote: { cardmarket: Number.MAX_VALUE, tcgplayer: 12 } }),
    ];

    const result = compareCardMarkets(assets, 2);

    expect(result.highest.map((row) => row.assetId)).toEqual(['eligible']);
    expect(result.lowest.map((row) => row.assetId)).toEqual(['eligible']);
    expect(result.summary).toEqual({
      inputAssetCount: 9,
      cardAssetCount: 8,
      eligiblePrintingCount: 1,
      filteredEligiblePrintingCount: 1,
      excludedAssetCount: 8,
      excludedCardPrintingCount: 7,
      exclusionCounts: {
        'not-card': 1,
        'missing-printing-id': 1,
        'missing-cardmarket-product-id': 1,
        'unverified-tcgplayer-source': 1,
        'missing-tcgplayer-product-id': 1,
        'invalid-cardmarket-price': 1,
        'invalid-tcgplayer-price': 1,
        'invalid-derived-ratio': 1,
      },
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid EUR to USD rate %s',
    (rate) => {
      expect(() => compareCardMarkets([makeAsset('card')], rate)).toThrow(RangeError);
    },
  );

  it('filters by the inclusive Cardmarket EUR range before ranking either top 20', () => {
    const assets = Array.from({ length: 30 }, (_, index) => {
      const cardmarketEur = index + 1;
      const ratio = 31 - cardmarketEur;
      return makeAsset(String(cardmarketEur).padStart(2, '0'), {
        cardmarketProductId: 100_000 + cardmarketEur,
        tcgplayerProductId: 200_000 + cardmarketEur,
        quote: { cardmarket: cardmarketEur, tcgplayer: cardmarketEur * ratio },
      });
    });

    const result = compareCardMarkets(assets, 1, {
      minCardmarketEur: 10,
      maxCardmarketEur: 15,
    });

    expect(result.priceFilter).toEqual({
      minCardmarketEur: 10,
      maxCardmarketEur: 15,
      error: null,
    });
    expect(result.highest.map((row) => row.cardmarketEur)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(result.lowest.map((row) => row.cardmarketEur)).toEqual([15, 14, 13, 12, 11, 10]);
    expect(result.summary.eligiblePrintingCount).toBe(30);
    expect(result.summary.filteredEligiblePrintingCount).toBe(6);
  });

  it('refills both top-20 rankings from the complete filtered pool', () => {
    const assets = Array.from({ length: 60 }, (_, index) => {
      const cardmarketEur = index + 1;
      const ratio = cardmarketEur;
      return makeAsset(String(cardmarketEur).padStart(2, '0'), {
        cardmarketProductId: 300_000 + cardmarketEur,
        tcgplayerProductId: 400_000 + cardmarketEur,
        quote: { cardmarket: cardmarketEur, tcgplayer: cardmarketEur * ratio },
      });
    });

    const result = compareCardMarkets(assets, 1, {
      minCardmarketEur: 21,
      maxCardmarketEur: 50,
    });

    expect(result.summary.filteredEligiblePrintingCount).toBe(30);
    expect(result.highest).toHaveLength(20);
    expect(result.lowest).toHaveLength(20);
    expect(result.highest.map((row) => row.cardmarketEur)).toEqual(
      Array.from({ length: 20 }, (_, index) => 50 - index),
    );
    expect(result.lowest.map((row) => row.cardmarketEur)).toEqual(
      Array.from({ length: 20 }, (_, index) => 21 + index),
    );
  });

  it('rebuilds both rankings from scratch when only a minimum price is set', () => {
    const assets = Array.from({ length: 60 }, (_, index) => {
      const cardmarketEur = index + 1;
      const ratio = 61 - cardmarketEur;
      return makeAsset(`minimum-${cardmarketEur}`, {
        cardmarketProductId: 500_000 + cardmarketEur,
        tcgplayerProductId: 600_000 + cardmarketEur,
        quote: { cardmarket: cardmarketEur, tcgplayer: cardmarketEur * ratio },
      });
    });

    const unfiltered = compareCardMarkets(assets, 1);
    const filtered = compareCardMarkets(assets, 1, { minCardmarketEur: 21 });

    expect(unfiltered.highest.map((row) => row.cardmarketEur)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(filtered.summary.filteredEligiblePrintingCount).toBe(40);
    expect(filtered.highest.map((row) => row.cardmarketEur)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
    expect(filtered.lowest.map((row) => row.cardmarketEur)).toEqual(
      Array.from({ length: 20 }, (_, index) => 60 - index),
    );
  });

  it('sanitizes empty and localized decimal bounds without mutating the inputs', () => {
    const filters = {
      minCardmarketEur: ' 1,25 ',
      maxCardmarketEur: '  ',
    } as const;

    const sanitized = sanitizeMarketComparisonPriceFilter(filters);

    expect(sanitized).toEqual({
      minCardmarketEur: 1.25,
      maxCardmarketEur: null,
      error: null,
    });
    expect(filters).toEqual({ minCardmarketEur: ' 1,25 ', maxCardmarketEur: '  ' });
  });

  it.each([
    [{ minCardmarketEur: -1 }, 'invalid-minimum'],
    [{ minCardmarketEur: '€1' }, 'invalid-minimum'],
    [{ maxCardmarketEur: Number.POSITIVE_INFINITY }, 'invalid-maximum'],
    [{ maxCardmarketEur: '1,000.00' }, 'invalid-maximum'],
  ] as const)('reports and safely suppresses an invalid price filter: %o', (filters, error) => {
    const result = compareCardMarkets([makeAsset('card')], 1, filters);

    expect(result.priceFilter.error).toBe(error);
    expect(result.summary.eligiblePrintingCount).toBe(1);
    expect(result.summary.filteredEligiblePrintingCount).toBe(0);
    expect(result.highest).toEqual([]);
    expect(result.lowest).toEqual([]);
  });

  it('reports an inverted price range instead of silently swapping its bounds', () => {
    const result = compareCardMarkets([makeAsset('card')], 1, {
      minCardmarketEur: '20',
      maxCardmarketEur: '10',
    });

    expect(result.priceFilter).toEqual({
      minCardmarketEur: 20,
      maxCardmarketEur: 10,
      error: 'minimum-exceeds-maximum',
    });
    expect(result.summary.filteredEligiblePrintingCount).toBe(0);
    expect(result.highest).toEqual([]);
    expect(result.lowest).toEqual([]);
  });
});
