import { createHash } from 'node:crypto';
import { ResilientFetchErrorV8 } from './resilient-fetch-v8.mjs';

export const OPTCG_SOURCE_CACHE_SCHEMA_VERSION_V1 = 1;
export const OPTCG_SOURCE_CACHE_SOURCE_V1 = 'https://optcgapi.com/documentation';
export const OPTCG_FEEDS_V1 = Object.freeze([
  Object.freeze({ kind: 'set', url: 'https://optcgapi.com/api/allSetCards/' }),
  Object.freeze({ kind: 'starter', url: 'https://optcgapi.com/api/allSTCards/' }),
  Object.freeze({ kind: 'promo', url: 'https://optcgapi.com/api/allPromos/' }),
  Object.freeze({ kind: 'don', url: 'https://optcgapi.com/api/allDonCards/' }),
]);

export const OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1 = Object.freeze({
  set: 3_000,
  starter: 400,
  promo: 1_000,
  don: 150,
});
export const OPTCG_SOURCE_CACHE_MAX_AGE_MS_V1 = 7 * 24 * 60 * 60 * 1_000;

const CACHE_FIELDS = Object.freeze([
  'card_set_id',
  'card_image_id',
  'card_name',
  'set_name',
  'set_id',
  'card_text',
  'market_price',
  'inventory_price',
  'date_scraped',
  'card_image',
  'optcg_don_name',
  'rarity',
]);
const CACHE_FIELD_SET = new Set(CACHE_FIELDS);
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertIsoTimestamp(value, label, {
  nowMs = Date.now(),
  maxAgeMs = null,
} = {}) {
  const parsed = new Date(value);
  if (typeof value !== 'string'
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString() !== value) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  if (parsed.valueOf() > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error(`${label} is unexpectedly in the future.`);
  }
  if (maxAgeMs != null && nowMs - parsed.valueOf() > maxAgeMs) {
    throw new Error(`${label} is older than the ${Math.round(maxAgeMs / 86_400_000)}-day fallback limit.`);
  }
  return value;
}

function compactRecord(record, feed) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`OPTCG ${feed.kind} feed contains a non-object record.`);
  }
  const compact = Object.fromEntries(CACHE_FIELDS
    .filter((field) => Object.hasOwn(record, field) && record[field] !== undefined)
    .map((field) => [field, record[field]]));
  assertCompactRecord(compact, feed);
  return compact;
}

function assertCompactRecord(record, feed) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Cached OPTCG ${feed.kind} feed contains a non-object record.`);
  }
  const unknownFields = Object.keys(record).filter((field) => !CACHE_FIELD_SET.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`Cached OPTCG ${feed.kind} record contains unsupported fields: ${unknownFields.join(', ')}.`);
  }
  if (![record.card_set_id, record.card_image_id, record.optcg_don_name]
    .some((value) => String(value ?? '').trim())) {
    throw new Error(`Cached OPTCG ${feed.kind} record has no stable card identity.`);
  }
  for (const [field, value] of Object.entries(record)) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Cached OPTCG ${feed.kind} record field ${field} is not a JSON scalar.`);
    }
  }
}

function assertResponseCounts(responses) {
  if (!Array.isArray(responses) || responses.length !== OPTCG_FEEDS_V1.length) {
    throw new Error(`Expected ${OPTCG_FEEDS_V1.length} OPTCG feed responses.`);
  }
  for (const [index, feed] of OPTCG_FEEDS_V1.entries()) {
    const records = responses[index];
    if (!Array.isArray(records)) {
      throw new Error(`OPTCG ${feed.kind} feed did not return an array.`);
    }
    const minimum = OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1[feed.kind];
    if (records.length < minimum) {
      throw new Error(`OPTCG ${feed.kind} feed returned ${records.length} records; expected at least ${minimum}.`);
    }
  }
}

function memberSetCodes(value) {
  return [...String(value ?? '').toUpperCase().matchAll(/(?:OP|EB|PRB|ST)-?\d{2}/g)]
    .map((match) => match[0].replace('-', ''));
}

function recordSetCodes(record, feed) {
  if (feed.kind === 'promo' || feed.kind === 'don') return [];
  const explicit = memberSetCodes(record.set_id);
  return explicit.length > 0 ? explicit : memberSetCodes(record.card_set_id);
}

function normalizedReleasedSetCodes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('OPTCG cache release coverage needs at least one released set code.');
  }
  const normalized = [...new Set(values.map((value) => String(value ?? '').trim().toUpperCase()))]
    .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true }));
  const invalid = normalized.filter((code) => !/^(?:OP|EB|PRB|ST)\d{2}$/.test(code));
  if (invalid.length > 0) {
    throw new Error(`OPTCG cache release coverage has invalid set codes: ${invalid.join(', ')}.`);
  }
  return normalized;
}

function releaseRecordCounts(feeds, releasedSetCodes) {
  const released = new Set(releasedSetCodes);
  const counts = Object.fromEntries(releasedSetCodes.map((code) => [code, 0]));
  for (const [index, feed] of OPTCG_FEEDS_V1.entries()) {
    for (const record of feeds[index].records) {
      for (const code of new Set(recordSetCodes(record, feed))) {
        if (released.has(code)) counts[code] += 1;
      }
    }
  }
  return counts;
}

function assertReleaseCoverage(releaseCoverage, feeds, nowMs) {
  if (!releaseCoverage || typeof releaseCoverage !== 'object' || Array.isArray(releaseCoverage)) {
    throw new Error('OPTCG source cache has no official release coverage metadata.');
  }
  assertIsoTimestamp(releaseCoverage.verifiedAt, 'OPTCG cache release coverage verifiedAt', { nowMs });
  const normalizedCodes = normalizedReleasedSetCodes(releaseCoverage.releasedSetCodes);
  if (JSON.stringify(normalizedCodes) !== JSON.stringify(releaseCoverage.releasedSetCodes)) {
    throw new Error('OPTCG cache released set codes must be unique, normalized, and sorted.');
  }
  const expectedCounts = releaseRecordCounts(feeds, normalizedCodes);
  const recordedCounts = releaseCoverage.recordCountsBySetCode;
  if (!recordedCounts || typeof recordedCounts !== 'object' || Array.isArray(recordedCounts)) {
    throw new Error('OPTCG cache has no per-set release record counts.');
  }
  if (JSON.stringify(Object.keys(recordedCounts)) !== JSON.stringify(normalizedCodes)) {
    throw new Error('OPTCG cache per-set counts do not match its released set list.');
  }
  for (const code of normalizedCodes) {
    if (!Number.isInteger(recordedCounts[code])
      || recordedCounts[code] <= 0
      || recordedCounts[code] !== expectedCounts[code]) {
      throw new Error(`OPTCG cache has invalid release coverage for ${code}.`);
    }
  }
  return normalizedCodes;
}

function cacheCore({ fetchedAt, releaseCoverage, feeds }) {
  return {
    schemaVersion: OPTCG_SOURCE_CACHE_SCHEMA_VERSION_V1,
    source: OPTCG_SOURCE_CACHE_SOURCE_V1,
    fetchedAt,
    releaseCoverage,
    feeds,
  };
}

function cacheHash(core) {
  return sha256(JSON.stringify(core));
}

export function buildOptcgSourceCacheV1(responses, {
  fetchedAt = new Date().toISOString(),
  releaseVerifiedAt = fetchedAt,
  releasedSetCodes,
} = {}) {
  assertIsoTimestamp(fetchedAt, 'OPTCG cache fetchedAt');
  assertIsoTimestamp(releaseVerifiedAt, 'OPTCG cache release coverage verifiedAt');
  assertResponseCounts(responses);
  const feeds = OPTCG_FEEDS_V1.map((feed, index) => ({
    kind: feed.kind,
    url: feed.url,
    records: responses[index].map((record) => compactRecord(record, feed)),
  }));
  const normalizedCodes = normalizedReleasedSetCodes(releasedSetCodes);
  const releaseCoverage = {
    verifiedAt: releaseVerifiedAt,
    releasedSetCodes: normalizedCodes,
    recordCountsBySetCode: releaseRecordCounts(feeds, normalizedCodes),
  };
  assertReleaseCoverage(releaseCoverage, feeds, Date.now());
  const core = cacheCore({ fetchedAt, releaseCoverage, feeds });
  return { ...core, payloadSha256: cacheHash(core) };
}

export function validateOptcgSourceCacheV1(document, { nowMs = Date.now() } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('OPTCG source cache must be a JSON object.');
  }
  if (document.schemaVersion !== OPTCG_SOURCE_CACHE_SCHEMA_VERSION_V1) {
    throw new Error(`Unsupported OPTCG source cache schema ${document.schemaVersion}.`);
  }
  if (document.source !== OPTCG_SOURCE_CACHE_SOURCE_V1) {
    throw new Error('OPTCG source cache has an unexpected source identifier.');
  }
  assertIsoTimestamp(document.fetchedAt, 'OPTCG cache fetchedAt', {
    nowMs,
    maxAgeMs: OPTCG_SOURCE_CACHE_MAX_AGE_MS_V1,
  });
  if (!Array.isArray(document.feeds) || document.feeds.length !== OPTCG_FEEDS_V1.length) {
    throw new Error(`OPTCG source cache must contain ${OPTCG_FEEDS_V1.length} feeds.`);
  }

  const responses = [];
  for (const [index, expected] of OPTCG_FEEDS_V1.entries()) {
    const cachedFeed = document.feeds[index];
    if (!cachedFeed || cachedFeed.kind !== expected.kind || cachedFeed.url !== expected.url) {
      throw new Error(`OPTCG source cache feed ${index + 1} does not match ${expected.kind} at ${expected.url}.`);
    }
    if (!Array.isArray(cachedFeed.records)) {
      throw new Error(`Cached OPTCG ${expected.kind} feed has no records array.`);
    }
    const minimum = OPTCG_SOURCE_CACHE_MINIMUM_RECORDS_V1[expected.kind];
    if (cachedFeed.records.length < minimum) {
      throw new Error(`Cached OPTCG ${expected.kind} feed has ${cachedFeed.records.length} records; expected at least ${minimum}.`);
    }
    cachedFeed.records.forEach((record) => assertCompactRecord(record, expected));
    responses.push(cachedFeed.records.map((record) => ({ ...record })));
  }

  const releasedSetCodes = assertReleaseCoverage(document.releaseCoverage, document.feeds, nowMs);

  const expectedHash = cacheHash(cacheCore({
    fetchedAt: document.fetchedAt,
    releaseCoverage: document.releaseCoverage,
    feeds: document.feeds,
  }));
  if (!/^[a-f0-9]{64}$/.test(String(document.payloadSha256 ?? ''))
    || document.payloadSha256 !== expectedHash) {
    throw new Error('OPTCG source cache integrity check failed.');
  }

  return {
    document,
    responses,
    fetchedAt: document.fetchedAt,
    releasedSetCodes,
  };
}

export function parseOptcgSourceCacheV1(serialized, options) {
  let document;
  try {
    document = JSON.parse(String(serialized));
  } catch (error) {
    throw new Error(`OPTCG source cache is not valid JSON: ${error?.message ?? String(error)}.`, { cause: error });
  }
  return validateOptcgSourceCacheV1(document, options);
}

export function serializeOptcgSourceCacheV1(document) {
  validateOptcgSourceCacheV1(document);
  return `${JSON.stringify(document)}\n`;
}

export function assertOptcgCacheCoversReleasedSetsV1(document, releasedSetCodes, options) {
  const cached = validateOptcgSourceCacheV1(document, options);
  const requiredCodes = normalizedReleasedSetCodes(releasedSetCodes);
  const cachedCodes = new Set(cached.releasedSetCodes);
  const missingCodes = requiredCodes.filter((code) => !cachedCodes.has(code));
  if (missingCodes.length > 0) {
    throw new Error(`Integrity-checked OPTCG cache predates officially released sets: ${missingCodes.join(', ')}.`);
  }
  return cached.releasedSetCodes;
}

export function isTransientOptcgSourceFailureV1(error) {
  if (!(error instanceof ResilientFetchErrorV8) || error.transient !== true) return false;
  try {
    return new URL(error.url).hostname === 'optcgapi.com';
  } catch {
    return false;
  }
}

function sanitizedFailure(error) {
  return {
    name: String(error?.name ?? 'Error'),
    message: String(error?.message ?? error),
    lastFailureKind: error?.lastFailureKind ?? null,
    attempts: Number.isInteger(error?.attempts) ? error.attempts : null,
  };
}

export async function loadOptcgFeedsWithCacheV1({ fetchLive, readCache }) {
  if (typeof fetchLive !== 'function') throw new TypeError('fetchLive must be a function.');
  if (typeof readCache !== 'function') throw new TypeError('readCache must be a function.');

  try {
    const responses = await fetchLive();
    assertResponseCounts(responses);
    for (const [index, feed] of OPTCG_FEEDS_V1.entries()) {
      responses[index].forEach((record) => compactRecord(record, feed));
    }
    return {
      responses,
      retrievalMode: 'live',
      cacheDocument: null,
      sourceFetchedAt: new Date().toISOString(),
      cacheFetchedAt: null,
      liveFetchError: null,
    };
  } catch (error) {
    if (!isTransientOptcgSourceFailureV1(error)) throw error;

    try {
      const cached = parseOptcgSourceCacheV1(await readCache());
      return {
        responses: cached.responses,
        retrievalMode: 'integrity-checked-cache-fallback',
        cacheDocument: cached.document,
        sourceFetchedAt: cached.fetchedAt,
        cacheFetchedAt: cached.fetchedAt,
        liveFetchError: sanitizedFailure(error),
      };
    } catch (cacheError) {
      throw new Error(
        `Transient OPTCG fetch failure had no usable integrity-checked cache. Live failure: ${error.message} Cache failure: ${cacheError?.message ?? String(cacheError)}`,
        { cause: error },
      );
    }
  }
}
