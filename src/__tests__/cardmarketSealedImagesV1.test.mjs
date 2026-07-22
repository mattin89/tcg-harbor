import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  CARDMARKET_SEALED_IMAGE_POLICY_V1,
  cardmarketSealedImageUrlsV1,
  immutableSealedImagePathV1,
  normalizeSealedProductImageV1,
  sealedImageCacheSourceMatchesV1,
} from '../../scripts/lib/cardmarket-sealed-images-v1.mjs';

describe('Cardmarket sealed product image cache', () => {
  it('derives only the exact category and product image paths', () => {
    expect(cardmarketSealedImageUrlsV1(1622, 750070)).toEqual([
      'https://product-images.s3.cardmarket.com/1622/750070/750070.jpg',
      'https://product-images.s3.cardmarket.com/1622/750070/750070.png',
    ]);
    expect(cardmarketSealedImageUrlsV1('bad', 750070)).toEqual([]);
    expect(cardmarketSealedImageUrlsV1(9999, 750070)).toEqual([]);
  });

  it('validates and converts product art into a bounded WebP cache asset', async () => {
    const pixels = Buffer.alloc(320 * 240 * 3);
    for (let index = 0; index < pixels.length; index += 3) {
      const pixel = index / 3;
      const x = pixel % 320;
      const y = Math.floor(pixel / 320);
      pixels[index] = (x * 3 + y) % 256;
      pixels[index + 1] = (x + y * 5) % 256;
      pixels[index + 2] = (x * 7 + y * 11) % 256;
    }
    const source = await sharp(pixels, {
      raw: { width: 320, height: 240, channels: 3 },
    }).png().toBuffer();
    const normalized = await normalizeSealedProductImageV1(source);
    const metadata = await sharp(normalized.outputBytes).metadata();

    expect(normalized.sourceDigest).toBe(createHash('sha256').update(source).digest('hex'));
    expect(normalized.outputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(immutableSealedImagePathV1(750070, normalized.outputDigest)).toBe(
      `/catalog/sealed/v1/750070-${normalized.outputDigest.slice(0, 12)}.webp`,
    );
  });

  it('rejects missing, tiny, and invalid image payloads', async () => {
    await expect(normalizeSealedProductImageV1(Buffer.alloc(0))).rejects.toThrow(/empty/i);
    await expect(normalizeSealedProductImageV1(Buffer.from('not an image'))).rejects.toThrow();
    const tiny = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await expect(normalizeSealedProductImageV1(tiny)).rejects.toThrow(/too small/i);
    const generic = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#eeeeee' },
    }).png().toBuffer();
    await expect(normalizeSealedProductImageV1(generic)).rejects.toThrow(/visual detail|placeholder/i);
  });

  it('reuses a cache entry only when its complete source identity is still current', () => {
    const expected = {
      sourceProductId: 750070,
      relationship: 'exact-product',
      sourceUrl: 'https://en.onepiece-cardgame.com/images/products/boosters/op07/img_thumbnail.png',
      evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/op07.php',
      sourceName: 'Bandai official English product page',
    };
    const asset = {
      imageSourceProductId: 750070,
      imageSourceRelationship: 'exact-product',
      imageSourceUrl: expected.sourceUrl,
      imageEvidenceUrl: expected.evidenceUrl,
      imageSourceName: expected.sourceName,
      imageSourceDigest: 'a'.repeat(64),
    };

    expect(sealedImageCacheSourceMatchesV1(asset, expected)).toBe(true);
    expect(sealedImageCacheSourceMatchesV1(
      { ...asset, imageSourceUrl: 'https://stale.example/placeholder.jpg' },
      expected,
    )).toBe(false);
    expect(sealedImageCacheSourceMatchesV1({
      ...asset,
      imageSourceDigest: CARDMARKET_SEALED_IMAGE_POLICY_V1.knownPlaceholderSourceDigests[1],
    }, expected)).toBe(false);
  });
});
