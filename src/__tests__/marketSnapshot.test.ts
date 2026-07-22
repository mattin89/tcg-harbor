import { describe, expect, it } from 'vitest';
import { catalogAssets, initialAssets, marketDataMeta, stores } from '../data/demo';

type CatalogAsset = (typeof catalogAssets)[number];
type SourcePrintingAsset = CatalogAsset & { sourcePrintingId?: string };
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
  it('records whether OPTCG was live or an integrity-checked fallback', () => {
    expect(['live', 'integrity-checked-cache-fallback']).toContain(marketDataMeta.optcg.retrievalMode);
    if (marketDataMeta.optcg.retrievalMode === 'integrity-checked-cache-fallback') {
      expect(Number.isNaN(Date.parse(marketDataMeta.optcg.cacheFetchedAt ?? ''))).toBe(false);
      expect(marketDataMeta.optcg.liveFetchError?.message).toBeTruthy();
    } else {
      expect(marketDataMeta.optcg.cacheFetchedAt).toBeNull();
      expect(marketDataMeta.optcg.liveFetchError).toBeNull();
    }
  });

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
    expect(marketDataMeta.catalogCounts.cardPrintings).toBeGreaterThan(5_200);
    expect(cards).toHaveLength(marketDataMeta.catalogCounts.cardPrintings);
    expect(cards).toHaveLength(
      marketDataMeta.catalogCounts.optcgCorePrintings
      + marketDataMeta.catalogCounts.tcgcsvNumberedPromoProducts,
    );
    expect(cards.every((asset) => asset.rulesCardId && asset.printingId)).toBe(true);
  });

  it('keeps an exact source-backed image for every card printing', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card') as SourcePrintingAsset[];
    const available = cards.filter((asset) => asset.imageState === 'available');
    const unavailable = cards.filter((asset) => asset.imageState === 'unavailable');

    expect(marketDataMeta.catalogCounts.cardPrintingsWithImages).toBe(cards.length);
    expect(marketDataMeta.catalogCounts.cardPrintingsWithoutImages).toBe(0);
    expect(available).toHaveLength(marketDataMeta.catalogCounts.cardPrintingsWithImages);
    expect(unavailable).toHaveLength(0);
    expect(available.every((asset) => asset.imageUrl?.startsWith('http'))).toBe(true);
    expect(cards.every((asset) => asset.imageState === 'available')).toBe(true);

    const exactTcgplayerOverrides = new Map<number, string>([
      [599735, 'https://storage.googleapis.com/images.pricecharting.com/sm3klbepvctxi6zj/1600.jpg'],
      [599737, 'https://storage.googleapis.com/images.pricecharting.com/xzrhxe6jku55h5f5/1600.jpg'],
      [599739, 'https://storage.googleapis.com/images.pricecharting.com/gz5twp7csl4nfy7i/1600.jpg'],
    ]);
    for (const [productId, imageUrl] of exactTcgplayerOverrides) {
      expect(cards.find((asset) => asset.tcgplayerProductId === productId)?.imageUrl).toBe(imageUrl);
    }

    const exactSourceOverrides = new Map<string, string>([
      ['don_169', 'https://tcgplayer-cdn.tcgplayer.com/product/655121_in_1000x1000.jpg'],
      ['don_181', 'https://tcgplayer-cdn.tcgplayer.com/product/677567_in_1000x1000.jpg'],
      ['don_132', 'https://storage.googleapis.com/images.pricecharting.com/correbdfe4st6ypotkzb/1600.jpg'],
      ['don_185', 'https://tcgplayer-cdn.tcgplayer.com/product/698314_in_1000x1000.jpg'],
    ]);
    for (const [sourcePrintingId, imageUrl] of exactSourceOverrides) {
      expect(cards.find((asset) => asset.sourcePrintingId === sourcePrintingId)?.imageUrl).toBe(imageUrl);
    }
  });

  it('uses every numbered TCGCSV promo product as a stable printing', () => {
    const promos = promoCards();
    expect(marketDataMeta.catalogCounts.tcgcsvNumberedPromoProducts).toBeGreaterThan(1_100);
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

  it('preserves every released starter deck through ST30, including all 17 ST05 base cards', () => {
    const coreCards = catalogAssets.filter((asset) => asset.kind === 'card' && asset.id.startsWith('card-optcg-'));
    for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
      const setCode = `ST${String(ordinal).padStart(2, '0')}`;
      expect(coreCards.some((asset) => asset.setCode === setCode), setCode).toBe(true);
    }
    expect(coreCards.filter((asset) => asset.setCode === 'ST05')).toHaveLength(17);
    expect(marketDataMeta.catalogCounts.unknownManifestOptcgCoreRecords).toBe(0);
  });

  it('includes hundreds of real English Cardmarket sealed products', () => {
    const sealed = catalogAssets.filter((asset) => asset.kind === 'sealed');
    expect(marketDataMeta.catalogCounts.englishSealedProducts).toBeGreaterThan(390);
    expect(marketDataMeta.catalogCounts.englishSealedSourceCandidates).toBe(
      marketDataMeta.catalogCounts.englishSealedProducts
      + marketDataMeta.catalogCounts.futureEnglishSealedProductsExcluded,
    );
    expect(marketDataMeta.catalogCounts.futureEnglishSealedProductsExcluded).toBeGreaterThan(0);
    expect(sealed).toHaveLength(marketDataMeta.catalogCounts.englishSealedProducts);
    expect(sealed.every((asset) => asset.language === 'English')).toBe(true);
    expect(sealed.every((asset) => asset.cardmarketProductId && asset.productType)).toBe(true);
    expect(sealed.every((asset) => asset.productType !== 'Lots')).toBe(true);
    expect(sealed.every(
      (asset) => asset.imageState === 'unavailable' && !asset.imageUrl && asset.imageUnavailableReason,
    )).toBe(true);
    expect(sealed.filter((asset) => asset.quote.cardmarket === null)).toHaveLength(
      marketDataMeta.catalogCounts.englishSealedProductsWithoutTrend,
    );
    expect(marketDataMeta.catalogCounts.englishSealedProductsWithoutTrend).toBeGreaterThan(0);
    expect(sealed.some((asset) => !/^(?:OP|ST|EB|PRB)\d{2}$/.test(asset.setCode))).toBe(true);
    expect(sealed.some(
      (asset) => asset.setCode === 'ST05' && asset.name === 'Starter Deck: ST05-ST06: Deck Set',
    )).toBe(true);
  });

  it('labels the 22 explicit Japanese promos and never invents a German printing', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    const promos = promoCards();
    const japanesePromos = promos.filter((asset) => asset.language === 'Japanese');
    const englishPromos = promos.filter((asset) => asset.language === 'English');

    expect(marketDataMeta.catalogCounts.japanesePromoPrintings).toBeGreaterThan(0);
    expect(marketDataMeta.catalogCounts.englishPromoPrintings).toBeGreaterThan(1_000);
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

  it('adds only artwork-safe v8 Cardmarket mappings and explains every price state', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    const exact = cards.filter((asset) => asset.cardmarketProductId != null);
    const available = cards.filter((asset) => asset.cardmarketPriceState === 'available');
    const trendUnavailable = cards.filter((asset) => asset.cardmarketPriceState === 'trend-unavailable');
    const ambiguous = cards.filter((asset) => asset.cardmarketPriceState === 'ambiguous-artwork');
    const unmapped = cards.filter((asset) => asset.cardmarketPriceState === 'unmapped');

    expect(cards.every((asset) => asset.cardmarketPriceReason)).toBe(true);
    expect(exact).toHaveLength(marketDataMeta.catalogCounts.cardmarketMappedCardPrintings);
    expect(new Set(exact.map((asset) => asset.cardmarketProductId)).size).toBe(exact.length);
    expect(available).toHaveLength(marketDataMeta.catalogCounts.cardmarketPricedCardPrintings);
    expect(trendUnavailable).toHaveLength(
      marketDataMeta.catalogCounts.cardmarketTrendUnavailableCardPrintings,
    );
    expect(ambiguous).toHaveLength(marketDataMeta.catalogCounts.cardmarketAmbiguousCardPrintings);
    expect(unmapped).toHaveLength(marketDataMeta.catalogCounts.cardmarketUnmappedCardPrintings);
    expect(available.every(
      (asset) => asset.cardmarketProductId != null && asset.quote.cardmarket != null,
    )).toBe(true);
    expect(ambiguous.every(
      (asset) => asset.cardmarketProductId == null
        && asset.quote.cardmarket == null
        && (asset.cardmarketCandidates?.length ?? 0) > 0,
    )).toBe(true);
    expect(ambiguous.every((asset) => {
      const range = asset.cardmarketCandidatePriceRange;
      return !range
        || range.minimumTrend == null
        || range.maximumTrend == null
        || range.minimumTrend <= range.maximumTrend;
    })).toBe(true);
    expect(marketDataMeta.catalogCounts.cardmarketAdditionalExactBoosterMappings).toBeGreaterThanOrEqual(150);
    expect(marketDataMeta.catalogCounts.cardmarketAdditionalExactStarterMappings).toBeGreaterThan(0);
  });

  it('keeps Cardmarket V.1/V.2 products ambiguous instead of sorting product IDs', () => {
    const fireFistPrintings = catalogAssets.filter(
      (asset) => asset.kind === 'card'
        && asset.setCode === 'OP03'
        && asset.number === 'OP03-018',
    );

    expect(fireFistPrintings).toHaveLength(2);
    for (const asset of fireFistPrintings) {
      expect(asset.cardmarketPriceState).toBe('ambiguous-artwork');
      expect(asset.cardmarketProductId).toBeNull();
      expect(asset.quote.cardmarket).toBeNull();
      expect(asset.cardmarketCandidates).toEqual([
        { productId: 719387, trend: expect.any(Number) },
        { productId: 719388, trend: expect.any(Number) },
      ]);
      expect(asset.cardmarketCandidatePriceRange?.totalCandidates).toBe(2);
    }
  });

  it('maps unique booster and starter-deck printings, including Katakuri, without title guessing', () => {
    const uniqueSpecial = catalogAssets.find(
      (asset) => asset.kind === 'card'
        && asset.setCode === 'OP03'
        && asset.sourcePrintingId === 'ST01-012_p1',
    );
    expect(uniqueSpecial).toMatchObject({
      cardmarketProductId: 720061,
      cardmarketPriceState: 'available',
    });

    for (const [setCode, sourcePrintingId] of [
      ['ST07', 'ST07-003'],
      ['ST16', 'ST16-003'],
      ['ST20', 'OP03-099_p2'],
    ] as const) {
      const katakuri = catalogAssets.find(
        (asset) => asset.kind === 'card'
          && asset.setCode === setCode
          && asset.sourcePrintingId === sourcePrintingId,
      );
      expect(katakuri?.name).toMatch(/Katakuri/i);
      expect(katakuri?.cardmarketProductId, `${setCode} ${sourcePrintingId}`).toBeTruthy();
      expect(katakuri?.cardmarketPriceState, `${setCode} ${sourcePrintingId}`).toBe('available');
      expect(katakuri?.quote.cardmarket, `${setCode} ${sourcePrintingId}`).not.toBeNull();
    }
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

  it('scans every officially released English booster group without admitting future printings', () => {
    const marketGroups = marketDataMeta.tcgcsv.marketGroups;
    const releaseManifest = marketDataMeta.englishReleaseManifest as typeof marketDataMeta.englishReleaseManifest & {
      fetchedAt: string;
      archivePagesChecked: number;
      officialProducts: Array<{
        abbreviation: string;
        category: 'boosters' | 'decks';
        officialCode: string;
        releasedOn: string;
        releasePrecision: 'day' | 'month';
        memberSetCodes: string[];
      }>;
    };
    const cutoff = new Date(releaseManifest.fetchedAt).valueOf();
    const isAvailable = (release: (typeof releaseManifest.officialProducts)[number]) => {
      const [year, month, day] = release.releasedOn.split('-').map(Number);
      const availableAt = release.releasePrecision === 'day'
        ? Date.UTC(year, month - 1, day)
        : Date.UTC(year, month, 1);
      return availableAt <= cutoff;
    };
    const expectedReleasedGroups = releaseManifest.officialProducts
      .filter((release) => release.category === 'boosters' && isAvailable(release))
      .map((release) => release.abbreviation)
      .filter((abbreviation) => /^(?:OP\d{2}|EB-\d{2}|PRB-\d{2}|OP\d{2}-EB\d{2})$/.test(abbreviation))
      .sort();

    expect(releaseManifest.archivePagesChecked).toBeGreaterThan(10);
    expect(Object.keys(marketGroups).sort()).toEqual(expectedReleasedGroups);
    expect(marketDataMeta.catalogCounts.releasedEnglishMarketGroups).toBe(expectedReleasedGroups.length);
    expect(marketDataMeta.catalogCounts.releasedEnglishMainGroups).toBe(
      expectedReleasedGroups.filter((abbreviation) => /^OP\d{2}(?:-EB\d{2})?$/.test(abbreviation)).length,
    );
    expect(marketDataMeta.catalogCounts.releasedEnglishSpecialGroups).toBe(
      expectedReleasedGroups.filter((abbreviation) => !/^OP\d{2}(?:-EB\d{2})?$/.test(abbreviation)).length,
    );
    expect(marketGroups.OP16).toMatchObject({
      groupId: 24664,
      officialEnglishReleasedOn: '2026-06-12',
      memberSetCodes: ['OP16'],
      cardmarketExpansionId: 6457,
    });
    expect(marketGroups.OP16.exactMappings).toBeGreaterThan(0);
    for (const release of releaseManifest.futureProductsExcluded) {
      expect(marketGroups[release.abbreviation]).toBeUndefined();
      expect(catalogAssets.some(
        (asset) => asset.kind === 'sealed' && release.memberSetCodes.includes(asset.setCode),
      )).toBe(false);
    }
    const leakedFutureDeckProductIds = new Set([897426, 897428, 897430, 897432, 897434, 897435]);
    expect(catalogAssets.some(
      (asset) => asset.kind === 'sealed' && asset.cardmarketProductId != null
        && leakedFutureDeckProductIds.has(asset.cardmarketProductId),
    )).toBe(false);
    expect(releaseManifest.officialProducts.find((product) => product.officialCode === 'ST-05')).toMatchObject({
      releasedOn: '2023-02-03',
      memberSetCodes: ['ST05'],
    });
    for (const release of releaseManifest.officialProducts.filter((product) => !isAvailable(product))) {
      expect(catalogAssets.some(
        (asset) => asset.kind === 'card' && release.memberSetCodes.some(
          (memberSetCode) => asset.setCode.match(/(?:OP|EB|PRB|ST)\d{2}/g)?.includes(memberSetCode),
        ),
      )).toBe(false);
    }

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
