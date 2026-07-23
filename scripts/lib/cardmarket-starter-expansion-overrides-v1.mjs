const PRECONSTRUCTED_DECK_CATEGORY_V1 = 'One Piece Preconstructed Decks';

/**
 * Cardmarket's non-singles catalog is the authoritative bridge between these
 * stable deck product IDs and their single-card expansion IDs. The product
 * titles do not expose enough normalized ST identity for the generic matcher,
 * so each exception is deliberately scoped to one reviewed product ID and one
 * frozen expansion ID.
 */
export const REVIEWED_CARDMARKET_STARTER_EXPANSION_OVERRIDES_V1 = Object.freeze([
  Object.freeze({ productId: 695261, setCode: 'ST05', expansionId: 5255 }),
  Object.freeze({ productId: 714451, setCode: 'ST10', expansionId: 5380 }),
  Object.freeze({ productId: 750521, setCode: 'ST12', expansionId: 5593 }),
  Object.freeze({ productId: 767014, setCode: 'ST15', expansionId: 5747 }),
  Object.freeze({ productId: 767018, setCode: 'ST17', expansionId: 5749 }),
  Object.freeze({ productId: 767024, setCode: 'ST19', expansionId: 5751 }),
]);

export const REVIEWED_CARDMARKET_STARTER_SET_CODE_BY_PRODUCT_V1 = new Map(
  REVIEWED_CARDMARKET_STARTER_EXPANSION_OVERRIDES_V1.map(
    ({ productId, setCode }) => [productId, setCode],
  ),
);

export function assertReviewedCardmarketStarterExpansionOverridesV1(nonSingles) {
  const productsById = new Map(
    nonSingles.map((product) => [Number(product.idProduct), product]),
  );

  for (const override of REVIEWED_CARDMARKET_STARTER_EXPANSION_OVERRIDES_V1) {
    const product = productsById.get(override.productId);
    if (!product) {
      throw new Error(
        `Reviewed Cardmarket starter product ${override.productId} (${override.setCode}) disappeared from the non-singles catalog.`,
      );
    }
    if (product.categoryName !== PRECONSTRUCTED_DECK_CATEGORY_V1) {
      throw new Error(
        `Reviewed Cardmarket starter product ${override.productId} left the preconstructed-deck category.`,
      );
    }
    if (Number(product.idExpansion) !== override.expansionId) {
      throw new Error(
        `Reviewed Cardmarket starter product ${override.productId} moved from expansion ${override.expansionId} to ${product.idExpansion}.`,
      );
    }
  }
}
