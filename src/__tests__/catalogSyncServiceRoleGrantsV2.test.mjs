import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../supabase/migrations/20260722153000_catalog_sync_service_role_grants_v2.sql',
  import.meta.url,
);

describe('catalog sync service-role grants v2', () => {
  it('grants exactly the importer table operations and identity sequence access', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    const normalized = migration.replace(/\s+/g, ' ').toLowerCase();

    for (const table of [
      'games',
      'pricing_providers',
      'card_sets',
      'cards',
      'card_variants',
      'sealed_products',
      'provider_catalog_mappings',
      'price_snapshots',
    ]) {
      expect(normalized).toContain(`public.${table}`);
    }
    expect(normalized).toContain('grant select on table public.collection_items to service_role');
    expect(normalized).toContain('grant usage, select on sequence public.price_snapshots_id_seq to service_role');
    expect(normalized).toContain('grant execute on function public.run_collection_daily_valuation_capture(date) to service_role');
    expect(normalized).toContain('from public, anon, authenticated, service_role');
    expect(normalized).not.toContain('auth.jwt()');
    expect(normalized).not.toMatch(/grant\s+delete/);
    expect(normalized).not.toMatch(/grant[^;]*\binsert\b[^;]*\bpublic\.collection_items\b[^;]*to service_role;/);
  });
});
