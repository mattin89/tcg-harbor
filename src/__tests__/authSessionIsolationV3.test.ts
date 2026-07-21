import { describe, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { SupabaseProductionAccess } from '../production/supabaseProductionAccess';
import {
  isBrowserSafeSupabaseKeyV3,
  resolveAuthStateTransitionV3,
  supabaseAuthStorageKeyV3,
} from '../services/supabase/authSessionIsolationV3';

function storedSession(userId: string): Session {
  return {
    access_token: `access-${userId}`,
    refresh_token: `refresh-${userId}`,
    expires_in: 3_600,
    token_type: 'bearer',
    user: { id: userId } as User,
  } as Session;
}

function verifiedUser(userId: string): User {
  return {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${userId}@example.test`,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-07-21T00:00:00.000Z',
  } as User;
}

function legacyJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('Supabase account session isolation v3', () => {
  it('server-verifies a restored session before returning its identity', async () => {
    const session = storedSession('account-a');
    const user = verifiedUser('account-a');
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        getUser,
      },
    } as unknown as SupabaseClient;

    const restored = await new SupabaseProductionAccess(client).getSession();

    expect(getUser).toHaveBeenCalledWith(session.access_token);
    expect(restored?.user).toBe(user);
  });

  it('fails closed when storage and the verified token identify different accounts', async () => {
    const session = storedSession('account-a');
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: verifiedUser('account-b') }, error: null }),
      },
    } as unknown as SupabaseClient;

    await expect(new SupabaseProductionAccess(client).getSession())
      .rejects.toThrow(/active session belongs to a different account/i);
  });

  it('signs out only the current device during a normal sign-out', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { signOut } } as unknown as SupabaseClient;

    await new SupabaseProductionAccess(client).signOut();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('uses global revocation only for the explicit all-devices action', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { signOut } } as unknown as SupabaseClient;

    await new SupabaseProductionAccess(client).signOutEverywhere();

    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('clears a rendered account immediately when another identity arrives', () => {
    expect(resolveAuthStateTransitionV3('SIGNED_IN', 'account-b', 'account-a')).toBe('replace-account');
    expect(resolveAuthStateTransitionV3('SIGNED_OUT', null, 'account-a')).toBe('signed-out');
    expect(resolveAuthStateTransitionV3('TOKEN_REFRESHED', 'account-a', 'account-a')).toBe('ignore');
  });

  it('uses a project-scoped v3 namespace and rejects browser secret keys', () => {
    expect(supabaseAuthStorageKeyV3('https://project-ref.supabase.co'))
      .toBe('tcg-harbor-v3:project-ref.supabase.co:auth');
    expect(isBrowserSafeSupabaseKeyV3('sb_publishable_example')).toBe(true);
    expect(isBrowserSafeSupabaseKeyV3(legacyJwt('anon'))).toBe(true);
    expect(isBrowserSafeSupabaseKeyV3('sb_secret_example')).toBe(false);
    expect(isBrowserSafeSupabaseKeyV3(legacyJwt('service_role'))).toBe(false);
  });
});
