import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260721115011_harden_portfolio_valuation_lot_purchase_v2.sql', import.meta.url),
  'utf8',
);

describe('daily valuation hardening migration', () => {
  it('preserves optional purchase values on each positive acquisition lot', () => {
    expect(migration).toContain('add column if not exists purchase_unit_amount');
    expect(migration).toContain('stage_collection_lot_purchase_context');
    expect(migration).toContain("pg_catalog.current_setting('tcg_harbor.purchase_unit_amount', true)");
  });

  it('uses a transparent Near Mint product-level fallback for non-sealed cards', () => {
    expect(migration).toContain("new.card_variant_id is not null");
    expect(migration).toContain("mapping.condition = 'near_mint'::public.item_condition");
    expect(migration).toContain('(snapshot.condition = lot.condition) desc');
  });

  it('uses only active mappings for current daily values', () => {
    expect(migration).toContain('join public.provider_catalog_mappings mapping on mapping.id = snapshot.mapping_id');
    expect(migration).toContain('(mapping.disabled_at is null or mapping.disabled_at >= v_cutoff)');
  });

  it('calculates partial growth only on copies with both references', () => {
    expect(migration).not.toContain('bool_and(');
    expect(migration).toContain('line.current_market_value is not null');
    expect(migration).toContain('line.acquisition_market_value is not null');
    expect(migration).toContain('matched_unit_count');
  });
});
