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

  it('reports exact prices for promo-only groups without inventing a regular art', () => {
    const firstPromo = artwork({
      id: 'promo-one',
      variant: 'Participant promo',
      setCode: 'P',
      number: 'P-041',
      rulesCardId: 'P-041',
      sourcePrintingId: 'tcgplayer:1',
      cardmarketProductId: 750655,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 19.69 },
    });
    const secondPromo = artwork({
      id: 'promo-two',
      variant: 'Winner promo',
      setCode: 'P',
      number: 'P-041',
      rulesCardId: 'P-041',
      sourcePrintingId: 'tcgplayer:2',
      cardmarketProductId: 766648,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 895.95 },
    });

    expect(resolveCatalogCardmarketReferenceV10(firstPromo, [firstPromo, secondPromo])).toMatchObject({
      state: 'art-selection-required',
      displayValue: 'Choose art',
      label: '2 exact-art prices',
      sourceAssetId: null,
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

  it('shows a verified lowest offer when Cardmarket has no trend without valuing the card', () => {
    const exactWithoutTrend = artwork({
      cardmarketProductId: 852787,
      cardmarketPriceState: 'trend-unavailable',
      quote: { cardmarket: null },
      pricing: {
        cardmarket: { low: 36500 },
      },
    });

    expect(resolveCardmarketArtworkReferenceV10(exactWithoutTrend)).toMatchObject({
      state: 'exact-low-offer',
      displayValue: '36.500,00 €',
      label: 'Regular art · lowest offer',
    });
    expect(resolveCatalogCardmarketReferenceV10(exactWithoutTrend, [exactWithoutTrend]))
      .toMatchObject({
        state: 'regular-low-offer',
        displayValue: '36.500,00 €',
      });
    expect(exactWithoutTrend.quote.cardmarket).toBeNull();
  });

  it('does not invent a fallback when an exact product has neither trend nor offer', () => {
    const exactWithoutMarket = artwork({
      cardmarketProductId: 884452,
      cardmarketPriceState: 'trend-unavailable',
      quote: { cardmarket: null },
    });

    expect(resolveCardmarketArtworkReferenceV10(exactWithoutMarket)).toMatchObject({
      state: 'exact-trend-unavailable',
      displayValue: 'Trend unavailable',
    });
  });

  it('shares Western release price trend between English and French standard printings', () => {
    const englishCanonical = artwork({
      id: 'card-optcg-2986bfd8f107757577dc',
      name: '"Buddha" Sengoku',
      setCode: 'OP16',
      number: 'OP16-077',
      rulesCardId: 'OP16-077',
      sourcePrintingId: 'OP16-077',
      variant: 'Standard',
      language: 'English',
      cardmarketProductId: 890771,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.14 },
    });

    const frenchPrinting = artwork({
      id: 'card-multilingual-fr-op16-077',
      name: '"Buddha" Sengoku',
      setCode: 'OP16-FR',
      number: 'OP16-077',
      rulesCardId: 'OP16-077',
      variant: 'Standard',
      language: 'French',
      cardmarketProductId: 890771,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.14 },
    });

    const siblings = [frenchPrinting, englishCanonical];

    // Standard cards in the same Western version share the verified regular art trend
    const searchView = resolveCatalogCardmarketReferenceV10(frenchPrinting, siblings);
    expect(searchView).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,14 €',
    });

    // Detail view reports exact trend
    const detailView = resolveCardmarketArtworkReferenceV10(frenchPrinting, siblings);
    expect(detailView).toMatchObject({
      state: 'exact',
      displayValue: '0,14 €',
    });
  });

  it('reports native Cardmarket price for Asian printings (Japanese, Korean, Chinese EB01-050 at 0.02 €) without mirroring English (0.13 €)', () => {
    const englishCanonical = artwork({
      id: 'card-optcg-433974100459a2a2d300',
      name: '...I Want to Live!!',
      setCode: 'EB01',
      number: 'EB01-050',
      rulesCardId: 'EB01-050',
      sourcePrintingId: 'EB01-050',
      variant: 'Standard',
      language: 'English',
      cardmarketProductId: 768017,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.13 },
    });

    const japanesePrinting = artwork({
      id: 'card-multilingual-jp-eb01-050',
      name: '...I Want to Live!!',
      setCode: 'EB01-JP',
      number: 'EB01-050',
      rulesCardId: 'EB01-050',
      variant: 'Standard',
      language: 'Japanese',
      cardmarketProductId: 754216,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.02 },
    });

    const koreanPrinting = artwork({
      id: 'card-multilingual-kr-eb01-050',
      name: '...I Want to Live!!',
      setCode: 'EB01-KR',
      number: 'EB01-050',
      rulesCardId: 'EB01-050',
      variant: 'Standard',
      language: 'Korean',
      cardmarketProductId: 754216,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.02 },
    });

    const chinesePrinting = artwork({
      id: 'card-multilingual-cn-eb01-050',
      name: '...I Want to Live!!',
      setCode: 'EB01-CN',
      number: 'EB01-050',
      rulesCardId: 'EB01-050',
      variant: 'Standard',
      language: 'Chinese',
      cardmarketProductId: 754216,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.02 },
    });

    const siblings = [japanesePrinting, koreanPrinting, chinesePrinting, englishCanonical];

    // Japanese Asian version search and detail resolve to 0.02 €
    expect(resolveCatalogCardmarketReferenceV10(japanesePrinting, siblings)).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,02 €',
      sourceAssetId: 'card-multilingual-jp-eb01-050',
    });
    expect(resolveCardmarketArtworkReferenceV10(japanesePrinting, siblings)).toMatchObject({
      state: 'exact',
      displayValue: '0,02 €',
    });

    // Korean Asian version search and detail resolve to 0.02 €
    expect(resolveCatalogCardmarketReferenceV10(koreanPrinting, siblings)).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,02 €',
    });
    expect(resolveCardmarketArtworkReferenceV10(koreanPrinting, siblings)).toMatchObject({
      state: 'exact',
      displayValue: '0,02 €',
    });

    // Chinese Asian version search and detail resolve to 0.02 €
    expect(resolveCatalogCardmarketReferenceV10(chinesePrinting, siblings)).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,02 €',
    });
    expect(resolveCardmarketArtworkReferenceV10(chinesePrinting, siblings)).toMatchObject({
      state: 'exact',
      displayValue: '0,02 €',
    });
  });

  it('keeps language-exclusive cards (such as Treasure Cup cards) isolated without borrowing regular art trends', () => {
    const regularEnglish = artwork({
      id: 'card-optcg-zoro-standard',
      name: 'Roronoa Zoro',
      setCode: 'OP01',
      number: 'OP01-025',
      rulesCardId: 'OP01-025',
      sourcePrintingId: 'OP01-025',
      variant: 'Standard',
      language: 'English',
      cardmarketProductId: 690835,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.15 },
    });

    const treasureCupZoro = artwork({
      id: 'card-tcgplayer-515356',
      name: 'Roronoa Zoro (025)',
      setCode: 'OP01',
      number: 'OP01-025',
      rulesCardId: 'OP01-025',
      variant: 'Promotional art · Treasure Cup · TCGplayer #515356',
      language: 'English',
      cardmarketProductId: null,
      cardmarketPriceState: 'unmapped',
      quote: { cardmarket: null },
    });

    const siblings = [regularEnglish, treasureCupZoro];

    // Detail view for the exclusive card stays unmapped and does not borrow 0.15 €
    const detailView = resolveCardmarketArtworkReferenceV10(treasureCupZoro, siblings);
    expect(detailView).toMatchObject({
      state: 'unmapped',
      displayValue: 'Exact price unavailable',
    });
  });

  it('never falls back to regular art trend for unmapped alternate arts even with siblings', () => {
    const englishCanonical = artwork({
      id: 'card-optcg-2986bfd8f107757577dc',
      name: '"Buddha" Sengoku',
      setCode: 'OP16',
      number: 'OP16-077',
      rulesCardId: 'OP16-077',
      sourcePrintingId: 'OP16-077',
      variant: 'Standard',
      language: 'English',
      cardmarketProductId: 890771,
      cardmarketPriceState: 'available',
      quote: { cardmarket: 0.14 },
    });

    const alternateArt = artwork({
      id: 'alternate-unmapped',
      name: '"Buddha" Sengoku',
      setCode: 'OP16',
      number: 'OP16-077',
      rulesCardId: 'OP16-077',
      variant: 'Alternate art · Parallel',
      cardmarketProductId: null,
      cardmarketPriceState: 'unmapped',
      quote: { cardmarket: null },
    });

    const view = resolveCardmarketArtworkReferenceV10(alternateArt, [alternateArt, englishCanonical]);
    expect(view).toMatchObject({
      state: 'unmapped',
      displayValue: 'Exact price unavailable',
    });
  });
});
