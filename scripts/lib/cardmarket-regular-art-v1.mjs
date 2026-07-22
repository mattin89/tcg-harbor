import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const CARDMARKET_REGULAR_ART_POLICY_V1 = Object.freeze({
  featureWidth: 64,
  featureHeight: 96,
  minimumCorrelation: 0.985,
  minimumMargin: 0.08,
  maximumImageBytes: 8 * 1024 * 1024,
  maximumInputPixels: 20_000_000,
});

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function cardmarketImageFolderV1(groupCode) {
  const compact = String(groupCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.match(/(?:PRB|OP|EB|ST)\d{2}/)?.[0] ?? null;
}

export function cardmarketProductImageUrlsV1(groupCode, productId) {
  const folder = cardmarketImageFolderV1(groupCode);
  const id = positiveInteger(productId);
  if (!folder || id == null) return [];
  // Historical starter-deck images use ST-01 while later products in the
  // same expansion use ST01. Both are observed Cardmarket CDN shapes.
  const folders = folder.startsWith('ST')
    ? [folder, folder.replace(/^ST(\d{2})$/, 'ST-$1')]
    : [folder];
  return [...new Set(folders)].flatMap((candidateFolder) => {
    const base = `https://product-images.s3.cardmarket.com/1621/${candidateFolder}/${id}/${id}`;
    return [`${base}.jpg`, `${base}.png`];
  });
}

export async function fingerprintArtworkImageV1(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (input.length === 0 || input.length > CARDMARKET_REGULAR_ART_POLICY_V1.maximumImageBytes) {
    throw new Error('Artwork image bytes are empty or exceed the safe size limit.');
  }

  const { data, info } = await sharp(input, {
    failOn: 'error',
    limitInputPixels: CARDMARKET_REGULAR_ART_POLICY_V1.maximumInputPixels,
  })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(
      CARDMARKET_REGULAR_ART_POLICY_V1.featureWidth,
      CARDMARKET_REGULAR_ART_POLICY_V1.featureHeight,
      { fit: 'fill', kernel: sharp.kernel.lanczos3 },
    )
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 1 || data.length !== (
    CARDMARKET_REGULAR_ART_POLICY_V1.featureWidth
    * CARDMARKET_REGULAR_ART_POLICY_V1.featureHeight
  )) {
    throw new Error('Artwork image normalization produced an unexpected pixel shape.');
  }

  let sum = 0;
  for (const value of data) sum += value;
  const mean = sum / data.length;
  let squaredDistance = 0;
  for (const value of data) squaredDistance += (value - mean) ** 2;
  const deviation = Math.sqrt(squaredDistance / data.length);
  if (!Number.isFinite(deviation) || deviation < 8) {
    throw new Error('Artwork image has insufficient visual detail for safe matching.');
  }

  return {
    pixels: data,
    mean,
    deviation,
    digest: createHash('sha256').update(data).digest('hex'),
  };
}

export function artworkCorrelationV1(left, right) {
  if (!left?.pixels || !right?.pixels || left.pixels.length !== right.pixels.length) {
    throw new Error('Artwork fingerprints must have equal non-empty pixel arrays.');
  }
  if (!(left.deviation > 0) || !(right.deviation > 0)) {
    throw new Error('Artwork fingerprints must have positive deviation.');
  }

  let covariance = 0;
  for (let index = 0; index < left.pixels.length; index += 1) {
    covariance += (left.pixels[index] - left.mean) * (right.pixels[index] - right.mean);
  }
  return covariance / (left.pixels.length * left.deviation * right.deviation);
}

export function chooseRegularArtImageMatchV1({
  sourceFingerprint,
  candidates,
  minimumCorrelation = CARDMARKET_REGULAR_ART_POLICY_V1.minimumCorrelation,
  minimumMargin = CARDMARKET_REGULAR_ART_POLICY_V1.minimumMargin,
}) {
  if (!sourceFingerprint || !Array.isArray(candidates) || candidates.length === 0) return null;
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      productId: positiveInteger(candidate.productId),
      correlation: artworkCorrelationV1(sourceFingerprint, candidate.fingerprint),
    }))
    .filter((candidate) => candidate.productId != null && Number.isFinite(candidate.correlation))
    .sort((left, right) => right.correlation - left.correlation || left.productId - right.productId);
  if (ranked.length === 0) return null;

  const best = ranked[0];
  const runnerUpCorrelation = ranked[1]?.correlation ?? -1;
  const margin = best.correlation - runnerUpCorrelation;
  if (best.correlation < minimumCorrelation || margin < minimumMargin) return null;

  return {
    productId: best.productId,
    correlation: best.correlation,
    runnerUpCorrelation: ranked[1]?.correlation ?? null,
    margin,
    sourceDigest: sourceFingerprint.digest,
    productDigest: best.fingerprint.digest,
  };
}

export async function mapWithConcurrencyV1(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array.');
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
