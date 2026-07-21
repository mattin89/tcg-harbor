import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/202607200003_store_applications_and_approval.sql', import.meta.url),
  'utf8',
);

const triggerBody = migration.match(
  /create or replace function public\.handle_new_auth_user\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
)?.[1] ?? '';

describe('new account database bootstrap', () => {
  it('creates identity records without seeding account-owned content', () => {
    expect(triggerBody).not.toBe('');
    expect(triggerBody).toMatch(/insert into public\.app_users/i);
    expect(triggerBody).toMatch(/insert into public\.user_profiles/i);
    expect(triggerBody).toMatch(/insert into public\.notification_preferences/i);

    for (const accountOwnedTable of [
      'collection_items',
      'collection_acquisition_lots',
      'collection_daily_valuation_snapshots',
      'community_memberships',
      'community_messages',
      'direct_conversations',
      'direct_messages',
      'notifications',
      'trade_posts',
    ]) {
      expect(triggerBody).not.toMatch(new RegExp(`insert into public\\.${accountOwnedTable}\\b`, 'i'));
    }
  });
});
