import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('direct messages and community profiles migration', () => {
  it('includes execute permissions on normalize_user_text and security definer on guard trigger', () => {
    const migration = readFileSync(
      new URL('../../supabase/migrations/20261002164000_fix_direct_messages_and_community_profiles.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.normalize_user_text\(text\)\s+to\s+authenticated/i);
    expect(migration).toMatch(/alter\s+function\s+public\.guard_direct_message\(\)\s+security\s+definer/i);
    expect(migration).toMatch(/alter\s+view\s+public\.community_member_profiles\s+set\s+\(\s*security_invoker\s*=\s*false\s*\)/i);
  });
});
