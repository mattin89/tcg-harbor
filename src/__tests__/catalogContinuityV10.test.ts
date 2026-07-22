import { describe, expect, it } from 'vitest';
import previousSnapshotRaw from '../data/generated/onepiece-market-v9.json?raw';
import { catalogAssets, marketDataGeneratedAt, marketDataMeta } from '../data/demo';

interface PreviousAsset {
  id: string;
  kind: 'card' | 'sealed';
  cardmarketProductId?: number | null;
}

const previousAssets = (JSON.parse(previousSnapshotRaw) as { assets: PreviousAsset[] }).assets;

describe('v10 catalog continuity', () => {
  it('preserves card identity and exact Cardmarket mappings from v9', () => {
    const currentById = new Map(catalogAssets.map((asset) => [asset.id, asset]));
    const previousCards = previousAssets.filter((asset) => asset.kind === 'card');

    for (const previous of previousCards) {
      const current = currentById.get(previous.id);
      expect(current, previous.id).toBeDefined();
      if (previous.cardmarketProductId != null) {
        expect(current?.cardmarketProductId, previous.id).toBe(previous.cardmarketProductId);
      }
    }
  });

  it('removes only the reviewed future sealed presales from v9', () => {
    const currentIds = new Set(catalogAssets.map((asset) => asset.id));
    const removedSealed = previousAssets
      .filter((asset) => asset.kind === 'sealed' && !currentIds.has(asset.id))
      .map((asset) => asset.id);

    expect(Number.isNaN(Date.parse(marketDataGeneratedAt))).toBe(false);
    const expectedRemoved = Object.keys(
      marketDataMeta.cardmarket.approvedCatalogRemovalReviews ?? {},
    ).sort();

    expect(removedSealed.sort()).toEqual(expectedRemoved);
  });
});
