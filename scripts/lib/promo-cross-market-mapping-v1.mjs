import { artworkCorrelationV1 } from './cardmarket-regular-art-v1.mjs';

export const PROMO_CROSS_MARKET_MAPPING_POLICY_V1 = Object.freeze({
  version: 'cardmarket-tcgplayer-promo-bidirectional-image-correlation-v1-complete-candidates',
  featureWidth: 64,
  featureHeight: 96,
  minimumCorrelation: 0.985,
  minimumMargin: 0.08,
  candidateCoverage: 'complete-both-providers',
  refreshBuckets: 7,
  maximumEvidenceAgeDays: 14,
  transientGraceDays: 21,
});

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function validFingerprint(fingerprint) {
  return fingerprint?.pixels?.length > 0
    && Number.isFinite(fingerprint.mean)
    && Number.isFinite(fingerprint.deviation)
    && fingerprint.deviation > 0
    && /^[a-f0-9]{64}$/i.test(String(fingerprint.digest ?? ''));
}

function validHttpsCardmarketUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && (
      url.hostname === 'www.cardmarket.com'
      || url.hostname === 'product-images.s3.cardmarket.com'
    );
  } catch {
    return false;
  }
}

export function validateCardmarketPromoExpansionRegistryV1(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.expansions)) {
    throw new Error('Cardmarket promo expansion registry must use schemaVersion 1.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.reviewedAt ?? ''))) {
    throw new Error('Cardmarket promo expansion registry requires a reviewedAt date.');
  }
  if (!Array.isArray(value.verifiedPairInvariants) || value.verifiedPairInvariants.length === 0) {
    throw new Error('Cardmarket promo expansion registry requires at least one image-verified pair invariant.');
  }

  const expansionIds = new Set();
  const folders = new Set();
  const expansions = value.expansions.map((entry) => {
    const idExpansion = positiveInteger(entry?.idExpansion);
    const imageFolder = String(entry?.imageFolder ?? '').trim().toUpperCase();
    if (
      idExpansion == null
      || expansionIds.has(idExpansion)
      || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(imageFolder)
      || folders.has(imageFolder)
      || entry?.language !== 'English'
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry?.releasedOn ?? ''))
      || !validHttpsCardmarketUrl(entry?.evidenceUrl)
      || !String(entry?.name ?? '').trim()
      || !String(entry?.evidence ?? '').trim()
    ) {
      throw new Error(`Invalid or duplicate reviewed Cardmarket promo expansion ${entry?.idExpansion ?? 'unknown'}.`);
    }
    expansionIds.add(idExpansion);
    folders.add(imageFolder);
    return Object.freeze({ ...entry, idExpansion, imageFolder });
  });
  if (expansions.length === 0) {
    throw new Error('Cardmarket promo expansion registry cannot be empty.');
  }

  const invariantPairs = new Set();
  const verifiedPairInvariants = value.verifiedPairInvariants.map((entry) => {
    const tcgplayerProductId = positiveInteger(entry?.tcgplayerProductId);
    const cardmarketProductId = positiveInteger(entry?.cardmarketProductId);
    const printedNumber = String(entry?.printedNumber ?? '').trim().toUpperCase();
    const pair = `${tcgplayerProductId}|${cardmarketProductId}`;
    if (
      tcgplayerProductId == null
      || cardmarketProductId == null
      || !cardmarketPromoPrintedNumberV1(`(${printedNumber})`)
      || invariantPairs.has(pair)
      || !String(entry?.evidence ?? '').trim()
    ) {
      throw new Error('Invalid or duplicate Cardmarket/TCGplayer promo pair invariant.');
    }
    invariantPairs.add(pair);
    return Object.freeze({
      ...entry,
      printedNumber,
      tcgplayerProductId,
      cardmarketProductId,
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    reviewedAt: value.reviewedAt,
    expansions: Object.freeze(expansions),
    verifiedPairInvariants: Object.freeze(verifiedPairInvariants),
  });
}

export function cardmarketPromoPrintedNumberV1(productName) {
  return String(productName ?? '')
    .toUpperCase()
    .match(/\(((?:P|OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-\d{3})\)\s*$/)?.[1] ?? null;
}

export function cardmarketPromoProductImageUrlsV1(imageFolder, productId) {
  const folder = String(imageFolder ?? '').trim().toUpperCase();
  const id = positiveInteger(productId);
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(folder) || id == null) return [];
  const base = `https://product-images.s3.cardmarket.com/1621/${folder}/${id}/${id}`;
  return [`${base}.jpg`, `${base}.png`];
}

function completeCandidateSide(requestedCandidates, availableCandidateImages) {
  if (!Array.isArray(requestedCandidates) || !Array.isArray(availableCandidateImages)) return false;
  const requestedIds = requestedCandidates.map((candidate) => positiveInteger(candidate?.productId));
  const availableIds = availableCandidateImages.map((candidate) => positiveInteger(candidate?.productId));
  if (
    requestedIds.length === 0
    || requestedIds.some((productId) => productId == null)
    || availableIds.some((productId) => productId == null)
    || new Set(requestedIds).size !== requestedIds.length
    || new Set(availableIds).size !== availableIds.length
    || requestedIds.length !== availableIds.length
    || availableCandidateImages.some((candidate) => (
      typeof candidate?.imageUrl !== 'string'
      || candidate.imageUrl.length === 0
      || !validFingerprint(candidate.fingerprint)
    ))
  ) return false;
  const available = new Set(availableIds);
  return requestedIds.every((productId) => available.has(productId));
}

export function hasCompletePromoArtworkCandidateMatrixV1({
  requestedTcgplayerCandidates,
  availableTcgplayerImages,
  requestedCardmarketCandidates,
  availableCardmarketImages,
}) {
  return completeCandidateSide(requestedTcgplayerCandidates, availableTcgplayerImages)
    && completeCandidateSide(requestedCardmarketCandidates, availableCardmarketImages);
}

export function choosePromoCrossMarketImageMatchesV1({
  requestedTcgplayerCandidates,
  availableTcgplayerImages,
  requestedCardmarketCandidates,
  availableCardmarketImages,
}) {
  if (!hasCompletePromoArtworkCandidateMatrixV1({
    requestedTcgplayerCandidates,
    availableTcgplayerImages,
    requestedCardmarketCandidates,
    availableCardmarketImages,
  })) return [];

  const tcgplayerImages = availableTcgplayerImages.map((candidate) => ({
    ...candidate,
    productId: positiveInteger(candidate.productId),
  }));
  const cardmarketImages = availableCardmarketImages.map((candidate) => ({
    ...candidate,
    productId: positiveInteger(candidate.productId),
  }));
  const scores = new Map();
  try {
    for (const tcgplayer of tcgplayerImages) {
      for (const cardmarket of cardmarketImages) {
        scores.set(
          `${tcgplayer.productId}|${cardmarket.productId}`,
          artworkCorrelationV1(tcgplayer.fingerprint, cardmarket.fingerprint),
        );
      }
    }
  } catch {
    return [];
  }

  const tcgplayerCandidateProductIds = tcgplayerImages
    .map((candidate) => candidate.productId)
    .sort((left, right) => left - right);
  const cardmarketCandidateProductIds = cardmarketImages
    .map((candidate) => candidate.productId)
    .sort((left, right) => left - right);
  const matches = [];

  for (const tcgplayer of tcgplayerImages) {
    const cardmarketRanking = cardmarketImages
      .map((candidate) => ({
        candidate,
        correlation: scores.get(`${tcgplayer.productId}|${candidate.productId}`),
      }))
      .sort((left, right) => right.correlation - left.correlation
        || left.candidate.productId - right.candidate.productId);
    const bestCardmarket = cardmarketRanking[0];
    const cardmarketRunnerUpCorrelation = cardmarketRanking[1]?.correlation ?? null;
    const cardmarketMargin = bestCardmarket.correlation
      - (cardmarketRunnerUpCorrelation ?? -1);
    if (
      bestCardmarket.correlation < PROMO_CROSS_MARKET_MAPPING_POLICY_V1.minimumCorrelation
      || cardmarketMargin < PROMO_CROSS_MARKET_MAPPING_POLICY_V1.minimumMargin
    ) continue;

    const tcgplayerRanking = tcgplayerImages
      .map((candidate) => ({
        candidate,
        correlation: scores.get(`${candidate.productId}|${bestCardmarket.candidate.productId}`),
      }))
      .sort((left, right) => right.correlation - left.correlation
        || left.candidate.productId - right.candidate.productId);
    const bestTcgplayer = tcgplayerRanking[0];
    const tcgplayerRunnerUpCorrelation = tcgplayerRanking[1]?.correlation ?? null;
    const tcgplayerMargin = bestTcgplayer.correlation
      - (tcgplayerRunnerUpCorrelation ?? -1);
    if (
      bestTcgplayer.candidate.productId !== tcgplayer.productId
      || tcgplayerMargin < PROMO_CROSS_MARKET_MAPPING_POLICY_V1.minimumMargin
    ) continue;

    const runnerUpCorrelation = Math.max(
      cardmarketRunnerUpCorrelation ?? -1,
      tcgplayerRunnerUpCorrelation ?? -1,
    );
    matches.push({
      tcgplayerProductId: tcgplayer.productId,
      cardmarketProductId: bestCardmarket.candidate.productId,
      correlation: bestCardmarket.correlation,
      runnerUpCorrelation: runnerUpCorrelation < 0 ? null : runnerUpCorrelation,
      margin: Math.min(cardmarketMargin, tcgplayerMargin),
      cardmarketRunnerUpCorrelation,
      cardmarketMargin,
      tcgplayerRunnerUpCorrelation,
      tcgplayerMargin,
      tcgplayerCandidateCount: tcgplayerImages.length,
      tcgplayerCandidateProductIds,
      cardmarketCandidateCount: cardmarketImages.length,
      cardmarketCandidateProductIds,
      tcgplayerImageUrl: tcgplayer.imageUrl,
      cardmarketImageUrl: bestCardmarket.candidate.imageUrl,
      tcgplayerImageDigest: tcgplayer.fingerprint.digest,
      cardmarketImageDigest: bestCardmarket.candidate.fingerprint.digest,
    });
  }

  const cardmarketIds = matches.map((match) => match.cardmarketProductId);
  if (new Set(cardmarketIds).size !== cardmarketIds.length) return [];
  return matches.sort((left, right) => left.tcgplayerProductId - right.tcgplayerProductId);
}
