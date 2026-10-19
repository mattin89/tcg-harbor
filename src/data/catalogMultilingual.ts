import type { DemoAsset } from './demo';
import multilingualCardsRaw from './generated/multilingual-cards.json';
import multilingualSealedRaw from './generated/multilingual-sealed.json';

export const multilingualCardAssets: DemoAsset[] = multilingualCardsRaw as unknown as DemoAsset[];
export const multilingualSealedAssets: DemoAsset[] = (multilingualSealedRaw ?? []) as unknown as DemoAsset[];

export const multilingualAssets: DemoAsset[] = [
  ...multilingualCardAssets,
  ...multilingualSealedAssets,
];

export const multilingualCounts = {
  total: multilingualCardAssets.length,
  cardsTotal: multilingualCardAssets.length,
  sealedTotal: multilingualSealedAssets.length,
  mapped: multilingualCardAssets.filter((a) => a.cardmarketProductId !== null).length,
  priced: multilingualCardAssets.filter((a) => a.cardmarketPriceState === 'available').length,
  trendUnavailable: multilingualCardAssets.filter((a) => a.cardmarketPriceState === 'trend-unavailable').length,
  ambiguous: multilingualCardAssets.filter((a) => a.cardmarketPriceState === 'ambiguous-artwork').length,
  unmapped: multilingualCardAssets.filter((a) => a.cardmarketPriceState === 'unmapped').length,
};


