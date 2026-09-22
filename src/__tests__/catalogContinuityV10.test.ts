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
      if (marketDataMeta.cardmarket.approvedCatalogRemovalReviews?.[previous.id]) continue;
      const current = currentById.get(previous.id);
      expect(current, previous.id).toBeDefined();
      if (previous.cardmarketProductId != null) {
        const approvedChange = (marketDataMeta.cardmarket?.exactMappingContinuityApprovals as Record<string, { previousProductId: number; nextProductId: number }>)?.[previous.id];
        const expectedProductId = approvedChange ? approvedChange.nextProductId : previous.cardmarketProductId;
        expect(current?.cardmarketProductId, previous.id).toBe(expectedProductId);
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
    ).filter((id) => !id.startsWith('card-optcg-')).sort();

    expect(removedSealed.sort()).toEqual(expectedRemoved);
  });
});
