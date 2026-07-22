import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const snapshot = JSON.parse(await readFile(
  resolve(root, 'src/data/generated/onepiece-market-v10.json'),
  'utf8',
));
const sealed = snapshot.assets.filter((asset) => asset.kind === 'sealed');
const releasedCount = snapshot.provenance.catalogCounts.releasedSealedProducts;

describe('sealed product image cache v10', () => {
  it('ships every released sealed product with its verified immutable WebP', async () => {
    let totalBytes = 0;
    for (const asset of sealed) {
      const relativePath = asset.imageUrl.replace(/^\//, '');
      const filePath = resolve(root, 'public', relativePath);
      const bytes = await readFile(filePath);
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
      totalBytes += bytes.length;

      expect(createHash('sha256').update(bytes).digest('hex'), asset.id)
        .toBe(asset.imageOutputDigest);
      expect(metadata.format, asset.id).toBe('webp');
      expect(metadata.width, asset.id).toBeGreaterThanOrEqual(200);
      expect(metadata.height, asset.id).toBeGreaterThanOrEqual(200);
      expect(asset.imageUrl, asset.id).toContain(asset.imageOutputDigest.slice(0, 12));
      expect(['exact-product', 'contained-unit'], asset.id).toContain(asset.imageSourceRelationship);
    }

    expect(sealed).toHaveLength(releasedCount);
    expect(snapshot.provenance.catalogCounts.releasedSealedProductsWithImages).toBe(sealed.length);
    expect(snapshot.provenance.catalogCounts.releasedSealedProductsWithoutImages).toBe(0);
    expect(totalBytes).toBeLessThan(25 * 1024 * 1024);

    const byProductId = new Map(sealed.map((asset) => [asset.cardmarketProductId, asset]));
    for (const asset of sealed.filter((candidate) => candidate.imageSourceRelationship === 'contained-unit')) {
      const source = byProductId.get(asset.imageSourceProductId);
      expect(source, asset.id).toBeDefined();
      expect(source?.imageSourceRelationship, asset.id).toBe('exact-product');
      expect(source?.imageSourceDigest, asset.id).toBe(asset.imageSourceDigest);
    }
  });
});
