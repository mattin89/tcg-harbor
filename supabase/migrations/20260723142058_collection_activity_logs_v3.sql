begin;

-- Collection activity is an immutable, server-owned audit stream. The browser
-- can read only rows whose user_id matches its verified Supabase identity.
alter table public.activity_logs enable row level security;

drop policy if exists activity_logs_owner_select on public.activity_logs;
create policy activity_logs_owner_select
  on public.activity_logs
  for select
  to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke all on public.activity_logs from public, anon, authenticated;
grant select on public.activity_logs to authenticated;

-- One activity row per immutable acquisition lot makes both the trigger and
-- historical backfill safe to rerun without duplicating a user's feed.
create unique index if not exists activity_logs_collection_acquisition_lot_v3_unique
  on public.activity_logs ((metadata ->> 'collection_acquisition_lot_id'))
  where activity_type = 'collection_item_added'
    and metadata ? 'collection_acquisition_lot_id';

create or replace function private.collection_item_activity_metadata_v3(
  p_card_variant_id uuid,
  p_sealed_product_id uuid,
  p_language public.language_code
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
begin
  if p_card_variant_id is not null then
    select jsonb_strip_nulls(jsonb_build_object(
      'asset_kind', 'card',
      'asset_name', card.name,
      'card_number', card.card_number,
      'set_code', card_set.code,
      'variant_name', coalesce(variant.variant_name, variant.variant_identifier),
      'language', p_language::text
    ))
    into v_metadata
    from public.card_variants variant
    join public.cards card on card.id = variant.card_id
    join public.card_sets card_set on card_set.id = card.card_set_id
    where variant.id = p_card_variant_id;
  else
    select jsonb_strip_nulls(jsonb_build_object(
      'asset_kind', 'sealed',
      'asset_name', product.name,
      'set_code', card_set.code,
      'product_type', product.product_type::text,
      'language', p_language::text
    ))
    into v_metadata
    from public.sealed_products product
    left join public.card_sets card_set on card_set.id = product.card_set_id
    where product.id = p_sealed_product_id;
  end if;

  return coalesce(v_metadata, jsonb_strip_nulls(jsonb_build_object(
    'asset_kind', case when p_card_variant_id is not null then 'card' else 'sealed' end,
    'language', p_language::text
  )));
end;
$$;

create or replace function private.capture_collection_acquisition_activity_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_logs (
    user_id,
    actor_id,
    activity_type,
    entity_type,
    entity_id,
    metadata,
    occurred_at
  ) values (
    new.owner_id,
    new.owner_id,
    'collection_item_added',
    'collection_item',
    new.collection_item_id,
    private.collection_item_activity_metadata_v3(
      new.card_variant_id,
      new.sealed_product_id,
      new.language
    ) || jsonb_build_object(
      'collection_acquisition_lot_id', new.id::text,
      'added_quantity', new.added_quantity,
      'quantity_after', new.quantity_after
    ),
    new.captured_at
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists collection_acquisition_activity_capture_v3
  on public.collection_acquisition_lots;
create trigger collection_acquisition_activity_capture_v3
  after insert on public.collection_acquisition_lots
  for each row execute function private.capture_collection_acquisition_activity_v3();

-- Decreases and removals do not create acquisition lots, so capture those two
-- collection changes directly. Positive deltas are handled only by the lot
-- trigger above and therefore cannot appear twice.
create or replace function private.capture_collection_item_change_activity_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_type text;
  v_metadata jsonb;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    v_activity_type := 'collection_item_removed';
    v_metadata := jsonb_build_object(
      'removed_quantity', old.quantity,
      'quantity_before', old.quantity,
      'quantity_after', 0
    );
  elsif old.deleted_at is null
    and new.deleted_at is null
    and new.quantity < old.quantity then
    v_activity_type := 'collection_quantity_decreased';
    v_metadata := jsonb_build_object(
      'removed_quantity', old.quantity - new.quantity,
      'quantity_before', old.quantity,
      'quantity_after', new.quantity
    );
  else
    return new;
  end if;

  insert into public.activity_logs (
    user_id,
    actor_id,
    activity_type,
    entity_type,
    entity_id,
    metadata,
    occurred_at
  ) values (
    new.owner_id,
    new.owner_id,
    v_activity_type,
    'collection_item',
    new.id,
    private.collection_item_activity_metadata_v3(
      new.card_variant_id,
      new.sealed_product_id,
      new.language
    ) || v_metadata,
    transaction_timestamp()
  );

  return new;
end;
$$;

drop trigger if exists collection_activity_change_capture_v3
  on public.collection_items;
create trigger collection_activity_change_capture_v3
  after update of quantity, deleted_at on public.collection_items
  for each row execute function private.capture_collection_item_change_activity_v3();

-- Existing immutable acquisition lots are reliable evidence of prior adds.
-- The unique partial index and NOT EXISTS guard make this backfill idempotent.
insert into public.activity_logs (
  user_id,
  actor_id,
  activity_type,
  entity_type,
  entity_id,
  metadata,
  occurred_at
)
select
  lot.owner_id,
  lot.owner_id,
  'collection_item_added',
  'collection_item',
  lot.collection_item_id,
  private.collection_item_activity_metadata_v3(
    lot.card_variant_id,
    lot.sealed_product_id,
    lot.language
  ) || jsonb_build_object(
    'collection_acquisition_lot_id', lot.id::text,
    'added_quantity', lot.added_quantity,
    'quantity_after', lot.quantity_after
  ),
  lot.captured_at
from public.collection_acquisition_lots lot
where not exists (
  select 1
  from public.activity_logs activity
  where activity.activity_type = 'collection_item_added'
    and activity.metadata ->> 'collection_acquisition_lot_id' = lot.id::text
)
on conflict do nothing;

revoke all on function private.collection_item_activity_metadata_v3(
  uuid, uuid, public.language_code
) from public, anon, authenticated;
revoke all on function private.capture_collection_acquisition_activity_v3()
  from public, anon, authenticated;
revoke all on function private.capture_collection_item_change_activity_v3()
  from public, anon, authenticated;

commit;
