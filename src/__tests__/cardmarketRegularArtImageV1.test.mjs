import { describe, expect, it } from 'vitest';
import {
  artworkCorrelationV1,
  cardmarketImageFolderV1,
  cardmarketProductImageUrlsV1,
  chooseRegularArtImageMatchV1,
  hasCompleteArtworkCandidateSetV2,
  mapWithConcurrencyV1,
} from '../../scripts/lib/cardmarket-regular-art-v1.mjs';

function fingerprint(values, digest = 'fixture') {
  const pixels = Buffer.from(values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  ) / values.length);
  return { pixels, mean, deviation, digest };
}

describe('Cardmarket regular-art image matching v1', () => {
  it('fails closed unless every current candidate image is present exactly once', () => {
    const requested = [{ productId: 1 }, { productId: 2 }, { productId: 3 }];
    expect(hasCompleteArtworkCandidateSetV2(requested, [
      { productId: 3 }, { productId: 1 }, { productId: 2 },
    ])).toBe(true);
    expect(hasCompleteArtworkCandidateSetV2(requested, [
      { productId: 1 }, { productId: 2 },
    ])).toBe(false);
    expect(hasCompleteArtworkCandidateSetV2(requested, [
      { productId: 1 }, { productId: 2 }, { productId: 2 },
    ])).toBe(false);
  });

  it('constructs only scoped One Piece product-image candidates', () => {
    expect(cardmarketImageFolderV1('EB-01')).toBe('EB01');
    expect(cardmarketImageFolderV1('PRB-02')).toBe('PRB02');
    expect(cardmarketImageFolderV1('OP15-EB04')).toBe('OP15');
    expect(cardmarketImageFolderV1('unknown')).toBeNull();
    expect(cardmarketProductImageUrlsV1('OP03', 719388)).toEqual([
      'https://product-images.s3.cardmarket.com/1621/OP03/719388/719388.jpg',
      'https://product-images.s3.cardmarket.com/1621/OP03/719388/719388.png',
    ]);
    expect(cardmarketProductImageUrlsV1('ST-01', 690965)).toEqual([
      'https://product-images.s3.cardmarket.com/1621/ST01/690965/690965.jpg',
      'https://product-images.s3.cardmarket.com/1621/ST01/690965/690965.png',
      'https://product-images.s3.cardmarket.com/1621/ST-01/690965/690965.jpg',
      'https://product-images.s3.cardmarket.com/1621/ST-01/690965/690965.png',
    ]);
  });

  it('accepts a unique high-correlation artwork without using price or product order', () => {
    const source = fingerprint([10, 25, 80, 160, 220, 180, 70, 15], 'source');
    const matching = fingerprint([11, 26, 82, 158, 219, 179, 72, 16], 'matching');
    const wrong = fingerprint([220, 170, 90, 15, 20, 80, 170, 230], 'wrong');
    const match = chooseRegularArtImageMatchV1({
      sourceFingerprint: source,
      candidates: [
        { productId: 900002, trend: 0.02, fingerprint: wrong },
        { productId: 800001, trend: 9999, fingerprint: matching },
      ],
      minimumCorrelation: 0.98,
      minimumMargin: 0.1,
    });

    expect(artworkCorrelationV1(source, matching)).toBeGreaterThan(0.99);
    expect(match).toMatchObject({
      productId: 800001,
      sourceDigest: 'source',
      productDigest: 'matching',
    });
  });

  it('fails closed when the best artwork lacks confidence or separation', () => {
    const source = fingerprint([10, 30, 60, 100, 150, 210, 170, 80]);
    const nearOne = fingerprint([11, 30, 61, 99, 151, 209, 169, 81]);
    const nearTwo = fingerprint([9, 31, 59, 101, 149, 211, 171, 79]);

    expect(chooseRegularArtImageMatchV1({
      sourceFingerprint: source,
      candidates: [
        { productId: 1, fingerprint: nearOne },
        { productId: 2, fingerprint: nearTwo },
      ],
      minimumCorrelation: 0.98,
      minimumMargin: 0.05,
    })).toBeNull();

    expect(chooseRegularArtImageMatchV1({
      sourceFingerprint: source,
      candidates: [{ productId: 3, fingerprint: fingerprint([80, 70, 60, 50, 40, 30, 20, 10]) }],
      minimumCorrelation: 0.98,
      minimumMargin: 0.05,
    })).toBeNull();
  });

  it('keeps bounded concurrent work in input order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrencyV1([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(result).toEqual([6, 2, 4, 8]);
  });
});
