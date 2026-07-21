import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const initialSchema = readFileSync(
  new URL('../../supabase/migrations/202607160001_initial_schema.sql', import.meta.url),
  'utf8',
);
const authClient = readFileSync(new URL('../services/supabase/client.ts', import.meta.url), 'utf8');
const accessHook = readFileSync(new URL('../production/useProductionAccess.ts', import.meta.url), 'utf8');
const authConfig = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');

describe('account isolation security contract v3', () => {
  it('keeps private account tables behind owner or participant RLS', () => {
    expect(initialSchema).toMatch(/collection_select_owner[\s\S]*?owner_id\s*=\s*\(select auth\.uid\(\)\)/);
    expect(initialSchema).toMatch(/profiles_select_self[\s\S]*?user_id\s*=\s*\(select auth\.uid\(\)\)/);
    expect(initialSchema).toMatch(/direct_conversations_participant_select[\s\S]*?auth\.uid\(\)[\s\S]*?participant_low_id, participant_high_id/);
    expect(initialSchema).toMatch(/direct_messages_participant_select[\s\S]*?is_direct_conversation_participant\(conversation_id, \(select auth\.uid\(\)\)\)/);
  });

  it('wires PKCE, a versioned auth namespace, and synchronous identity replacement', () => {
    expect(authClient).toContain('flowType: "pkce"');
    expect(authClient).toContain('storageKey: supabaseAuthStorageKeyV3(config.url)');
    expect(accessHook).toContain('resolveAuthStateTransitionV3');
    expect(accessHook).toContain('renderedUserIdRef.current = null');
    expect(accessHook).toContain('setSnapshot(null)');
  });

  it('keeps the checked-in Auth baseline strict', () => {
    expect(authConfig).toContain('enable_confirmations = true');
    expect(authConfig).toContain('minimum_password_length = 12');
    expect(authConfig).toContain('password_requirements = "lower_upper_letters_digits_symbols"');
    expect(authConfig).toContain('secure_password_change = true');
    expect(authConfig).toContain('enable_refresh_token_rotation = true');
    expect(authConfig).toContain('jwt_expiry = 3600');
  });
});
