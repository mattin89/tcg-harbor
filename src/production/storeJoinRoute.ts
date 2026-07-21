const legacyProductionJoinPattern = /^\/join\/store\/([^/?#]+)\/?$/i;
const legacyDemoJoinPattern = /^\/join\/(?!store(?:\/|$))([^/?#]+)\/?$/i;
const canonicalJoinPattern = /^\/join\/store\/?$/i;

const sessionIntentKey = "tcg-harbor.store-join.session.v1";
const emailHandoffKey = "tcg-harbor.store-join.email-handoff.v1";
const sessionIntentTtlMs = 30 * 60 * 1000;
const emailHandoffTtlMs = 15 * 60 * 1000;

export interface StoreJoinIntent {
  token: string;
  expiresAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface LocationLike {
  pathname: string;
  hash: string;
}

interface HistoryLike {
  state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

function decodeToken(value: string): string | null {
  try {
    const token = decodeURIComponent(value).trim();
    if (token.length === 0 || token.length > 256) return null;
    return /^(?:th[qj]_[a-f0-9]{4,128}|TH-[A-F0-9]{8,128}|HARBOR-[A-Z0-9-]{4,200})$/i.test(token)
      ? token
      : null;
  } catch {
    return null;
  }
}

function tokenFromHash(hash: string): string | null {
  try {
    const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
    return token ? decodeToken(token) : null;
  } catch {
    return null;
  }
}

function writeIntent(storage: StorageLike, key: string, intent: StoreJoinIntent): boolean {
  try {
    storage.setItem(key, JSON.stringify(intent));
    return true;
  } catch {
    return false;
  }
}

function readIntent(storage: StorageLike, key: string, now: number): StoreJoinIntent | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoreJoinIntent>;
    const token = typeof parsed.token === "string" ? decodeToken(parsed.token) : null;
    if (!token || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) {
      storage.removeItem(key);
      return null;
    }
    return { token, expiresAt: parsed.expiresAt };
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be disabled. */ }
    return null;
  }
}

function removeIntent(storage: StorageLike, key: string) {
  try { storage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

/** Extracts existing path-based codes during the migration period. */
export function storeJoinTokenFromPath(pathname: string): string | null {
  const match = pathname.match(legacyProductionJoinPattern) ?? pathname.match(legacyDemoJoinPattern);
  return match ? decodeToken(match[1]) : null;
}

export function storeJoinTokenFromLocation(pathname: string, hash: string): string | null {
  if (canonicalJoinPattern.test(pathname)) return tokenFromHash(hash);
  return storeJoinTokenFromPath(pathname);
}

export function storeJoinTokenFromPayload(payload: string, origin: string): string | null {
  const value = payload.trim();
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    const routedToken = storeJoinTokenFromLocation(url.pathname, url.hash);
    if (routedToken) return routedToken;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || /[/?#]/.test(value)) return null;
    return decodeToken(value);
  } catch {
    return decodeToken(value);
  }
}

/** Fragments are not sent to Render/CDNs or included in HTTP Referer headers. */
export function storeJoinUrl(origin: string, rawToken: string): string {
  return `${origin.replace(/\/$/, "")}/join/store#token=${encodeURIComponent(rawToken)}`;
}

/**
 * Captures fragment or legacy path tokens, stores a short-lived same-tab
 * intent, and immediately replaces the address with the token-free route.
 */
export function captureStoreJoinIntent(
  location: LocationLike,
  history: HistoryLike,
  sessionStorage: StorageLike,
  localStorage: StorageLike,
  now = Date.now(),
): StoreJoinIntent | null {
  const token = storeJoinTokenFromLocation(location.pathname, location.hash);
  const isJoinRoute = canonicalJoinPattern.test(location.pathname) || Boolean(storeJoinTokenFromPath(location.pathname));

  if (token) {
    const intent = { token, expiresAt: now + sessionIntentTtlMs };
    writeIntent(sessionStorage, sessionIntentKey, intent);
    history.replaceState(history.state, "", "/join/store");
    return intent;
  }

  if (!isJoinRoute) return null;

  const sessionIntent = readIntent(sessionStorage, sessionIntentKey, now);
  if (sessionIntent) return sessionIntent;

  const handoff = readIntent(localStorage, emailHandoffKey, now);
  if (!handoff) return null;
  removeIntent(localStorage, emailHandoffKey);
  writeIntent(sessionStorage, sessionIntentKey, handoff);
  return handoff;
}

export function captureStoreJoinIntentFromBrowser(now = Date.now()): StoreJoinIntent | null {
  return captureStoreJoinIntent(window.location, window.history, window.sessionStorage, window.localStorage, now);
}

export function persistStoreJoinSessionIntent(token: string, storage: StorageLike, now = Date.now()): StoreJoinIntent | null {
  const normalized = decodeToken(token);
  if (!normalized) return null;
  const intent = { token: normalized, expiresAt: now + sessionIntentTtlMs };
  return writeIntent(storage, sessionIntentKey, intent) ? intent : null;
}

export function peekStoreJoinIntent(storage: StorageLike, now = Date.now()): StoreJoinIntent | null {
  return readIntent(storage, sessionIntentKey, now);
}

/** One-time cross-tab bridge for an email-confirmation callback. */
export function persistStoreJoinEmailHandoff(token: string, storage: StorageLike, now = Date.now()): boolean {
  const normalized = decodeToken(token);
  return normalized ? writeIntent(storage, emailHandoffKey, { token: normalized, expiresAt: now + emailHandoffTtlMs }) : false;
}

export function clearStoredStoreJoinIntent(sessionStorage: StorageLike, localStorage: StorageLike): void {
  removeIntent(sessionStorage, sessionIntentKey);
  removeIntent(localStorage, emailHandoffKey);
}
