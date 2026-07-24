import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724110922_open_dresden_community_trading_v6.sql',
  import.meta.url,
)), 'utf8');

describe('open Dresden community migration v6', () => {
  it('seeds the approved Frauenkirche test location and an open community', () => {
    expect(migration).toContain("'Test Dresden Community'");
    expect(migration).toContain("'An der Frauenkirche'");
    expect(migration).toContain("'01067'");
    expect(migration).toContain('51.05195');
    expect(migration).toContain('13.74161');
    expect(migration).toContain("'open'");
    expect(migration).toContain("'5b46755e-4d45-4f8e-a5aa-d9b2ec8cd602'");
  });

  it('keeps open joining authenticated, suspension-aware, and account-scoped', () => {
    expect(migration).toMatch(/create or replace function public\.join_open_community_v6/);
    expect(migration).toContain('security definer');
    expect(migration).toContain("app_user.status = 'active'");
    expect(migration).toContain("v_existing_status = 'suspended'");
    expect(migration).toContain("raise exception 'This membership is suspended'");
    expect(migration).toContain("jsonb_build_object('join_method', 'open')");
    expect(migration).toMatch(/grant execute on function public\.join_open_community_v6\(uuid\)\s+to authenticated/);
  });

  it('models both post directions and all four exchange modes with exact EUR cents', () => {
    expect(migration).toContain("post_kind in ('offering_card', 'seeking_card')");
    expect(migration).toContain("exchange_mode in ('money', 'any_card', 'specific_card', 'open')");
    expect(migration).toContain('cash_amount_cents integer');
    expect(migration).toContain("cash_currency = 'EUR'");
    expect(migration).toContain("'An asking amount is required; use zero for a giveaway'");
  });

  it('creates posts atomically and verifies every offered card against the author collection', () => {
    expect(migration).toMatch(/create or replace function public\.create_community_trade_post_v6/);
    expect(migration).toContain('collection_item.owner_id = v_uid');
    expect(migration).toContain('collection_item.card_variant_id is not null');
    expect(migration).toContain('p_quantity > v_owned.quantity');
    expect(migration).toContain("v_owned.language = 'DE'");
    expect(migration).toContain("'trade_post_created'");
  });

  it('removes direct multi-table mutation and grants only narrow authenticated RPCs', () => {
    expect(migration).toContain('revoke insert, update, delete on table public.trade_posts from authenticated');
    expect(migration).toContain('revoke insert, update, delete on table public.trade_post_offered_items from authenticated');
    expect(migration).toContain('revoke insert, update, delete on table public.trade_post_wanted_items from authenticated');
    expect(migration).toMatch(/set search_path = ''/);
    expect(migration).toMatch(/grant execute on function public\.create_community_trade_post_v6\(/);
    expect(migration).toMatch(/grant execute on function public\.set_community_trade_post_status_v6\(/);
  });
});
