import { describe, expect, it } from 'vitest';
import { catalogAssets, initialAssets, marketDataMeta, stores } from '../data/demo';

type CatalogAsset = (typeof catalogAssets)[number];
type PromoAsset = CatalogAsset & {
  languageEvidence?: string;
  tcgplayerPriceState?: 'available' | 'market-unavailable' | 'unavailable' | 'multiple-subtypes';
  pricing?: NonNullable<CatalogAsset['pricing']> & {
    usMarket: NonNullable<CatalogAsset['pricing']>['usMarket'] & {
      variants?: Array<{
        subtype: string | null;
        market: number | null;
        low: number | null;
        mid: number | null;
        high: number | null;
        directLow: number | null;
      }>;
    };
  };
};

function promoCards(): PromoAsset[] {
  return catalogAssets.filter((asset) => asset.id.startsWith('card-tcgplayer-')) as PromoAsset[];
}

function percentAgainst(current: number | null, comparison: number | null): number | null {
  if (current === null || comparison === null || comparison === 0) return null;
  return Number((((current - comparison) / comparison) * 100).toFixed(2));
}

describe('source-backed catalog snapshot', () => {
  it('keeps the owned collection separate from the complete searchable catalog', () => {
    expect(initialAssets).toHaveLength(40);
    expect(catalogAssets.length).toBeGreaterThan(5_500);
    expect(initialAssets.every((asset) => asset.kind === 'card')).toBe(true);
    expect(initialAssets.every((asset) => asset.language === 'English')).toBe(true);

    const catalogIds = new Set(catalogAssets.map((asset) => asset.id));
    expect(catalogIds.size).toBe(catalogAssets.length);
    for (const asset of initialAssets) {
      expect(catalogIds.has(asset.id)).toBe(true);
      expect(asset.catalogId).toBe(asset.id);
      expect(asset.acquisitionLots).toHaveLength(1);
      expect(asset.acquisitionLots?.[0]).toMatchObject({
        quantity: asset.quantity,
        quoteAtAdd: asset.quote,
      });
      expect(Number.isNaN(Date.parse(asset.acquisitionLots?.[0].addedAt ?? ''))).toBe(false);
    }
  });

  it('contains the complete core and numbered-promo printing catalog', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    expect(marketDataMeta.catalogCounts.cardPrintings).toBe(5_349);
    expect(cards).toHaveLength(marketDataMeta.catalogCounts.cardPrintings);
    expect(cards).toHaveLength(
      marketDataMeta.catalogCounts.optcgCorePrintings
      + marketDataMeta.catalogCounts.tcgcsvNumberedPromoProducts,
    );
    expect(cards.every((asset) => asset.rulesCardId && asset.printingId)).toBe(true);
  });

  it('has 5,342 sourced images and exactly seven explicitly unavailable images', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    const available = cards.filter((asset) => asset.imageState === 'available');
    const unavailable = cards.filter((asset) => asset.imageState === 'unavailable');

    expect(marketDataMeta.catalogCounts.cardPrintingsWithImages).toBe(5_342);
    expect(marketDataMeta.catalogCounts.cardPrintingsWithoutImages).toBe(7);
    expect(available).toHaveLength(marketDataMeta.catalogCounts.cardPrintingsWithImages);
    expect(unavailable).toHaveLength(marketDataMeta.catalogCounts.cardPrintingsWithoutImages);
    expect(available.every((asset) => asset.imageUrl?.startsWith('http'))).toBe(true);
    expect(unavailable.every((asset) => !asset.imageUrl && asset.imageUnavailableReason)).toBe(true);
    expect(cards.every((asset) => asset.imageState === 'available' || asset.imageState === 'unavailable')).toBe(true);

    const unavailableTcgplayerIds = unavailable
      .map((asset) => asset.tcgplayerProductId)
      .filter((productId): productId is number => typeof productId === 'number')
      .sort((left, right) => left - right);
    expect(unavailableTcgplayerIds).toEqual([599735, 599737, 599739]);
  });

  it('uses all 1,139 numbered TCGCSV promo products as stable printings', () => {
    const promos = promoCards();
    expect(marketDataMeta.catalogCounts.tcgcsvNumberedPromoProducts).toBe(1_139);
    expect(promos).toHaveLength(marketDataMeta.catalogCounts.tcgcsvNumberedPromoProducts);
    expect(new Set(promos.map((asset) => asset.tcgplayerProductId)).size).toBe(promos.length);

    for (const asset of promos) {
      expect(Number.isInteger(asset.tcgplayerProductId)).toBe(true);
      expect(asset.id).toBe(`card-tcgplayer-${asset.tcgplayerProductId}`);
      expect(asset.printingId).toBe(`tcgplayer:${asset.tcgplayerProductId}`);
      expect(asset.number).toBeTruthy();
      expect(asset.rulesCardId).toBeTruthy();
      expect(asset.usPriceSource).toBe('TCGplayer via TCGCSV');
    }
  });

  it('groups alternate arts under their rules card, including DON!! designs', () => {
    const zoroArts = catalogAssets.filter(
      (asset) => asset.kind === 'card' && asset.rulesCardId === 'OP01-001',
    );
    expect(zoroArts.length).toBeGreaterThan(1);
    expect(new Set(zoroArts.map((asset) => asset.printingId)).size).toBe(zoroArts.length);
    expect(zoroArts.some((asset) => asset.variant !== 'Standard')).toBe(true);

    const donArts = catalogAssets.filter(
      (asset) => asset.kind === 'card' && asset.setCode === 'DON',
    );
    expect(donArts.length).toBeGreaterThan(150);
    expect(new Set(donArts.map((asset) => asset.rulesCardId)).size).toBe(1);
  });

  it('includes hundreds of real English Cardmarket sealed products', () => {
    const sealed = catalogAssets.filter((asset) => asset.kind === 'sealed');
    expect(marketDataMeta.catalogCounts.englishSealedProducts).toBeGreaterThan(350);
    expect(sealed).toHaveLength(marketDataMeta.catalogCounts.englishSealedProducts);
    expect(sealed.every((asset) => asset.language === 'English')).toBe(true);
    expect(sealed.every((asset) => asset.cardmarketProductId && asset.productType)).toBe(true);
    expect(sealed.every((asset) => asset.productType !== 'Lots')).toBe(true);
  });

  it('labels the 22 explicit Japanese promos and never invents a German printing', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    const promos = promoCards();
    const japanesePromos = promos.filter((asset) => asset.language === 'Japanese');
    const englishPromos = promos.filter((asset) => asset.language === 'English');

    expect(marketDataMeta.catalogCounts.japanesePromoPrintings).toBe(22);
    expect(marketDataMeta.catalogCounts.englishPromoPrintings).toBe(1_117);
    expect(japanesePromos).toHaveLength(marketDataMeta.catalogCounts.japanesePromoPrintings);
    expect(englishPromos).toHaveLength(marketDataMeta.catalogCounts.englishPromoPrintings);
    expect(japanesePromos.every(
      (asset) => asset.languageEvidence === 'Explicit Japanese Anniversary/Version product title',
    )).toBe(true);
    expect(englishPromos.every(
      (asset) => asset.languageEvidence === 'TCGplayer English-market product record',
    )).toBe(true);
    expect(cards.filter((asset) => !asset.id.startsWith('card-tcgplayer-')).every(
      (asset) => asset.language === 'English',
    )).toBe(true);
    expect(catalogAssets.every((asset) => asset.language === 'English' || asset.language === 'Japanese')).toBe(true);
    expect(catalogAssets.some((asset) => asset.language === 'German')).toBe(false);
  });

  it('preserves exact source quotes, nulls, and multi-subtype promo prices', () => {
    const promos = promoCards();

    for (const asset of catalogAssets) {
      expect(asset.pricing).toBeDefined();
      expect(asset.quote.cardmarket).toBe(asset.pricing?.cardmarket.trend ?? null);
      expect(asset.quote.tcgplayer).toBe(asset.pricing?.usMarket.market ?? null);
      expect(asset.change.cardmarket).toEqual({
        '1D': percentAgainst(
          asset.pricing?.cardmarket.trend ?? null,
          asset.pricing?.cardmarket.average1Day ?? null,
        ),
        '1W': percentAgainst(
          asset.pricing?.cardmarket.trend ?? null,
          asset.pricing?.cardmarket.average7Days ?? null,
        ),
        '1M': percentAgainst(
          asset.pricing?.cardmarket.trend ?? null,
          asset.pricing?.cardmarket.average30Days ?? null,
        ),
      });
      expect(Object.values(asset.change.tcgplayer).every((value) => value === null)).toBe(true);

      if (asset.quote.cardmarket !== null) expect(asset.cardmarketProductId).toBeTruthy();
      if (asset.quote.tcgplayer !== null) expect(asset.printingId).toBeTruthy();
    }

    expect(promos.filter((asset) => asset.quote.tcgplayer !== null)).toHaveLength(
      marketDataMeta.catalogCounts.tcgcsvPromoPrintingsWithPrices,
    );
    expect(promos.filter((asset) => asset.quote.tcgplayer === null)).toHaveLength(
      marketDataMeta.catalogCounts.tcgcsvPromoPrintingsWithoutHeadlinePrice,
    );
    expect(promos.filter((asset) => asset.tcgplayerPriceState === 'unavailable')).toHaveLength(
      marketDataMeta.catalogCounts.tcgcsvPromoPrintingsWithoutPriceRows,
    );
    expect(promos.filter(
      (asset) => asset.tcgplayerPriceState === 'market-unavailable' && asset.quote.tcgplayer === null,
    )).toHaveLength(marketDataMeta.catalogCounts.tcgcsvPromoPrintingsWithPriceRowsButNoMarket);
    expect(promos.every(
      (asset) => asset.quote.tcgplayer === (asset.pricing?.usMarket.market ?? null),
    )).toBe(true);

    const multipleSubtypes = promos.filter(
      (asset) => asset.tcgplayerPriceState === 'multiple-subtypes',
    );
    expect(multipleSubtypes).toHaveLength(
      marketDataMeta.catalogCounts.tcgcsvPromoPrintingsWithMultiplePriceSubtypes,
    );
    for (const asset of multipleSubtypes) {
      expect(asset.quote.tcgplayer).toBeNull();
      expect(asset.pricing?.usMarket.market).toBeNull();
      expect(asset.pricing?.usMarket.variants?.length).toBeGreaterThan(1);
      expect(asset.pricing?.usMarket.variants?.some((variant) => variant.market !== null)).toBe(true);
    }
  });

  it('retains a known exact Cardmarket base-product mapping', () => {
    const usopp = catalogAssets.find(
      (asset) => asset.number === 'OP01-004' && asset.variant === 'Standard',
    );
    expect(usopp).toMatchObject({
      rulesCardId: 'OP01-004',
      cardmarketProductId: 690370,
      cardmarketExpansionId: 5229,
    });
    expect(usopp?.name).toBe('Usopp');
    expect(usopp?.quote.cardmarket).toBe(usopp?.pricing?.cardmarket.trend);

    const alternateArts = catalogAssets.filter(
      (asset) => asset.rulesCardId === 'OP01-004' && asset.variant !== 'Standard',
    );
    expect(alternateArts.length).toBeGreaterThan(0);
    expect(alternateArts.every((asset) => asset.cardmarketProductId == null)).toBe(true);
    expect(alternateArts.every((asset) => asset.quote.cardmarket === null)).toBe(true);
  });

  it('has hundreds of exact direct Cardmarket and TCGplayer comparison pairs', () => {
    const comparable = catalogAssets.filter((asset) =>
      asset.kind === 'card'
      && asset.cardmarketProductId != null
      && asset.tcgplayerProductId != null
      && asset.usPriceSource === 'TCGplayer via TCGCSV'
      && asset.quote.cardmarket != null
      && asset.quote.cardmarket > 0
      && asset.quote.tcgplayer != null
      && asset.quote.tcgplayer > 0,
    );

    expect(marketDataMeta.catalogCounts.tcgplayerMappedBaseArts).toBeGreaterThan(800);
    expect(comparable).toHaveLength(marketDataMeta.catalogCounts.exactCrossMarketComparablePrices);
    expect(comparable.length).toBeGreaterThan(750);
    expect(comparable.every((asset) => asset.variant === 'Standard')).toBe(true);
    expect(comparable.every((asset) => asset.tcgplayerMappingEvidence?.includes('unique unqualified base product'))).toBe(true);

    const usopp = comparable.find((asset) => asset.number === 'OP01-004');
    expect(usopp).toMatchObject({
      cardmarketProductId: 690370,
      tcgplayerProductId: 454516,
      tcgplayerGroupId: 3188,
      usPriceSource: 'TCGplayer via TCGCSV',
    });

    expect(marketDataMeta.exchangeRate.seriesKey).toBe('EXR.D.USD.EUR.SP00.A');
    expect(marketDataMeta.exchangeRate.direction).toBe('USD per EUR');
    expect(marketDataMeta.exchangeRate.usdPerEur).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(marketDataMeta.exchangeRate.observationDate))).toBe(false);
  });

  it('scans every released English booster group through OP16 without admitting future or ambiguous printings', () => {
    const marketGroups = marketDataMeta.tcgcsv.marketGroups;

    expect(marketDataMeta.catalogCounts.releasedEnglishMarketGroups).toBe(21);
    expect(marketDataMeta.catalogCounts.releasedEnglishMainGroups).toBe(16);
    expect(marketDataMeta.catalogCounts.releasedEnglishSpecialGroups).toBe(5);
    expect(Object.keys(marketGroups)).toHaveLength(21);
    expect(marketGroups.OP16).toMatchObject({
      groupId: 24664,
      officialEnglishReleasedOn: '2026-06-12',
      memberSetCodes: ['OP16'],
      cardmarketExpansionId: 6457,
    });
    expect(marketGroups.OP16.exactMappings).toBeGreaterThan(0);
    expect(marketGroups.OP17).toBeUndefined();
    expect(marketGroups['EB-05']).toBeUndefined();
    expect(marketDataMeta.englishReleaseManifest.futureProductsExcluded.map((release) => release.abbreviation))
      .toEqual(expect.arrayContaining(['OP17', 'EB-05']));

    expect(marketGroups.OP14).toMatchObject({
      groupId: 24537,
      memberSetCodes: ['OP14', 'EB04'],
      cardmarketExpansionId: 6432,
    });
    expect(marketGroups['OP15-EB04']).toMatchObject({
      groupId: 24637,
      memberSetCodes: ['OP15', 'EB04'],
      cardmarketExpansionId: 6456,
    });
    expect(marketDataMeta.crossMarketCoverage.releasedGroupsWithoutExactStandardMappings)
      .toEqual(['PRB-01', 'PRB-02']);

    const groupById = new Map(Object.values(marketGroups).map((group) => [group.groupId, group]));
    const comparable = catalogAssets.filter((asset) =>
      asset.kind === 'card'
      && asset.cardmarketProductId != null
      && asset.tcgplayerProductId != null
      && asset.usPriceSource === 'TCGplayer via TCGCSV',
    );
    for (const asset of comparable) {
      const group = groupById.get(asset.tcgplayerGroupId ?? -1);
      expect(group).toBeDefined();
      expect(group?.memberSetCodes).toContain(asset.number?.split('-')[0]);
      if (asset.number?.startsWith('EB04-')) {
        expect([24537, 24637]).toContain(asset.tcgplayerGroupId);
        expect([6432, 6456]).toContain(asset.cardmarketExpansionId);
      }
    }
  });
});

describe('Dresden store map data', () => {
  it('gives every registered store a Dresden coordinate', () => {
    expect(stores).toHaveLength(6);
    for (const store of stores) {
      expect(store.city).toBe('Dresden');
      expect(store.latitude).toBeGreaterThan(51.03);
      expect(store.latitude).toBeLessThan(51.1);
      expect(store.longitude).toBeGreaterThan(13.69);
      expect(store.longitude).toBeLessThan(13.83);
    }
  });
});
