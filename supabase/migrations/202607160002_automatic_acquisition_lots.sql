-- Automatic acquisition dates and immutable acquisition-lot market snapshots.
--
-- Collection clients only choose an asset and quantity. The database owns the
-- acquisition date, records every positive inventory delta, and preserves the
-- latest provenance-backed live quote for each eligible provider at that time.

-- Existing rows predate the automatic date rule. Preserve their server-side
-- creation date when no acquisition date was recorded, then require a value.
update public.collection_items
set acquired_on = (created_at at time zone 'UTC')::date
where acquired_on is null;

alter table public.collection_items
  alter column acquired_on set default current_date,
  alter column acquired_on set not null;

create or replace function public.enforce_collection_acquired_on()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Deliberately ignore any date supplied by the client.
    new.acquired_on := current_date;
  else
    -- Once assigned by the server, the acquisition date is immutable.
    new.acquired_on := old.acquired_on;
  end if;
  return new;
end;
$$;

create trigger collection_acquired_on_guard
  before insert or update of acquired_on on public.collection_items
  for each row execute function public.enforce_collection_acquired_on();

create table public.collection_acquisition_lots (
  id bigint generated always as identity primary key,
  collection_item_id uuid not null references public.collection_items(id) on delete cascade,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  card_variant_id uuid references public.card_variants(id) on delete restrict,
  sealed_product_id uuid references public.sealed_products(id) on delete restrict,
  condition public.item_condition not null,
  language public.language_code not null,
  added_quantity integer not null,
  quantity_after integer not null,
  captured_at timestamptz not null default clock_timestamp(),
  constraint collection_acquisition_lots_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint collection_acquisition_lots_added_quantity_positive check (added_quantity > 0),
  constraint collection_acquisition_lots_quantity_after_valid check (
    quantity_after >= added_quantity and quantity_after between 1 and 100000
  )
);

create index collection_acquisition_lots_owner_time_idx
  on public.collection_acquisition_lots (owner_id, captured_at desc, id desc);
create index collection_acquisition_lots_item_time_idx
  on public.collection_acquisition_lots (collection_item_id, captured_at desc, id desc);

-- One row per eligible provider and acquisition lot. A verified mapping with no
-- quote yet is retained as an explicit null reference; unavailable provider
-- quotes likewise retain their nullable market values instead of inventing one.
create table public.collection_acquisition_market_references (
  id bigint generated always as identity primary key,
  acquisition_lot_id bigint not null
    references public.collection_acquisition_lots(id) on delete cascade,
  provider_id uuid not null references public.pricing_providers(id) on delete restrict,
  source_quote_id uuid references public.price_quotes(id) on delete set null,
  currency public.currency_code,
  market_value numeric(14,2),
  low_value numeric(14,2),
  average_value numeric(14,2),
  trend_value numeric(14,2),
  quote_fetched_at timestamptz,
  freshness public.quote_freshness,
  data_mode public.price_data_mode,
  captured_at timestamptz not null,
  constraint collection_acquisition_market_values_nonnegative check (
    (market_value is null or market_value >= 0)
    and (low_value is null or low_value >= 0)
    and (average_value is null or average_value >= 0)
    and (trend_value is null or trend_value >= 0)
  ),
  unique (acquisition_lot_id, provider_id)
);

create index collection_acquisition_market_refs_provider_idx
  on public.collection_acquisition_market_references (provider_id, captured_at desc);
create index collection_acquisition_market_refs_source_quote_idx
  on public.collection_acquisition_market_references (source_quote_id)
  where source_quote_id is not null;

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
    latest.id,
    coalesce(latest.currency, eligible.native_currency),
    latest.market_value,
    latest.low_value,
    latest.average_value,
    latest.trend_value,
    latest.fetched_at,
    latest.freshness,
    latest.data_mode,
    new.captured_at
  from (
    select distinct mapping.provider_id, provider.native_currency
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
    order by quote.fetched_at desc, quote.cached_at desc, quote.created_at desc, quote.id desc
    limit 1
  ) latest on true;

  return new;
end;
$$;

create trigger collection_acquisition_market_reference_capture
  after insert on public.collection_acquisition_lots
  for each row execute function public.capture_collection_acquisition_market_references();

create or replace function public.capture_collection_acquisition_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added_quantity integer;
begin
  if tg_op = 'INSERT' then
    v_added_quantity := new.quantity;
  else
    v_added_quantity := new.quantity - old.quantity;
  end if;

  -- Decreases and no-op updates are inventory history, not acquisitions.
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
    new.quantity,
    clock_timestamp()
  );

  return new;
end;
$$;

create trigger collection_acquisition_lot_capture
  after insert or update of quantity on public.collection_items
  for each row execute function public.capture_collection_acquisition_lot();

-- Reconstruct positive inventory deltas already recorded by the original audit
-- table. This is intentionally a one-time migration backfill; future lots are
-- written directly from collection_items in the same transaction as the add.
with ordered_history as (
  select
    history.id,
    history.collection_item_id,
    history.owner_id,
    history.quantity,
    history.effective_at,
    coalesce(
      lag(history.quantity) over (
        partition by history.collection_item_id
        order by history.effective_at, history.id
      ),
      0
    ) as previous_quantity
  from public.collection_quantity_history history
), positive_history as (
  select *
  from ordered_history
  where quantity > previous_quantity
)
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
)
select
  item.id,
  item.owner_id,
  item.card_variant_id,
  item.sealed_product_id,
  item.condition,
  item.language,
  history.quantity - history.previous_quantity,
  history.quantity,
  history.effective_at
from positive_history history
join public.collection_items item on item.id = history.collection_item_id;

-- A collection row should always have quantity history, but preserve any legacy
-- row that predates that trigger as one server-derived initial acquisition lot.
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
)
select
  item.id,
  item.owner_id,
  item.card_variant_id,
  item.sealed_product_id,
  item.condition,
  item.language,
  item.quantity,
  item.quantity,
  item.created_at
from public.collection_items item
where not exists (
  select 1
  from public.collection_acquisition_lots lot
  where lot.collection_item_id = item.id
);

-- One Piece has real English and Japanese catalog records, but no German card
-- printing. Keep DE in the shared enum for other games and reject only this
-- game's variants/sealed products at the catalog boundary.
create or replace function public.reject_one_piece_german_catalog_language()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_one_piece boolean;
begin
  if tg_table_name = 'card_variants' then
    select exists (
      select 1
      from public.cards card
      join public.games game on game.id = card.game_id
      where card.id = new.card_id
        and lower(game.slug) = 'one-piece-card-game'
    ) into v_is_one_piece;
  elsif tg_table_name = 'sealed_products' then
    select exists (
      select 1
      from public.games game
      where game.id = new.game_id
        and lower(game.slug) = 'one-piece-card-game'
    ) into v_is_one_piece;
  else
    raise exception 'Unsupported catalog table: %', tg_table_name;
  end if;

  if v_is_one_piece and new.language = 'DE' then
    raise exception using
      errcode = '23514',
      message = 'German is not a valid One Piece catalog printing language';
  end if;

  return new;
end;
$$;

create trigger card_variants_one_piece_language_guard
  before insert or update of card_id, language on public.card_variants
  for each row execute function public.reject_one_piece_german_catalog_language();

create trigger sealed_products_one_piece_language_guard
  before insert or update of game_id, language on public.sealed_products
  for each row execute function public.reject_one_piece_german_catalog_language();

-- Fail safely instead of silently relabeling any pre-existing German record.
do $$
begin
  if exists (
    select 1
    from public.card_variants variant
    join public.cards card on card.id = variant.card_id
    join public.games game on game.id = card.game_id
    where lower(game.slug) = 'one-piece-card-game'
      and variant.language = 'DE'
  ) or exists (
    select 1
    from public.sealed_products product
    join public.games game on game.id = product.game_id
    where lower(game.slug) = 'one-piece-card-game'
      and product.language = 'DE'
  ) then
    raise exception 'Existing German One Piece catalog records must be reviewed before this migration can complete';
  end if;
end;
$$;

alter table public.collection_acquisition_lots enable row level security;
alter table public.collection_acquisition_market_references enable row level security;

create policy collection_acquisition_lots_select_owner
  on public.collection_acquisition_lots
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy collection_acquisition_market_refs_select_owner
  on public.collection_acquisition_market_references
  for select to authenticated
  using (
    exists (
      select 1
      from public.collection_acquisition_lots lot
      where lot.id = acquisition_lot_id
        and lot.owner_id = (select auth.uid())
    )
  );

-- Acquisition audit rows are trigger-owned. Clients can read only their own
-- rows and receive no INSERT, UPDATE, or DELETE privilege or policy.
revoke all on public.collection_acquisition_lots,
  public.collection_acquisition_market_references from public, anon, authenticated;
grant select on public.collection_acquisition_lots,
  public.collection_acquisition_market_references to authenticated;

revoke execute on function public.enforce_collection_acquired_on()
  from public, anon, authenticated;
revoke execute on function public.capture_collection_acquisition_lot()
  from public, anon, authenticated;
revoke execute on function public.capture_collection_acquisition_market_references()
  from public, anon, authenticated;
revoke execute on function public.reject_one_piece_german_catalog_language()
  from public, anon, authenticated;
