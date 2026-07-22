import { describe, expect, it } from 'vitest';
import {
  assertCardmarketProductPageV1,
  cardmarketProductPageUrlV1,
  cardmarketProductPageReleaseAuditV1,
  cardmarketPresaleMarkerPresentV1,
  cardmarketProductSlugV1,
  cardmarketReleaseStateAtV1,
  isCanonicalCardmarketSealedProductV1,
  parseCardmarketPresaleReleaseV1,
} from '../../scripts/lib/cardmarket-sealed-release-v1.mjs';

describe('Cardmarket sealed release audit v1', () => {
  it('builds a bounded canonical product-page URL', () => {
    expect(cardmarketProductPageUrlV1({
      idProduct: 869915,
      idCategory: 1628,
      name: 'One Piece Card Game 3rd English Anniversary Set (English Version)',
    })).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/One-Piece-Card-Game-3rd-English-Anniversary-Set-English-Version',
    );
    expect(cardmarketProductSlugV1("The Azure's Sea Seven")).toBe('The-Azures-Sea-Seven');
    expect(() => cardmarketProductPageUrlV1({ idProduct: 1, idCategory: 9999, name: 'Nope' }))
      .toThrow(/Unsupported Cardmarket sealed category/);
  });

  it('parses the explicit English presale notice and validates the date', () => {
    expect(parseCardmarketPresaleReleaseV1(
      '<p>Attention: This is a presale item and will not be shipped before 28.08.2026</p>',
    )).toBe('2026-08-28');
    expect(parseCardmarketPresaleReleaseV1('<p>Available items</p>')).toBeNull();
    expect(() => parseCardmarketPresaleReleaseV1(
      '<p>Attention: This is a presale item and will not be shipped before 31.02.2026</p>',
    )).toThrow(/invalid release date/);
  });

  it('accepts only the exact requested Cardmarket product page', () => {
    const productName = 'One Piece Card Game 3rd English Anniversary Set (English Version)';
    const page = `<html><head><title>Cardmarket</title></head><body><h1>${productName}</h1></body></html>`;

    expect(assertCardmarketProductPageV1(page, productName)).toEqual({ heading: productName });
    expect(() => assertCardmarketProductPageV1(
      '<html><head><title>Cardmarket</title></head><body><h1>Login</h1></body></html>',
      productName,
    )).toThrow(/identity check failed/);
    expect(() => assertCardmarketProductPageV1(
      `<html><body><h1>${productName}</h1></body></html>`,
      productName,
    )).toThrow(/identity check failed/);
  });

  it('does not mistake active presale listings for release evidence', () => {
    const name = 'Legacy Collection Box';
    const releasedPage = `<html><head><title>Cardmarket</title></head><body>
      <h1>${name}</h1>
      <p>A sealed product can only be sold if it is SEALED in its original packaging.</p>
      <p>Available items 0 From N/A</p>
      <p>Currently there are no available offers for this article.</p>
    </body></html>`;
    expect(cardmarketProductPageReleaseAuditV1(
      releasedPage,
      name,
      '2026-07-22T00:00:00.000Z',
    )).toMatchObject({ state: 'unknown', releasedOn: null, presaleMarkerPresent: false });

    const unparsedPresalePage = releasedPage.replace(
      '</body>',
      '<p>This presale ships when the publisher confirms availability.</p></body>',
    );
    expect(cardmarketPresaleMarkerPresentV1(unparsedPresalePage)).toBe(true);
    expect(cardmarketPresaleMarkerPresentV1('<p>Pre-sale item</p>')).toBe(true);
    expect(cardmarketPresaleMarkerPresentV1('<p>Pre sale item</p>')).toBe(true);
    expect(cardmarketProductPageReleaseAuditV1(
      unparsedPresalePage,
      name,
      '2026-07-22T00:00:00.000Z',
    )).toMatchObject({ state: 'unknown', presaleMarkerPresent: true });

    const incompletePage = `<html><head><title>Cardmarket</title></head><body><h1>${name}</h1></body></html>`;
    expect(cardmarketProductPageReleaseAuditV1(
      incompletePage,
      name,
      '2026-07-22T00:00:00.000Z',
    )).toMatchObject({ state: 'unknown', releasedOn: null });
  });

  it('releases on the stated day and remains future before it', () => {
    expect(cardmarketReleaseStateAtV1('2026-08-28', '2026-08-27T23:59:59.999Z')).toBe('future');
    expect(cardmarketReleaseStateAtV1('2026-08-28', '2026-08-28T00:00:00.000Z')).toBe('released');
    expect(cardmarketReleaseStateAtV1(null, '2026-07-22T00:00:00.000Z')).toBe('unknown');
  });

  it('distinguishes canonical set products from ancillary packs that need exact-page audit', () => {
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Legacy of the Master Booster' },
      'Booster',
    )).toBe(true);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Legacy of the Master Sleeved Booster' },
      'Booster',
    )).toBe(true);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Legacy of the Master - Release Event Pack' },
      'Booster',
    )).toBe(false);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Starter Deck: Egghead Deck Pack' },
      'Preconstructed deck',
    )).toBe(false);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Starter Deck: Egghead' },
      'Preconstructed deck',
    )).toBe(true);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'The Best Vol.2 Booster Box Case (10x Booster Box)' },
      'Booster box',
    )).toBe(true);
    expect(isCanonicalCardmarketSealedProductV1(
      { name: 'Premium Card Collection - Best Selection Vol.6' },
      'Promo product',
    )).toBe(false);
  });
});
