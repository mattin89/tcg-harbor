import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260721124718_bind_collection_add_to_expected_owner.sql', import.meta.url),
  'utf8',
);

describe('collection owner binding migration', () => {
  it('rejects an add when the browser owner no longer matches auth.uid()', () => {
    expect(migration).toContain('p_expected_owner_id uuid');
    expect(migration).toContain('private.require_active_collection_owner()');
    expect(migration).toContain('p_expected_owner_id is distinct from v_uid');
    expect(migration).toContain("using errcode = '42501'");
    expect(migration.indexOf('p_expected_owner_id is distinct from v_uid')).toBeLessThan(
      migration.indexOf('return public.add_or_merge_collection_item('),
    );
  });

  it('keeps the security-definer wrapper locked to authenticated callers', () => {
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
    expect(migration).toMatch(/revoke execute on function public\.add_or_merge_collection_item\([\s\S]*?from public, anon, authenticated;/);
  });
});
