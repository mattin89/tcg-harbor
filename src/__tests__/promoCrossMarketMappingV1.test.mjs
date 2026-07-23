import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardmarketPromoPrintedNumberV1,
  cardmarketPromoProductImageUrlsV1,
  choosePromoCrossMarketImageMatchesV1,
  hasCompletePromoArtworkCandidateMatrixV1,
  PROMO_CROSS_MARKET_MAPPING_POLICY_V1,
  validateCardmarketPromoExpansionRegistryV1,
} from '../../scripts/lib/promo-cross-market-mapping-v1.mjs';

function fingerprint(values, digestCharacter) {
  const pixels = Buffer.from(values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  ) / values.length);
  return { pixels, mean, deviation, digest: digestCharacter.repeat(64) };
}

function image(productId, values, digestCharacter, provider) {
  return {
    productId,
    imageUrl: `https://${provider}.example/${productId}.jpg`,
    fingerprint: fingerprint(values, digestCharacter),
  };
}

const registryPath = resolve(
  process.cwd(),
  'scripts/data/cardmarket-promo-expansions-v1.json',
);
const syncPath = resolve(process.cwd(), 'scripts/sync-onepiece-data-v10.mjs');

describe('promotional cross-market artwork mapping v1', () => {
  it('freezes a complete, bidirectional, image-only policy', () => {
    expect(PROMO_CROSS_MARKET_MAPPING_POLICY_V1).toMatchObject({
      minimumCorrelation: 0.985,
      minimumMargin: 0.08,
      candidateCoverage: 'complete-both-providers',
      refreshBuckets: 7,
      maximumEvidenceAgeDays: 14,
      transientGraceDays: 21,
    });
  });

  it('validates every reviewed English promo expansion and its exact unnumbered exclusions', async () => {
    const registry = validateCardmarketPromoExpansionRegistryV1(
      JSON.parse(await readFile(registryPath, 'utf8')),
    );

    expect(registry.expansions.map(({
      idExpansion,
      imageFolder,
      language,
      excludedUnnumberedProductIds,
    }) => ({
      idExpansion,
      imageFolder,
      language,
      excludedUnnumberedProductCount: excludedUnnumberedProductIds.length,
    }))).toEqual([
      {
        idExpansion: 5230,
        imageFolder: 'P',
        language: 'English',
        excludedUnnumberedProductCount: 5,
      },
      {
        idExpansion: 5262,
        imageFolder: 'STP',
        language: 'English',
        excludedUnnumberedProductCount: 20,
      },
      {
        idExpansion: 5267,
        imageFolder: 'PB-XX',
        language: 'English',
        excludedUnnumberedProductCount: 0,
      },
    ]);
    expect(registry.expansions[0].excludedUnnumberedProductIds).toEqual([
      746238,
      746239,
      780210,
      857368,
      867223,
    ]);
    expect(registry.expansions[1].excludedUnnumberedProductIds).toEqual([
      696662,
      696663,
      696664,
      696665,
      696666,
      696667,
      696668,
      696669,
      696670,
      696671,
      696672,
      748118,
      748119,
      752070,
      762652,
      773382,
      773429,
      821345,
      826292,
      826293,
    ]);
    expect(registry.expansions[2].excludedUnnumberedProductIds).toEqual([]);
    expect(registry.requiredCompletePricedPrintedNumbers).toEqual(['P-041']);
    expect(registry.reviewedArtworkMappings).toHaveLength(10);
    expect(registry.reviewedArtworkMappings.every(
      (mapping) => mapping.printedNumber === 'P-041'
        && /^[a-f0-9]{64}$/.test(mapping.tcgplayerImageDigest)
        && /^[a-f0-9]{64}$/.test(mapping.cardmarketImageDigest),
    )).toBe(true);
    expect(registry.reviewedArtworkMappings.filter(
      (mapping) => mapping.cardmarketProductId === 766646,
    )).toHaveLength(2);
    expect(registry.verifiedPairInvariants).toContainEqual(expect.objectContaining({
      printedNumber: 'OP01-016',
      tcgplayerProductId: 485265,
      cardmarketProductId: 698921,
    }));
    expect(cardmarketPromoProductImageUrlsV1('P', 750655)).toEqual([
      'https://product-images.s3.cardmarket.com/1621/P/750655/750655.jpg',
      'https://product-images.s3.cardmarket.com/1621/P/750655/750655.png',
    ]);
    expect(cardmarketPromoProductImageUrlsV1('STP', 787461)).toEqual([
      'https://product-images.s3.cardmarket.com/1621/STP/787461/787461.jpg',
      'https://product-images.s3.cardmarket.com/1621/STP/787461/787461.png',
    ]);
    expect(cardmarketPromoProductImageUrlsV1('PB-XX', 698921)).toEqual([
      'https://product-images.s3.cardmarket.com/1621/PB-XX/698921/698921.jpg',
      'https://product-images.s3.cardmarket.com/1621/PB-XX/698921/698921.png',
    ]);
  });

  it('rejects invalid and registry-wide duplicate excluded promo product IDs', async () => {
    const registrySource = await readFile(registryPath, 'utf8');
    const duplicate = JSON.parse(registrySource);
    duplicate.expansions
      .find(({ idExpansion }) => idExpansion === 5262)
      .excludedUnnumberedProductIds.push(746238);
    expect(() => validateCardmarketPromoExpansionRegistryV1(duplicate))
      .toThrow(/^Invalid or duplicate excluded Cardmarket promo product 746238\.$/);

    const invalid = JSON.parse(registrySource);
    invalid.expansions
      .find(({ idExpansion }) => idExpansion === 5230)
      .excludedUnnumberedProductIds[0] = 0;
    expect(() => validateCardmarketPromoExpansionRegistryV1(invalid))
      .toThrow(/^Invalid or duplicate excluded Cardmarket promo product 0\.$/);

    const duplicateRequiredNumber = JSON.parse(registrySource);
    duplicateRequiredNumber.requiredCompletePricedPrintedNumbers.push('p-041');
    expect(() => validateCardmarketPromoExpansionRegistryV1(duplicateRequiredNumber))
      .toThrow(/^Invalid or duplicate required priced promotional printed number\.$/);

    const unsafeSharedMapping = JSON.parse(registrySource);
    unsafeSharedMapping.reviewedArtworkMappings
      .find((mapping) => mapping.reviewId === 'P-041:544782:766646')
      .allowSharedCardmarketProduct = false;
    expect(() => validateCardmarketPromoExpansionRegistryV1(unsafeSharedMapping))
      .toThrow(/^Reviewed Cardmarket promotional product 766646 has an unsafe shared mapping\.$/);
  });

  it('attempts reviewed invariants first and counts promos by provider source, not display label', async () => {
    const sync = await readFile(syncPath, 'utf8');
    expect(sync).toContain('Number(right.requiredInvariant) - Number(left.requiredInvariant)');
    expect(sync).toContain('(asset) => asset.tcgplayerGroupId === TCGCSV_PROMO_GROUP_ID');
    expect(sync).not.toContain('(asset) => /promo/i.test(asset.variant)');
  });

  it('recognizes numbered promo, starter, booster, extra, and premium products only at the exact suffix', () => {
    expect(cardmarketPromoPrintedNumberV1('Monkey.D.Luffy (P-001)')).toBe('P-001');
    expect(cardmarketPromoPrintedNumberV1('Nami (OP01-016)')).toBe('OP01-016');
    expect(cardmarketPromoPrintedNumberV1('Nami (OP01-016) extra')).toBeNull();
    expect(cardmarketPromoPrintedNumberV1('Unknown card')).toBeNull();
  });

  it('reproduces the reviewed Nami pair from a complete same-number matrix', () => {
    const nami = [8, 24, 60, 110, 172, 226, 185, 91];
    const gift = [230, 178, 96, 28, 15, 72, 164, 221];
    const deck = [35, 208, 69, 184, 15, 232, 104, 149];
    const anniversary = [218, 32, 191, 61, 151, 242, 83, 11];
    const tcgplayerImages = [
      image(485265, nami, 'a', 'tcgplayer'),
      image(523775, gift, 'b', 'tcgplayer'),
      image(527619, deck, 'c', 'tcgplayer'),
      image(557286, anniversary, 'd', 'tcgplayer'),
    ];
    const cardmarketImages = [
      image(698921, nami, 'e', 'cardmarket'),
      image(778601, gift, 'f', 'cardmarket'),
    ];
    const matches = choosePromoCrossMarketImageMatchesV1({
      requestedTcgplayerCandidates: tcgplayerImages.map(({ productId }) => ({ productId })),
      availableTcgplayerImages: [...tcgplayerImages].reverse(),
      requestedCardmarketCandidates: cardmarketImages.map(({ productId }) => ({ productId })),
      availableCardmarketImages: [...cardmarketImages].reverse(),
    });

    expect(matches).toContainEqual(expect.objectContaining({
      tcgplayerProductId: 485265,
      cardmarketProductId: 698921,
      tcgplayerCandidateCount: 4,
      cardmarketCandidateCount: 2,
    }));
  });

  it('fails the whole number closed when either provider candidate set is incomplete', () => {
    const tcgplayerImages = [image(1, [1, 20, 50, 90], '1', 'tcgplayer')];
    const cardmarketImages = [image(10, [1, 20, 50, 90], '2', 'cardmarket')];
    const input = {
      requestedTcgplayerCandidates: [{ productId: 1 }, { productId: 2 }],
      availableTcgplayerImages: tcgplayerImages,
      requestedCardmarketCandidates: [{ productId: 10 }],
      availableCardmarketImages: cardmarketImages,
    };

    expect(hasCompletePromoArtworkCandidateMatrixV1(input)).toBe(false);
    expect(choosePromoCrossMarketImageMatchesV1(input)).toEqual([]);
  });

  it('rejects a pair that is not separated in both mapping directions', () => {
    const first = [10, 30, 60, 100, 150, 210, 170, 80];
    const nearlySame = [11, 30, 61, 99, 151, 209, 169, 81];
    const input = {
      requestedTcgplayerCandidates: [{ productId: 1 }, { productId: 2 }],
      availableTcgplayerImages: [
        image(1, first, '1', 'tcgplayer'),
        image(2, nearlySame, '2', 'tcgplayer'),
      ],
      requestedCardmarketCandidates: [{ productId: 10 }],
      availableCardmarketImages: [image(10, first, '3', 'cardmarket')],
    };

    expect(choosePromoCrossMarketImageMatchesV1(input)).toEqual([]);
  });
});
