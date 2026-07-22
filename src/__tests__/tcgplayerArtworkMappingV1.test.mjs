import { describe, expect, it } from 'vitest';
import {
  chooseTcgplayerArtworkImageMatchV1,
  compareTcgplayerArtworkDiscoveryPriorityV1,
  hasCompleteTcgplayerArtworkCandidateSetV1,
  reusableTcgplayerArtworkReferenceV1,
  tcgplayerArtworkRefreshScheduledV1,
  TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1,
  TCGPLAYER_ARTWORK_MAPPING_POLICY_V1,
} from '../../scripts/lib/tcgplayer-artwork-mapping-v1.mjs';

function fingerprint(values, digestCharacter) {
  const pixels = Buffer.from(values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  ) / values.length);
  return { pixels, mean, deviation, digest: digestCharacter.repeat(64) };
}

const tcgplayerFixtures = [
  { productId: 657400, fingerprint: fingerprint([8, 24, 60, 110, 172, 226, 185, 91], 'a') },
  { productId: 657401, fingerprint: fingerprint([12, 87, 210, 178, 66, 24, 140, 235], 'b') },
  { productId: 657402, fingerprint: fingerprint([230, 178, 96, 28, 15, 72, 164, 221], 'c') },
  { productId: 657403, fingerprint: fingerprint([35, 208, 69, 184, 15, 232, 104, 149], 'd') },
  { productId: 657404, fingerprint: fingerprint([218, 32, 191, 61, 151, 242, 83, 11], 'e') },
].map((candidate) => ({
  ...candidate,
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${candidate.productId}_200w.jpg`,
}));

const requestedCandidates = tcgplayerFixtures.map(({ productId }) => ({ productId }));

const DAY_MS = 24 * 60 * 60_000;
const observedAt = '2026-07-22T12:00:00.000Z';

function previousArtworkAsset(ageMs = 7 * DAY_MS) {
  const imageVerifiedAt = new Date(Date.parse(observedAt) - ageMs).toISOString();
  return {
    setCode: 'OP13',
    number: 'OP13-118',
    cardmarketProductId: 857338,
    tcgplayerProductId: 657403,
    tcgplayerGroupId: 24281,
    tcgplayerGroupAbbreviation: 'OP13',
    tcgplayerArtworkReference: {
      productId: 657403,
      setCode: 'OP13',
      groupId: 24281,
      groupAbbreviation: 'OP13',
      number: 'OP13-118',
      cardmarketProductId: 857338,
      matchPolicy: TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.version,
      candidateCount: 5,
      candidateProductIds: [657400, 657401, 657402, 657403, 657404],
      cardmarketCandidateCount: 2,
      cardmarketCandidateProductIds: [857338, 857339],
      imageVerifiedAt,
      correlation: 0.999,
      margin: 0.12,
      cardmarketImageUrl: 'https://product-images.s3.cardmarket.com/857338.jpg',
      tcgplayerImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/657403_200w.jpg',
      cardmarketImageDigest: 'a'.repeat(64),
      tcgplayerImageDigest: 'b'.repeat(64),
    },
  };
}

function reusableReference(overrides = {}) {
  return reusableTcgplayerArtworkReferenceV1({
    previousAsset: previousArtworkAsset(),
    cardmarketProductId: 857338,
    cardmarketCandidateProductIds: [857339, 857338],
    setCode: 'OP13',
    groupId: 24281,
    groupAbbreviation: 'OP13',
    number: 'OP13-118',
    requestedCandidates,
    observedAt,
    ...overrides,
  });
}

describe('TCGplayer exact-artwork mapping v1', () => {
  it('freezes the strict correlation and separation thresholds', () => {
    expect(TCGPLAYER_ARTWORK_MAPPING_POLICY_V1).toMatchObject({
      minimumCorrelation: 0.985,
      minimumMargin: 0.08,
      candidateCoverage: 'complete',
    });
    expect(TCGPLAYER_ARTWORK_EVIDENCE_POLICY_V1).toEqual({
      maximumFreshAgeMs: 14 * DAY_MS,
      transientGraceAgeMs: 21 * DAY_MS,
      refreshBuckets: 7,
    });
  });

  it('reuses unchanged complete-provider evidence inside the fresh and transient windows', () => {
    expect(reusableReference()).toMatchObject({
      productId: 657403,
      evidenceAgeMs: 7 * DAY_MS,
      fresh: true,
      withinTransientGrace: true,
    });
    expect(reusableReference({
      previousAsset: previousArtworkAsset((14 * DAY_MS) + 1),
    })).toMatchObject({
      fresh: false,
      withinTransientGrace: true,
    });
    expect(reusableReference({
      previousAsset: previousArtworkAsset(21 * DAY_MS),
    })).not.toBeNull();
    expect(reusableReference({
      previousAsset: previousArtworkAsset((21 * DAY_MS) + 1),
    })).toBeNull();
  });

  it.each([
    ['policy', () => {
      const previousAsset = previousArtworkAsset();
      previousAsset.tcgplayerArtworkReference.matchPolicy = 'changed-policy';
      return { previousAsset };
    }],
    ['TCGplayer candidate set', () => ({
      requestedCandidates: requestedCandidates.slice(0, -1),
    })],
    ['Cardmarket candidate set', () => ({
      cardmarketCandidateProductIds: [857338, 857340],
    })],
    ['Cardmarket identity', () => ({ cardmarketProductId: 857339 })],
    ['set', () => ({ setCode: 'OP14' })],
    ['group', () => ({ groupId: 99999 })],
    ['number', () => ({ number: 'OP13-119' })],
  ])('rejects persisted evidence when the %s changes', (_label, changed) => {
    expect(reusableReference(changed())).toBeNull();
  });

  it('prioritizes required OP13 evidence, then higher Cardmarket trend', () => {
    const queue = [
      { cardmarketProductId: 1, cardmarketTrend: 500, number: 'OP01-001' },
      { cardmarketProductId: 2, cardmarketTrend: 10, number: 'OP13-118', requiredInvariant: true },
      { cardmarketProductId: 3, cardmarketTrend: 80, number: 'OP02-001' },
    ].sort(compareTcgplayerArtworkDiscoveryPriorityV1);

    expect(queue.map((entry) => entry.cardmarketProductId)).toEqual([2, 1, 3]);
  });

  it('stagger-refreshes each persisted source exactly once per seven-day cycle', () => {
    const scheduledDays = Array.from({ length: 7 }, (_unused, offset) => (
      tcgplayerArtworkRefreshScheduledV1(
        857338,
        new Date(Date.parse(observedAt) + (offset * DAY_MS)).toISOString(),
      )
    )).filter(Boolean);

    expect(scheduledDays).toHaveLength(1);
    expect(tcgplayerArtworkRefreshScheduledV1(null, observedAt)).toBe(true);
    expect(tcgplayerArtworkRefreshScheduledV1(857338, 'not-a-date')).toBe(true);
  });

  it('fails closed unless every exact released group-and-number candidate has an image', () => {
    expect(hasCompleteTcgplayerArtworkCandidateSetV1(
      requestedCandidates,
      [...tcgplayerFixtures].reverse(),
    )).toBe(true);
    expect(hasCompleteTcgplayerArtworkCandidateSetV1(
      requestedCandidates,
      tcgplayerFixtures.slice(0, -1),
    )).toBe(false);
    expect(hasCompleteTcgplayerArtworkCandidateSetV1(
      requestedCandidates,
      [...tcgplayerFixtures.slice(0, -1), tcgplayerFixtures[0]],
    )).toBe(false);
  });

  it.each([
    [857338, 657403],
    [857339, 657402],
    [857340, 657401],
    [857341, 657404],
  ])(
    'keeps the verified OP13-118 Cardmarket %i to TCGplayer %i artwork identity',
    (cardmarketProductId, expectedTcgplayerProductId) => {
      const exact = tcgplayerFixtures.find(
        (candidate) => candidate.productId === expectedTcgplayerProductId,
      );
      const source = fingerprint([...exact.fingerprint.pixels], 'f');
      const match = chooseTcgplayerArtworkImageMatchV1({
        cardmarketProductId,
        cardmarketFingerprint: source,
        requestedCandidates,
        availableCandidateImages: [...tcgplayerFixtures].reverse(),
      });

      expect(match).toMatchObject({
        cardmarketProductId,
        productId: expectedTcgplayerProductId,
        candidateCount: 5,
        candidateProductIds: [657400, 657401, 657402, 657403, 657404],
      });
      expect(match.correlation).toBeGreaterThanOrEqual(0.985);
      expect(match.margin).toBeGreaterThanOrEqual(0.08);
    },
  );

  it('rejects a visually ambiguous best candidate even when both correlations are high', () => {
    const first = fingerprint([10, 30, 60, 100, 150, 210, 170, 80], '1');
    const second = fingerprint([11, 30, 61, 99, 151, 209, 169, 81], '2');
    const requested = [{ productId: 1 }, { productId: 2 }];
    const available = [
      { productId: 1, imageUrl: 'https://example.test/1.jpg', fingerprint: first },
      { productId: 2, imageUrl: 'https://example.test/2.jpg', fingerprint: second },
    ];

    expect(chooseTcgplayerArtworkImageMatchV1({
      cardmarketProductId: 100,
      cardmarketFingerprint: first,
      requestedCandidates: requested,
      availableCandidateImages: available,
    })).toBeNull();
  });
});
