import { describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import {
  buildMultiPointCurve,
  emptyUserCardPriceHistory,
  extractAssetAveragePrice,
  readStoredCardPriceHistory,
  recordTodayCardPrices,
  writeStoredCardPriceHistory,
  type UserCardPriceHistory,
} from '../domain/cardPriceHistory';

function mockPricing(overrides: {
  cardmarket?: Partial<{ trend: number | null; low: number | null; average: number | null; average1Day: number | null; average7Days: number | null; average30Days: number | null }>;
  usMarket?: Partial<{ market: number | null; inventory: number | null }>;
} = {}) {
  return {
    cardmarket: {
      trend: overrides.cardmarket?.trend ?? null,
      low: overrides.cardmarket?.low ?? null,
      average: overrides.cardmarket?.average ?? null,
      average1Day: overrides.cardmarket?.average1Day ?? null,
      average7Days: overrides.cardmarket?.average7Days ?? null,
      average30Days: overrides.cardmarket?.average30Days ?? null,
    },
    usMarket: {
      market: overrides.usMarket?.market ?? null,
      inventory: overrides.usMarket?.inventory ?? null,
    },
  };
}

function mockAsset(overrides: Partial<DemoAsset> = {}): DemoAsset {
  return {
    id: 'card-1',
    catalogId: 'cat-1',
    kind: 'card',
    name: 'Monkey D. Luffy',
    set: 'Romance Dawn',
    setCode: 'OP01',
    number: 'OP01-001',
    rarity: 'Leader',
    variant: 'Standard',
    language: 'English',
    condition: 'Near Mint',
    quantity: 2,
    addedAt: '2026-08-01T10:00:00.000Z',
    color: 'coral',
    quote: { cardmarket: 10, tcgplayer: 12 },
    change: {
      cardmarket: { '1D': 0, '1W': 0, '1M': 0 },
      tcgplayer: { '1D': 0, '1W': 0, '1M': 0 },
    },
    pricing: mockPricing({
      cardmarket: { trend: 10, average: 9.5 },
      usMarket: { market: 11.5, inventory: 10 },
    }),
    ...overrides,
  };
}

describe('cardPriceHistory', () => {
  describe('extractAssetAveragePrice', () => {
    it('extracts cardmarket average price with proper fallback', () => {
      const assetWithAvg = mockAsset({
        pricing: mockPricing({ cardmarket: { average: 25.5, trend: 20 } }),
      });
      expect(extractAssetAveragePrice(assetWithAvg, 'cardmarket')).toBe(25.5);

      const assetWithTrendOnly = mockAsset({
        pricing: mockPricing({ cardmarket: { trend: 18.0 } }),
        quote: { cardmarket: 15, tcgplayer: 15 },
      });
      expect(extractAssetAveragePrice(assetWithTrendOnly, 'cardmarket')).toBe(18.0);

      const assetWithQuoteOnly = mockAsset({
        pricing: undefined,
        quote: { cardmarket: 14.2, tcgplayer: 15 },
      });
      expect(extractAssetAveragePrice(assetWithQuoteOnly, 'cardmarket')).toBe(14.2);

      const assetNoPrice = mockAsset({
        pricing: undefined,
        quote: { cardmarket: null, tcgplayer: null },
      });
      expect(extractAssetAveragePrice(assetNoPrice, 'cardmarket')).toBe(0);
    });

    it('extracts usMarket average price with fallback to quote', () => {
      const assetWithUsMarket = mockAsset({
        pricing: mockPricing({ usMarket: { market: 30 } }),
        quote: { cardmarket: 20, tcgplayer: 28 },
      });
      expect(extractAssetAveragePrice(assetWithUsMarket, 'tcgplayer')).toBe(30);

      const assetWithQuoteOnly = mockAsset({
        pricing: undefined,
        quote: { cardmarket: 20, tcgplayer: 28 },
      });
      expect(extractAssetAveragePrice(assetWithQuoteOnly, 'tcgplayer')).toBe(28);
    });
  });

  describe('recordTodayCardPrices', () => {
    it('records today card prices and keeps cardmarket and tcgplayer isolated', () => {
      const assets = [
        mockAsset({ id: 'card-1', quantity: 2, pricing: mockPricing({ cardmarket: { average: 10 } }) }),
        mockAsset({ id: 'card-2', quantity: 1, pricing: mockPricing({ cardmarket: { average: 50 } }) }),
      ];

      const history1 = recordTodayCardPrices(undefined, assets, 'cardmarket', '2026-09-11');
      expect(history1.cardmarket['2026-09-11']).toEqual({
        'card-1': 10,
        'card-2': 50,
      });
      expect(history1.tcgplayer).toEqual({});

      // Record tcgplayer for the same day
      const assetsUs = [
        mockAsset({ id: 'card-1', quantity: 2, pricing: mockPricing({ usMarket: { market: 12 } }) }),
      ];
      const history2 = recordTodayCardPrices(history1, assetsUs, 'tcgplayer', '2026-09-11');
      expect(history2.cardmarket['2026-09-11']).toEqual({
        'card-1': 10,
        'card-2': 50,
      });
      expect(history2.tcgplayer['2026-09-11']).toEqual({
        'card-1': 12,
      });
    });

    it('prunes history entries older than 35 days', () => {
      const existing: UserCardPriceHistory = {
        cardmarket: {
          '2026-07-01': { 'card-1': 5 }, // 72 days old
          '2026-08-20': { 'card-1': 8 }, // 22 days old
        },
        tcgplayer: {},
      };

      const updated = recordTodayCardPrices(existing, [mockAsset({ id: 'card-1' })], 'cardmarket', '2026-09-11');
      expect(updated.cardmarket['2026-07-01']).toBeUndefined();
      expect(updated.cardmarket['2026-08-20']).toEqual({ 'card-1': 8 });
      expect(updated.cardmarket['2026-09-11']).toBeDefined();
    });
  });

  describe('buildMultiPointCurve', () => {
    const fixedToday = new Date(2026, 8, 11); // 2026-09-11

    it('returns exactly 2 points for 1D period window', () => {
      const assets = [mockAsset({ id: 'card-1', quantity: 2, pricing: mockPricing({ cardmarket: { average: 15 } }) })];
      const result = buildMultiPointCurve(assets, 'cardmarket', '1D', undefined, fixedToday);

      expect(result.points).toHaveLength(2);
      expect(result.dates).toHaveLength(2);
      expect(result.labels).toHaveLength(2);
      expect(result.dates[0]).toBe('2026-09-10');
      expect(result.dates[1]).toBe('2026-09-11');
      expect(result.labels[0]).toBe('Yesterday');
      expect(result.labels[1]).toBe('Today');
      // Previous date has no history, so evaluates to 0
      expect(result.points[0]).toBe(0);
      // Current date evaluates to average * quantity = 15 * 2 = 30
      expect(result.points[1]).toBe(30);
    });

    it('returns exactly 7 points for 1W period window', () => {
      const assets = [mockAsset({ id: 'card-1', quantity: 1, pricing: mockPricing({ cardmarket: { average: 100 } }) })];
      const result = buildMultiPointCurve(assets, 'cardmarket', '1W', undefined, fixedToday);

      expect(result.points).toHaveLength(7);
      expect(result.dates).toHaveLength(7);
      expect(result.labels).toHaveLength(7);
      expect(result.dates[0]).toBe('2026-09-05');
      expect(result.dates[6]).toBe('2026-09-11');
      expect(result.labels[6]).toBe('Today');
      expect(result.labels[5]).toBe('Yesterday');
      // Unrecorded past days evaluate to 0
      expect(result.points.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(result.points[6]).toBe(100);
    });

    it('returns exactly 30 points for 1M period window', () => {
      const assets = [mockAsset({ id: 'card-1', quantity: 1, pricing: mockPricing({ cardmarket: { average: 50 } }) })];
      const result = buildMultiPointCurve(assets, 'cardmarket', '1M', undefined, fixedToday);

      expect(result.points).toHaveLength(30);
      expect(result.dates).toHaveLength(30);
      expect(result.labels).toHaveLength(30);
      expect(result.dates[29]).toBe('2026-09-11');
      expect(result.labels[29]).toBe('Today');
      // Last point is today's value
      expect(result.points[29]).toBe(50);
      // First point is 29 days before today: 2026-08-13
      expect(result.dates[0]).toBe('2026-08-13');
    });

    it('uses recorded historical prices from user profile history when available', () => {
      const assets = [
        mockAsset({ id: 'card-1', quantity: 2, pricing: mockPricing({ cardmarket: { average: 20 } }) }),
        mockAsset({ id: 'card-2', quantity: 1, pricing: mockPricing({ cardmarket: { average: 40 } }) }),
      ];

      const history: UserCardPriceHistory = {
        cardmarket: {
          '2026-09-09': { 'card-1': 15, 'card-2': 35 },
          '2026-09-10': { 'card-1': 18, 'card-2': 38 },
        },
        tcgplayer: {},
      };

      const result = buildMultiPointCurve(assets, 'cardmarket', '1W', history, fixedToday);
      expect(result.points).toHaveLength(7);
      // Index 4 is 2026-09-09: (15 * 2) + (35 * 1) = 30 + 35 = 65
      expect(result.dates[4]).toBe('2026-09-09');
      expect(result.points[4]).toBe(65);

      // Index 5 is 2026-09-10 (yesterday): (18 * 2) + (38 * 1) = 36 + 38 = 74
      expect(result.dates[5]).toBe('2026-09-10');
      expect(result.points[5]).toBe(74);

      // Index 6 is 2026-09-11 (today): (20 * 2) + (40 * 1) = 40 + 40 = 80
      expect(result.dates[6]).toBe('2026-09-11');
      expect(result.points[6]).toBe(80);

      // Index 0 to 3 are unrecorded, evaluate to 0
      expect(result.points.slice(0, 4)).toEqual([0, 0, 0, 0]);
    });
  });

  describe('storage serialization', () => {
    it('reads and writes to localStorage correctly', () => {
      const store: Record<string, string> = {};
      const mockStorage = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
      } as Storage;

      expect(readStoredCardPriceHistory(mockStorage)).toEqual(emptyUserCardPriceHistory());

      const data: UserCardPriceHistory = {
        cardmarket: { '2026-09-11': { 'card-1': 42 } },
        tcgplayer: { '2026-09-11': { 'card-1': 45 } },
      };

      writeStoredCardPriceHistory(mockStorage, data);
      expect(readStoredCardPriceHistory(mockStorage)).toEqual(data);
    });
  });
});
