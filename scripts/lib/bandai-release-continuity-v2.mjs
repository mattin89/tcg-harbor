import { officialProductCodeFromTitle } from './catalog-ingestion-plan.mjs';

const BANDAI_ORIGIN = 'https://en.onepiece-cardgame.com';
const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isAvailableAt(product, cutoff) {
  const [year, month, day] = product.releasedOn.split('-').map(Number);
  const availableAt = product.releasePrecision === 'day'
    ? Date.UTC(year, month - 1, day)
    : Date.UTC(year, month, 1);
  return availableAt <= cutoff.valueOf();
}

function assertFirstPartyProductUrl(productUrl, officialCode) {
  const parsed = new URL(productUrl, BANDAI_ORIGIN);
  if (parsed.origin !== BANDAI_ORIGIN || !parsed.pathname.startsWith('/products/')) {
    throw new Error(`Previous Bandai release ${officialCode} has an unsafe product URL.`);
  }
  return productUrl;
}

export function previousBandaiReleaseContinuityV2(previousSnapshot) {
  if (previousSnapshot == null) return [];

  const previousGeneratedAt = new Date(previousSnapshot.generatedAt);
  if (Number.isNaN(previousGeneratedAt.valueOf())) {
    throw new Error('Previous catalog snapshot has an invalid generatedAt timestamp.');
  }

  const products = previousSnapshot?.provenance?.englishReleaseManifest?.officialProducts;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('Previous catalog snapshot has no verified Bandai release manifest.');
  }

  return products
    .filter((product) => product?.category === 'boosters' || product?.category === 'decks')
    .map((product) => {
      const title = String(product.title ?? '').trim();
      const officialCode = String(product.officialCode ?? '').trim().toUpperCase();
      const releasedOn = String(product.releasedOn ?? '').trim();
      const releasePrecision = product.releasePrecision;
      if (!title || officialProductCodeFromTitle(title) !== officialCode) {
        throw new Error(`Previous Bandai release ${officialCode || '(missing code)'} no longer matches its official title.`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(releasedOn)
        || Number.isNaN(Date.parse(`${releasedOn}T00:00:00Z`))) {
        throw new Error(`Previous Bandai release ${officialCode} has an invalid release date.`);
      }
      if (releasePrecision !== 'day' && releasePrecision !== 'month') {
        throw new Error(`Previous Bandai release ${officialCode} has an invalid release precision.`);
      }

      return {
        category: product.category,
        officialCode,
        title,
        releasedOn,
        releaseLabel: String(product.releaseLabel ?? '').trim(),
        releasePrecision,
        productUrl: assertFirstPartyProductUrl(product.productUrl, officialCode),
        page: -1,
        continuityEvidence: 'Previously verified released product from the official Bandai English manifest',
      };
    })
    // Do not perpetuate a presale announcement: only products that had already
    // become available when the verified snapshot was written can carry over.
    .filter((product) => isAvailableAt(product, previousGeneratedAt));
}

export async function retryReleaseManifestValidationV2(loadAndValidate, {
  maxAttempts = 3,
  baseDelayMs = 2_000,
  sleep = defaultSleep,
  onRetry = () => {},
} = {}) {
  if (typeof loadAndValidate !== 'function') throw new TypeError('loadAndValidate must be a function.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer.');
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new TypeError('baseDelayMs must be a non-negative finite number.');
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await loadAndValidate(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const delayMs = baseDelayMs * attempt;
      onRetry({ attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, error });
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw new Error(
    `Official release manifest remained inconsistent after ${maxAttempts} attempts: ${lastError?.message ?? String(lastError)}.`,
    { cause: lastError },
  );
}
