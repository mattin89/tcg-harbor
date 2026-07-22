import { describe, expect, it } from 'vitest';
import {
  resolveCardmarketArtworkReferenceV10,
  resolveCatalogCardmarketReferenceV10,
  type CatalogCardmarketAssetV10,
} from '../domain/cardmarketSearchReferenceV10';

function artwork(overrides: Partial<CatalogCardmarketAssetV10> = {}): CatalogCardmarketAssetV10 {
  return {
    id: 'regular',
    kind: 'card',
    variant: 'Standard',
    setCode: 'OP03',
    number: 'OP03-018',
    rulesCardId: 'OP03-018',
    sourcePrintingId: 'OP03-018',
    cardmarketProductId: null,
    cardmarketPriceState: 'ambiguous-artwork',
    quote: { cardmarket: null },
    cardmarketCandidatePriceRange: {
      minimumTrend: 0.19,
      maximumTrend: 16.84,
      pricedCandidates: 2,
      totalCandidates: 2,
    },
    ...overrides,
  };
}

const reference = (productId: number, trend: number) => ({
  productId,
  expansionId: 5364,
  trend,
  matchPolicy: 'cardmarket-image-correlation-v2-complete-candidates' as const,
  candidateCount: 2,
  evidence: 'Exact source and Cardmarket artwork images passed the frozen match policy.',
});

describe('per-art Cardmarket references v10', () => {
  it('shows the image-verified regular and alternate amounts on their own artwork rows', () => {
    const regular = artwork({
      cardmarketProductId: 719388,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.19 },
      cardmarketArtworkReference: reference(719388, 0.19),
    });
    const alternate = artwork({
      id: 'alternate',
      variant: 'Alternate art · P1',
      sourcePrintingId: 'OP03-018_p1',
      cardmarketProductId: 719387,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 16.84 },
      cardmarketArtworkReference: reference(719387, 16.84),
    });

    expect(resolveCardmarketArtworkReferenceV10(regular)).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,19 €',
      label: 'Regular art · image verified',
    });
    expect(resolveCardmarketArtworkReferenceV10(alternate)).toMatchObject({
      state: 'artwork-image-reference',
      displayValue: '16,84 €',
      label: 'Exact art · image verified',
    });
    expect(regular.quote.cardmarket).toBe(0.19);
    expect(alternate.quote.cardmarket).toBe(16.84);
  });

  it('keeps a grouped search result on the regular-art amount', () => {
    const regular = artwork({
      cardmarketProductId: 719388,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.19 },
      cardmarketArtworkReference: reference(719388, 0.19),
    });
    const alternate = artwork({
      id: 'alternate',
      variant: 'Alternate art · P1',
      sourcePrintingId: 'OP03-018_p1',
      cardmarketProductId: 719387,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 16.84 },
      cardmarketArtworkReference: reference(719387, 16.84),
    });

    expect(resolveCatalogCardmarketReferenceV10(alternate, [alternate, regular])).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,19 €',
      sourceAssetId: 'regular',
    });
  });

  it('never uses the low or high end when an artwork image match is absent', () => {
    const view = resolveCardmarketArtworkReferenceV10(artwork({
      variant: 'Alternate art · P1',
      sourcePrintingId: 'OP03-018_p1',
    }));

    expect(view).toMatchObject({
      state: 'artwork-unverified',
      displayValue: 'Exact price unavailable',
    });
    expect(view.displayValue).not.toMatch(/0,19|16,84|–/);
  });

  it('labels sealed prices as exact products rather than artwork', () => {
    expect(resolveCardmarketArtworkReferenceV10({
      kind: 'sealed',
      quote: { cardmarket: 5.89 },
      cardmarketProductId: 750070,
      cardmarketPriceState: 'available',
    })).toMatchObject({
      state: 'exact',
      displayValue: '5,89 €',
      label: 'Exact product',
    });
  });
});
