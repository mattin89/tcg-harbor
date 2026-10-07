import type { DemoAsset } from './demo';
import multilingualCardsRaw from './generated/multilingual-cards.json';

export const multilingualAssets: DemoAsset[] = multilingualCardsRaw as unknown as DemoAsset[];

export const multilingualCounts = {
  total: multilingualAssets.length,
  mapped: multilingualAssets.filter((a) => a.cardmarketProductId !== null).length,
  priced: multilingualAssets.filter((a) => a.cardmarketPriceState === 'available').length,
  trendUnavailable: multilingualAssets.filter((a) => a.cardmarketPriceState === 'trend-unavailable').length,
  ambiguous: multilingualAssets.filter((a) => a.cardmarketPriceState === 'ambiguous-artwork').length,
  unmapped: multilingualAssets.filter((a) => a.cardmarketPriceState === 'unmapped').length,
};
