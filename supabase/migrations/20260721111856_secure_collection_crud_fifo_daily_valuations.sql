-- Secure collection mutations, FIFO disposal accounting, and daily portfolio
-- valuation snapshots. Catalog and pricing ingestion remain separate concerns.
--
-- Authenticated clients retain owner-scoped reads, but every collection write
-- now crosses a narrow SECURITY DEFINER RPC that derives owner identity from
-- auth.uid(). The private daily capture function is intended to run once after
-- the trusted price-snapshot ingestion step; reruns for a date are idempotent.

begin;

-- ---------------------------------------------------------------------------
-- FIFO disposal ledger
-- ---------------------------------------------------------------------------

create table public.collection_disposal_events (
  id bigint generated always as identity primary key,
  collection_item_id uuid not null
    references public.collection_items(id) on delete cascade,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  removed_quantity integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  disposal_kind text not null,
  changed_by uuid references public.app_users(id) on delete set null,
  disposed_at timestamptz not null default transaction_timestamp(),
  created_at timestamptz not null default now(),
  constraint collection_disposal_events_removed_positive
    check (removed_quantity > 0),
  constraint collection_disposal_events_quantities_valid check (
    quantity_before between 1 and 100000
    and quantity_after between 0 and 99999
    and quantity_before - quantity_after = removed_quantity
  ),
  constraint collection_disposal_events_kind_valid check (
    disposal_kind in ('quantity_reduced', 'soft_removed', 'migration_reconciliation')
  )
);

create index collection_disposal_events_owner_time_idx
  on public.collection_disposal_events (owner_id, disposed_at desc, id desc);
create index collection_disposal_events_item_time_idx
  on public.collection_disposal_events (collection_item_id, disposed_at desc, id desc);
create index collection_disposal_events_changed_by_idx
  on public.collection_disposal_events (changed_by)
  where changed_by is not null;

create table public.collection_disposal_lot_allocations (
  disposal_event_id bigint not null
    references public.collection_disposal_events(id) on delete cascade,
  acquisition_lot_id bigint not null
    references public.collection_acquisition_lots(id) on delete cascade,
  allocated_quantity integer not null,
  allocated_at timestamptz not null default transaction_timestamp(),
  primary key (disposal_event_id, acquisition_lot_id),
  constraint collection_disposal_allocations_quantity_positive
    check (allocated_quantity > 0)
);

create index collection_disposal_allocations_lot_idx
  on public.collection_disposal_lot_allocations (acquisition_lot_id, disposal_event_id);

-- Supports daily as-of quantity reconstruction without scanning every owner's
-- complete history. owner_id and quantity are included for index-only reads.
create index collection_quantity_history_item_asof_idx
  on public.collection_quantity_history (collection_item_id, effective_at desc, id desc)
  include (owner_id, quantity);

create or replace function private.allocate_collection_disposal_fifo(
  p_disposal_event_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.collection_disposal_events%rowtype;
  v_lot record;
  v_already_allocated integer;
  v_needed integer;
  v_take integer;
begin
  select disposal.*
  into v_event
  from public.collection_disposal_events disposal
  where disposal.id = p_disposal_event_id
  for update;

  if not found then
    raise exception 'Collection disposal event not found';
  end if;

  select coalesce(sum(allocation.allocated_quantity), 0)::integer
  into v_already_allocated
  from public.collection_disposal_lot_allocations allocation
  where allocation.disposal_event_id = v_event.id;

  if v_already_allocated > v_event.removed_quantity then
    raise exception 'FIFO allocations exceed the disposal quantity';
  end if;

  v_needed := v_event.removed_quantity - v_already_allocated;
  if v_needed = 0 then
    return;
  end if;

  -- The collection item row is already locked by the calling mutation. Lots
  -- are additionally locked in stable FIFO order for deterministic allocation.
  for v_lot in
    select
      lot.id,
      lot.added_quantity - coalesce((
        select sum(existing.allocated_quantity)
        from public.collection_disposal_lot_allocations existing
        where existing.acquisition_lot_id = lot.id
      ), 0)::integer as available_quantity
    from public.collection_acquisition_lots lot
    where lot.collection_item_id = v_event.collection_item_id
      and lot.owner_id = v_event.owner_id
      and lot.captured_at <= v_event.disposed_at
      and lot.added_quantity - coalesce((
        select sum(existing.allocated_quantity)
        from public.collection_disposal_lot_allocations existing
        where existing.acquisition_lot_id = lot.id
      ), 0) > 0
    order by lot.captured_at, lot.id
    for update of lot
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_lot.available_quantity);

    insert into public.collection_disposal_lot_allocations (
      disposal_event_id,
      acquisition_lot_id,
      allocated_quantity,
      allocated_at
    ) values (
      v_event.id,
      v_lot.id,
      v_take,
      v_event.disposed_at
    )
    on conflict (disposal_event_id, acquisition_lot_id)
    do update set
      allocated_quantity = public.collection_disposal_lot_allocations.allocated_quantity
        + excluded.allocated_quantity;

    v_needed := v_needed - v_take;
  end loop;

  if v_needed <> 0 then
    raise exception
      'Insufficient acquisition-lot quantity for FIFO disposal event % (missing % units)',
      v_event.id,
      v_needed;
  end if;
end;
$$;

create or replace function private.capture_collection_fifo_disposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity_before integer;
  v_quantity_after integer;
  v_disposal_event_id bigint;
begin
  v_quantity_before := case when old.deleted_at is null then old.quantity else 0 end;
  v_quantity_after := case when new.deleted_at is null then new.quantity else 0 end;

  if v_quantity_after >= v_quantity_before then
    return new;
  end if;

  insert into public.collection_disposal_events (
    collection_item_id,
    owner_id,
    removed_quantity,
    quantity_before,
    quantity_after,
    disposal_kind,
    changed_by,
    disposed_at
  ) values (
    new.id,
    new.owner_id,
    v_quantity_before - v_quantity_after,
    v_quantity_before,
    v_quantity_after,
    case when new.deleted_at is null then 'quantity_reduced' else 'soft_removed' end,
    auth.uid(),
    transaction_timestamp()
  )
  returning id into v_disposal_event_id;

  perform private.allocate_collection_disposal_fifo(v_disposal_event_id);
  return new;
end;
$$;

-- Treat restoration from a soft delete as a new row through add-or-merge. This
-- guard keeps every row's owner, catalog target, valuation identity, acquisition
-- date, and original purchase metadata stable for its complete audit lifetime.
create or replace function private.guard_collection_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Soft-removed collection items are immutable';
  end if;

  if new.owner_id is distinct from old.owner_id
     or new.card_variant_id is distinct from old.card_variant_id
     or new.sealed_product_id is distinct from old.sealed_product_id
     or new.condition is distinct from old.condition
     or new.language is distinct from old.language
     or new.acquired_on is distinct from old.acquired_on
     or new.created_at is distinct from old.created_at then
    raise exception 'Collection item identity and acquisition date are immutable';
  end if;

  if old.purchase_unit_amount is not null
     and (
       new.purchase_unit_amount is distinct from old.purchase_unit_amount
       or new.purchase_currency is distinct from old.purchase_currency
     ) then
    raise exception 'Original purchase metadata is immutable once recorded';
  end if;

  if old.purchase_unit_amount is null
     and (
       (new.purchase_unit_amount is null) <> (new.purchase_currency is null)
       or new.purchase_unit_amount < 0
     ) then
    raise exception 'Purchase amount and currency must be supplied together';
  end if;

  if new.deleted_at is not null and new.quantity is distinct from old.quantity then
    raise exception 'Soft removal must preserve the stored quantity';
  end if;

  return new;
end;
$$;

-- The production importer writes normalized price_snapshots. Preserve the
-- richer licensed quote when one exists at acquisition time, otherwise fall
-- back to the latest verified live snapshot without manufacturing unavailable
-- low/average values or a source_quote_id.
create or replace function public.capture_collection_acquisition_market_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.collection_acquisition_market_references (
    acquisition_lot_id,
    provider_id,
    source_quote_id,
    currency,
    market_value,
    low_value,
    average_value,
    trend_value,
    quote_fetched_at,
    freshness,
    data_mode,
    captured_at
  )
  select
    new.id,
    eligible.provider_id,
    latest_quote.id,
    case
      when latest_quote.id is not null then latest_quote.currency
      when latest_snapshot.id is not null then latest_snapshot.currency
      else eligible.native_currency
    end,
    case
      when latest_quote.id is not null then latest_quote.market_value
      else latest_snapshot.market_value
    end,
    case when latest_quote.id is not null then latest_quote.low_value else null end,
    case when latest_quote.id is not null then latest_quote.average_value else null end,
    case
      when latest_quote.id is not null then latest_quote.trend_value
      when eligible.provider_slug = 'cardmarket' then latest_snapshot.market_value
      else null
    end,
    case
      when latest_quote.id is not null then latest_quote.fetched_at
      else latest_snapshot.observed_at
    end,
    case
      when latest_quote.id is not null then latest_quote.freshness
      when latest_snapshot.id is null or latest_snapshot.market_value is null
        then 'unavailable'::public.quote_freshness
      else 'fresh'::public.quote_freshness
    end,
    case
      when latest_quote.id is not null then latest_quote.data_mode
      else latest_snapshot.data_mode
    end,
    new.captured_at
  from (
    select distinct
      mapping.provider_id,
      provider.slug as provider_slug,
      provider.native_currency
    from public.provider_catalog_mappings mapping
    join public.pricing_providers provider on provider.id = mapping.provider_id
    where provider.is_enabled
      and provider.data_mode = 'live'
      and mapping.created_at <= new.captured_at
      and mapping.verified_at is not null
      and mapping.verified_at <= new.captured_at
      and (mapping.disabled_at is null or mapping.disabled_at > new.captured_at)
      and mapping.condition = new.condition
      and mapping.language = new.language
      and mapping.card_variant_id is not distinct from new.card_variant_id
      and mapping.sealed_product_id is not distinct from new.sealed_product_id
  ) eligible
  left join lateral (
    select quote.*
    from public.price_quotes quote
    join public.provider_catalog_mappings mapping on mapping.id = quote.mapping_id
    where quote.provider_id = eligible.provider_id
      and quote.data_mode = 'live'
      and quote.card_variant_id is not distinct from new.card_variant_id
      and quote.sealed_product_id is not distinct from new.sealed_product_id
      and quote.condition = new.condition
      and quote.language = new.language
      and mapping.created_at <= new.captured_at
      and mapping.verified_at is not null
      and mapping.verified_at <= new.captured_at
      and (mapping.disabled_at is null or mapping.disabled_at > new.captured_at)
      and quote.fetched_at <= new.captured_at
      and quote.cached_at <= new.captured_at
      and quote.created_at <= new.captured_at
      and quote.market_value is not null
      and quote.freshness <> 'unavailable'
    order by quote.fetched_at desc, quote.cached_at desc, quote.created_at desc, quote.id desc
    limit 1
  ) latest_quote on true
  left join lateral (
    select snapshot.*
    from public.price_snapshots snapshot
    join public.provider_catalog_mappings mapping on mapping.id = snapshot.mapping_id
    where snapshot.provider_id = eligible.provider_id
      and snapshot.data_mode = 'live'
      and snapshot.card_variant_id is not distinct from new.card_variant_id
      and snapshot.sealed_product_id is not distinct from new.sealed_product_id
      and snapshot.condition = new.condition
      and snapshot.language = new.language
      and mapping.created_at <= new.captured_at
      and mapping.verified_at is not null
      and mapping.verified_at <= new.captured_at
      and (mapping.disabled_at is null or mapping.disabled_at > new.captured_at)
      and snapshot.observed_at <= new.captured_at
      and snapshot.created_at <= new.captured_at
    order by snapshot.observed_at desc, snapshot.created_at desc, snapshot.id desc
    limit 1
  ) latest_snapshot on latest_quote.id is null;

  return new;
end;
$$;

-- Repair only legacy placeholder references that never captured a quote. The
-- fallback remains point-in-time safe: both the verified mapping and snapshot
-- must have existed no later than the immutable acquisition-lot timestamp.
with snapshot_fallback as (
  select
    reference.id as reference_id,
    snapshot.currency,
    snapshot.market_value,
    case
      when provider.slug = 'cardmarket' then snapshot.market_value
      else null
    end as trend_value,
    snapshot.observed_at,
    case
      when snapshot.market_value is null then 'unavailable'::public.quote_freshness
      else 'fresh'::public.quote_freshness
    end as freshness,
    snapshot.data_mode
  from public.collection_acquisition_market_references reference
  join public.collection_acquisition_lots lot
    on lot.id = reference.acquisition_lot_id
  join public.pricing_providers provider on provider.id = reference.provider_id
  join lateral (
    select candidate.*
    from public.price_snapshots candidate
    join public.provider_catalog_mappings mapping on mapping.id = candidate.mapping_id
    where candidate.provider_id = reference.provider_id
      and candidate.data_mode = 'live'
      and candidate.card_variant_id is not distinct from lot.card_variant_id
      and candidate.sealed_product_id is not distinct from lot.sealed_product_id
      and candidate.condition = lot.condition
      and candidate.language = lot.language
      and mapping.created_at <= lot.captured_at
      and mapping.verified_at is not null
      and mapping.verified_at <= lot.captured_at
      and (mapping.disabled_at is null or mapping.disabled_at > lot.captured_at)
      and candidate.observed_at <= lot.captured_at
      and candidate.created_at <= lot.captured_at
    order by candidate.observed_at desc, candidate.created_at desc, candidate.id desc
    limit 1
  ) snapshot on true
  where reference.source_quote_id is null
    and reference.market_value is null
    and reference.trend_value is null
)
update public.collection_acquisition_market_references reference
set currency = fallback.currency,
    market_value = fallback.market_value,
    trend_value = fallback.trend_value,
    quote_fetched_at = fallback.observed_at,
    freshness = fallback.freshness,
    data_mode = fallback.data_mode
from snapshot_fallback fallback
where reference.id = fallback.reference_id;

-- Positive effective-quantity deltas remain immutable acquisition lots. Using
-- transaction_timestamp aligns them with quantity history and FIFO events.
create or replace function public.capture_collection_acquisition_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity_before integer;
  v_quantity_after integer;
  v_added_quantity integer;
begin
  if tg_op = 'INSERT' then
    v_quantity_before := 0;
  else
    v_quantity_before := case when old.deleted_at is null then old.quantity else 0 end;
  end if;
  v_quantity_after := case when new.deleted_at is null then new.quantity else 0 end;
  v_added_quantity := v_quantity_after - v_quantity_before;

  if v_added_quantity <= 0 then
    return new;
  end if;

  insert into public.collection_acquisition_lots (
    collection_item_id,
    owner_id,
    card_variant_id,
    sealed_product_id,
    condition,
    language,
    added_quantity,
    quantity_after,
    captured_at
  ) values (
    new.id,
    new.owner_id,
    new.card_variant_id,
    new.sealed_product_id,
    new.condition,
    new.language,
    v_added_quantity,
    v_quantity_after,
    transaction_timestamp()
  );

  return new;
end;
$$;

drop trigger if exists collection_acquisition_lot_capture on public.collection_items;
create trigger collection_acquisition_lot_capture
  after insert or update of quantity, deleted_at on public.collection_items
  for each row execute function public.capture_collection_acquisition_lot();

create trigger collection_fifo_disposal_capture
  after update of quantity, deleted_at on public.collection_items
  for each row execute function private.capture_collection_fifo_disposal();

create trigger collection_item_immutable_identity_guard
  before update on public.collection_items
  for each row execute function private.guard_collection_item_mutation();

-- Replay historical negative deltas against the acquisition lots generated by
-- the preceding acquisition migration. A reconciliation event covers any old
-- row that predated complete quantity history; missing positive basis fails
-- closed instead of inventing an acquisition value.
do $$
declare
  v_delta record;
  v_item record;
  v_event_id bigint;
begin
  for v_delta in
    with ordered_history as (
      select
        history.id,
        history.collection_item_id,
        history.owner_id,
        history.quantity,
        history.effective_at,
        history.reason,
        coalesce(
          lag(history.quantity) over (
            partition by history.collection_item_id
            order by history.effective_at, history.id
          ),
          0
        ) as previous_quantity
      from public.collection_quantity_history history
    )
    select *
    from ordered_history
    where quantity < previous_quantity
    order by effective_at, id
  loop
    insert into public.collection_disposal_events (
      collection_item_id,
      owner_id,
      removed_quantity,
      quantity_before,
      quantity_after,
      disposal_kind,
      disposed_at
    ) values (
      v_delta.collection_item_id,
      v_delta.owner_id,
      v_delta.previous_quantity - v_delta.quantity,
      v_delta.previous_quantity,
      v_delta.quantity,
      case when v_delta.reason = 'item_removed' then 'soft_removed' else 'quantity_reduced' end,
      v_delta.effective_at
    )
    returning id into v_event_id;

    perform private.allocate_collection_disposal_fifo(v_event_id);
  end loop;

  for v_item in
    with lot_balances as (
      select
        item.id as collection_item_id,
        item.owner_id,
        case when item.deleted_at is null then item.quantity else 0 end as expected_quantity,
        coalesce((
          select sum(
            lot.added_quantity - coalesce((
              select sum(allocation.allocated_quantity)
              from public.collection_disposal_lot_allocations allocation
              where allocation.acquisition_lot_id = lot.id
            ), 0)
          )
          from public.collection_acquisition_lots lot
          where lot.collection_item_id = item.id
        ), 0)::integer as lot_quantity,
        item.deleted_at
      from public.collection_items item
    )
    select * from lot_balances where lot_quantity <> expected_quantity
  loop
    if v_item.lot_quantity < v_item.expected_quantity then
      raise exception
        'Collection item % has % units but only % acquisition-lot units',
        v_item.collection_item_id,
        v_item.expected_quantity,
        v_item.lot_quantity;
    end if;

    insert into public.collection_disposal_events (
      collection_item_id,
      owner_id,
      removed_quantity,
      quantity_before,
      quantity_after,
      disposal_kind,
      disposed_at
    ) values (
      v_item.collection_item_id,
      v_item.owner_id,
      v_item.lot_quantity - v_item.expected_quantity,
      v_item.lot_quantity,
      v_item.expected_quantity,
      'migration_reconciliation',
      coalesce(v_item.deleted_at, transaction_timestamp())
    )
    returning id into v_event_id;

    perform private.allocate_collection_disposal_fifo(v_event_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Narrow authenticated mutation API
-- ---------------------------------------------------------------------------

create or replace function private.require_active_collection_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (
       select 1
       from public.app_users app_user
       where app_user.id = v_uid
         and app_user.status = 'active'
     ) then
    raise exception 'An active authenticated account is required';
  end if;

  return v_uid;
end;
$$;

create or replace function public.add_or_merge_collection_item(
  p_card_variant_id uuid default null,
  p_sealed_product_id uuid default null,
  p_condition public.item_condition default 'near_mint',
  p_quantity integer default 1,
  p_private_note text default null,
  p_purchase_unit_amount numeric default null,
  p_purchase_currency public.currency_code default null
)
returns public.collection_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_collection_owner();
  v_language public.language_code;
  v_note text := public.normalize_user_text(p_private_note);
  v_item public.collection_items%rowtype;
begin
  if ((p_card_variant_id is not null)::integer
      + (p_sealed_product_id is not null)::integer) <> 1 then
    raise exception 'Exactly one catalog asset is required';
  end if;
  if p_condition is null then
    raise exception 'Condition is required';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'Quantity must be between 1 and 100000';
  end if;
  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Private note must not exceed 4000 characters';
  end if;
  if (p_purchase_unit_amount is null) <> (p_purchase_currency is null)
     or p_purchase_unit_amount < 0
     or p_purchase_unit_amount >= 1000000000000 then
    raise exception 'Purchase amount and currency must be supplied together with a valid amount';
  end if;

  if p_card_variant_id is not null then
    if p_condition = 'sealed' then
      raise exception 'Sealed is not a valid card condition';
    end if;

    select variant.language
    into v_language
    from public.card_variants variant
    join public.cards card on card.id = variant.card_id
    join public.card_sets card_set on card_set.id = card.card_set_id
    join public.games game on game.id = card.game_id
    where variant.id = p_card_variant_id
      and variant.archived_at is null
      and card.archived_at is null
      and card_set.archived_at is null
      and game.is_active
      and game.archived_at is null;
    if not found then
      raise exception 'Active card variant not found';
    end if;

    insert into public.collection_items (
      owner_id,
      card_variant_id,
      sealed_product_id,
      condition,
      language,
      quantity,
      purchase_unit_amount,
      purchase_currency,
      private_note
    ) values (
      v_uid,
      p_card_variant_id,
      null,
      p_condition,
      v_language,
      p_quantity,
      p_purchase_unit_amount,
      p_purchase_currency,
      v_note
    )
    on conflict (owner_id, card_variant_id, condition, language)
      where deleted_at is null and card_variant_id is not null
    do update set
      quantity = public.collection_items.quantity + excluded.quantity,
      private_note = coalesce(excluded.private_note, public.collection_items.private_note),
      purchase_unit_amount = coalesce(
        public.collection_items.purchase_unit_amount,
        excluded.purchase_unit_amount
      ),
      purchase_currency = coalesce(
        public.collection_items.purchase_currency,
        excluded.purchase_currency
      )
    where public.collection_items.quantity <= 100000 - excluded.quantity
    returning * into v_item;
  else
    if p_condition <> 'sealed' then
      raise exception 'Sealed products must use the sealed condition';
    end if;

    select product.language
    into v_language
    from public.sealed_products product
    join public.games game on game.id = product.game_id
    left join public.card_sets card_set on card_set.id = product.card_set_id
    where product.id = p_sealed_product_id
      and product.archived_at is null
      and (card_set.id is null or card_set.archived_at is null)
      and game.is_active
      and game.archived_at is null;
    if not found then
      raise exception 'Active sealed product not found';
    end if;

    insert into public.collection_items (
      owner_id,
      card_variant_id,
      sealed_product_id,
      condition,
      language,
      quantity,
      purchase_unit_amount,
      purchase_currency,
      private_note
    ) values (
      v_uid,
      null,
      p_sealed_product_id,
      p_condition,
      v_language,
      p_quantity,
      p_purchase_unit_amount,
      p_purchase_currency,
      v_note
    )
    on conflict (owner_id, sealed_product_id, condition, language)
      where deleted_at is null and sealed_product_id is not null
    do update set
      quantity = public.collection_items.quantity + excluded.quantity,
      private_note = coalesce(excluded.private_note, public.collection_items.private_note),
      purchase_unit_amount = coalesce(
        public.collection_items.purchase_unit_amount,
        excluded.purchase_unit_amount
      ),
      purchase_currency = coalesce(
        public.collection_items.purchase_currency,
        excluded.purchase_currency
      )
    where public.collection_items.quantity <= 100000 - excluded.quantity
    returning * into v_item;
  end if;

  if v_item.id is null then
    raise exception 'Quantity would exceed the 100000-unit holding limit';
  end if;
  return v_item;
end;
$$;

create or replace function public.set_collection_item_quantity(
  p_collection_item_id uuid,
  p_quantity integer
)
returns public.collection_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_collection_owner();
  v_item public.collection_items%rowtype;
begin
  if p_collection_item_id is null then
    raise exception 'Collection item is required';
  end if;
  if p_quantity is null or p_quantity not between 1 and 100000 then
    raise exception 'Quantity must be between 1 and 100000';
  end if;

  select item.*
  into v_item
  from public.collection_items item
  where item.id = p_collection_item_id
    and item.owner_id = v_uid
    and item.deleted_at is null
  for update;
  if not found then
    raise exception 'Active collection item not found';
  end if;

  update public.collection_items
  set quantity = p_quantity
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.update_collection_item_details(
  p_collection_item_id uuid,
  p_private_note text
)
returns public.collection_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_collection_owner();
  v_note text := public.normalize_user_text(p_private_note);
  v_item public.collection_items%rowtype;
begin
  if p_collection_item_id is null then
    raise exception 'Collection item is required';
  end if;
  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Private note must not exceed 4000 characters';
  end if;

  update public.collection_items item
  set private_note = v_note
  where item.id = p_collection_item_id
    and item.owner_id = v_uid
    and item.deleted_at is null
  returning * into v_item;
  if not found then
    raise exception 'Active collection item not found';
  end if;

  return v_item;
end;
$$;

create or replace function public.soft_remove_collection_item(
  p_collection_item_id uuid
)
returns public.collection_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_active_collection_owner();
  v_item public.collection_items%rowtype;
begin
  if p_collection_item_id is null then
    raise exception 'Collection item is required';
  end if;

  select item.*
  into v_item
  from public.collection_items item
  where item.id = p_collection_item_id
    and item.owner_id = v_uid
    and item.deleted_at is null
  for update;
  if not found then
    raise exception 'Active collection item not found';
  end if;

  update public.collection_items
  set deleted_at = transaction_timestamp()
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner-only daily portfolio valuation snapshots
-- ---------------------------------------------------------------------------

create table public.collection_daily_valuation_snapshots (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  snapshot_date date not null,
  provider_id uuid not null references public.pricing_providers(id) on delete restrict,
  currency public.currency_code not null,
  market_value numeric(20,2),
  acquisition_value numeric(20,2),
  absolute_growth numeric(20,2),
  growth_percentage numeric(18,6),
  item_count integer not null,
  unit_count bigint not null,
  priced_unit_count bigint not null,
  unpriced_unit_count bigint not null,
  acquisition_priced_unit_count bigint not null,
  acquisition_unpriced_unit_count bigint not null,
  latest_price_observed_at timestamptz,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_daily_valuation_values_nonnegative check (
    (market_value is null or market_value >= 0)
    and (acquisition_value is null or acquisition_value >= 0)
  ),
  constraint collection_daily_valuation_counts_valid check (
    item_count > 0
    and unit_count > 0
    and priced_unit_count between 0 and unit_count
    and unpriced_unit_count = unit_count - priced_unit_count
    and acquisition_priced_unit_count between 0 and unit_count
    and acquisition_unpriced_unit_count = unit_count - acquisition_priced_unit_count
  ),
  constraint collection_daily_valuation_growth_consistent check (
    (market_value is null or acquisition_value is null)
      = (absolute_growth is null)
    and (
      growth_percentage is null
      or (market_value is not null and acquisition_value > 0)
    )
  ),
  unique (owner_id, snapshot_date, provider_id)
);

create index collection_daily_valuations_owner_date_idx
  on public.collection_daily_valuation_snapshots (owner_id, snapshot_date desc, provider_id)
  include (
    market_value,
    acquisition_value,
    absolute_growth,
    growth_percentage,
    currency
  );
create index collection_daily_valuations_provider_date_idx
  on public.collection_daily_valuation_snapshots (provider_id, snapshot_date desc);

create trigger collection_daily_valuations_updated_at
  before update on public.collection_daily_valuation_snapshots
  for each row execute function public.set_updated_at();

create or replace function private.capture_collection_daily_valuations_after_prices(
  p_snapshot_date date default ((now() at time zone 'UTC')::date)
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_written integer := 0;
begin
  if p_snapshot_date is null
     or p_snapshot_date > (now() at time zone 'UTC')::date then
    raise exception 'Snapshot date must be today or an earlier UTC date';
  end if;

  v_cutoff := ((p_snapshot_date + 1)::timestamp at time zone 'UTC');

  -- A transaction-scoped lock prevents concurrent retries for the same date.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tcg-harbor-daily-valuation:' || p_snapshot_date::text, 11)
  );

  with historical_holdings as (
    select distinct on (history.collection_item_id)
      history.collection_item_id,
      history.owner_id,
      item.card_variant_id,
      item.sealed_product_id,
      item.condition,
      item.language,
      history.quantity
    from public.collection_quantity_history history
    join public.collection_items item on item.id = history.collection_item_id
    where history.effective_at < v_cutoff
    order by
      history.collection_item_id,
      history.effective_at desc,
      history.id desc
  ),
  active_holdings as (
    select * from historical_holdings where quantity > 0
  ),
  enabled_providers as (
    select provider.id, provider.native_currency
    from public.pricing_providers provider
    where provider.is_enabled
      and provider.data_mode = 'live'
  ),
  valuation_lines as (
    select
      holding.owner_id,
      holding.collection_item_id,
      holding.quantity,
      provider.id as provider_id,
      provider.native_currency as currency,
      latest.market_value,
      latest.observed_at
    from active_holdings holding
    cross join enabled_providers provider
    left join lateral (
      select snapshot.market_value, snapshot.observed_at
      from public.price_snapshots snapshot
      where snapshot.provider_id = provider.id
        and snapshot.data_mode = 'live'
        and snapshot.card_variant_id is not distinct from holding.card_variant_id
        and snapshot.sealed_product_id is not distinct from holding.sealed_product_id
        and snapshot.condition = holding.condition
        and snapshot.language = holding.language
        and snapshot.observed_at < v_cutoff
      order by snapshot.observed_at desc, snapshot.id desc
      limit 1
    ) latest on true
  ),
  current_values as (
    select
      line.owner_id,
      line.provider_id,
      line.currency,
      count(*)::integer as item_count,
      sum(line.quantity)::bigint as unit_count,
      sum(case when line.market_value is not null then line.quantity else 0 end)::bigint
        as priced_unit_count,
      case
        when bool_and(line.market_value is not null)
          then round(sum(line.quantity * line.market_value), 2)
        else null
      end as market_value,
      max(line.observed_at) as latest_price_observed_at
    from valuation_lines line
    group by line.owner_id, line.provider_id, line.currency
  ),
  lot_remaining as (
    select
      lot.id as acquisition_lot_id,
      lot.owner_id,
      lot.added_quantity - coalesce((
        select sum(allocation.allocated_quantity)
        from public.collection_disposal_lot_allocations allocation
        join public.collection_disposal_events disposal
          on disposal.id = allocation.disposal_event_id
        where allocation.acquisition_lot_id = lot.id
          and disposal.disposed_at < v_cutoff
      ), 0)::integer as remaining_quantity
    from public.collection_acquisition_lots lot
    where lot.captured_at < v_cutoff
  ),
  basis_lines as (
    select
      lot.owner_id,
      provider.id as provider_id,
      lot.remaining_quantity,
      reference.market_value
    from lot_remaining lot
    cross join enabled_providers provider
    left join public.collection_acquisition_market_references reference
      on reference.acquisition_lot_id = lot.acquisition_lot_id
      and reference.provider_id = provider.id
      and reference.currency = provider.native_currency
    where lot.remaining_quantity > 0
  ),
  basis_values as (
    select
      basis.owner_id,
      basis.provider_id,
      sum(
        case when basis.market_value is not null then basis.remaining_quantity else 0 end
      )::bigint as priced_unit_count,
      case
        when bool_and(basis.market_value is not null)
          then round(sum(basis.remaining_quantity * basis.market_value), 2)
        else null
      end as acquisition_value
    from basis_lines basis
    group by basis.owner_id, basis.provider_id
  ),
  valuations as (
    select
      current.owner_id,
      current.provider_id,
      current.currency,
      current.market_value,
      basis.acquisition_value,
      case
        when current.market_value is not null and basis.acquisition_value is not null
          then current.market_value - basis.acquisition_value
        else null
      end as absolute_growth,
      case
        when current.market_value is not null and basis.acquisition_value > 0
          then round(
            ((current.market_value - basis.acquisition_value) / basis.acquisition_value) * 100,
            6
          )
        else null
      end as growth_percentage,
      current.item_count,
      current.unit_count,
      current.priced_unit_count,
      current.unit_count - current.priced_unit_count as unpriced_unit_count,
      coalesce(basis.priced_unit_count, 0) as acquisition_priced_unit_count,
      current.unit_count - coalesce(basis.priced_unit_count, 0)
        as acquisition_unpriced_unit_count,
      current.latest_price_observed_at
    from current_values current
    left join basis_values basis
      on basis.owner_id = current.owner_id
      and basis.provider_id = current.provider_id
  )
  insert into public.collection_daily_valuation_snapshots (
    owner_id,
    snapshot_date,
    provider_id,
    currency,
    market_value,
    acquisition_value,
    absolute_growth,
    growth_percentage,
    item_count,
    unit_count,
    priced_unit_count,
    unpriced_unit_count,
    acquisition_priced_unit_count,
    acquisition_unpriced_unit_count,
    latest_price_observed_at,
    captured_at,
    updated_at
  )
  select
    valuation.owner_id,
    p_snapshot_date,
    valuation.provider_id,
    valuation.currency,
    valuation.market_value,
    valuation.acquisition_value,
    valuation.absolute_growth,
    valuation.growth_percentage,
    valuation.item_count,
    valuation.unit_count,
    valuation.priced_unit_count,
    valuation.unpriced_unit_count,
    valuation.acquisition_priced_unit_count,
    valuation.acquisition_unpriced_unit_count,
    valuation.latest_price_observed_at,
    transaction_timestamp(),
    transaction_timestamp()
  from valuations valuation
  on conflict (owner_id, snapshot_date, provider_id)
  do update set
    currency = excluded.currency,
    market_value = excluded.market_value,
    acquisition_value = excluded.acquisition_value,
    absolute_growth = excluded.absolute_growth,
    growth_percentage = excluded.growth_percentage,
    item_count = excluded.item_count,
    unit_count = excluded.unit_count,
    priced_unit_count = excluded.priced_unit_count,
    unpriced_unit_count = excluded.unpriced_unit_count,
    acquisition_priced_unit_count = excluded.acquisition_priced_unit_count,
    acquisition_unpriced_unit_count = excluded.acquisition_unpriced_unit_count,
    latest_price_observed_at = excluded.latest_price_observed_at,
    updated_at = excluded.updated_at;

  get diagnostics v_written = row_count;

  -- Remove only stale rows for this date: rows whose provider is no longer a
  -- live source or whose owner had no positive holding at the UTC cutoff.
  delete from public.collection_daily_valuation_snapshots snapshot
  where snapshot.snapshot_date = p_snapshot_date
    and (
      not exists (
        select 1
        from public.pricing_providers provider
        where provider.id = snapshot.provider_id
          and provider.is_enabled
          and provider.data_mode = 'live'
      )
      or not exists (
        select 1
        from public.collection_quantity_history history
        where history.owner_id = snapshot.owner_id
          and history.effective_at < v_cutoff
          and history.quantity > 0
          and not exists (
            select 1
            from public.collection_quantity_history newer
            where newer.collection_item_id = history.collection_item_id
              and newer.effective_at < v_cutoff
              and (newer.effective_at, newer.id) > (history.effective_at, history.id)
          )
      )
    );

  return v_written;
end;
$$;

-- PostgREST does not expose the private schema. This wrapper is deliberately
-- public but executable only with the service-role API key; it also validates
-- the signed JWT role before crossing the private capture boundary.
create or replace function public.run_collection_daily_valuation_capture(
  p_snapshot_date date default ((now() at time zone 'UTC')::date)
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Service-role access required';
  end if;

  return private.capture_collection_daily_valuations_after_prices(p_snapshot_date);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and explicit Data API privileges
-- ---------------------------------------------------------------------------

alter table public.collection_disposal_events enable row level security;
alter table public.collection_disposal_lot_allocations enable row level security;
alter table public.collection_daily_valuation_snapshots enable row level security;

create policy collection_disposal_events_select_owner
  on public.collection_disposal_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy collection_disposal_allocations_select_owner
  on public.collection_disposal_lot_allocations
  for select to authenticated
  using (
    exists (
      select 1
      from public.collection_disposal_events disposal
      where disposal.id = disposal_event_id
        and disposal.owner_id = (select auth.uid())
    )
  );

create policy collection_daily_valuations_select_owner
  on public.collection_daily_valuation_snapshots
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Remove the legacy direct-write surface. SELECT remains owner-scoped through
-- collection_select_owner; all mutations now use the four RPCs below.
drop policy if exists collection_insert_owner on public.collection_items;
drop policy if exists collection_update_owner on public.collection_items;
revoke insert, update, delete on table public.collection_items
  from public, anon, authenticated;

revoke all on table public.collection_disposal_events,
  public.collection_disposal_lot_allocations,
  public.collection_daily_valuation_snapshots
  from public, anon, authenticated;
grant select on table public.collection_disposal_events,
  public.collection_disposal_lot_allocations,
  public.collection_daily_valuation_snapshots
  to authenticated;

revoke execute on function private.require_active_collection_owner(),
  private.allocate_collection_disposal_fifo(bigint),
  private.capture_collection_fifo_disposal(),
  private.guard_collection_item_mutation()
  from public, anon, authenticated, service_role;

revoke execute on function private.capture_collection_daily_valuations_after_prices(date)
  from public, anon, authenticated, service_role;

revoke execute on function public.add_or_merge_collection_item(
    uuid, uuid, public.item_condition, integer, text, numeric, public.currency_code
  ),
  public.set_collection_item_quantity(uuid, integer),
  public.update_collection_item_details(uuid, text),
  public.soft_remove_collection_item(uuid)
  from public, anon, authenticated;

grant execute on function public.add_or_merge_collection_item(
    uuid, uuid, public.item_condition, integer, text, numeric, public.currency_code
  ),
  public.set_collection_item_quantity(uuid, integer),
  public.update_collection_item_details(uuid, text),
  public.soft_remove_collection_item(uuid)
  to authenticated;

revoke execute on function public.run_collection_daily_valuation_capture(date)
  from public, anon, authenticated, service_role;
grant execute on function public.run_collection_daily_valuation_capture(date)
  to service_role;

revoke execute on function public.capture_collection_acquisition_lot(),
  public.capture_collection_acquisition_market_references()
  from public, anon, authenticated;

commit;

-- Trusted REST price ingestion must call run_collection_daily_valuation_capture
-- after the day's public.price_snapshots transaction commits. The wrapper is
-- idempotent per UTC date and intentionally unavailable to browser clients.
