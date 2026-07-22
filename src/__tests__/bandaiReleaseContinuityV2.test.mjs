import { describe, expect, it } from 'vitest';
import {
  previousBandaiReleaseContinuityV2,
  retryReleaseManifestValidationV2,
} from '../../scripts/lib/bandai-release-continuity-v2.mjs';

const product = (overrides = {}) => ({
  abbreviation: 'OP12',
  category: 'boosters',
  officialCode: 'OP-12',
  releasedOn: '2025-08-22',
  releaseLabel: 'August 22, 2025',
  releasePrecision: 'day',
  memberSetCodes: ['OP12'],
  title: 'BOOSTER PACK -LEGACY OF THE MASTER- [OP-12]',
  productUrl: 'https://en.onepiece-cardgame.com/products/boosters/op12.php',
  continuityEvidence: null,
  ...overrides,
});

const snapshot = (officialProducts, generatedAt = '2026-07-21T12:00:00.000Z') => ({
  generatedAt,
  provenance: { englishReleaseManifest: { officialProducts } },
});

describe('Bandai release continuity v2', () => {
  it('carries forward only previously verified products that were already released', () => {
    const continuity = previousBandaiReleaseContinuityV2(snapshot([
      product(),
      product({
        abbreviation: 'OP17',
        officialCode: 'OP-17',
        releasedOn: '2026-08-21',
        releaseLabel: 'August 21, 2026',
        title: "BOOSTER PACK -THE WORLD'S STRONGEST WARRIORS- [OP-17]",
        productUrl: '/products/boosters/op17.php',
      }),
    ]));

    expect(continuity).toHaveLength(1);
    expect(continuity[0]).toMatchObject({
      officialCode: 'OP-12',
      page: -1,
      continuityEvidence: 'Previously verified released product from the official Bandai English manifest',
    });
  });

  it('rejects mutated identity, invalid dates, and non-Bandai URLs', () => {
    expect(() => previousBandaiReleaseContinuityV2(snapshot([
      product({ officialCode: 'OP-13' }),
    ]))).toThrow(/no longer matches its official title/);

    expect(() => previousBandaiReleaseContinuityV2(snapshot([
      product({ releasedOn: 'not-a-date' }),
    ]))).toThrow(/invalid release date/);

    expect(() => previousBandaiReleaseContinuityV2(snapshot([
      product({ productUrl: 'https://example.com/products/boosters/op12.php' }),
    ]))).toThrow(/unsafe product URL/);
  });

  it('refetches transiently inconsistent release manifests with bounded delays', async () => {
    const delays = [];
    const retries = [];
    let attempts = 0;
    const result = await retryReleaseManifestValidationV2(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`inconsistent archive ${attempts}`);
      return { groups: ['OP01', 'OP02'] };
    }, {
      maxAttempts: 3,
      baseDelayMs: 100,
      sleep: async (milliseconds) => delays.push(milliseconds),
      onRetry: (retry) => retries.push(retry),
    });

    expect(result).toEqual({ groups: ['OP01', 'OP02'] });
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(retries.map((retry) => retry.nextAttempt)).toEqual([2, 3]);
  });

  it('reports the final manifest inconsistency and preserves its cause', async () => {
    await expect(retryReleaseManifestValidationV2(
      async () => { throw new Error('duplicate OP-12'); },
      { maxAttempts: 2, baseDelayMs: 0, sleep: async () => {} },
    )).rejects.toSatisfy((error) =>
      /remained inconsistent after 2 attempts/.test(error.message)
      && error.cause?.message === 'duplicate OP-12',
    );
  });
});
