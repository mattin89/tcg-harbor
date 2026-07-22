import { describe, expect, it, vi } from 'vitest';
import {
  ResilientFetchErrorV8,
  fetchJsonWithRetryV8,
  fetchSequentiallyWithPauseV8,
  fetchTextWithRetryV8,
  isTransientHttpStatusV8,
  isTransientNetworkErrorV8,
  parseRetryAfterV8,
} from '../../scripts/lib/resilient-fetch-v8.mjs';

const response = (body, status = 200, headers = {}) => new Response(body, { status, headers });
const quiet = () => {};

describe('resilient fetch v8', () => {
  it('classifies only retryable HTTP statuses as transient', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 599]) {
      expect(isTransientHttpStatusV8(status), String(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 422, 600]) {
      expect(isTransientHttpStatusV8(status), String(status)).toBe(false);
    }
  });

  it('recognizes transient network causes without retrying arbitrary errors', () => {
    const timeout = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
    });
    expect(isTransientNetworkErrorV8(timeout)).toBe(true);
    expect(isTransientNetworkErrorV8(new TypeError('bad application input'))).toBe(false);
    expect(isTransientNetworkErrorV8(new Error('programming error'))).toBe(false);
  });

  it('uses bounded exponential delays for transient network failures', async () => {
    const delays = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 5) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
        });
      }
      return response('{"ok":true}');
    });

    await expect(fetchJsonWithRetryV8('https://example.test/cards', {
      fetchImpl,
      sleep: async (milliseconds) => delays.push(milliseconds),
      random: () => 0.5,
      jitterRatio: 0,
      baseDelayMs: 100,
      maxDelayMs: 250,
      onRetry: quiet,
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(delays).toEqual([100, 200, 250, 250]);
  });

  it('honors Retry-After and immediately rejects permanent HTTP failures', async () => {
    const delays = [];
    const retryingFetch = vi.fn()
      .mockResolvedValueOnce(response('busy', 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(response('{"ok":true}'));

    await expect(fetchJsonWithRetryV8('https://example.test/rate-limited', {
      fetchImpl: retryingFetch,
      sleep: async (milliseconds) => delays.push(milliseconds),
      jitterRatio: 0,
      onRetry: quiet,
    })).resolves.toEqual({ ok: true });
    expect(delays).toEqual([3_000]);

    const permanentFetch = vi.fn(async () => response('missing', 404));
    await expect(fetchTextWithRetryV8('https://example.test/missing', {
      fetchImpl: permanentFetch,
      sleep: async () => { throw new Error('must not sleep'); },
      onRetry: quiet,
    })).rejects.toMatchObject({
      name: 'ResilientFetchErrorV8',
      attempts: 1,
      status: 404,
      transient: false,
    });
    expect(permanentFetch).toHaveBeenCalledTimes(1);
  });

  it('parses both forms of Retry-After and caps excessive server delays', async () => {
    const nowMs = Date.parse('2026-07-22T12:00:00.000Z');
    expect(parseRetryAfterV8('2.5', nowMs)).toBe(2_500);
    expect(parseRetryAfterV8('Wed, 22 Jul 2026 12:00:07 GMT', nowMs)).toBe(7_000);
    expect(parseRetryAfterV8('not-a-date', nowMs)).toBeNull();

    const delays = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response('busy', 503, { 'retry-after': '120' }))
      .mockResolvedValueOnce(response('ready'));
    await fetchTextWithRetryV8('https://example.test/recovering', {
      fetchImpl,
      sleep: async (milliseconds) => delays.push(milliseconds),
      maxRetryAfterMs: 5_000,
      jitterRatio: 0,
      onRetry: quiet,
    });
    expect(delays).toEqual([5_000]);
  });

  it('retries failed JSON bodies and parse errors inside the request budget', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => { throw new TypeError('terminated while reading body'); },
      })
      .mockResolvedValueOnce(response('{truncated'))
      .mockResolvedValueOnce(response('{"cards":[1,2]}'));
    const retries = [];

    await expect(fetchJsonWithRetryV8('https://example.test/json', {
      fetchImpl,
      sleep: async () => {},
      jitterRatio: 0,
      onRetry: (retry) => retries.push(retry),
    })).resolves.toEqual({ cards: [1, 2] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(retries).toHaveLength(2);
    expect(retries.every((retry) => /invalid JSON response/.test(retry.reason))).toBe(true);
  });

  it('aborts an attempt and reports the URL, attempts, and final cause', async () => {
    const fetchImpl = vi.fn(async (_url, { signal }) => {
      if (signal.aborted) throw signal.reason;
      throw new Error('timer did not abort');
    });

    let timerId = 0;
    const promise = fetchTextWithRetryV8('https://optcgapi.com/api/allSetCards/', {
      fetchImpl,
      maxAttempts: 1,
      attemptTimeoutMs: 25,
      overallTimeoutMs: 25,
      setTimeoutImpl: (callback) => {
        timerId += 1;
        callback();
        return timerId;
      },
      clearTimeoutImpl: () => {},
      onRetry: quiet,
    });

    await expect(promise).rejects.toSatisfy((error) =>
      error instanceof ResilientFetchErrorV8
      && error.url === 'https://optcgapi.com/api/allSetCards/'
      && error.attempts === 1
      && error.lastFailureKind === 'timeout'
      && /request attempt timed out after 25ms/.test(error.message),
    );
  });

  it('does not start another attempt when its backoff cannot fit the overall budget', async () => {
    let nowMs = 0;
    const delays = [];
    const fetchImpl = vi.fn(async () => response('busy', 503));

    await expect(fetchTextWithRetryV8('https://example.test/budgeted', {
      fetchImpl,
      now: () => nowMs,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        nowMs += milliseconds;
      },
      maxAttempts: 5,
      attemptTimeoutMs: 100,
      overallTimeoutMs: 100,
      baseDelayMs: 60,
      maxDelayMs: 1_000,
      jitterRatio: 0,
      onRetry: quiet,
    })).rejects.toSatisfy((error) =>
      error instanceof ResilientFetchErrorV8
      && error.attempts === 2
      && /40ms remained, less than the 120ms required backoff/.test(error.message),
    );

    expect(delays).toEqual([60]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fetches same-host feeds sequentially with a pause between feeds', async () => {
    let active = 0;
    let maximumActive = 0;
    const pauses = [];
    const order = [];
    const feeds = ['set', 'starter', 'promo', 'don'];

    const results = await fetchSequentiallyWithPauseV8(feeds, async (feed) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(feed);
      await Promise.resolve();
      active -= 1;
      return `${feed}-cards`;
    }, {
      pauseMs: 300,
      sleep: async (milliseconds) => pauses.push(milliseconds),
    });

    expect(maximumActive).toBe(1);
    expect(order).toEqual(feeds);
    expect(pauses).toEqual([300, 300, 300]);
    expect(results).toEqual(feeds.map((feed) => `${feed}-cards`));
  });
});
