import { describe, expect, it } from 'vitest';
import { resolveCardmarketReferenceV8 } from '../domain/cardmarketReferenceV8';

describe('Cardmarket reference presentation v8', () => {
  it('labels a verified trend as an exact-artwork price', () => {
    expect(resolveCardmarketReferenceV8({
      quote: { cardmarket: 12.34 },
      cardmarketProductId: 719_396,
      cardmarketPriceState: 'available',
    })).toEqual({
      state: 'exact',
      displayValue: '12,34 €',
      label: 'Exact artwork',
      detail: 'Verified exact Cardmarket product and official daily trend.',
    });
  });

  it('shows an ambiguous release range without turning it into an exact quote', () => {
    const input = {
      quote: { cardmarket: null },
      cardmarketPriceState: 'ambiguous-artwork' as const,
      cardmarketCandidateExpansionId: 5195,
      cardmarketCandidates: [
        { productId: 719_395, trend: 89.54 },
        { productId: 719_396, trend: 0.22 },
      ],
      cardmarketCandidatePriceRange: {
        minimumTrend: 0.22,
        maximumTrend: 89.54,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    };

    const view = resolveCardmarketReferenceV8(input);

    expect(view).toMatchObject({
      state: 'release-range',
      displayValue: '0,22–89,54 €',
      label: '2 Cardmarket release candidates',
    });
    expect(view.detail).toContain('Selected artwork is not verified');
    expect(view.detail).toContain('excluded from collection value');
    expect(input.quote.cardmarket).toBeNull();
  });

  it('uses one amount when all priced release candidates share a trend', () => {
    const view = resolveCardmarketReferenceV8({
      quote: { cardmarket: null },
      cardmarketPriceState: 'ambiguous-artwork',
      cardmarketCandidatePriceRange: {
        minimumTrend: 4.01,
        maximumTrend: 4.01,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    });

    expect(view.displayValue).toBe('4,01 €');
    expect(view.state).toBe('release-range');
  });

  it('explains an exact product whose daily guide has no trend', () => {
    const view = resolveCardmarketReferenceV8({
      quote: { cardmarket: null },
      cardmarketProductId: 123,
      cardmarketPriceState: 'trend-unavailable',
      cardmarketPriceReason: 'The exact product has no trend in today\'s guide.',
    });

    expect(view).toMatchObject({
      state: 'exact-trend-unavailable',
      displayValue: 'Trend unavailable',
      label: 'Exact artwork · no current trend',
      detail: 'The exact product has no trend in today\'s guide.',
    });
  });

  it('surfaces honest unmapped and not-listed reasons', () => {
    const unmapped = resolveCardmarketReferenceV8({
      // An explicit state wins over any stale numeric field and fails closed.
      quote: { cardmarket: 123.45 },
      cardmarketPriceState: 'unmapped',
      cardmarketPriceReason: 'No artwork-safe mapping is proven for this DON!! design.',
    });
    const notListed = resolveCardmarketReferenceV8({
      quote: { cardmarket: null },
      cardmarketPriceState: 'not-listed',
      cardmarketPriceReason: 'This exact promotional printing is absent from the current catalog.',
    });

    expect(unmapped).toMatchObject({
      displayValue: 'Exact price unavailable',
      label: 'Exact artwork not mapped',
      detail: 'No artwork-safe mapping is proven for this DON!! design.',
    });
    expect(notListed).toMatchObject({
      displayValue: 'Not listed',
      label: 'Not listed on Cardmarket',
      detail: 'This exact promotional printing is absent from the current catalog.',
    });
  });
});
