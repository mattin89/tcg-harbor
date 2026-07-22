import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES_V5,
  DEMO_NOTIFICATION_SETTINGS_KEY_V5,
  DEMO_PROFILE_SETTINGS_KEY_V5,
  readDemoNotificationPreferencesV5,
  readDemoProfileSettingsV5,
} from '../domain/accountSettingsV5';
import { SupabaseProductionAccess } from '../production/supabaseProductionAccess';

const settings = readFileSync(new URL('../components/SettingsPageV5.tsx', import.meta.url), 'utf8');
const access = readFileSync(new URL('../production/supabaseProductionAccess.ts', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../ProductionApp_v2.tsx', import.meta.url), 'utf8');
const notificationMigration = readFileSync(
  new URL('../../supabase/migrations/20260723001500_enforce_notification_preferences_v5.sql', import.meta.url),
  'utf8',
);

describe('account settings v5 wiring', () => {
  it('exposes four accessible settings tabs with real panels', () => {
    expect(settings).toContain('role="tablist"');
    expect(settings.match(/role="tabpanel"/g)).toHaveLength(4);
    expect(settings).toContain("setTab(item.id)");
    for (const panel of ['profile', 'notifications', 'privacy', 'security']) {
      expect(settings).toContain(`settings-panel-${panel}`);
    }
  });

  it('does not discard unsaved drafts when unrelated realtime account state rerenders', () => {
    expect(settings).not.toContain('}, [identity?.profileSettings]);');
    expect(settings).not.toContain('}, [identity?.notificationPreferences]);');
    expect(settings).toContain('identity?.profileSettings?.username');
    expect(settings).toContain('identity?.notificationPreferences?.directMessages');
  });

  it('persists owner-scoped profile and notification preferences and verifies an updated row', () => {
    expect(access).toContain('.from("user_profiles")');
    expect(access).toContain('.from("notification_preferences")');
    expect(access.match(/\.eq\("user_id", userId\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(access.match(/\.select\("user_id"\)/g)).toHaveLength(2);
    expect(bridge).toContain('onUpdateProfileSettings: identity.updateProfileSettings');
    expect(bridge).toContain('onUpdateNotificationPreferences: identity.updateNotificationPreferences');
  });

  it('verifies the current password before attempting an authenticated password change', () => {
    expect(access).toContain('current_password: currentPassword');
    expect(access).toContain('signInWithPassword');
    expect(settings).toContain('autoComplete="current-password"');
    expect(bridge).toContain('onChangePassword: identity.changePassword');
  });

  it('restores complete local-preview settings and rejects malformed storage', () => {
    const values = new Map<string, string>([
      [DEMO_PROFILE_SETTINGS_KEY_V5, JSON.stringify({
        username: 'mario',
        primaryMarket: 'tcgplayer',
        preferredCurrency: 'USD',
        approximateCity: 'Dresden',
        approximatePostcode: '01067',
      })],
      [DEMO_NOTIFICATION_SETTINGS_KEY_V5, JSON.stringify({
        directMessages: false,
        communityReplies: true,
        matchingTrades: false,
        tradeUpdates: true,
        emailEnabled: false,
      })],
    ]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    const fallback = {
      username: 'player',
      primaryMarket: 'cardmarket' as const,
      preferredCurrency: 'EUR' as const,
      approximateCity: '',
      approximatePostcode: '',
    };

    expect(readDemoProfileSettingsV5(storage, fallback)).toMatchObject({
      username: 'mario',
      primaryMarket: 'tcgplayer',
      approximateCity: 'Dresden',
    });
    expect(readDemoNotificationPreferencesV5(storage)).toMatchObject({
      directMessages: false,
      matchingTrades: false,
    });

    values.set(DEMO_PROFILE_SETTINGS_KEY_V5, '{bad json');
    values.set(DEMO_NOTIFICATION_SETTINGS_KEY_V5, JSON.stringify({ directMessages: 'yes' }));
    expect(readDemoProfileSettingsV5(storage, fallback)).toBe(fallback);
    expect(readDemoNotificationPreferencesV5(storage)).toBe(DEFAULT_NOTIFICATION_PREFERENCES_V5);
  });

  it('rejects a silent zero-row preference update', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned' },
    });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const client = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient;

    await expect(new SupabaseProductionAccess(client).updateNotificationPreferences(
      'owner-a',
      DEFAULT_NOTIFICATION_PREFERENCES_V5,
    )).rejects.toThrow(/no.*rows returned/i);
    expect(eq).toHaveBeenCalledWith('user_id', 'owner-a');
  });

  it('never updates the password when current-password verification fails', async () => {
    const updateUser = vi.fn();
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'owner-a', email: 'owner@example.test' } },
          error: null,
        }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        }),
        updateUser,
      },
    } as unknown as SupabaseClient;

    await expect(new SupabaseProductionAccess(client).changePassword(
      'wrong-current-password',
      'New-strong-password-42!',
    )).rejects.toThrow(/invalid login credentials/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('enforces notification choices at the database insertion boundary', () => {
    expect(notificationMigration).toContain('before insert on public.notifications');
    expect(notificationMigration).toMatch(/'direct_message'.*preferences\.direct_messages/s);
    expect(notificationMigration).toMatch(/'community_reply'.*preferences\.community_replies/s);
    expect(notificationMigration).toMatch(/'matching_trade'.*preferences\.matching_trades/s);
    expect(notificationMigration).toMatch(/'trade_status_changed'.*preferences\.trade_updates/s);
    expect(notificationMigration).toContain("p_kind in ('system', 'community_joined') then true");
  });
});
