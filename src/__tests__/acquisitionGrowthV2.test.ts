import { describe, expect, it } from 'vitest';
import { summarizeAcquisitionBasis, summarizePortfolioGrowth } from '../domain/acquisitionGrowthV2';
import type { DemoAsset } from '../data/demo';

function asset(overrides: Partial<DemoAsset> = {}): DemoAsset {
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
    acquisitionLots: [
      {
        id: 'lot-old',
        addedAt: '2026-07-01T10:00:00.000Z',
        quantity: 2,
        quoteAtAdd: { cardmarket: 10, tcgplayer: 12 },
      },
      {
        id: 'lot-new',
        addedAt: '2026-07-10T10:00:00.000Z',
        quantity: 1,
        quoteAtAdd: { cardmarket: 12, tcgplayer: 14 },
      },
    ],
    ...overrides,
  };
}

describe('acquisition growth v2', () => {
  it('keeps newest lots after a FIFO removal', () => {
    const summary = summarizeAcquisitionBasis([asset()], 'cardmarket');
    expect(summary).toMatchObject({
      value: 22,
      knownValue: 22,
      totalQuantity: 2,
      pricedQuantity: 2,
      complete: true,
    });
  });

  it('calculates growth from acquisition-time market references', () => {
    const summary = summarizePortfolioGrowth([asset()], 'cardmarket');
    expect(summary.currentKnownValue).toBe(30);
    expect(summary.absoluteGrowth).toBe(8);
    expect(summary.percentageGrowth).toBeCloseTo(36.3636, 3);
  });

  it('does not turn missing prices into zero growth', () => {
    const withMissingReference = asset({
      acquisitionLots: [{
        id: 'missing',
        addedAt: '2026-07-10T10:00:00.000Z',
        quantity: 2,
        quoteAtAdd: { cardmarket: null, tcgplayer: 14 },
      }],
    });
    const summary = summarizePortfolioGrowth([withMissingReference], 'cardmarket');
    expect(summary.complete).toBe(false);
    expect(summary.value).toBeNull();
    expect(summary.absoluteGrowth).toBeNull();
    expect(summary.percentageGrowth).toBeNull();
  });
});
