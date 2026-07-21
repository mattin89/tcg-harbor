import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export type AuthStateTransitionV3 = 'ignore' | 'reload-current' | 'replace-account' | 'signed-out';

function legacyJwtRoleV3(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3 || !value.startsWith('eyJ')) return null;
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : '';
  } catch {
    return '';
  }
}

/** Only publishable or legacy anon keys are permitted in a browser bundle. */
export function isBrowserSafeSupabaseKeyV3(value: string): boolean {
  const key = value.trim();
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  return legacyJwtRoleV3(key) === 'anon';
}

/**
 * Uses an app-specific, project-specific namespace. Versioning deliberately
 * prevents an older demo client on the same origin from restoring its token
 * into the production account runtime.
 */
export function supabaseAuthStorageKeyV3(supabaseUrl: string): string {
  const projectHost = new URL(supabaseUrl).hostname
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9.-]+/g, '-');
  return `tcg-harbor-v3:${projectHost}:auth`;
}

export class AccountIsolationErrorV3 extends Error {
  constructor(readonly operation: string, detail: string) {
    super(`${operation}: ${detail}`);
    this.name = 'AccountIsolationErrorV3';
  }
}

/** Verifies the active JWT with Supabase Auth before trusting an owner id. */
export async function requireAuthenticatedOwnerV3(
  client: SupabaseClient,
  expectedOwnerId: string,
  operation: string,
  accessToken?: string,
): Promise<User> {
  if (!expectedOwnerId) {
    throw new AccountIsolationErrorV3(operation, 'a signed-in account is required.');
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new AccountIsolationErrorV3(
      operation,
      'the active account could not be verified. Sign out and sign in again.',
    );
  }
  if (data.user.id !== expectedOwnerId) {
    throw new AccountIsolationErrorV3(
      operation,
      'the active session belongs to a different account. Sign out and sign in again.',
    );
  }
  return data.user;
}

/** Replaces untrusted storage-derived user data with the server-verified user. */
export async function verifiedSupabaseSessionV3(
  client: SupabaseClient,
  session: Session,
  operation = 'Restore session',
): Promise<Session> {
  const user = await requireAuthenticatedOwnerV3(
    client,
    session.user.id,
    operation,
    session.access_token,
  );
  return { ...session, user };
}

/** Defense in depth if a mocked, misconfigured, or regressed RLS query leaks rows. */
export function assertRowsOwnedByV3<Row extends object>(
  rows: readonly Row[],
  expectedOwnerId: string,
  operation: string,
  ownerColumn = 'owner_id',
): void {
  if (rows.some((row) => (row as Record<string, unknown>)[ownerColumn] !== expectedOwnerId)) {
    throw new AccountIsolationErrorV3(
      operation,
      'the database returned data owned by another account. No data was displayed.',
    );
  }
}

/** Clears account-shaped UI synchronously before a different identity can render. */
export function resolveAuthStateTransitionV3(
  event: string,
  incomingUserId: string | null,
  renderedUserId: string | null,
): AuthStateTransitionV3 {
  if (event === 'SIGNED_OUT' || !incomingUserId) return 'signed-out';
  if (!renderedUserId || incomingUserId !== renderedUserId) return 'replace-account';
  if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') return 'reload-current';
  return 'ignore';
}
