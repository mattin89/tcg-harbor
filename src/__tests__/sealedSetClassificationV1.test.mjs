import { describe, expect, it } from 'vitest';
import {
  buildReleasedSealedSetCodeByExpansionV1,
  normalizedDeckProductTitleV1,
  resolveSealedSetCodeV1,
} from '../../scripts/lib/sealed-set-classification-v1.mjs';

const booster = { productType: 'Booster', setCode: 'BOOSTER' };
const deck = { productType: 'Preconstructed deck', setCode: 'DECK' };

describe('released sealed-set classification v1', () => {
  it('matches the official and Cardmarket ST30 title punctuation exactly', () => {
    expect(normalizedDeckProductTitleV1(
      'STARTER DECK EX -Luffy & Ace- [ST-30]',
    )).toBe('luffyace');
    expect(normalizedDeckProductTitleV1(
      'Starter Deck: EX Luffy & Ace',
    )).toBe('luffyace');
    expect(normalizedDeckProductTitleV1(
      'Starter Deck: Red Monkey.D.Luffy',
    )).not.toBe('luffyace');
  });

  it('classifies canonical and ancillary products through unique released expansion evidence', () => {
    const byExpansion = buildReleasedSealedSetCodeByExpansionV1([
      ['OP02', 5263],
      ['ST-30', 6608],
      ['EB-01', 5585],
    ]);
    const officialDeckTitles = new Map([['luffyace', 'ST30']]);

    expect(resolveSealedSetCodeV1({
      product: { idProduct: 696230, idExpansion: 5263, name: 'Paramount War Booster' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('OP02');
    expect(resolveSealedSetCodeV1({
      product: { idProduct: 891050, idExpansion: 6608, name: 'Starter Deck: EX Luffy & Ace' },
      category: deck,
      officialDeckSetCodesByTitle: officialDeckTitles,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('ST30');
    expect(resolveSealedSetCodeV1({
      product: { idProduct: 891015, idExpansion: 6608, name: 'Starter Deck EX: "Luffy & Ace" Bonus Pack Booster' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('ST30');
  });

  it('uses an explicit member code inside a proven composite expansion', () => {
    const byExpansion = buildReleasedSealedSetCodeByExpansionV1([
      ['OP15-EB04', 6456],
    ]);

    expect(resolveSealedSetCodeV1({
      product: { idProduct: 867939, idExpansion: 6456, name: 'OP15 Booster Box' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('OP15');
    expect(resolveSealedSetCodeV1({
      product: { idProduct: 867940, idExpansion: 6456, name: 'EB04 Booster' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('EB04');
    expect(resolveSealedSetCodeV1({
      product: { idProduct: 867941, idExpansion: 6456, name: 'Double Pack Booster' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('OP15-EB04');
  });

  it('fails closed when expansion evidence conflicts or is not released', () => {
    expect(() => buildReleasedSealedSetCodeByExpansionV1([
      ['OP02', 5263],
      ['OP03', 5263],
    ])).toThrow(/multiple released set codes/i);

    const byExpansion = buildReleasedSealedSetCodeByExpansionV1([['OP02', 5263]]);
    expect(() => resolveSealedSetCodeV1({
      product: { idProduct: 1, idExpansion: 5263, name: 'OP03 Booster' },
      category: booster,
      releasedSetCodeByExpansionId: byExpansion,
    })).toThrow(/conflicting set evidence/i);
    expect(() => resolveSealedSetCodeV1({
      product: { idProduct: 3, idExpansion: 6456, name: 'OP14 Booster' },
      category: booster,
      releasedSetCodeByExpansionId: buildReleasedSealedSetCodeByExpansionV1([
        ['OP15-EB04', 6456],
      ]),
    })).toThrow(/conflicting set evidence/i);
    expect(resolveSealedSetCodeV1({
      product: { idProduct: 2, idExpansion: 9999, name: 'Starter Deck: Red Monkey.D.Luffy' },
      category: deck,
      officialDeckSetCodesByTitle: new Map([['luffyace', 'ST30']]),
      releasedSetCodeByExpansionId: byExpansion,
    })).toBe('DECK');
  });
});
