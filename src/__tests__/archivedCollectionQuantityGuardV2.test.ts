import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260722153225_block_archived_collection_quantity_increase_v2.sql',
    import.meta.url,
  ),
  'utf8',
);
const repository = readFileSync(
  new URL('../services/supabase/collectionRepositoryV2.ts', import.meta.url),
  'utf8',
);
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

describe('archived collection quantity guard', () => {
  it('checks every card catalog ancestor only for positive quantity deltas', () => {
    const positiveDelta = migration.indexOf('if p_quantity > v_item.quantity then');
    const rejection = migration.indexOf('Archived catalog holdings cannot be increased');
    const quantityUpdate = migration.indexOf('update public.collection_items');

    expect(positiveDelta).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(positiveDelta);
    expect(quantityUpdate).toBeGreaterThan(rejection);
    expect(migration).toContain('variant.archived_at is null');
    expect(migration).toContain('card.archived_at is null');
    expect(migration).toContain('card_set.archived_at is null');
    expect(migration).toContain('game.is_active');
    expect(migration).toContain('game.archived_at is null');
    expect(migration).toContain('for share of variant, card, card_set, game');
  });

  it('checks sealed products and their optional set before an increase', () => {
    expect(migration).toContain('product.archived_at is null');
    expect(migration).toContain('for share of product, game');
    expect(migration).toContain('if v_catalog_active and v_card_set_id is not null then');
    expect(migration).toContain('for share of card_set');
  });

  it('keeps the RPC owner-scoped and callable only by authenticated users', () => {
    expect(migration).toContain('private.require_active_collection_owner()');
    expect(migration).toContain('and item.owner_id = v_uid');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to authenticated');
  });

  it('marks archived holdings and disables only the increase control', () => {
    expect(repository).toContain('catalogArchived: holdingCatalogIsArchived(item)');
    expect(repository).toContain('(product.card_set !== null && product.card_set.archived_at !== null)');
    expect(app).toContain("selected.catalogArchived ? 'Archived item · decrease or remove only'");
    expect(app).toContain('disabled={productionCollection?.mutating || selected.catalogArchived}');
    expect(app).toContain('aria-label="Decrease quantity">−</Button>');
  });
});
