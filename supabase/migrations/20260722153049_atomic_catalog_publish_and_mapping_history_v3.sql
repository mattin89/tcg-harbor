-- TCG Harbor catalog ingestion v3
--
-- PostgREST commits each request independently. The importer therefore stages
-- bounded batches in private tables and publishes them through one RPC/one
-- PostgreSQL transaction. Public readers see the complete old generation until
-- this function commits, then the complete new generation.
--
-- Provider mappings are append-versioned. Identity-bearing columns may never
-- be changed in place because historical price rows reference the mapping ID.

begin;

alter table public.provider_catalog_mappings
  add column supersedes_mapping_id uuid
    references public.provider_catalog_mappings(id) on delete restrict,
  add column mapping_version integer not null default 1;

alter table public.provider_catalog_mappings
  add constraint provider_mappings_version_positive_v3
    check (mapping_version >= 1),
  add constraint provider_mappings_no_self_supersession_v3
    check (supersedes_mapping_id is null or supersedes_mapping_id <> id);

create index provider_mappings_supersedes_idx_v3
  on public.provider_catalog_mappings (supersedes_mapping_id)
  where supersedes_mapping_id is not null;

create or replace function public.prevent_provider_mapping_identity_mutation_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.provider_id is distinct from old.provider_id
     or new.card_variant_id is distinct from old.card_variant_id
     or new.sealed_product_id is distinct from old.sealed_product_id
     or new.provider_product_id is distinct from old.provider_product_id
     or new.provider_listing_id is distinct from old.provider_listing_id
     or new.condition is distinct from old.condition
     or new.language is distinct from old.language
     or new.variant_key is distinct from old.variant_key
     or new.supersedes_mapping_id is distinct from old.supersedes_mapping_id
     or new.mapping_version is distinct from old.mapping_version then
    raise exception using
      errcode = '23514',
      message = 'Provider mapping identity is immutable; disable it and insert a new mapping version.';
  end if;
  return new;
end;
$$;

create trigger provider_mapping_identity_immutable_v3
  before update of
    provider_id,
    card_variant_id,
    sealed_product_id,
    provider_product_id,
    provider_listing_id,
    condition,
    language,
    variant_key,
    supersedes_mapping_id,
    mapping_version
  on public.provider_catalog_mappings
  for each row execute function public.prevent_provider_mapping_identity_mutation_v3();

revoke execute on function public.prevent_provider_mapping_identity_mutation_v3()
  from public, anon, authenticated, service_role;

create table private.catalog_sync_runs_v3 (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete restrict,
  snapshot_generated_at timestamptz not null,
  provider_ids uuid[] not null,
  provider_lock_until timestamptz not null,
  expected_counts jsonb not null,
  status text not null default 'staging',
  started_at timestamptz not null default now(),
  published_at timestamptz,
  failed_at timestamptz,
  failure_message text,
  result jsonb,
  constraint catalog_sync_runs_provider_count_v3
    check (cardinality(provider_ids) = 2),
  constraint catalog_sync_runs_expected_counts_object_v3
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint catalog_sync_runs_status_v3
    check (status in ('staging', 'published', 'failed')),
  constraint catalog_sync_runs_terminal_state_v3 check (
    (status = 'staging' and published_at is null and failed_at is null)
    or (status = 'published' and published_at is not null and failed_at is null)
    or (status = 'failed' and published_at is null and failed_at is not null)
  )
);

create table private.catalog_sync_stage_v3 (
  run_id uuid not null references private.catalog_sync_runs_v3(id) on delete cascade,
  entity_type text not null,
  row_key text not null,
  payload jsonb not null,
  staged_at timestamptz not null default now(),
  primary key (run_id, entity_type, row_key),
  constraint catalog_sync_stage_entity_v3 check (entity_type in (
    'card_sets',
    'cards',
    'card_variants',
    'sealed_products',
    'provider_catalog_mappings',
    'price_snapshots',
    'retire_provider_catalog_mappings',
    'retire_card_variants',
    'retire_sealed_products',
    'retire_cards',
    'retire_card_sets'
  )),
  constraint catalog_sync_stage_row_key_v3
    check (length(btrim(row_key)) between 1 and 240),
  constraint catalog_sync_stage_payload_object_v3
    check (jsonb_typeof(payload) = 'object')
);

create index catalog_sync_stage_entity_idx_v3
  on private.catalog_sync_stage_v3 (run_id, entity_type, row_key);

alter table private.catalog_sync_runs_v3 enable row level security;
alter table private.catalog_sync_stage_v3 enable row level security;

revoke all on table private.catalog_sync_runs_v3 from public, anon, authenticated, service_role;
revoke all on table private.catalog_sync_stage_v3 from public, anon, authenticated, service_role;

create or replace function public.begin_catalog_sync_v3(
  p_run_id uuid,
  p_game_id uuid,
  p_snapshot_generated_at timestamptz,
  p_provider_ids uuid[],
  p_provider_lock_until timestamptz,
  p_expected_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_entities text[] := array[
    'card_sets',
    'cards',
    'card_variants',
    'sealed_products',
    'provider_catalog_mappings',
    'price_snapshots',
    'retire_provider_catalog_mappings',
    'retire_card_variants',
    'retire_sealed_products',
    'retire_cards',
    'retire_card_sets'
  ];
  v_provider_count integer;
begin
  if p_run_id is null
     or p_game_id is null
     or p_snapshot_generated_at is null
     or p_provider_lock_until is null
     or cardinality(p_provider_ids) <> 2
     or (select count(distinct provider_id) from unnest(p_provider_ids) provider_id) <> 2 then
    raise exception 'Invalid catalog sync run identity or provider lock';
  end if;

  if jsonb_typeof(p_expected_counts) <> 'object'
     or (select count(*) from jsonb_object_keys(p_expected_counts)) <> cardinality(v_entities) then
    raise exception 'Catalog sync expected_counts must contain the exact v3 entity set';
  end if;

  foreach v_entity in array v_entities loop
    if coalesce(p_expected_counts ->> v_entity, '') !~ '^\d+$' then
      raise exception 'Catalog sync expected count for % is missing or invalid', v_entity;
    end if;
  end loop;

  select count(*)::integer
  into v_provider_count
  from public.pricing_providers provider
  where provider.id = any(p_provider_ids)
    and provider.sync_lock_until = p_provider_lock_until
    and provider.sync_lock_until > now();

  if v_provider_count <> cardinality(p_provider_ids) then
    raise exception 'Catalog sync provider lock is not owned by this run';
  end if;

  insert into private.catalog_sync_runs_v3 (
    id,
    game_id,
    snapshot_generated_at,
    provider_ids,
    provider_lock_until,
    expected_counts
  ) values (
    p_run_id,
    p_game_id,
    p_snapshot_generated_at,
    p_provider_ids,
    p_provider_lock_until,
    p_expected_counts
  );
end;
$$;

create or replace function public.stage_catalog_sync_rows_v3(
  p_run_id uuid,
  p_entity_type text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row_count integer;
  v_run private.catalog_sync_runs_v3%rowtype;
begin
  if p_entity_type not in (
    'card_sets',
    'cards',
    'card_variants',
    'sealed_products',
    'provider_catalog_mappings',
    'price_snapshots',
    'retire_provider_catalog_mappings',
    'retire_card_variants',
    'retire_sealed_products',
    'retire_cards',
    'retire_card_sets'
  ) then
    raise exception 'Unsupported catalog sync entity type';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception 'Catalog sync stage batches must be JSON arrays of at most 250 rows';
  end if;

  select * into v_run
  from private.catalog_sync_runs_v3 run
  where run.id = p_run_id
  for update;

  if not found or v_run.status <> 'staging' then
    raise exception 'Catalog sync run is unavailable for staging';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_payload
    where jsonb_typeof(row_payload) <> 'object'
       or length(btrim(coalesce(row_payload ->> '_stage_key', ''))) not between 1 and 240
  ) then
    raise exception 'Every staged catalog row requires a nonempty _stage_key';
  end if;

  insert into private.catalog_sync_stage_v3 (run_id, entity_type, row_key, payload)
  select
    p_run_id,
    p_entity_type,
    row_payload ->> '_stage_key',
    row_payload - '_stage_key'
  from jsonb_array_elements(p_rows) row_payload
  on conflict (run_id, entity_type, row_key)
  do update set payload = excluded.payload, staged_at = now();

  get diagnostics v_row_count = row_count;
  return v_row_count;
end;
$$;

create or replace function public.finalize_catalog_sync_v3(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10min'
as $$
declare
  v_run private.catalog_sync_runs_v3%rowtype;
  v_entity text;
  v_entities text[] := array[
    'card_sets',
    'cards',
    'card_variants',
    'sealed_products',
    'provider_catalog_mappings',
    'price_snapshots',
    'retire_provider_catalog_mappings',
    'retire_card_variants',
    'retire_sealed_products',
    'retire_cards',
    'retire_card_sets'
  ];
  v_expected integer;
  v_actual integer;
  v_provider_count integer;
  v_valuation_count integer;
  v_publish_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('tcg-harbor:one-piece-catalog-publish-v3')) then
    raise exception 'Another catalog generation is being published';
  end if;

  select * into v_run
  from private.catalog_sync_runs_v3 run
  where run.id = p_run_id
  for update;

  if not found or v_run.status <> 'staging' then
    raise exception 'Catalog sync run is unavailable for publish';
  end if;

  perform provider.id
  from public.pricing_providers provider
  where provider.id = any(v_run.provider_ids)
  order by provider.id
  for update;

  select count(*)::integer
  into v_provider_count
  from public.pricing_providers provider
  where provider.id = any(v_run.provider_ids)
    and provider.sync_lock_until = v_run.provider_lock_until
    and provider.sync_lock_until > now();

  if v_provider_count <> cardinality(v_run.provider_ids) then
    raise exception 'Catalog sync provider lock expired or changed before publish';
  end if;

  if exists (
    select 1
    from public.pricing_providers provider
    where provider.id = any(v_run.provider_ids)
      and provider.last_sync_at > v_run.snapshot_generated_at
  ) then
    raise exception 'A newer provider generation is already published';
  end if;

  foreach v_entity in array v_entities loop
    v_expected := (v_run.expected_counts ->> v_entity)::integer;
    select count(*)::integer into v_actual
    from private.catalog_sync_stage_v3 stage
    where stage.run_id = p_run_id and stage.entity_type = v_entity;
    if v_actual <> v_expected then
      raise exception 'Catalog sync % count mismatch: expected %, staged %',
        v_entity, v_expected, v_actual;
    end if;
  end loop;

  insert into public.card_sets (
    id, game_id, code, name, release_date, image_url, external_identifiers, archived_at
  )
  select
    row_data.id,
    row_data.game_id,
    row_data.code,
    row_data.name,
    row_data.release_date,
    row_data.image_url,
    row_data.external_identifiers,
    row_data.archived_at
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(null::public.card_sets, stage.payload) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'card_sets'
  order by stage.row_key
  on conflict (id) do update set
    game_id = excluded.game_id,
    code = excluded.code,
    name = excluded.name,
    release_date = excluded.release_date,
    image_url = excluded.image_url,
    external_identifiers = excluded.external_identifiers,
    archived_at = excluded.archived_at;

  insert into public.cards (
    id, game_id, card_set_id, card_number, name, rarity, card_type, colors,
    image_url, release_date, external_identifiers, archived_at
  )
  select
    row_data.id,
    row_data.game_id,
    row_data.card_set_id,
    row_data.card_number,
    row_data.name,
    row_data.rarity,
    row_data.card_type,
    row_data.colors,
    row_data.image_url,
    row_data.release_date,
    row_data.external_identifiers,
    row_data.archived_at
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(null::public.cards, stage.payload) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'cards'
  order by stage.row_key
  on conflict (id) do update set
    game_id = excluded.game_id,
    card_set_id = excluded.card_set_id,
    card_number = excluded.card_number,
    name = excluded.name,
    rarity = excluded.rarity,
    card_type = excluded.card_type,
    colors = excluded.colors,
    image_url = excluded.image_url,
    release_date = excluded.release_date,
    external_identifiers = excluded.external_identifiers,
    archived_at = excluded.archived_at;

  insert into public.card_variants (
    id, card_id, variant_identifier, variant_name, language, image_url,
    external_identifiers, archived_at
  )
  select
    row_data.id,
    row_data.card_id,
    row_data.variant_identifier,
    row_data.variant_name,
    row_data.language,
    row_data.image_url,
    row_data.external_identifiers,
    row_data.archived_at
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(null::public.card_variants, stage.payload) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'card_variants'
  order by stage.row_key
  on conflict (id) do update set
    card_id = excluded.card_id,
    variant_identifier = excluded.variant_identifier,
    variant_name = excluded.variant_name,
    language = excluded.language,
    image_url = excluded.image_url,
    external_identifiers = excluded.external_identifiers,
    archived_at = excluded.archived_at;

  insert into public.sealed_products (
    id, game_id, card_set_id, name, product_type, language, region, image_url,
    release_date, external_identifiers, archived_at
  )
  select
    row_data.id,
    row_data.game_id,
    row_data.card_set_id,
    row_data.name,
    row_data.product_type,
    row_data.language,
    row_data.region,
    row_data.image_url,
    row_data.release_date,
    row_data.external_identifiers,
    row_data.archived_at
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(null::public.sealed_products, stage.payload) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'sealed_products'
  order by stage.row_key
  on conflict (id) do update set
    game_id = excluded.game_id,
    card_set_id = excluded.card_set_id,
    name = excluded.name,
    product_type = excluded.product_type,
    language = excluded.language,
    region = excluded.region,
    image_url = excluded.image_url,
    release_date = excluded.release_date,
    external_identifiers = excluded.external_identifiers,
    archived_at = excluded.archived_at;

  if exists (
    select 1
    from private.catalog_sync_stage_v3 stage
    cross join lateral jsonb_populate_record(
      null::public.provider_catalog_mappings,
      stage.payload
    ) staged_mapping
    join public.provider_catalog_mappings existing_mapping
      on existing_mapping.id = staged_mapping.id
    where stage.run_id = p_run_id
      and stage.entity_type = 'provider_catalog_mappings'
      and (
        existing_mapping.provider_id is distinct from staged_mapping.provider_id
        or existing_mapping.card_variant_id is distinct from staged_mapping.card_variant_id
        or existing_mapping.sealed_product_id is distinct from staged_mapping.sealed_product_id
        or existing_mapping.provider_product_id is distinct from staged_mapping.provider_product_id
        or existing_mapping.provider_listing_id is distinct from staged_mapping.provider_listing_id
        or existing_mapping.condition is distinct from staged_mapping.condition
        or existing_mapping.language is distinct from staged_mapping.language
        or existing_mapping.variant_key is distinct from staged_mapping.variant_key
        or existing_mapping.supersedes_mapping_id is distinct from staged_mapping.supersedes_mapping_id
        or existing_mapping.mapping_version is distinct from staged_mapping.mapping_version
      )
  ) then
    raise exception 'Catalog sync attempted to relabel an existing provider mapping ID';
  end if;

  -- Disable the previous active identity before inserting its successor. Both
  -- actions are in this transaction, so no reader observes an unpriced gap.
  update public.provider_catalog_mappings existing_mapping
  set disabled_at = v_publish_at
  from (
    select staged_mapping.*
    from private.catalog_sync_stage_v3 stage
    cross join lateral jsonb_populate_record(
      null::public.provider_catalog_mappings,
      stage.payload
    ) staged_mapping
    where stage.run_id = p_run_id
      and stage.entity_type = 'provider_catalog_mappings'
  ) new_mapping
  where existing_mapping.disabled_at is null
    and existing_mapping.id <> new_mapping.id
    and existing_mapping.provider_id = new_mapping.provider_id
    and existing_mapping.card_variant_id is not distinct from new_mapping.card_variant_id
    and existing_mapping.sealed_product_id is not distinct from new_mapping.sealed_product_id
    and existing_mapping.condition = new_mapping.condition
    and existing_mapping.language = new_mapping.language
    and existing_mapping.variant_key = new_mapping.variant_key;

  update public.provider_catalog_mappings mapping
  set disabled_at = v_publish_at
  from private.catalog_sync_stage_v3 stage
  where stage.run_id = p_run_id
    and stage.entity_type = 'retire_provider_catalog_mappings'
    and mapping.id = (stage.payload ->> 'id')::uuid
    and mapping.disabled_at is null;

  insert into public.provider_catalog_mappings (
    id,
    provider_id,
    card_variant_id,
    sealed_product_id,
    provider_product_id,
    provider_listing_id,
    condition,
    language,
    variant_key,
    mapping_metadata,
    verified_at,
    disabled_at,
    supersedes_mapping_id,
    mapping_version
  )
  select
    row_data.id,
    row_data.provider_id,
    row_data.card_variant_id,
    row_data.sealed_product_id,
    row_data.provider_product_id,
    row_data.provider_listing_id,
    row_data.condition,
    row_data.language,
    row_data.variant_key,
    row_data.mapping_metadata,
    row_data.verified_at,
    null,
    row_data.supersedes_mapping_id,
    row_data.mapping_version
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(
    null::public.provider_catalog_mappings,
    stage.payload
  ) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'provider_catalog_mappings'
  order by stage.row_key
  on conflict (id) do update set
    mapping_metadata = excluded.mapping_metadata,
    verified_at = excluded.verified_at,
    disabled_at = null;

  insert into public.price_snapshots (
    mapping_id,
    provider_id,
    card_variant_id,
    sealed_product_id,
    currency,
    market_value,
    condition,
    language,
    observed_at,
    data_mode,
    source_quote_id
  )
  select
    row_data.mapping_id,
    row_data.provider_id,
    row_data.card_variant_id,
    row_data.sealed_product_id,
    row_data.currency,
    row_data.market_value,
    row_data.condition,
    row_data.language,
    row_data.observed_at,
    row_data.data_mode,
    row_data.source_quote_id
  from private.catalog_sync_stage_v3 stage
  cross join lateral jsonb_populate_record(null::public.price_snapshots, stage.payload) row_data
  where stage.run_id = p_run_id and stage.entity_type = 'price_snapshots'
  order by stage.row_key
  on conflict (mapping_id, observed_at) do update set
    provider_id = excluded.provider_id,
    card_variant_id = excluded.card_variant_id,
    sealed_product_id = excluded.sealed_product_id,
    currency = excluded.currency,
    market_value = excluded.market_value,
    condition = excluded.condition,
    language = excluded.language,
    data_mode = excluded.data_mode,
    source_quote_id = excluded.source_quote_id;

  update public.card_variants variant
  set archived_at = v_publish_at
  from private.catalog_sync_stage_v3 stage
  where stage.run_id = p_run_id
    and stage.entity_type = 'retire_card_variants'
    and variant.id = (stage.payload ->> 'id')::uuid
    and variant.archived_at is null;

  update public.sealed_products sealed
  set archived_at = v_publish_at
  from private.catalog_sync_stage_v3 stage
  where stage.run_id = p_run_id
    and stage.entity_type = 'retire_sealed_products'
    and sealed.id = (stage.payload ->> 'id')::uuid
    and sealed.archived_at is null;

  update public.cards card
  set archived_at = v_publish_at
  from private.catalog_sync_stage_v3 stage
  where stage.run_id = p_run_id
    and stage.entity_type = 'retire_cards'
    and card.id = (stage.payload ->> 'id')::uuid
    and card.archived_at is null;

  update public.card_sets card_set
  set archived_at = v_publish_at
  from private.catalog_sync_stage_v3 stage
  where stage.run_id = p_run_id
    and stage.entity_type = 'retire_card_sets'
    and card_set.id = (stage.payload ->> 'id')::uuid
    and card_set.archived_at is null;

  v_valuation_count := private.capture_collection_daily_valuations_after_prices(
    (now() at time zone 'UTC')::date
  );

  update public.pricing_providers provider
  set
    last_sync_at = v_run.snapshot_generated_at,
    next_sync_allowed_at = null,
    sync_lock_until = null,
    consecutive_failures = 0
  where provider.id = any(v_run.provider_ids)
    and provider.sync_lock_until = v_run.provider_lock_until;

  get diagnostics v_provider_count = row_count;
  if v_provider_count <> cardinality(v_run.provider_ids) then
    raise exception 'Catalog sync provider lock changed during publish';
  end if;

  v_result := jsonb_build_object(
    'run_id', p_run_id,
    'published_at', v_publish_at,
    'snapshot_generated_at', v_run.snapshot_generated_at,
    'valuation_rows_captured', v_valuation_count,
    'counts', v_run.expected_counts
  );

  update private.catalog_sync_runs_v3 run
  set status = 'published', published_at = v_publish_at, result = v_result
  where run.id = p_run_id;

  delete from private.catalog_sync_stage_v3 stage where stage.run_id = p_run_id;

  return v_result;
end;
$$;

create or replace function public.abort_catalog_sync_v3(
  p_run_id uuid,
  p_failure_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.catalog_sync_runs_v3%rowtype;
begin
  select * into v_run
  from private.catalog_sync_runs_v3 run
  where run.id = p_run_id
  for update;

  if not found then
    return 'missing';
  end if;
  if v_run.status <> 'staging' then
    return v_run.status;
  end if;

  update public.pricing_providers provider
  set
    sync_lock_until = null,
    consecutive_failures = provider.consecutive_failures + 1
  where provider.id = any(v_run.provider_ids)
    and provider.sync_lock_until = v_run.provider_lock_until;

  delete from private.catalog_sync_stage_v3 stage where stage.run_id = p_run_id;

  update private.catalog_sync_runs_v3 run
  set
    status = 'failed',
    failed_at = clock_timestamp(),
    failure_message = left(coalesce(p_failure_message, 'Unknown importer failure'), 2000)
  where run.id = p_run_id;

  return 'aborted';
end;
$$;

-- Only the backend importer may call the privileged staging/publish boundary.
-- The functions use a fixed empty search_path and fully-qualified relations.
revoke execute on function public.begin_catalog_sync_v3(
  uuid, uuid, timestamptz, uuid[], timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.stage_catalog_sync_rows_v3(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_catalog_sync_v3(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.abort_catalog_sync_v3(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.begin_catalog_sync_v3(
  uuid, uuid, timestamptz, uuid[], timestamptz, jsonb
) to service_role;
grant execute on function public.stage_catalog_sync_rows_v3(
  uuid, text, jsonb
) to service_role;
grant execute on function public.finalize_catalog_sync_v3(uuid)
  to service_role;
grant execute on function public.abort_catalog_sync_v3(uuid, text)
  to service_role;

-- The service role now stages through RPC and can no longer bypass the atomic
-- publisher with direct production-table writes.
revoke insert, update on table
  public.card_sets,
  public.cards,
  public.card_variants,
  public.sealed_products,
  public.provider_catalog_mappings,
  public.price_snapshots
from service_role;
revoke usage, select on sequence public.price_snapshots_id_seq from service_role;

commit;
