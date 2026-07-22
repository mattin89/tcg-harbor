import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../supabase/migrations/20260722153049_atomic_catalog_publish_and_mapping_history_v3.sql',
  import.meta.url,
);
const syncScriptUrl = new URL('../../scripts/sync-onepiece-data-v10.mjs', import.meta.url);

function normalized(value) {
  return value.replace(/\s+/g, ' ').toLowerCase();
}

describe('atomic catalog publish and provider mapping history v3', () => {
  it('keeps batched payloads private and exposes only service-role RPC boundaries', async () => {
    const migration = normalized(await readFile(migrationUrl, 'utf8'));

    expect(migration).toContain('create table private.catalog_sync_runs_v3');
    expect(migration).toContain('create table private.catalog_sync_stage_v3');
    expect(migration).toContain('revoke all on table private.catalog_sync_runs_v3 from public, anon, authenticated, service_role');
    expect(migration).toContain('revoke all on table private.catalog_sync_stage_v3 from public, anon, authenticated, service_role');
    for (const fn of [
      'begin_catalog_sync_v3',
      'stage_catalog_sync_rows_v3',
      'finalize_catalog_sync_v3',
      'abort_catalog_sync_v3',
    ]) {
      expect(migration).toContain(`grant execute on function public.${fn}`);
    }
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('grant execute on function public.finalize_catalog_sync_v3(uuid) to anon');
    expect(migration).not.toContain('grant execute on function public.finalize_catalog_sync_v3(uuid) to authenticated');
  });

  it('publishes every catalog relation, prices, valuation capture, and provider marker in one RPC transaction', async () => {
    const migration = normalized(await readFile(migrationUrl, 'utf8'));
    const finalizer = migration.match(
      /create or replace function public\.finalize_catalog_sync_v3[\s\S]+?create or replace function public\.abort_catalog_sync_v3/,
    )?.[0] ?? '';

    expect(finalizer).toContain('pg_try_advisory_xact_lock');
    expect(finalizer).toContain('count mismatch');
    for (const relation of [
      'public.card_sets',
      'public.cards',
      'public.card_variants',
      'public.sealed_products',
      'public.provider_catalog_mappings',
      'public.price_snapshots',
    ]) {
      expect(finalizer).toContain(relation);
    }
    expect(finalizer).toContain('private.capture_collection_daily_valuations_after_prices');
    expect(finalizer).toContain('last_sync_at = v_run.snapshot_generated_at');
    expect(finalizer).toContain("status = 'published'");
    expect(finalizer).toContain('delete from private.catalog_sync_stage_v3');
  });

  it('makes mapping identity immutable and records an append-only supersession chain', async () => {
    const migration = normalized(await readFile(migrationUrl, 'utf8'));

    expect(migration).toContain('add column supersedes_mapping_id uuid');
    expect(migration).toContain('add column mapping_version integer not null default 1');
    expect(migration).toContain('provider mapping identity is immutable; disable it and insert a new mapping version');
    expect(migration).toContain('existing_mapping.provider_product_id is distinct from staged_mapping.provider_product_id');
    expect(migration).toContain('set disabled_at = v_publish_at');
    expect(migration).toContain('existing_mapping.id <> new_mapping.id');
  });

  it('stages bounded batches and never writes public catalog tables before finalization', async () => {
    const script = await readFile(syncScriptUrl, 'utf8');

    expect(script).toContain(".rpc('begin_catalog_sync_v3'");
    expect(script).toContain(".rpc('stage_catalog_sync_rows_v3'");
    expect(script).toContain(".rpc('finalize_catalog_sync_v3'");
    expect(script).toContain(".rpc('abort_catalog_sync_v3'");
    expect(script).toContain("'append-only-provider-identity-v3'");
    expect(script).toContain('providerMappingVersionSeed(');
    expect(script).toContain('existing.provider_product_id === providerProductId');
    expect(script).not.toMatch(
      /upsertSupabaseRows\(supabase,\s*'(?:card_sets|cards|card_variants|sealed_products|provider_catalog_mappings|price_snapshots)'/,
    );
    expect(script).not.toContain(".rpc('run_collection_daily_valuation_capture'");
  });

  it('removes direct catalog mutation privileges from the service role', async () => {
    const migration = normalized(await readFile(migrationUrl, 'utf8'));
    const revoke = migration.match(
      /revoke insert, update on table[\s\S]+?from service_role;/,
    )?.[0] ?? '';

    for (const relation of [
      'public.card_sets',
      'public.cards',
      'public.card_variants',
      'public.sealed_products',
      'public.provider_catalog_mappings',
      'public.price_snapshots',
    ]) {
      expect(revoke).toContain(relation);
    }
    expect(migration).toContain('revoke usage, select on sequence public.price_snapshots_id_seq from service_role');
  });
});
