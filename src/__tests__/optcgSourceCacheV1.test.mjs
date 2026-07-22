import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  assertOptcgCacheCoversReleasedSetsV1,
  buildOptcgSourceCacheV1,
  loadOptcgFeedsWithCacheV1,
  OPTCG_FEEDS_V1,
  OPTCG_SOURCE_CACHE_MAX_AGE_MS_V1,
  OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1,
  parseOptcgSourceCacheV1,
  serializeOptcgSourceCacheV1,
} from '../../scripts/lib/optcg-source-cache-v1.mjs';
import { ResilientFetchErrorV8 } from '../../scripts/lib/resilient-fetch-v8.mjs';

const FETCHED_AT = new Date().toISOString();
const PARSE_NOW_MS = Date.parse(FETCHED_AT) + (5 * 60 * 1_000);
const RELEASED_SET_CODES = ['OP16', 'ST30'];
const checkedInCacheUrl = new URL('../../scripts/data/optcg-source-cache-v1.json', import.meta.url);

function recordFor(kind, index) {
  return {
    card_set_id: kind === 'don' ? null : `${kind.toUpperCase()}-${String(index).padStart(4, '0')}`,
    card_image_id: `${kind}_${index}`,
    card_name: `${kind} card ${index}`,
    set_name: `${kind} source`,
    set_id: kind === 'set' ? 'OP16' : kind === 'starter' ? 'ST30' : kind === 'promo' ? 'P' : null,
    card_text: `Rules ${index}`,
    market_price: index / 10,
    inventory_price: null,
    date_scraped: FETCHED_AT,
    card_image: `https://example.test/${kind}/${index}.jpg`,
    optcg_don_name: kind === 'don' ? `DON ${index}` : null,
    rarity: kind === 'don' ? 'DON!!' : 'C',
    ignored_upstream_field: 'must not enter the cache',
  };
}

function validResponses() {
  return OPTCG_FEEDS_V1.map((feed) => Array.from(
    { length: OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1[feed.kind] },
    (_unused, index) => recordFor(feed.kind, index),
  ));
}

function buildCache(responses = validResponses()) {
  return buildOptcgSourceCacheV1(responses, {
    fetchedAt: FETCHED_AT,
    releaseVerifiedAt: FETCHED_AT,
    releasedSetCodes: RELEASED_SET_CODES,
  });
}

function transientOptcgError() {
  return new ResilientFetchErrorV8('OPTCG connect timeout', {
    url: OPTCG_FEEDS_V1[0].url,
    attempts: 5,
    maxAttempts: 5,
    elapsedMs: 66_000,
    lastFailureKind: 'network',
    status: null,
    transient: true,
  });
}

describe('OPTCG source cache v1', () => {
  it('round-trips compact records under a content hash', () => {
    const source = validResponses();
    const document = buildCache(source);
    const parsed = parseOptcgSourceCacheV1(serializeOptcgSourceCacheV1(document), {
      nowMs: PARSE_NOW_MS,
    });

    expect(document.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.fetchedAt).toBe(FETCHED_AT);
    expect(parsed.responses.map((records) => records.length)).toEqual(
      OPTCG_FEEDS_V1.map((feed) => OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1[feed.kind]),
    );
    expect(parsed.responses[0][0]).not.toHaveProperty('ignored_upstream_field');
    expect(parsed.releasedSetCodes).toEqual(RELEASED_SET_CODES);
  });

  it('rejects tampering and feed identity changes', () => {
    const document = buildCache();
    const tampered = structuredClone(document);
    tampered.feeds[0].records[0].card_name = 'Tampered';
    expect(() => parseOptcgSourceCacheV1(JSON.stringify(tampered), {
      nowMs: PARSE_NOW_MS,
    })).toThrow(/integrity check failed/i);

    const wrongFeed = structuredClone(document);
    wrongFeed.feeds[0].url = 'https://example.test/not-optcg';
    expect(() => parseOptcgSourceCacheV1(JSON.stringify(wrongFeed), {
      nowMs: PARSE_NOW_MS,
    })).toThrow(/does not match set/i);
  });

  it('refuses truncated live or cached feeds', () => {
    const truncatedLive = validResponses();
    truncatedLive[0].pop();
    expect(() => buildCache(truncatedLive)).toThrow(/expected at least 3000/i);

    const truncatedCache = buildCache();
    truncatedCache.feeds[3].records.pop();
    expect(() => parseOptcgSourceCacheV1(JSON.stringify(truncatedCache), {
      nowMs: PARSE_NOW_MS,
    })).toThrow(/expected at least 150/i);
  });

  it('expires old caches and refuses a newly released preview set', () => {
    const previewResponses = validResponses();
    previewResponses[0][0].set_id = 'OP17';
    previewResponses[0][0].card_set_id = 'OP17-001';
    const previewCache = buildCache(previewResponses);

    expect(() => assertOptcgCacheCoversReleasedSetsV1(
      previewCache,
      [...RELEASED_SET_CODES, 'OP17'],
      { nowMs: PARSE_NOW_MS },
    )).toThrow(/predates officially released sets: OP17/i);

    expect(() => parseOptcgSourceCacheV1(JSON.stringify(previewCache), {
      nowMs: Date.parse(FETCHED_AT) + OPTCG_SOURCE_CACHE_MAX_AGE_MS_V1 + 1,
    })).toThrow(/older than the 7-day fallback limit/i);
  });

  it('validates the checked-in production cache fixture', async () => {
    const parsed = parseOptcgSourceCacheV1(await readFile(checkedInCacheUrl, 'utf8'));
    expect(parsed.responses.map((records) => records.length)).toEqual([3485, 538, 1082, 187]);
    expect(parsed.releasedSetCodes).toContain('OP16');
    expect(parsed.releasedSetCodes).toContain('ST30');
  });

  it('falls back only for a transient failure from the exact OPTCG host', async () => {
    const document = buildCache();
    const readCache = vi.fn(async () => serializeOptcgSourceCacheV1(document));
    const fallback = await loadOptcgFeedsWithCacheV1({
      fetchLive: async () => { throw transientOptcgError(); },
      readCache,
    });

    expect(fallback.retrievalMode).toBe('integrity-checked-cache-fallback');
    expect(fallback.cacheFetchedAt).toBe(FETCHED_AT);
    expect(fallback.cacheDocument).toMatchObject({
      schemaVersion: 1,
      fetchedAt: FETCHED_AT,
    });
    expect(fallback.liveFetchError).toMatchObject({
      name: 'ResilientFetchErrorV8',
      lastFailureKind: 'network',
      attempts: 5,
    });
    expect(readCache).toHaveBeenCalledOnce();

    const permanent = new ResilientFetchErrorV8('Not found', {
      url: OPTCG_FEEDS_V1[0].url,
      transient: false,
      status: 404,
    });
    const permanentRead = vi.fn();
    await expect(loadOptcgFeedsWithCacheV1({
      fetchLive: async () => { throw permanent; },
      readCache: permanentRead,
    })).rejects.toBe(permanent);
    expect(permanentRead).not.toHaveBeenCalled();
  });
});
