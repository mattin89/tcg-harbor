import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const CARDMARKET_SEALED_IMAGE_POLICY_V1 = Object.freeze({
  allowedCategoryIds: Object.freeze([1622, 1624, 1625, 1628]),
  maximumImageBytes: 8 * 1024 * 1024,
  maximumInputPixels: 20_000_000,
  minimumWidth: 200,
  minimumHeight: 200,
  minimumEntropy: 1.75,
  outputWidth: 480,
  outputHeight: 480,
  webpQuality: 85,
  knownPlaceholderSourceDigests: Object.freeze([
    // Cardmarket's generic "image unavailable" art currently returned for
    // the unreleased Double Pack Set Vol.12 product (875688).
    '1825b07de69201c75b73595a8cd456943533e99dc033c4450f74549a09237ce1',
    // Product-specific-looking gray Cardmarket templates that contain no real
    // package photography/artwork. Exact Bandai overrides replace each one.
    'c599a3341fee86de7ce4118f6c1d0895fd78d61f7dfa6f7cd5f7a4423067f4e9',
    '539b4a8a4bf9e7e7ed0a8ff9794d44480b7a1edc7a3ebf70f38b699f2fba85bd',
    'a4e6b963bbad91f07bbc48470054157ad9c64aead5f2582cb611f1f2a98e090e',
    '9afef8a5a60091f86ef97e17330fb7b95a090d78432d40d08a6707593ec3ea99',
    '70c45fbaaa8ae45d280451123786f42f23b59b308982b79f8f0c5a4cc1d4b495',
  ]),
});

export function sealedImageCacheSourceMatchesV1(asset, expected) {
  const sourceDigest = String(asset?.imageSourceDigest ?? '').toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(sourceDigest)
    || CARDMARKET_SEALED_IMAGE_POLICY_V1.knownPlaceholderSourceDigests.includes(sourceDigest)
    || Number(asset?.imageSourceProductId) !== Number(expected?.sourceProductId)
    || (asset?.imageSourceRelationship ?? 'exact-product') !== expected?.relationship
  ) return false;

  for (const field of ['sourceUrl', 'evidenceUrl', 'sourceName']) {
    if (expected?.[field] != null) {
      const assetField = {
        sourceUrl: 'imageSourceUrl',
        evidenceUrl: 'imageEvidenceUrl',
        sourceName: 'imageSourceName',
      }[field];
      if (asset?.[assetField] !== expected[field]) return false;
    }
  }

  return true;
}

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function cardmarketSealedImageUrlsV1(categoryId, productId) {
  const category = positiveInteger(categoryId);
  const product = positiveInteger(productId);
  if (
    category == null
    || product == null
    || !CARDMARKET_SEALED_IMAGE_POLICY_V1.allowedCategoryIds.includes(category)
  ) return [];
  const base = `https://product-images.s3.cardmarket.com/${category}/${product}/${product}`;
  return [`${base}.jpg`, `${base}.png`];
}

export async function normalizeSealedProductImageV1(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (input.length === 0 || input.length > CARDMARKET_SEALED_IMAGE_POLICY_V1.maximumImageBytes) {
    throw new Error('Sealed product image bytes are empty or exceed the safe size limit.');
  }

  const sourceDigest = createHash('sha256').update(input).digest('hex');
  if (CARDMARKET_SEALED_IMAGE_POLICY_V1.knownPlaceholderSourceDigests.includes(sourceDigest)) {
    throw new Error('Cardmarket returned its generic sealed-product placeholder.');
  }

  const image = sharp(input, {
    failOn: 'error',
    limitInputPixels: CARDMARKET_SEALED_IMAGE_POLICY_V1.maximumInputPixels,
  }).rotate();
  const metadata = await image.metadata();
  if (
    !metadata.width
    || !metadata.height
    || metadata.width < CARDMARKET_SEALED_IMAGE_POLICY_V1.minimumWidth
    || metadata.height < CARDMARKET_SEALED_IMAGE_POLICY_V1.minimumHeight
  ) {
    throw new Error('Sealed product image is too small to be trusted product artwork.');
  }
  const stats = await image.clone().stats();
  if (!Number.isFinite(stats.entropy) || stats.entropy < CARDMARKET_SEALED_IMAGE_POLICY_V1.minimumEntropy) {
    throw new Error('Sealed product image has insufficient visual detail and may be a generic placeholder.');
  }

  const outputBytes = await image
    .flatten({ background: '#ffffff' })
    .resize({
      width: CARDMARKET_SEALED_IMAGE_POLICY_V1.outputWidth,
      height: CARDMARKET_SEALED_IMAGE_POLICY_V1.outputHeight,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: CARDMARKET_SEALED_IMAGE_POLICY_V1.webpQuality, effort: 4 })
    .toBuffer();
  const outputMetadata = await sharp(outputBytes, {
    failOn: 'error',
    limitInputPixels: CARDMARKET_SEALED_IMAGE_POLICY_V1.maximumInputPixels,
  }).metadata();
  const outputDigest = createHash('sha256').update(outputBytes).digest('hex');

  return {
    outputBytes,
    sourceDigest,
    outputDigest,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    outputWidth: outputMetadata.width,
    outputHeight: outputMetadata.height,
  };
}

export function immutableSealedImagePathV1(productId, outputDigest) {
  const product = positiveInteger(productId);
  const digest = String(outputDigest ?? '').trim().toLowerCase();
  if (product == null || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error('A positive product ID and SHA-256 digest are required for a sealed image path.');
  }
  return `/catalog/sealed/v1/${product}-${digest.slice(0, 12)}.webp`;
}
