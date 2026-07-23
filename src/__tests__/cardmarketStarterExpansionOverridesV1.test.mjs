import { describe, expect, it } from 'vitest';
import {
  assertReviewedCardmarketStarterExpansionOverridesV1,
  REVIEWED_CARDMARKET_STARTER_EXPANSION_OVERRIDES_V1,
  REVIEWED_CARDMARKET_STARTER_SET_CODE_BY_PRODUCT_V1,
} from '../../scripts/lib/cardmarket-starter-expansion-overrides-v1.mjs';

const reviewedRows = [
  [695261, 'ST05', 5255],
  [714451, 'ST10', 5380],
  [750521, 'ST12', 5593],
  [767014, 'ST15', 5747],
  [767018, 'ST17', 5749],
  [767024, 'ST19', 5751],
];

function catalogProducts() {
  return reviewedRows.map(([idProduct, _setCode, idExpansion]) => ({
    idProduct,
    idExpansion,
    categoryName: 'One Piece Preconstructed Decks',
    name: `Reviewed deck ${idProduct}`,
  }));
}

describe('reviewed Cardmarket starter expansion overrides v1', () => {
  it('contains only the six audited product-to-set-to-expansion identities', () => {
    expect(REVIEWED_CARDMARKET_STARTER_EXPANSION_OVERRIDES_V1).toEqual(
      reviewedRows.map(([productId, setCode, expansionId]) => ({
        productId,
        setCode,
        expansionId,
      })),
    );
    expect(Object.fromEntries(REVIEWED_CARDMARKET_STARTER_SET_CODE_BY_PRODUCT_V1))
      .toEqual(Object.fromEntries(
        reviewedRows.map(([productId, setCode]) => [productId, setCode]),
      ));
  });

  it('accepts only catalog rows that retain the reviewed expansion identity', () => {
    expect(() => assertReviewedCardmarketStarterExpansionOverridesV1(catalogProducts()))
      .not.toThrow();

    const moved = catalogProducts();
    moved[2] = { ...moved[2], idExpansion: 9999 };
    expect(() => assertReviewedCardmarketStarterExpansionOverridesV1(moved))
      .toThrow('Reviewed Cardmarket starter product 750521 moved from expansion 5593 to 9999.');
  });

  it('fails closed when a reviewed deck disappears or changes category', () => {
    expect(() => assertReviewedCardmarketStarterExpansionOverridesV1(
      catalogProducts().filter(({ idProduct }) => idProduct !== 767018),
    )).toThrow(
      'Reviewed Cardmarket starter product 767018 (ST17) disappeared from the non-singles catalog.',
    );

    const changedCategory = catalogProducts();
    changedCategory[0] = { ...changedCategory[0], categoryName: 'One Piece Lots' };
    expect(() => assertReviewedCardmarketStarterExpansionOverridesV1(changedCategory))
      .toThrow('Reviewed Cardmarket starter product 695261 left the preconstructed-deck category.');
  });
});
