import { describe, expect, it } from 'vitest';
import { catalogAssets } from '../data/demo';

describe('catalog erratas and reprints', () => {
  it('includes both errata (OP01E) and reprint versions for Trafalgar Law (OP01-002)', () => {
    const law002Cards = catalogAssets.filter(
      (asset) => asset.number === 'OP01-002',
    );

    // Standard pre-errata (OP01E, Cardmarket #768136)
    const errataStd = law002Cards.find((c) => c.cardmarketProductId === 768136);
    expect(errataStd).toBeDefined();
    expect(errataStd?.name).toBe('OP01E Trafalgar Law (OP01-002) (V.2)');
    expect(errataStd?.setCode).toBe('OP01E');
    expect(errataStd?.set).toBe('Romance Dawn (Pre-Errata)');
    expect(errataStd?.variant).toBe('Standard · Pre-Errata');
    expect(errataStd?.cardmarketExpansionId).toBe(5624);
    expect(errataStd?.quote.cardmarket).toBe(3.43);
    expect(errataStd?.imageUrl).toBeTruthy();

    // Alternate art pre-errata (OP01E, Cardmarket #755413)
    const errataAlt = law002Cards.find((c) => c.cardmarketProductId === 755413);
    expect(errataAlt).toBeDefined();
    expect(errataAlt?.name).toBe('OP01E Trafalgar Law (OP01-002) (V.2)');
    expect(errataAlt?.setCode).toBe('OP01E');
    expect(errataAlt?.variant).toBe('Alternate art · Pre-Errata');
    expect(errataAlt?.cardmarketExpansionId).toBe(5624);
    expect(errataAlt?.quote.cardmarket).toBe(744.56);
    expect(errataAlt?.imageUrl).toBeTruthy();

    // Standard reprint (OP01, Cardmarket #690793)
    const reprintStd = law002Cards.find((c) => c.cardmarketProductId === 690793);
    expect(reprintStd).toBeDefined();
    expect(reprintStd?.name).toBe('OP01 Trafalgar Law (OP01-002) (Reprint)');
    expect(reprintStd?.setCode).toBe('OP01');
    expect(reprintStd?.variant).toBe('Standard · Reprint');
    expect(reprintStd?.cardmarketExpansionId).toBe(5229);
    expect(reprintStd?.quote.cardmarket).toBe(1.03);

    // Alternate art reprint (OP01, Cardmarket #690794)
    const reprintAlt = law002Cards.find((c) => c.cardmarketProductId === 690794);
    expect(reprintAlt).toBeDefined();
    expect(reprintAlt?.name).toBe('OP01 Trafalgar Law (OP01-002) (Reprint)');
    expect(reprintAlt?.setCode).toBe('OP01');
    expect(reprintAlt?.variant).toBe('Alternate art · Reprint');
    expect(reprintAlt?.cardmarketExpansionId).toBe(5229);
    expect(reprintAlt?.quote.cardmarket).toBe(474.78);
  });

  it('contains all 78 Romance Dawn OP01E errata cards with images and Cardmarket pricing', () => {
    const op01eCards = catalogAssets.filter((c) => c.setCode === 'OP01E');
    expect(op01eCards).toHaveLength(78);
    expect(op01eCards.every((c) => c.cardmarketExpansionId === 5624)).toBe(true);
    expect(op01eCards.every((c) => c.cardmarketPriceState === 'available')).toBe(true);
    expect(op01eCards.every((c) => typeof c.quote.cardmarket === 'number' && c.quote.cardmarket > 0)).toBe(true);
    expect(op01eCards.every((c) => c.imageUrl?.startsWith('http'))).toBe(true);
    expect(op01eCards.every((c) => c.name.startsWith('OP01E ') && c.name.endsWith('(V.2)'))).toBe(true);
  });

  it('contains all 45 Revision Pack errata reprint cards with images and Cardmarket pricing', () => {
    const revCards = catalogAssets.filter((c) => c.setCode === 'REV1');
    expect(revCards).toHaveLength(45);
    expect(revCards.every((c) => c.cardmarketExpansionId === 5302)).toBe(true);
    expect(revCards.every((c) => c.cardmarketPriceState === 'available')).toBe(true);
    expect(revCards.every((c) => typeof c.quote.cardmarket === 'number' && c.quote.cardmarket > 0)).toBe(true);
    expect(revCards.every((c) => c.imageUrl?.startsWith('http'))).toBe(true);
    expect(revCards.every((c) => c.name.startsWith('Revision Pack: ') && c.name.endsWith('(Errata)'))).toBe(true);
  });
});
