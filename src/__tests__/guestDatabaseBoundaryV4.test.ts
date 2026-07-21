import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function migration(path: string): string {
  return readFileSync(new URL(`../../supabase/migrations/${path}`, import.meta.url), 'utf8');
}

const initialSchema = migration('202607160001_initial_schema.sql');
const storeApproval = migration('202607200003_store_applications_and_approval.sql');
const qrInvites = migration('20260720180849_physical_store_qr_invites.sql');
const qrRedemptionFix = migration('20260721093251_fix_store_join_redemption_ambiguity.sql');
const guestStorePrivacy = migration('20260721153658_restrict_guest_store_columns_v4.sql');

describe('guest database boundary v4', () => {
  it('keeps catalog rows publicly readable behind RLS', () => {
    expect(initialSchema).toContain('alter table public.games enable row level security;');
    expect(initialSchema).toContain('alter table public.card_sets enable row level security;');
    expect(initialSchema).toContain('alter table public.cards enable row level security;');
    expect(initialSchema).toContain('alter table public.card_variants enable row level security;');
    expect(initialSchema).toContain('alter table public.sealed_products enable row level security;');
    expect(initialSchema).toMatch(/create policy games_public_read[\s\S]*?to anon, authenticated/);
    expect(initialSchema).toMatch(/create policy sealed_products_public_read[\s\S]*?to anon, authenticated/);
    expect(initialSchema).toMatch(/grant select on public\.games, public\.card_sets, public\.cards, public\.card_variants,\s*public\.sealed_products[\s\S]*?to anon;/);
  });

  it('restricts public store discovery rows to approved live stores', () => {
    expect(initialSchema).toContain('alter table public.stores enable row level security;');
    expect(storeApproval).toMatch(
      /create policy stores_public_read on public\.stores for select to anon, authenticated\s+using \(is_verified and is_active and deleted_at is null\);/,
    );
  });

  it('replaces anon table-wide store access with an exact safe column grant', () => {
    expect(guestStorePrivacy).toMatch(/revoke select on table public\.stores from anon;/i);
    const grant = guestStorePrivacy.match(
      /grant select \(([\s\S]*?)\) on table public\.stores to anon;/i,
    );
    expect(grant).not.toBeNull();

    const columns = grant?.[1]
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    expect(columns).toEqual([
      'id',
      'slug',
      'name',
      'description',
      'address_line_1',
      'address_line_2',
      'city',
      'region',
      'postcode',
      'country_code',
      'latitude',
      'longitude',
      'timezone',
      'opening_hours',
      'website_url',
      'image_url',
      'is_verified',
      'is_active',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
    expect(columns).not.toContain('contact_email');
    expect(columns).not.toContain('phone');
  });

  it('keeps QR validation and redemption unavailable to anon callers', () => {
    expect(qrInvites).toMatch(
      /revoke execute on function public\.list_store_qr_invites\(uuid\),[\s\S]*?public\.validate_store_join_code\(text\),[\s\S]*?public\.redeem_store_join_code\(text, text\),[\s\S]*?from public, anon, authenticated;/,
    );
    expect(qrInvites).toMatch(
      /grant execute on function public\.list_store_qr_invites\(uuid\),[\s\S]*?public\.validate_store_join_code\(text\),[\s\S]*?public\.redeem_store_join_code\(text, text\),[\s\S]*?to authenticated;/,
    );
    expect(qrRedemptionFix).toMatch(
      /revoke execute on function public\.redeem_store_join_code\(text, text\)\s+from public, anon, authenticated;/,
    );
    expect(qrRedemptionFix).toMatch(
      /grant execute on function public\.redeem_store_join_code\(text, text\)\s+to authenticated;/,
    );
    expect(qrRedemptionFix).toContain("auth.jwt() ->> 'is_anonymous'");
  });
});
