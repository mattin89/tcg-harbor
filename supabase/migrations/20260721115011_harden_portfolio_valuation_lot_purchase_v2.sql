begin;

-- Preserve the optional purchase price supplied with each individual addition.
-- The collection row remains a convenient summary, while FIFO lots retain the
-- actual per-addition amounts instead of silently reusing the first purchase.
alter table public.collection_acquisition_lots
  add column if not exists purchase_unit_amount numeric(14,2),
  add column if not exists purchase_currency public.currency_code;

do $ddl$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.collection_acquisition_lots'::regclass
      and constraint_row.conname = 'collection_acquisition_lot_purchase_pair'
  ) then
    alter table public.collection_acquisition_lots
      add constraint collection_acquisition_lot_purchase_pair check (
        (purchase_unit_amount is null and purchase_currency is null)
        or (
          purchase_unit_amount is not null
          and purchase_currency is not null
          and purchase_unit_amount >= 0
          and purchase_unit_amount < 1000000000000
        )
      ) not valid;
  end if;
end;
$ddl$;

alter table public.collection_acquisition_lots
  validate constraint collection_acquisition_lot_purchase_pair;

-- PostgreSQL fires BEFORE INSERT triggers before resolving ON CONFLICT. This
-- transaction-local context therefore carries the proposed addition's price
-- into the positive-delta lot trigger for both a new holding and a merge. A
-- plain quantity update has no INSERT context and correctly records null.
create or replace function private.stage_collection_lot_purchase_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'tcg_harbor.purchase_unit_amount',
    coalesce(new.purchase_unit_amount::text, ''),
    true
  );
  perform pg_catalog.set_config(
    'tcg_harbor.purchase_currency',
    coalesce(new.purchase_currency::text, ''),
    true
  );
  return new;
end;
$$;

drop trigger if exists collection_lot_purchase_context on public.collection_items;
create trigger collection_lot_purchase_context
  before insert on public.collection_items
  for each row execute function private.stage_collection_lot_purchase_context();

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
  v_purchase_unit_amount numeric(14,2);
  v_purchase_currency public.currency_code;
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

  v_purchase_unit_amount := nullif(
    pg_catalog.current_setting('tcg_harbor.purchase_unit_amount', true),
    ''
  )::numeric(14,2);
  v_purchase_currency := nullif(
    pg_catalog.current_setting('tcg_harbor.purchase_currency', true),
    ''
  )::public.currency_code;

  if (v_purchase_unit_amount is null) <> (v_purchase_currency is null) then
    v_purchase_unit_amount := null;
    v_purchase_currency := null;
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
    purchase_unit_amount,
    purchase_currency,
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
    v_purchase_unit_amount,
    v_purchase_currency,
    transaction_timestamp()
  );

  return new;
end;
$$;

-- Market feeds used by TCG Harbor publish one verified product-level reference
-- for a card printing. The reference is intentionally not a synthetic
-- condition-adjusted price. Prefer a future exact-condition mapping when one
-- exists; otherwise use the verified Near Mint product reference for every
-- non-sealed card condition. Sealed products remain exact-condition only.
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
      and (
        mapping.condition = new.condition
        or (
          new.card_variant_id is not null
          and mapping.condition = 'near_mint'::public.item_condition
        )
      )
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
      and (
        quote.condition = new.condition
        or (
          new.card_variant_id is not null
          and quote.condition = 'near_mint'::public.item_condition
        )
      )
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
    order by
      (quote.condition = new.condition) desc,
      quote.fetched_at desc,
      quote.cached_at desc,
      quote.created_at desc,
      quote.id desc
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
      and (
        snapshot.condition = new.condition
        or (
          new.card_variant_id is not null
          and snapshot.condition = 'near_mint'::public.item_condition
        )
      )
      and snapshot.language = new.language
      and mapping.created_at <= new.captured_at
      and mapping.verified_at is not null
      and mapping.verified_at <= new.captured_at
      and (mapping.disabled_at is null or mapping.disabled_at > new.captured_at)
      and snapshot.observed_at <= new.captured_at
      and snapshot.created_at <= new.captured_at
    order by
      (snapshot.condition = new.condition) desc,
      snapshot.observed_at desc,
      snapshot.created_at desc,
      snapshot.id desc
    limit 1
  ) latest_snapshot on latest_quote.id is null;

  return new;
end;
$$;

-- Backfill only references that were absent because older trigger versions
-- required an exact condition mapping. Point-in-time safeguards prevent a
-- price published after the acquisition from being substituted retroactively.
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
  lot.id,
  eligible.provider_id,
  null,
  coalesce(latest_snapshot.currency, eligible.native_currency),
  latest_snapshot.market_value,
  null,
  null,
  case
    when eligible.provider_slug = 'cardmarket' then latest_snapshot.market_value
    else null
  end,
  latest_snapshot.observed_at,
  case
    when latest_snapshot.id is null or latest_snapshot.market_value is null
      then 'unavailable'::public.quote_freshness
    else 'fresh'::public.quote_freshness
  end,
  latest_snapshot.data_mode,
  lot.captured_at
from public.collection_acquisition_lots lot
join lateral (
  select distinct
    mapping.provider_id,
    provider.slug as provider_slug,
    provider.native_currency
  from public.provider_catalog_mappings mapping
  join public.pricing_providers provider on provider.id = mapping.provider_id
  where provider.is_enabled
    and provider.data_mode = 'live'
    and mapping.created_at <= lot.captured_at
    and mapping.verified_at is not null
    and mapping.verified_at <= lot.captured_at
    and (mapping.disabled_at is null or mapping.disabled_at > lot.captured_at)
    and (
      mapping.condition = lot.condition
      or (
        lot.card_variant_id is not null
        and mapping.condition = 'near_mint'::public.item_condition
      )
    )
    and mapping.language = lot.language
    and mapping.card_variant_id is not distinct from lot.card_variant_id
    and mapping.sealed_product_id is not distinct from lot.sealed_product_id
) eligible on true
left join lateral (
  select snapshot.*
  from public.price_snapshots snapshot
  join public.provider_catalog_mappings mapping on mapping.id = snapshot.mapping_id
  where snapshot.provider_id = eligible.provider_id
    and snapshot.data_mode = 'live'
    and snapshot.card_variant_id is not distinct from lot.card_variant_id
    and snapshot.sealed_product_id is not distinct from lot.sealed_product_id
    and (
      snapshot.condition = lot.condition
      or (
        lot.card_variant_id is not null
        and snapshot.condition = 'near_mint'::public.item_condition
      )
    )
    and snapshot.language = lot.language
    and mapping.created_at <= lot.captured_at
    and mapping.verified_at is not null
    and mapping.verified_at <= lot.captured_at
    and (mapping.disabled_at is null or mapping.disabled_at > lot.captured_at)
    and snapshot.observed_at <= lot.captured_at
    and snapshot.created_at <= lot.captured_at
  order by
    (snapshot.condition = lot.condition) desc,
    snapshot.observed_at desc,
    snapshot.created_at desc,
    snapshot.id desc
  limit 1
) latest_snapshot on true
where not exists (
  select 1
  from public.collection_acquisition_market_references existing
  where existing.acquisition_lot_id = lot.id
    and existing.provider_id = eligible.provider_id
)
on conflict (acquisition_lot_id, provider_id) do nothing;

-- Daily values are calculated on remaining FIFO lot units so current and
-- acquisition values always cover the same copies. Missing prices produce an
-- honest partial total plus coverage counts; one unavailable item can no
-- longer erase the value of every priced item.
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tcg-harbor-daily-valuation:' || p_snapshot_date::text, 11)
  );

  with enabled_providers as (
    select provider.id, provider.slug, provider.native_currency
    from public.pricing_providers provider
    where provider.is_enabled
      and provider.data_mode = 'live'
  ),
  lot_remaining as (
    select
      lot.id as acquisition_lot_id,
      lot.collection_item_id,
      lot.owner_id,
      lot.card_variant_id,
      lot.sealed_product_id,
      lot.condition,
      lot.language,
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
  valuation_lines as (
    select
      lot.owner_id,
      lot.collection_item_id,
      lot.remaining_quantity,
      provider.id as provider_id,
      provider.native_currency as currency,
      current_price.market_value as current_market_value,
      case
        when provider.slug = 'cardmarket'
          then coalesce(reference.trend_value, reference.market_value)
        else reference.market_value
      end as acquisition_market_value,
      current_price.observed_at
    from lot_remaining lot
    cross join enabled_providers provider
    left join public.collection_acquisition_market_references reference
      on reference.acquisition_lot_id = lot.acquisition_lot_id
      and reference.provider_id = provider.id
      and reference.currency = provider.native_currency
    left join lateral (
      select snapshot.market_value, snapshot.observed_at
      from public.price_snapshots snapshot
      join public.provider_catalog_mappings mapping on mapping.id = snapshot.mapping_id
      where snapshot.provider_id = provider.id
        and snapshot.data_mode = 'live'
        and snapshot.card_variant_id is not distinct from lot.card_variant_id
        and snapshot.sealed_product_id is not distinct from lot.sealed_product_id
        and (
          snapshot.condition = lot.condition
          or (
            lot.card_variant_id is not null
            and snapshot.condition = 'near_mint'::public.item_condition
          )
        )
        and snapshot.language = lot.language
        and mapping.created_at < v_cutoff
        and mapping.verified_at is not null
        and mapping.verified_at < v_cutoff
        and (mapping.disabled_at is null or mapping.disabled_at >= v_cutoff)
        and snapshot.observed_at < v_cutoff
        and snapshot.created_at < v_cutoff
      order by
        (snapshot.condition = lot.condition) desc,
        snapshot.observed_at desc,
        snapshot.created_at desc,
        snapshot.id desc
      limit 1
    ) current_price on true
    where lot.remaining_quantity > 0
  ),
  aggregates as (
    select
      line.owner_id,
      line.provider_id,
      line.currency,
      count(distinct line.collection_item_id)::integer as item_count,
      sum(line.remaining_quantity)::bigint as unit_count,
      sum(
        case
          when line.current_market_value is not null
            and line.acquisition_market_value is not null
            then line.remaining_quantity
          else 0
        end
      )::bigint as matched_unit_count,
      round(sum(
        line.remaining_quantity * line.current_market_value
      ) filter (
        where line.current_market_value is not null
          and line.acquisition_market_value is not null
      ), 2) as market_value,
      round(sum(
        line.remaining_quantity * line.acquisition_market_value
      ) filter (
        where line.current_market_value is not null
          and line.acquisition_market_value is not null
      ), 2) as acquisition_value,
      round(sum(
        line.remaining_quantity
          * (line.current_market_value - line.acquisition_market_value)
      ) filter (
        where line.current_market_value is not null
          and line.acquisition_market_value is not null
      ), 2) as absolute_growth,
      max(line.observed_at) filter (
        where line.current_market_value is not null
          and line.acquisition_market_value is not null
      ) as latest_price_observed_at
    from valuation_lines line
    group by line.owner_id, line.provider_id, line.currency
  ),
  valuations as (
    select
      summary.owner_id,
      summary.provider_id,
      summary.currency,
      summary.market_value,
      summary.acquisition_value,
      summary.absolute_growth,
      case
        when summary.acquisition_value > 0 then round(
          (summary.absolute_growth / summary.acquisition_value) * 100,
          6
        )
        else null
      end as growth_percentage,
      summary.item_count,
      summary.unit_count,
      summary.matched_unit_count as priced_unit_count,
      summary.unit_count - summary.matched_unit_count as unpriced_unit_count,
      summary.matched_unit_count as acquisition_priced_unit_count,
      summary.unit_count - summary.matched_unit_count
        as acquisition_unpriced_unit_count,
      summary.latest_price_observed_at
    from aggregates summary
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

revoke execute on function public.capture_collection_acquisition_market_references()
  from public, anon, authenticated;
revoke execute on function public.capture_collection_acquisition_lot()
  from public, anon, authenticated;
revoke execute on function private.stage_collection_lot_purchase_context()
  from public, anon, authenticated, service_role;
revoke execute on function private.capture_collection_daily_valuations_after_prices(date)
  from public, anon, authenticated, service_role;

commit;
