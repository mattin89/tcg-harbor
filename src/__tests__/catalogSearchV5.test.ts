import { describe, expect, it } from 'vitest';
import { catalogAssets, type DemoAsset } from '../data/demo';
import {
  catalogCardGroupIdV5,
  normalizeBaseSetCode,
  normalizeCatalogQueryV5,
  selectCardGroupMatchV5,
} from '../domain/catalogSearchV5';

function groupedCatalogCards(): DemoAsset[][] {
  const groups = new Map<string, DemoAsset[]>();
  for (const asset of catalogAssets) {
    if (asset.kind !== 'card') continue;
    const id = catalogCardGroupIdV5(asset);
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

  it('matches the Flame-Flame Fruit Coliseum Champion Trophy Card via name and product label', () => {
    const query = normalizeCatalogQueryV5('Coliseum Champion');
    const results = groupedCatalogCards()
      .map((arts) => selectCardGroupMatchV5(arts, query, 'all'))
      .filter((asset): asset is DemoAsset => asset !== null);

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((asset) => asset.productName?.includes('Coliseum Champion'))).toBe(true);

    const trophyQuery = normalizeCatalogQueryV5('Flame-Flame Fruit');
    const trophyResults = groupedCatalogCards()
      .map((arts) => selectCardGroupMatchV5(arts, trophyQuery, 'all'))
      .filter((asset): asset is DemoAsset => asset !== null);

    expect(trophyResults.some((asset) => asset.id === 'card-tcgplayer-906851')).toBe(true);
  });

  it('returns all distinct DON!! cards when searching for DON!! without collapsing them into one item', () => {
    const query = normalizeCatalogQueryV5('DON!!');
    const results = groupedCatalogCards()
      .map((arts) => selectCardGroupMatchV5(arts, query, 'all'))
      .filter((asset): asset is DemoAsset => asset !== null);

    expect(results.length).toBeGreaterThan(150);
    // Verifies multiple individual character DON cards are distinct search results
    expect(results.some((asset) => asset.name.includes('(Smoker)'))).toBe(true);
    expect(results.some((asset) => asset.name.includes('(Shanks)'))).toBe(true);
    expect(results.some((asset) => asset.name.includes('(Yamato)'))).toBe(true);
    expect(results.some((asset) => asset.name.includes('(Zoro)'))).toBe(true);
  });

  it('matches compound searches combining character name and card set or number like Luffy OP11-040', () => {
    const luffyCard = {
      name: 'Monkey.D.Luffy',
      number: 'OP11-040',
      setCode: 'OP-11',
      variant: 'Standard',
    };

    expect(selectCardGroupMatchV5([luffyCard], normalizeCatalogQueryV5('Luffy OP11-040'), 'all')).toBe(luffyCard);
    expect(selectCardGroupMatchV5([luffyCard], normalizeCatalogQueryV5('Luffy OP11'), 'all')).toBe(luffyCard);
    expect(selectCardGroupMatchV5([luffyCard], normalizeCatalogQueryV5('Monkey D Luffy'), 'all')).toBe(luffyCard);
  });

  it('normalizes base set codes by removing language suffixes like EB03-CN, EB03-FR, OP01-JP', () => {
    expect(normalizeBaseSetCode('EB03-CN')).toBe('EB03');
    expect(normalizeBaseSetCode('EB03-FR')).toBe('EB03');
    expect(normalizeBaseSetCode('EB03-JP')).toBe('EB03');
    expect(normalizeBaseSetCode('OP01-JP')).toBe('OP01');
    expect(normalizeBaseSetCode('OP01-CN')).toBe('OP01');
    expect(normalizeBaseSetCode('OP01-KR')).toBe('OP01');
    expect(normalizeBaseSetCode('ST01-JP')).toBe('ST01');
    expect(normalizeBaseSetCode('P-JP')).toBe('P');
    expect(normalizeBaseSetCode('PROMO')).toBe('P');
    expect(normalizeBaseSetCode('P')).toBe('P');

    // Retains compound set codes and non-language hyphens
    expect(normalizeBaseSetCode('PRB-01')).toBe('PRB-01');
    expect(normalizeBaseSetCode('PRB-02')).toBe('PRB-02');
    expect(normalizeBaseSetCode('OP14-EB04')).toBe('OP14-EB04');
    expect(normalizeBaseSetCode('OP15-EB04')).toBe('OP15-EB04');
  });

  it('matches multilingual cards when filtering by the normalized base set code EB03', () => {
    const englishCard = {
      name: 'Nami',
      number: 'EB03-001',
      setCode: 'EB03',
      variant: 'Standard',
      language: 'English',
    };
    const chineseCard = {
      name: 'Nami',
      number: 'EB03-001',
      setCode: 'EB03-CN',
      variant: 'Standard',
      language: 'Chinese',
    };
    const frenchCard = {
      name: 'Nami',
      number: 'EB03-001',
      setCode: 'EB03-FR',
      variant: 'Standard',
      language: 'French',
    };

    // Base set filter EB03 matches all language variants
    expect(selectCardGroupMatchV5([englishCard], '', 'EB03')).toBe(englishCard);
    expect(selectCardGroupMatchV5([chineseCard], '', 'EB03')).toBe(chineseCard);
    expect(selectCardGroupMatchV5([frenchCard], '', 'EB03')).toBe(frenchCard);
  });

  it('matches all P-xxx promotional cards when filtering by set P', () => {
    const promoCard1 = {
      name: 'Monkey.D.Luffy',
      number: 'P-001',
      setCode: 'P',
      variant: 'Standard',
    };
    const promoCard2 = {
      name: 'Kaido',
      number: 'P-040',
      setCode: 'PROMO',
      variant: 'Standard',
    };
    const promoCard3 = {
      name: 'Koby',
      number: 'P-014',
      setCode: 'PRB01',
      variant: 'Alternate art',
    };

    expect(selectCardGroupMatchV5([promoCard1], '', 'P')).toBe(promoCard1);
    expect(selectCardGroupMatchV5([promoCard2], '', 'P')).toBe(promoCard2);
    expect(selectCardGroupMatchV5([promoCard3], '', 'P')).toBe(promoCard3);
  });

  it('matches all tournament promo cards when filtering by set STP', () => {
    const trophyCard = {
      name: 'Flame-Flame Fruit (Coliseum Champion)',
      productName: 'Flame-Flame Fruit Coliseum Champion Trophy Card',
      number: 'P-TROPHY-906851',
      setCode: 'STP',
      set: 'Special Tournaments Promos',
      variant: 'Coliseum Champion Trophy Card · Cardmarket #906851',
    };
    const storeTournamentCard = {
      name: 'Usopp',
      number: 'OP01-004',
      setCode: 'OP01',
      set: 'Special Tournaments Promos',
      variant: 'Promotional art · Store Tournament 2023 · TCGplayer #450304',
      cardmarketExpansionId: 5262,
    };
    const regionalWinnerCard = {
      name: 'Monkey.D.Luffy (001)',
      number: 'P-001',
      setCode: 'P',
      set: 'One Piece Promotion Cards',
      variant: 'Offline Regional 2024 Vol. 2 Winner · TCGplayer #544772',
      cardmarketExpansionId: 5262,
    };

    expect(selectCardGroupMatchV5([trophyCard], '', 'STP')).toBe(trophyCard);
    expect(selectCardGroupMatchV5([storeTournamentCard], '', 'STP')).toBe(storeTournamentCard);
    expect(selectCardGroupMatchV5([regionalWinnerCard], '', 'STP')).toBe(regionalWinnerCard);
  });
});
