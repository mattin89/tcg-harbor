import { describe, expect, it } from 'vitest';
import {
  resolveCardmarketArtworkReferenceV9,
  resolveCatalogCardmarketReferenceV9,
  type CatalogCardmarketAssetV9,
} from '../domain/cardmarketSearchReferenceV9';

function card(overrides: Partial<CatalogCardmarketAssetV9> = {}): CatalogCardmarketAssetV9 {
  return {
    id: 'regular',
    kind: 'card',
    variant: 'Standard',
    setCode: 'OP01',
    number: 'OP01-001',
    rulesCardId: 'OP01-001',
    sourcePrintingId: 'OP01-001',
    cardmarketProductId: 100,
    cardmarketPriceState: 'available',
    quote: { cardmarket: 0.22 },
    ...overrides,
  };
}

describe('catalog Cardmarket regular-art reference v9', () => {
  it('shows one exact regular-art amount for a grouped search row', () => {
    const regular = card();
    expect(resolveCatalogCardmarketReferenceV9(regular, [regular])).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,22 €',
      label: 'Regular art · exact trend',
      sourceAssetId: 'regular',
    });
  });

  it('uses the original regular-art sibling instead of an alternate-art range', () => {
    const regular = card();
    const alternate = card({
      id: 'alternate',
      variant: 'Alternate art · P1',
      sourcePrintingId: 'OP01-001_p1',
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketCandidatePriceRange: {
        minimumTrend: 0.02,
        maximumTrend: 90,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    });

    const view = resolveCatalogCardmarketReferenceV9(alternate, [alternate, regular]);
    expect(view).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,22 €',
      sourceAssetId: 'regular',
    });
    expect(view.detail).toContain('selected alternative art');
    expect(view.displayValue).not.toContain('–');
    expect(alternate.quote.cardmarket).toBeNull();
  });

  it('shows an image-verified regular price without promoting it to an exact quote', () => {
    const regular = card({
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketRegularArtReference: {
        productId: 719388,
        expansionId: 5364,
        trend: 0.17,
        matchPolicy: 'cardmarket-image-correlation-v1',
        evidence: 'Verified image fixture',
      },
    });

    expect(resolveCatalogCardmarketReferenceV9(regular, [regular])).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,17 €',
      label: 'Regular art · image verified',
    });
    expect(regular.quote.cardmarket).toBeNull();
  });

  it('never infers a regular price from ambiguous candidates', () => {
    const regular = card({
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketCandidates: [
        { productId: 1, trend: 0.02 },
        { productId: 2, trend: 90 },
      ],
      cardmarketCandidatePriceRange: {
        minimumTrend: 0.02,
        maximumTrend: 90,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    });
    const view = resolveCatalogCardmarketReferenceV9(regular, [regular]);

    expect(view).toMatchObject({
      state: 'regular-unavailable',
      displayValue: 'Price unavailable',
      label: 'Regular art not verified',
    });
    expect(view.displayValue).not.toMatch(/0,02|90|–/);
  });

  it('prefers the origin release when a later Standard reprint reuses the source identity', () => {
    const original = card({ id: 'original', setCode: 'OP10', number: 'OP10-063', rulesCardId: 'OP10-063', sourcePrintingId: 'OP10-063', quote: { cardmarket: 0.4 } });
    const reprint = card({ id: 'reprint', setCode: 'PRB02', number: 'OP10-063', rulesCardId: 'OP10-063', sourcePrintingId: 'OP10-063', quote: { cardmarket: 2.5 } });

    expect(resolveCatalogCardmarketReferenceV9(reprint, [reprint, original])).toMatchObject({
      displayValue: '0,40 €',
      sourceAssetId: 'original',
    });
  });

  it('coalesces duplicate source rows only when their verified regular reference agrees', () => {
    const reference = {
      productId: 857292,
      expansionId: 6187,
      trend: 0.18,
      matchPolicy: 'cardmarket-image-correlation-v1' as const,
      evidence: 'same normalized artwork',
    };
    const first = card({
      id: 'duplicate-b',
      setCode: 'OP13',
      number: 'OP13-084',
      rulesCardId: 'OP13-084',
      sourcePrintingId: 'OP13-084',
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketRegularArtReference: reference,
    });
    const second = card({ ...first, id: 'duplicate-a' });

    expect(resolveCatalogCardmarketReferenceV9(first, [first, second])).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,18 €',
      sourceAssetId: 'duplicate-a',
    });
    expect(resolveCatalogCardmarketReferenceV9(first, [
      first,
      card({
        ...second,
        cardmarketRegularArtReference: { ...reference, productId: 999999 },
      }),
    ])).toMatchObject({ state: 'regular-unavailable' });
  });

  it('suppresses release ranges in exact-art details', () => {
    const view = resolveCardmarketArtworkReferenceV9(card({
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketCandidatePriceRange: {
        minimumTrend: 0.02,
        maximumTrend: 90,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    }));

    expect(view).toMatchObject({
      state: 'artwork-unverified',
      displayValue: 'Exact price unavailable',
      label: 'Artwork match not verified',
    });
    expect(view.displayValue).not.toContain('–');
  });

  it('keeps the image-verified Standard price visible in details without creating a quote', () => {
    const regular = card({
      cardmarketProductId: null,
      cardmarketPriceState: 'ambiguous-artwork',
      quote: { cardmarket: null },
      cardmarketRegularArtReference: {
        productId: 719388,
        expansionId: 5364,
        trend: 0.17,
        matchPolicy: 'cardmarket-image-correlation-v1',
        evidence: 'Verified image fixture',
      },
    });
    expect(resolveCardmarketArtworkReferenceV9(regular)).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,17 €',
    });
    expect(regular.quote.cardmarket).toBeNull();
  });

  it('delegates sealed pricing to the exact-product resolver', () => {
    const sealed = card({ id: 'box', kind: 'sealed', variant: 'English release', setCode: 'OP01' });
    expect(resolveCatalogCardmarketReferenceV9(sealed, [sealed])).toMatchObject({
      state: 'sealed',
      displayValue: '0,22 €',
      sourceAssetId: 'box',
    });
  });

  it('never renders a range for an ambiguous sealed search result', () => {
    const sealed = card({
      id: 'box',
      kind: 'sealed',
      variant: 'English release',
      setCode: 'OP01',
      cardmarketProductId: null,
      quote: { cardmarket: null },
      cardmarketPriceState: 'ambiguous-artwork',
      cardmarketCandidatePriceRange: {
        minimumTrend: 12,
        maximumTrend: 120,
        pricedCandidates: 2,
        totalCandidates: 2,
      },
    });
    expect(resolveCatalogCardmarketReferenceV9(sealed, [sealed])).toMatchObject({
      state: 'sealed',
      displayValue: 'Exact price unavailable',
    });
  });
});
