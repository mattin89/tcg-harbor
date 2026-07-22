import { describe, expect, it } from 'vitest';
import previousSnapshotRaw from '../data/generated/onepiece-market-v8.json?raw';
import { catalogAssets } from '../data/demo';

interface SnapshotAsset {
  id: string;
  kind: 'card' | 'sealed';
  setCode: string;
}

const previousAssets = (JSON.parse(previousSnapshotRaw) as { assets: SnapshotAsset[] }).assets;

describe('v9 catalog identity continuity', () => {
  it('does not move an existing TCGplayer promotional printing between parent sets', () => {
    const currentById = new Map(catalogAssets.map((asset) => [asset.id, asset]));
    const previousPromos = previousAssets.filter(
      (asset) => asset.kind === 'card' && asset.id.startsWith('card-tcgplayer-'),
    );

    expect(previousPromos.length).toBeGreaterThan(1_000);
    for (const previous of previousPromos) {
      expect(currentById.get(previous.id)?.setCode, previous.id).toBe(previous.setCode);
    }
    expect(currentById.get('card-tcgplayer-564143')?.setCode).toBe('OP02');
  });
});
