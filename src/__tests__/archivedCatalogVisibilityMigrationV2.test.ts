import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260721131143_collection_owner_archived_catalog_read_v2.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('archived catalog owner visibility migration', () => {
  it('adds owner-only read paths for archived holdings and their embedded parents', () => {
    expect(migration).toContain('card_variants_collection_owner_archived_read');
    expect(migration).toContain('sealed_products_collection_owner_archived_read');
    expect(migration).toContain('cards_collection_owner_archived_read');
    expect(migration).toContain('card_sets_collection_owner_archived_read');
    expect(migration.match(/for select\s+to authenticated/g)).toHaveLength(4);
    expect(migration).not.toMatch(/to\s+(?:anon|public)/);
    expect(migration).not.toContain('security definer');
  });

  it('requires a current owner holding for every archived catalog access path', () => {
    expect(migration.match(/item\.owner_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/item\.deleted_at is null/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toMatch(/card_variants[\s\S]*?item\.card_variant_id/);
    expect(migration).toMatch(/sealed_products[\s\S]*?item\.sealed_product_id/);
    expect(migration).toMatch(/cards[\s\S]*?variant\.card_id/);
    expect(migration).toMatch(/card_sets[\s\S]*?card\.card_set_id[\s\S]*?product\.card_set_id/);
  });
});
