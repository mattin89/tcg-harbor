import { artworkCorrelationV1 } from './cardmarket-regular-art-v1.mjs';

export const TCGPLAYER_ARTWORK_MAPPING_POLICY_V1 = Object.freeze({
  version: 'cardmarket-tcgplayer-image-correlation-v1-complete-candidates',
  featureWidth: 64,
  featureHeight: 96,
  minimumCorrelation: 0.985,
  minimumMargin: 0.08,
  candidateCoverage: 'complete',
});

export const TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1 = Object.freeze({
  maximumFreshAgeMs: 14 * 24 * 60 * 60_000,
  transientGraceAgeMs: 21 * 24 * 60 * 60_000,
  refreshBuckets: 7,
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

function candidateProductIds(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const productIds = candidates.map((candidate) => (
    positiveInteger(candidate?.productId ?? candidate)
  ));
  if (
    productIds.some((productId) => productId == null)
    || new Set(productIds).size !== productIds.length
  ) return null;
  return productIds.sort((left, right) => left - right);
}

function sameProductIds(left, right) {
  return left?.length === right?.length
    && left.every((productId, index) => productId === right[index]);
}

function exactString(value, expected) {
  return typeof value === 'string'
    && value.length > 0
    && value === expected;
}

/**
 * Returns prior evidence only when the complete identity inputs that made the
 * image decision remain reproducible. The caller may reuse `fresh` evidence
 * immediately, or `withinTransientGrace` evidence only after a transient
 * refresh failure (including a bounded global-budget deferral).
 */
export function reusableTcgplayerArtworkReferenceV1({
  previousAsset,
  cardmarketProductId,
  cardmarketCandidateProductIds,
  setCode,
  groupId,
  groupAbbreviation,
  number,
  requestedCandidates,
  observedAt,
}) {
  const reference = previousAsset?.tcgplayerArtworkReference ?? null;
  const exactCardmarketProductId = positiveInteger(cardmarketProductId);
  const exactGroupId = positiveInteger(groupId);
  const exactTcgplayerCandidateIds = candidateProductIds(requestedCandidates);
  const exactCardmarketCandidateIds = candidateProductIds(cardmarketCandidateProductIds);
  const previousTcgplayerCandidateIds = candidateProductIds(reference?.candidateProductIds);
  const previousCardmarketCandidateIds = candidateProductIds(
    reference?.cardmarketCandidateProductIds,
  );
  const productId = positiveInteger(reference?.productId);
  const correlation = Number(reference?.correlation);
  const margin = Number(reference?.margin);
  const verifiedAt = Date.parse(reference?.imageVerifiedAt ?? '');
  const observationTime = Date.parse(observedAt ?? '');
  const evidenceAgeMs = observationTime - verifiedAt;

  if (
    reference?.matchPolicy !== TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.version
    || exactCardmarketProductId == null
    || exactGroupId == null
    || exactTcgplayerCandidateIds == null
    || exactCardmarketCandidateIds == null
    || previousTcgplayerCandidateIds == null
    || previousCardmarketCandidateIds == null
    || productId == null
    || !exactTcgplayerCandidateIds.includes(productId)
    || !exactCardmarketCandidateIds.includes(exactCardmarketProductId)
    || Number(reference.cardmarketProductId) !== exactCardmarketProductId
    || Number(reference.groupId) !== exactGroupId
    || !exactString(reference.groupAbbreviation, groupAbbreviation)
    || !exactString(reference.setCode, setCode)
    || !exactString(reference.number, number)
    || Number(reference.candidateCount) !== exactTcgplayerCandidateIds.length
    || Number(reference.cardmarketCandidateCount) !== exactCardmarketCandidateIds.length
    || !sameProductIds(previousTcgplayerCandidateIds, exactTcgplayerCandidateIds)
    || !sameProductIds(previousCardmarketCandidateIds, exactCardmarketCandidateIds)
    || Number(previousAsset?.tcgplayerProductId) !== productId
    || Number(previousAsset?.cardmarketProductId) !== exactCardmarketProductId
    || Number(previousAsset?.tcgplayerGroupId) !== exactGroupId
    || !exactString(previousAsset?.tcgplayerGroupAbbreviation, groupAbbreviation)
    || !exactString(previousAsset?.setCode, setCode)
    || !exactString(previousAsset?.number, number)
    || !Number.isFinite(correlation)
    || correlation < TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.minimumCorrelation
    || !Number.isFinite(margin)
    || margin < TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.minimumMargin
    || !/^[a-f0-9]{64}$/i.test(String(reference.cardmarketImageDigest ?? ''))
    || !/^[a-f0-9]{64}$/i.test(String(reference.tcgplayerImageDigest ?? ''))
    || typeof reference.cardmarketImageUrl !== 'string'
    || reference.cardmarketImageUrl.length === 0
    || typeof reference.tcgplayerImageUrl !== 'string'
    || reference.tcgplayerImageUrl.length === 0
    || !Number.isFinite(evidenceAgeMs)
    || evidenceAgeMs < 0
    || evidenceAgeMs > TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1.transientGraceAgeMs
  ) return null;

  return {
    reference,
    productId,
    evidenceAgeMs,
    fresh: evidenceAgeMs <= TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1.maximumFreshAgeMs,
    withinTransientGrace: true,
  };
}

export function compareTcgplayerArtworkDiscoveryPriorityV1(left, right) {
  const requiredDifference = Number(Boolean(right?.requiredInvariant))
    - Number(Boolean(left?.requiredInvariant));
  if (requiredDifference !== 0) return requiredDifference;
  const leftTrend = Number.isFinite(Number(left?.cardmarketTrend))
    ? Number(left.cardmarketTrend)
    : Number.NEGATIVE_INFINITY;
  const rightTrend = Number.isFinite(Number(right?.cardmarketTrend))
    ? Number(right.cardmarketTrend)
    : Number.NEGATIVE_INFINITY;
  return rightTrend - leftTrend
    || String(left?.groupCode ?? '').localeCompare(String(right?.groupCode ?? ''))
    || String(left?.number ?? '').localeCompare(String(right?.number ?? ''))
    || (positiveInteger(left?.cardmarketProductId) ?? Number.MAX_SAFE_INTEGER)
      - (positiveInteger(right?.cardmarketProductId) ?? Number.MAX_SAFE_INTEGER);
}

export function tcgplayerArtworkRefreshScheduledV1(sourceId, observedAt) {
  const numericId = positiveInteger(sourceId);
  const observationTime = Date.parse(observedAt ?? '');
  if (numericId == null || !Number.isFinite(observationTime)) return true;
  const dailyBucket = Math.floor(observationTime / (24 * 60 * 60_000))
    % TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1.refreshBuckets;
  return numericId % TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1.refreshBuckets === dailyBucket;
}

export function hasCompleteTcgplayerArtworkCandidateSetV1(
  requestedCandidates,
  availableCandidateImages,
) {
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

export function chooseTcgplayerArtworkImageMatchV1({
  cardmarketProductId,
  cardmarketFingerprint,
  requestedCandidates,
  availableCandidateImages,
}) {
  const exactCardmarketProductId = positiveInteger(cardmarketProductId);
  if (
    exactCardmarketProductId == null
    || !validFingerprint(cardmarketFingerprint)
    || !hasCompleteTcgplayerArtworkCandidateSetV1(
      requestedCandidates,
      availableCandidateImages,
    )
  ) return null;

  let ranked;
  try {
    ranked = availableCandidateImages
      .map((candidate) => ({
        ...candidate,
        productId: positiveInteger(candidate.productId),
        correlation: artworkCorrelationV1(cardmarketFingerprint, candidate.fingerprint),
      }))
      .filter((candidate) => candidate.productId != null && Number.isFinite(candidate.correlation))
      .sort((left, right) => right.correlation - left.correlation || left.productId - right.productId);
  } catch {
    return null;
  }
  if (ranked.length !== requestedCandidates.length) return null;

  const best = ranked[0];
  const runnerUpCorrelation = ranked[1]?.correlation ?? -1;
  const margin = best.correlation - runnerUpCorrelation;
  if (
    best.correlation < TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.minimumCorrelation
    || margin < TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.minimumMargin
  ) return null;

  return {
    cardmarketProductId: exactCardmarketProductId,
    productId: best.productId,
    candidateCount: ranked.length,
    candidateProductIds: ranked.map((candidate) => candidate.productId).sort((left, right) => left - right),
    correlation: best.correlation,
    runnerUpCorrelation: ranked[1]?.correlation ?? null,
    margin,
    cardmarketImageDigest: cardmarketFingerprint.digest,
    tcgplayerImageDigest: best.fingerprint.digest,
    tcgplayerImageUrl: best.imageUrl,
  };
}
