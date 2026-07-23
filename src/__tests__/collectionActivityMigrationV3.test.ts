import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260723142058_collection_activity_logs_v3.sql',
    import.meta.url,
  ),
  'utf8',
);
const normalized = migration.replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

describe('collection activity migration v3', () => {
  it('keeps the activity feed owner-readable and server-write-only', () => {
    expect(normalized).toContain('alter table public.activity_logs enable row level security');
    expect(normalized).toContain(
      'create policy activity_logs_owner_select on public.activity_logs for select to authenticated',
    );
    expect(normalized).toContain(
      'user_id = (select auth.uid())',
    );
    expect(normalized).toContain(
      'revoke all on public.activity_logs from public, anon, authenticated',
    );
    expect(normalized).toContain('grant select on public.activity_logs to authenticated');
    expect(normalized).not.toMatch(
      /grant[^;]*\binsert\b[^;]*activity_logs[^;]*authenticated/,
    );
  });

  it('emits one add activity for every immutable acquisition lot', () => {
    expect(normalized).toContain(
      'create trigger collection_acquisition_activity_capture_v3 after insert on public.collection_acquisition_lots',
    );
    expect(normalized).toContain("'collection_item_added'");
    expect(normalized).toContain("'collection_acquisition_lot_id', new.id::text");
    expect(normalized).toContain("'added_quantity', new.added_quantity");
    expect(normalized).toContain("'quantity_after', new.quantity_after");
  });

  it('is idempotent when triggers or the historical backfill are rerun', () => {
    expect(normalized).toContain(
      'create unique index if not exists activity_logs_collection_acquisition_lot_v3_unique',
    );
    expect(normalized).toContain(
      'drop trigger if exists collection_acquisition_activity_capture_v3',
    );
    expect(normalized).toContain(
      'drop trigger if exists collection_activity_change_capture_v3',
    );
    expect(normalized).toContain('from public.collection_acquisition_lots lot');
    expect(normalized).toContain(
      "where not exists ( select 1 from public.activity_logs activity where activity.activity_type = 'collection_item_added'",
    );
    expect(normalized.match(/on conflict do nothing/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('captures decreases and removals without duplicating positive additions', () => {
    expect(normalized).toContain("'collection_item_removed'");
    expect(normalized).toContain("'collection_quantity_decreased'");
    expect(normalized).toContain('and new.quantity < old.quantity');
    expect(normalized).toContain(
      'after update of quantity, deleted_at on public.collection_items',
    );
  });

  it('keeps every trigger helper private and non-callable by browser roles', () => {
    expect(normalized).toContain(
      'create or replace function private.capture_collection_acquisition_activity_v3()',
    );
    expect(normalized).toContain(
      'create or replace function private.capture_collection_item_change_activity_v3()',
    );
    expect(normalized).toContain(
      'revoke all on function private.capture_collection_acquisition_activity_v3() from public, anon, authenticated',
    );
    expect(normalized).toContain(
      'revoke all on function private.capture_collection_item_change_activity_v3() from public, anon, authenticated',
    );
  });
});
