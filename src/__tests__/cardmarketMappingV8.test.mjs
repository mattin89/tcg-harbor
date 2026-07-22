import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  assertCardmarketMappingContinuity,
  matchCardmarketReleaseProducts,
} from '../../scripts/lib/cardmarket-mapping-v8.mjs';

const identity = (card) => card.id;
const number = (entry) => entry.number;

describe('Cardmarket v8 artwork-safe mapping', () => {
  it('maps the only printing to the only product in a proven release', () => {
    const result = matchCardmarketReleaseProducts({
      groupCode: 'OP03',
      expansionId: 5364,
      cards: [{ id: 'ST01-012_p1', number: 'ST01-012' }],
      products: [{ idProduct: 720061, number: 'ST01-012' }],
      priceByProduct: new Map([[720061, { trend: 41.2 }]]),
      cardIdentity: identity,
      cardNumber: number,
      productNumber: number,
    });

    expect(result.exact).toHaveLength(1);
    expect(result.exact[0]).toMatchObject({
      identity: 'ST01-012_p1',
      groupCode: 'OP03',
      expansionId: 5364,
      product: { idProduct: 720061 },
      price: { trend: 41.2 },
    });
    expect(result.ambiguous).toHaveLength(0);
  });

  it('does not infer V.1/V.2 from product ID order or price', () => {
    const result = matchCardmarketReleaseProducts({
      groupCode: 'OP03',
      expansionId: 5364,
      cards: [
        { id: 'OP03-018', number: 'OP03-018' },
        { id: 'OP03-018_p1', number: 'OP03-018' },
      ],
      products: [
        { idProduct: 719387, number: 'OP03-018' },
        { idProduct: 719388, number: 'OP03-018' },
      ],
      priceByProduct: new Map([
        [719387, { trend: 17.38 }],
        [719388, { trend: 0.17 }],
      ]),
      cardIdentity: identity,
      cardNumber: number,
      productNumber: number,
    });

    expect(result.exact).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(2);
    expect(result.ambiguous[0].candidates).toEqual([
      { productId: 719387, trend: 17.38 },
      { productId: 719388, trend: 0.17 },
    ]);
    expect(result.ambiguous[0].priceRange).toEqual({
      minimumTrend: 0.17,
      maximumTrend: 17.38,
      pricedCandidates: 2,
      totalCandidates: 2,
    });
  });

  it('reserves an independently verified base mapping before matching leftovers', () => {
    const base = { id: 'EB03-013', number: 'EB03-013' };
    const alternate = { id: 'EB03-013_p1', number: 'EB03-013' };
    const seededMatches = new Map([['EB03-013', { product: { idProduct: 871978 } }]]);
    const result = matchCardmarketReleaseProducts({
      groupCode: 'EB-03',
      expansionId: 6449,
      cards: [base, alternate],
      products: [{ idProduct: 871978, number: 'EB03-013' }],
      priceByProduct: new Map([[871978, { trend: 0.12 }]]),
      seededMatches,
      usedProductIds: new Set([871978]),
      cardIdentity: identity,
      cardNumber: number,
      productNumber: number,
    });

    expect(result.exact).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.unavailable).toEqual([
      expect.objectContaining({ identity: 'EB03-013_p1' }),
    ]);
  });
});

describe('Cardmarket v8 exact-mapping continuity', () => {
  const generatedAt = '2026-07-21T16:50:50.539Z';
  const exact = (id, cardmarketProductId) => ({
    id,
    kind: 'card',
    cardmarketProductId,
  });

  it('preserves prior exact IDs while allowing new exact mappings', () => {
    expect(assertCardmarketMappingContinuity({
      previousAssets: [
        exact('card-optcg-existing', 690370),
        exact('card-optcg-new', null),
      ],
      nextAssets: [
        exact('card-optcg-existing', 690370),
        exact('card-optcg-new', 720061),
      ],
      generatedAt,
    })).toEqual([]);
  });

  it('fails when a prior exact product changes or disappears', () => {
    expect(() => assertCardmarketMappingContinuity({
      previousAssets: [
        exact('card-optcg-changed', 690370),
        exact('card-optcg-removed', 720061),
      ],
      nextAssets: [exact('card-optcg-changed', 690371)],
      generatedAt,
    })).toThrow(/continuity failed for 2 card printing/);
  });

  it('accepts only an exact, unexpired reviewed exception', () => {
    const previousAssets = [exact('card-optcg-correction', 690370)];
    const nextAssets = [exact('card-optcg-correction', 690371)];
    const validApproval = new Map([['card-optcg-correction', {
      previousProductId: 690370,
      nextProductId: 690371,
      reason: 'Reviewed upstream artwork correction',
      expiresAt: '2026-08-01T00:00:00.000Z',
    }]]);

    expect(assertCardmarketMappingContinuity({
      previousAssets,
      nextAssets,
      approvals: validApproval,
      generatedAt,
    })).toEqual([expect.objectContaining({
      assetId: 'card-optcg-correction',
      previousProductId: 690370,
      nextProductId: 690371,
    })]);

    validApproval.get('card-optcg-correction').expiresAt = generatedAt;
    expect(() => assertCardmarketMappingContinuity({
      previousAssets,
      nextAssets,
      approvals: validApproval,
      generatedAt,
    })).toThrow(/continuity failed/);
  });

  it('protects exact promo mappings as well as OPTCG mappings', () => {
    expect(() => assertCardmarketMappingContinuity({
      previousAssets: [exact('card-tcgplayer-promo', 800001)],
      nextAssets: [exact('card-tcgplayer-promo', 800002)],
      generatedAt,
    })).toThrow(/continuity failed for 1 card printing/);
  });

  it('preserves every exact v7 card mapping in the generated v8 snapshot', async () => {
    const [previousSnapshot, nextSnapshot] = await Promise.all([
      readFile(new URL('../data/generated/onepiece-market-v7.json', import.meta.url), 'utf8').then(JSON.parse),
      readFile(new URL('../data/generated/onepiece-market-v8.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);

    expect(assertCardmarketMappingContinuity({
      previousAssets: previousSnapshot.assets,
      nextAssets: nextSnapshot.assets,
      generatedAt: nextSnapshot.generatedAt,
    })).toEqual([]);
  });

  it('protects mappings introduced by v8 when v8 is the next-run baseline', async () => {
    const snapshot = JSON.parse(await readFile(
      new URL('../data/generated/onepiece-market-v8.json', import.meta.url),
      'utf8',
    ));
    const introduced = snapshot.assets.find((asset) =>
      asset.kind === 'card'
      && asset.sourcePrintingId === 'ST01-012_p1'
      && asset.cardmarketProductId === 720061,
    );
    expect(introduced).toBeDefined();
    const nextAssets = snapshot.assets.map((asset) => (
      asset.id === introduced.id ? { ...asset, cardmarketProductId: null } : asset
    ));

    expect(() => assertCardmarketMappingContinuity({
      previousAssets: snapshot.assets,
      nextAssets,
      generatedAt: '2026-07-22T00:00:00.000Z',
    })).toThrow(/continuity failed for 1 card printing/);
  });
});
