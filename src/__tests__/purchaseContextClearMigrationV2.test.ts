import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260721153100_clear_collection_lot_purchase_context_v2.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('collection lot purchase-context clearing migration', () => {
  it('is a forward replacement that consumes both transaction-local values once', () => {
    expect(migration).toContain('create or replace function public.capture_collection_acquisition_lot()');
    expect(migration).toContain("pg_catalog.current_setting('tcg_harbor.purchase_unit_amount', true)");
    expect(migration).toContain("pg_catalog.current_setting('tcg_harbor.purchase_currency', true)");

    const amountRead = migration.indexOf("pg_catalog.current_setting('tcg_harbor.purchase_unit_amount', true)");
    const amountClear = migration.indexOf("pg_catalog.set_config('tcg_harbor.purchase_unit_amount', '', true)", amountRead);
    const currencyRead = migration.indexOf("pg_catalog.current_setting('tcg_harbor.purchase_currency', true)");
    const currencyClear = migration.indexOf("pg_catalog.set_config('tcg_harbor.purchase_currency', '', true)", currencyRead);
    const lotInsert = migration.indexOf('insert into public.collection_acquisition_lots');

    expect(amountClear).toBeGreaterThan(amountRead);
    expect(currencyClear).toBeGreaterThan(currencyRead);
    expect(amountClear).toBeLessThan(lotInsert);
    expect(currencyClear).toBeLessThan(lotInsert);
  });

  it('also clears staged context before every non-positive early return', () => {
    const earlyReturnBlock = migration.match(/if v_added_quantity <= 0 then([\s\S]*?)return new;/)?.[1] ?? '';
    expect(earlyReturnBlock).toContain("set_config('tcg_harbor.purchase_unit_amount', '', true)");
    expect(earlyReturnBlock).toContain("set_config('tcg_harbor.purchase_currency', '', true)");
  });

  it('clears context after an insert statement even when ON CONFLICT does nothing', () => {
    expect(migration).toContain('create or replace function private.clear_collection_lot_purchase_context()');
    expect(migration).toMatch(/create trigger collection_lot_purchase_context_statement_clear[\s\S]*?after insert on public\.collection_items[\s\S]*?for each statement/);
    expect(migration).toMatch(/revoke execute on function private\.clear_collection_lot_purchase_context\(\)[\s\S]*?from public, anon, authenticated;/);
  });

  it('keeps the trigger function unavailable to browser roles', () => {
    expect(migration).toMatch(/revoke execute on function public\.capture_collection_acquisition_lot\(\)[\s\S]*?from public, anon, authenticated;/);
  });
});
