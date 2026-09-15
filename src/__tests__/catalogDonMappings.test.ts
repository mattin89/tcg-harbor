import { describe, expect, it } from 'vitest';
import { catalogAssets, marketDataMeta } from '../data/demo';
import { donCounts, donMappings } from '../data/catalogDonMappings';

describe('DON!! Cardmarket Mappings & Live Pricing', () => {
  const donCards = catalogAssets.filter(
    (asset) => asset.kind === 'card' && asset.setCode === 'DON',
  );

  it('preserves rulesCardId as DON!! for all DON cards', () => {
    expect(donCards.length).toBe(donCounts.totalDons);
    expect(donCards.length).toBe(187);
    const rulesCardIds = new Set(donCards.map((asset) => asset.rulesCardId));
    expect(rulesCardIds.size).toBe(1);
    expect(rulesCardIds.has('DON!!')).toBe(true);
  });

  it('maps exactly 177 DON cards to verified Cardmarket products with unique product IDs', () => {
    const mapped = donCards.filter((asset) => asset.cardmarketProductId != null);
    expect(mapped.length).toBe(donCounts.mappedCount);
    expect(mapped.length).toBe(177);

    // Each mapped DON card must have a unique Cardmarket product ID
    const productIds = mapped.map((asset) => asset.cardmarketProductId as number);
    expect(new Set(productIds).size).toBe(mapped.length);
  });

  it('populates live trend prices for 174 DON cards', () => {
    const priced = donCards.filter((asset) => asset.cardmarketPriceState === 'available');
    expect(priced.length).toBe(donCounts.pricedCount);
    expect(priced.length).toBe(174);

    for (const asset of priced) {
      expect(asset.quote.cardmarket).not.toBeNull();
      expect(typeof asset.quote.cardmarket).toBe('number');
      expect((asset.quote.cardmarket as number)).toBeGreaterThan(0);
      expect(asset.pricing?.cardmarket.trend).toBe(asset.quote.cardmarket);
      expect(asset.cardmarketPriceReason).toBe(
        'An exact Cardmarket product is verified for this artwork and its daily trend is available.',
      );
    }
  });

  it('marks 3 rare promo DON cards as trend-unavailable', () => {
    const trendUnavailable = donCards.filter(
      (asset) => asset.cardmarketPriceState === 'trend-unavailable',
    );
    expect(trendUnavailable.length).toBe(donCounts.trendUnavailableCount);
    expect(trendUnavailable.length).toBe(3);

    for (const asset of trendUnavailable) {
      expect(asset.cardmarketProductId).not.toBeNull();
      expect(asset.quote.cardmarket).toBeNull();
      expect(asset.pricing?.cardmarket.trend).toBeNull();
      expect(asset.cardmarketPriceReason).toBe(
        'An exact Cardmarket product is verified, but the current daily price guide has no trend for it.',
      );
    }
  });

  it('keeps the 10 unlisted promotional cards cleanly documented as unmapped', () => {
    const unmapped = donCards.filter((asset) => asset.cardmarketPriceState === 'unmapped');
    expect(unmapped.length).toBe(donCounts.unmappedCount);
    expect(unmapped.length).toBe(10);

    for (const asset of unmapped) {
      expect(asset.cardmarketProductId).toBeNull();
      expect(asset.cardmarketPriceReason).toBe(
        'The Cardmarket public catalog does not expose an artwork-safe product mapping for this DON!! design.',
      );
    }
  });

  it('verifies prominent individual DON cards receive exact products and prices', () => {
    // PRB-01 Zoro Gold
    const zoroGold = donCards.find((c) => c.name === 'DON!! Card (Zoro) (Gold) - Premium Booster -The Best- (PRB-01)');
    expect(zoroGold).toBeDefined();
    expect(zoroGold?.cardmarketProductId).toBe(799543);
    expect(zoroGold?.cardmarketExpansionId).toBe(5805);
    expect(zoroGold?.cardmarketPriceState).toBe('available');
    expect(zoroGold?.quote.cardmarket).toBe(505.91);

    // PRB-02 Smoker
    const smoker = donCards.find((c) => c.name === 'DON!! Card (Smoker) - Premium Booster -The Best- Vol. 2 (PRB-02)');
    expect(smoker).toBeDefined();
    expect(smoker?.cardmarketProductId).toBe(852284);
    expect(smoker?.cardmarketExpansionId).toBe(6242);
    expect(smoker?.cardmarketPriceState).toBe('available');
    expect(smoker?.quote.cardmarket).toBe(0.36);

    // EB-03 Nami
    const namiEb03 = donCards.find((c) => c.name === 'DON!! Card (Nami) - Extra Booster: One Piece Heroines Edition (EB-03)');
    expect(namiEb03).toBeDefined();
    expect(namiEb03?.cardmarketProductId).toBe(873732);
    expect(namiEb03?.cardmarketExpansionId).toBe(6449);
    expect(namiEb03?.cardmarketPriceState).toBe('available');
    expect(namiEb03?.quote.cardmarket).toBe(2.22);

    // 1st Anniversary Yamato
    const yamato = donCards.find((c) => c.name.includes('Yamato') && c.name.includes('1st Anniversary'));
    expect(yamato).toBeDefined();
    expect(yamato?.cardmarketProductId).toBe(748118);
    expect(yamato?.cardmarketExpansionId).toBe(5262);
    expect(yamato?.cardmarketPriceState).toBe('available');
    expect(yamato?.quote.cardmarket).toBe(15.63);

    // OP01 Romance Dawn Manga DON
    const op01Manga = donCards.find((c) => c.name.includes('Manga') && c.name.includes('Romance Dawn'));
    expect(op01Manga).toBeDefined();
    expect(op01Manga?.cardmarketProductId).toBe(693571);
    expect(op01Manga?.cardmarketExpansionId).toBe(5229);
    expect(op01Manga?.cardmarketPriceState).toBe('available');
    expect(op01Manga?.quote.cardmarket).toBe(7.76);
  });

  it('keeps catalogAssets and marketDataMeta.catalogCounts in exact alignment', () => {
    const cards = catalogAssets.filter((asset) => asset.kind === 'card');
    const exact = cards.filter((asset) => asset.cardmarketProductId != null);
    const available = cards.filter((asset) => asset.cardmarketPriceState === 'available');
    const trendUnavailable = cards.filter((asset) => asset.cardmarketPriceState === 'trend-unavailable');
    const ambiguous = cards.filter((asset) => asset.cardmarketPriceState === 'ambiguous-artwork');
    const unmapped = cards.filter((asset) => asset.cardmarketPriceState === 'unmapped');

    expect(exact.length).toBe(marketDataMeta.catalogCounts.cardmarketMappedCardPrintings);
    expect(available.length).toBe(marketDataMeta.catalogCounts.cardmarketPricedCardPrintings);
    expect(trendUnavailable.length).toBe(marketDataMeta.catalogCounts.cardmarketTrendUnavailableCardPrintings);
    expect(ambiguous.length).toBe(marketDataMeta.catalogCounts.cardmarketAmbiguousCardPrintings);
    expect(unmapped.length).toBe(marketDataMeta.catalogCounts.cardmarketUnmappedCardPrintings);
    expect(available.length + trendUnavailable.length + ambiguous.length + unmapped.length).toBe(cards.length);
  });
});
