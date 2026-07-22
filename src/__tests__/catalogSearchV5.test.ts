import { describe, expect, it } from 'vitest';
import { catalogAssets, type DemoAsset } from '../data/demo';
import {
  normalizeCatalogQueryV5,
  selectCardGroupMatchV5,
} from '../domain/catalogSearchV5';

function groupedCatalogCards(): DemoAsset[][] {
  const groups = new Map<string, DemoAsset[]>();
  for (const asset of catalogAssets) {
    if (asset.kind !== 'card') continue;
    const id = asset.rulesCardId ?? asset.number ?? asset.id;
    groups.set(id, [...(groups.get(id) ?? []), asset]);
  }
  return [...groups.values()];
}

describe('catalog card search v5', () => {
  it('does not match a character found only in a set title', () => {
    const unrelatedDeckCard = {
      name: 'Charlotte Opera',
      number: 'OP03-106',
      setCode: 'ST20',
      set: 'Starter Deck 20: YELLOW Charlotte Katakuri',
      variant: 'Reprint',
    };

    expect(selectCardGroupMatchV5(
      [unrelatedDeckCard],
      normalizeCatalogQueryV5('Katakuri'),
      'all',
    )).toBeNull();
  });

  it('returns the matching art instead of an unrelated group representative', () => {
    const smoker = {
      name: 'DON!! Card (Smoker)',
      number: 'DON!!',
      setCode: 'PRB-02',
      variant: 'DON!! design',
    };
    const katakuri = {
      name: 'DON!! Card (Katakuri)',
      number: 'DON!!',
      setCode: 'PRB-01',
      variant: 'DON!! design',
    };

    expect(selectCardGroupMatchV5(
      [smoker, katakuri],
      normalizeCatalogQueryV5('Katakuri'),
      'all',
    )).toBe(katakuri);
  });

  it('still supports card-number, set-code, and art searches within the active set', () => {
    const base = {
      name: 'Charlotte Katakuri',
      number: 'OP03-099',
      setCode: 'OP03',
      variant: 'Standard',
    };
    const alternate = {
      ...base,
      setCode: 'PRB-01',
      variant: 'Alternate art · P2',
    };

    expect(selectCardGroupMatchV5([base], normalizeCatalogQueryV5('OP03-099'), 'all')).toBe(base);
    expect(selectCardGroupMatchV5([base], normalizeCatalogQueryV5('OP03'), 'all')).toBe(base);
    expect(selectCardGroupMatchV5([base, alternate], normalizeCatalogQueryV5('alternate'), 'PRB-01')).toBe(alternate);
    expect(selectCardGroupMatchV5([base, alternate], normalizeCatalogQueryV5('alternate'), 'OP03')).toBeNull();
  });

  it('shows only Katakuri-named cards for Katakuri in the current catalog', () => {
    const query = normalizeCatalogQueryV5('Katakuri');
    const results = groupedCatalogCards()
      .map((arts) => selectCardGroupMatchV5(arts, query, 'all'))
      .filter((asset): asset is DemoAsset => asset !== null);

    expect(results.length).toBeGreaterThan(5);
    expect(results.every((asset) => asset.name.toLocaleLowerCase('en-US').includes(query))).toBe(true);
    expect(results.some((asset) => asset.name.includes('DON!! Card (Katakuri)'))).toBe(true);
    expect(results.some((asset) => asset.name === 'Charlotte Opera')).toBe(false);
  });
});
