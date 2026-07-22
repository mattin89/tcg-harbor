const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);
const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ResilientFetchErrorV8 extends Error {
  constructor(message, context, options = {}) {
    super(message, options);
    this.name = 'ResilientFetchErrorV8';
    Object.assign(this, context);
  }
}

class JsonPayloadErrorV8 extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'JsonPayloadErrorV8';
  }
}

function errorChain(error) {
  const errors = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    errors.push(current);
    seen.add(current);
    current = current.cause;
  }
  return errors;
}

function networkCode(error) {
  return errorChain(error)
    .map((entry) => String(entry.code ?? ''))
    .find(Boolean) ?? null;
}

export function isTransientHttpStatusV8(status) {
  const numericStatus = Number(status);
  return TRANSIENT_HTTP_STATUSES.has(numericStatus)
    || (numericStatus >= 500 && numericStatus <= 599);
}

export function isTransientNetworkErrorV8(error) {
  const chain = errorChain(error);
  if (chain.some((entry) => TRANSIENT_NETWORK_CODES.has(String(entry.code ?? '')))) return true;
  if (chain.some((entry) => entry.name === 'AbortError' || entry.name === 'TimeoutError')) return true;

  // Node's fetch wraps some connection failures in TypeError. Only treat that
  // wrapper as transient when it is the fetch-style error, rather than retrying
  // arbitrary TypeErrors raised by application code.
  return chain.some((entry) =>
    entry instanceof TypeError
    && /fetch failed|network error|terminated|socket/i.test(String(entry.message ?? '')),
  );
}

export function parseRetryAfterV8(value, nowMs = Date.now()) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const milliseconds = Number(normalized) * 1_000;
    return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : null;
  }

  const retryAt = Date.parse(normalized);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

function describeFailure(failure) {
  if (failure.kind === 'http') {
    const statusText = failure.statusText ? ` ${failure.statusText}` : '';
    return `HTTP ${failure.status}${statusText}`;
  }
  if (failure.kind === 'json') return `invalid JSON response (${failure.error.message})`;
  if (failure.kind === 'timeout') return `request attempt timed out after ${failure.timeoutMs}ms`;
  const code = networkCode(failure.error);
  return `${code ? `${code}: ` : ''}${failure.error?.message ?? String(failure.error)}`;
}

function retryDelay({
  attempt,
  retryAfter,
  baseDelayMs,
  maxDelayMs,
  maxRetryAfterMs,
  jitterRatio,
  random,
}) {
  if (retryAfter != null) return Math.min(retryAfter, maxRetryAfterMs);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
  const jitter = 1 + (((random() * 2) - 1) * jitterRatio);
  return Math.max(0, Math.min(maxDelayMs, Math.round(exponential * jitter)));
}

function validateOptions({
  maxAttempts,
  attemptTimeoutMs,
  overallTimeoutMs,
  baseDelayMs,
  maxDelayMs,
  maxRetryAfterMs,
  jitterRatio,
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be a positive integer.');
  for (const [name, value] of Object.entries({
    attemptTimeoutMs,
    overallTimeoutMs,
    baseDelayMs,
    maxDelayMs,
    maxRetryAfterMs,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number.`);
  }
  if (attemptTimeoutMs === 0 || overallTimeoutMs === 0) throw new TypeError('Request timeouts must be greater than zero.');
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new TypeError('jitterRatio must be between zero and one.');
  }
}

async function requestWithRetryV8(url, {
  responseType,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  maxAttempts = 5,
  attemptTimeoutMs = 30_000,
  overallTimeoutMs = 150_000,
  baseDelayMs = 1_000,
  maxDelayMs = 15_000,
  maxRetryAfterMs = 30_000,
  jitterRatio = 0.2,
  headers,
  onRetry = () => {},
} = {}) {
  validateOptions({
    maxAttempts,
    attemptTimeoutMs,
    overallTimeoutMs,
    baseDelayMs,
    maxDelayMs,
    maxRetryAfterMs,
    jitterRatio,
  });
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');

  const requestUrl = String(url);
  const startedAt = now();
  let attempt = 0;
  let lastFailure = null;
  let budgetContext = null;

  while (attempt < maxAttempts) {
    const elapsedBeforeAttempt = Math.max(0, now() - startedAt);
    const remainingBeforeAttempt = overallTimeoutMs - elapsedBeforeAttempt;
    if (remainingBeforeAttempt <= 0) {
      budgetContext = `the ${overallTimeoutMs}ms overall request budget was exhausted`;
      break;
    }

    attempt += 1;
    const timeoutMs = Math.max(1, Math.min(attemptTimeoutMs, remainingBeforeAttempt));
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => {
      controller.abort(new DOMException(`Request attempt exceeded ${timeoutMs}ms.`, 'TimeoutError'));
    }, timeoutMs);

    let failure = null;
    let retryAfter = null;
    try {
      const response = await fetchImpl(requestUrl, { headers, signal: controller.signal });
      if (!response?.ok) {
        const status = Number(response?.status);
        failure = {
          kind: 'http',
          status,
          statusText: String(response?.statusText ?? '').trim(),
          transient: isTransientHttpStatusV8(status),
        };
        retryAfter = parseRetryAfterV8(response?.headers?.get?.('retry-after'), now());
      } else if (responseType === 'json') {
        try {
          const body = await response.text();
          return JSON.parse(body);
        } catch (error) {
          if (controller.signal.aborted) {
            failure = { kind: 'timeout', error, timeoutMs, transient: true };
          } else {
            const payloadError = new JsonPayloadErrorV8(
              `Could not read or parse JSON from ${requestUrl}: ${error?.message ?? String(error)}`,
              { cause: error },
            );
            failure = { kind: 'json', error: payloadError, transient: true };
          }
        }
      } else {
        try {
          return await response.text();
        } catch (error) {
          failure = {
            kind: controller.signal.aborted ? 'timeout' : 'network',
            error,
            timeoutMs,
            transient: controller.signal.aborted || isTransientNetworkErrorV8(error),
          };
        }
      }
    } catch (error) {
      failure = {
        kind: controller.signal.aborted ? 'timeout' : 'network',
        error,
        timeoutMs,
        transient: controller.signal.aborted || isTransientNetworkErrorV8(error),
      };
    } finally {
      clearTimeoutImpl(timeout);
    }

    lastFailure = failure;
    const canRetry = failure?.transient && attempt < maxAttempts;
    if (!canRetry) break;

    const elapsedAfterAttempt = Math.max(0, now() - startedAt);
    const remainingAfterAttempt = overallTimeoutMs - elapsedAfterAttempt;
    if (remainingAfterAttempt <= 0) {
      budgetContext = `the ${overallTimeoutMs}ms overall request budget was exhausted`;
      break;
    }
    const requestedDelayMs = retryDelay({
      attempt,
      retryAfter,
      baseDelayMs,
      maxDelayMs,
      maxRetryAfterMs,
      jitterRatio,
      random,
    });
    if (requestedDelayMs >= remainingAfterAttempt) {
      budgetContext = `${remainingAfterAttempt}ms remained, less than the ${requestedDelayMs}ms required backoff`;
      break;
    }
    const delayMs = requestedDelayMs;
    onRetry({
      url: requestUrl,
      attempt,
      nextAttempt: attempt + 1,
      maxAttempts,
      delayMs,
      reason: describeFailure(failure),
      retryAfterMs: retryAfter,
    });
    if (delayMs > 0) await sleep(delayMs);
  }

  const elapsedMs = Math.max(0, now() - startedAt);
  const reason = lastFailure ? describeFailure(lastFailure) : `overall timeout exhausted after ${overallTimeoutMs}ms`;
  const retrySummary = lastFailure?.transient
    ? `${attempt}/${maxAttempts} attempts in ${elapsedMs}ms`
    : `a non-retryable failure on attempt ${attempt}`;
  const budgetSummary = budgetContext ? `; retry stopped because ${budgetContext}` : '';
  const cause = lastFailure?.error;
  throw new ResilientFetchErrorV8(
    `Failed to fetch ${requestUrl} after ${retrySummary}${budgetSummary}; last failure: ${reason}.`,
    {
      url: requestUrl,
      attempts: attempt,
      maxAttempts,
      elapsedMs,
      lastFailureKind: lastFailure?.kind ?? 'overall-timeout',
      status: lastFailure?.status ?? null,
      transient: lastFailure?.transient ?? true,
    },
    cause ? { cause } : {},
  );
}

export function fetchJsonWithRetryV8(url, options) {
  return requestWithRetryV8(url, { ...options, responseType: 'json' });
}

export function fetchTextWithRetryV8(url, options) {
  return requestWithRetryV8(url, { ...options, responseType: 'text' });
}

export async function fetchSequentiallyWithPauseV8(items, fetchItem, {
  pauseMs = 250,
  sleep = defaultSleep,
} = {}) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array.');
  if (typeof fetchItem !== 'function') throw new TypeError('fetchItem must be a function.');
  if (!Number.isFinite(pauseMs) || pauseMs < 0) throw new TypeError('pauseMs must be a non-negative finite number.');

  const results = [];
  for (const [index, item] of items.entries()) {
    if (index > 0 && pauseMs > 0) await sleep(pauseMs);
    results.push(await fetchItem(item, index));
  }
  return results;
}
