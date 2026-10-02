-- Migration: 20261002180000_card_borrowing_and_lending.sql
-- Enables community card borrow requests, multi-member lending offers,
-- loan agreements, and mutual two-party return confirmation.

-- 1. Extend trade_posts constraint to permit borrow_card
alter table public.trade_posts
  drop constraint if exists trade_posts_post_kind;

alter table public.trade_posts
  add constraint trade_posts_post_kind check (
    post_kind in ('offering_card', 'seeking_card', 'borrow_card')
  );

-- 2. Update create_community_trade_post_v6 to support borrow_card
create or replace function public.create_community_trade_post_v6(
  p_community_id uuid,
  p_post_kind text,
  p_exchange_mode text,
  p_primary_collection_item_id uuid default null,
  p_primary_card_variant_id uuid default null,
  p_specific_collection_item_id uuid default null,
  p_specific_card_variant_id uuid default null,
  p_quantity integer default 1,
  p_desired_condition public.item_condition default 'near_mint',
  p_cash_amount_cents integer default null,
  p_notes text default null,
  p_client_request_id uuid default extensions.gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_trade_post_id uuid;
  v_owned public.collection_items%rowtype;
  v_specific_owned public.collection_items%rowtype;
  v_primary_variant public.card_variants%rowtype;
  v_specific_variant public.card_variants%rowtype;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;
  if not exists (
    select 1 from public.app_users app_user
    where app_user.id = v_uid and app_user.status = 'active'
  ) then
    raise exception 'An active account is required';
  end if;
  if not private.is_active_community_member(p_community_id, v_uid) then
    raise exception 'Active community membership required';
  end if;
  if p_post_kind not in ('offering_card', 'seeking_card', 'borrow_card') then
    raise exception 'Invalid trade post kind';
  end if;
  if p_exchange_mode not in ('money', 'any_card', 'specific_card', 'open') then
    raise exception 'Invalid exchange mode';
  end if;
  if p_quantity not between 1 and 100000 then
    raise exception 'Quantity must be between 1 and 100000';
  end if;
  if p_cash_amount_cents is not null
     and p_cash_amount_cents not between 0 and 100000000 then
    raise exception 'Cash amount is outside the supported range';
  end if;
  if p_exchange_mode = 'money'
     and p_post_kind = 'offering_card'
     and p_cash_amount_cents is null then
    raise exception 'An asking amount is required; use zero for a giveaway';
  end if;
  if p_exchange_mode <> 'money' and p_cash_amount_cents is not null then
    raise exception 'Cash amount is only valid for money posts';
  end if;

  if p_post_kind = 'offering_card' then
    if p_primary_collection_item_id is null
       or p_primary_card_variant_id is not null
       or p_specific_collection_item_id is not null then
      raise exception 'Offering posts require one owned primary card';
    end if;

    select collection_item.*
    into v_owned
    from public.collection_items collection_item
    where collection_item.id = p_primary_collection_item_id
      and collection_item.owner_id = v_uid
      and collection_item.card_variant_id is not null
      and collection_item.sealed_product_id is null
      and collection_item.deleted_at is null
    for update;

    if not found then
      raise exception 'The offered card is not in the active collection';
    end if;
    if p_quantity > v_owned.quantity then
      raise exception 'Offered quantity exceeds the active collection quantity';
    end if;
    if v_owned.language = 'DE' then
      raise exception 'German One Piece card versions are not supported';
    end if;

    if p_exchange_mode = 'specific_card' then
      if p_specific_card_variant_id is null then
        raise exception 'Choose the specific card wanted in return';
      end if;
      select variant.*
      into v_specific_variant
      from public.card_variants variant
      join public.cards card on card.id = variant.card_id
      join public.card_sets card_set
        on card_set.id = card.card_set_id and card_set.game_id = card.game_id
      where variant.id = p_specific_card_variant_id
        and variant.archived_at is null
        and card.archived_at is null
        and card_set.archived_at is null;
      if not found then
        raise exception 'The wanted card printing is unavailable';
      end if;
      if v_specific_variant.language = 'DE' then
        raise exception 'German One Piece card versions are not supported';
      end if;
      if v_specific_variant.id = v_owned.card_variant_id then
        raise exception 'The offered and wanted card must be different';
      end if;
    elsif p_specific_card_variant_id is not null then
      raise exception 'A specific wanted card is only valid for specific-card posts';
    end if;
  else
    if p_primary_card_variant_id is null
       or p_primary_collection_item_id is not null
       or p_specific_card_variant_id is not null then
      raise exception 'Seeking and borrow posts require one wanted catalog card';
    end if;

    select variant.*
    into v_primary_variant
    from public.card_variants variant
    join public.cards card on card.id = variant.card_id
    join public.card_sets card_set
      on card_set.id = card.card_set_id and card_set.game_id = card.game_id
    where variant.id = p_primary_card_variant_id
      and variant.archived_at is null
      and card.archived_at is null
      and card_set.archived_at is null;

    if not found then
      raise exception 'The wanted card printing is unavailable';
    end if;
    if v_primary_variant.language = 'DE' then
      raise exception 'German One Piece card versions are not supported';
    end if;

    if p_exchange_mode = 'specific_card' then
      if p_specific_collection_item_id is null then
        raise exception 'Choose the specific owned card offered in return';
      end if;
      select collection_item.*
      into v_specific_owned
      from public.collection_items collection_item
      where collection_item.id = p_specific_collection_item_id
        and collection_item.owner_id = v_uid
        and collection_item.card_variant_id is not null
        and collection_item.sealed_product_id is null
        and collection_item.deleted_at is null
      for update;
      if not found then
        raise exception 'The offered return card is not in the active collection';
      end if;
      if v_specific_owned.language = 'DE' then
        raise exception 'German One Piece card versions are not supported';
      end if;
      if v_specific_owned.card_variant_id = v_primary_variant.id then
        raise exception 'The wanted and offered return card must be different';
      end if;
    elsif p_specific_collection_item_id is not null then
      raise exception 'An owned return card is only valid for specific-card posts';
    end if;
  end if;

  insert into public.trade_posts (
    community_id,
    author_id,
    status,
    notes,
    meetup_preference,
    client_request_id,
    post_kind,
    exchange_mode,
    cash_amount_cents,
    cash_currency
  ) values (
    p_community_id,
    v_uid,
    'open',
    public.normalize_user_text(p_notes),
    'at_store',
    p_client_request_id,
    p_post_kind,
    p_exchange_mode,
    case when p_exchange_mode = 'money' then p_cash_amount_cents else null end,
    case when p_exchange_mode = 'money' then 'EUR'::public.currency_code else null end
  )
  returning id into v_trade_post_id;

  if p_post_kind = 'offering_card' then
    insert into public.trade_post_offered_items (
      trade_post_id,
      source_collection_item_id,
      card_variant_id,
      quantity,
      condition,
      language
    ) values (
      v_trade_post_id,
      v_owned.id,
      v_owned.card_variant_id,
      p_quantity,
      v_owned.condition,
      v_owned.language
    );

    if p_exchange_mode = 'specific_card' then
      insert into public.trade_post_wanted_items (
        trade_post_id,
        card_variant_id,
        quantity,
        desired_condition,
        desired_language
      ) values (
        v_trade_post_id,
        v_specific_variant.id,
        1,
        p_desired_condition,
        v_specific_variant.language
      );
    end if;
  else
    insert into public.trade_post_wanted_items (
      trade_post_id,
      card_variant_id,
      quantity,
      desired_condition,
      desired_language
    ) values (
      v_trade_post_id,
      v_primary_variant.id,
      p_quantity,
      p_desired_condition,
      v_primary_variant.language
    );

    if p_exchange_mode = 'specific_card' then
      insert into public.trade_post_offered_items (
        trade_post_id,
        source_collection_item_id,
        card_variant_id,
        quantity,
        condition,
        language
      ) values (
        v_trade_post_id,
        v_specific_owned.id,
        v_specific_owned.card_variant_id,
        1,
        v_specific_owned.condition,
        v_specific_owned.language
      );
    end if;
  end if;

  insert into public.activity_logs (
    user_id,
    actor_id,
    community_id,
    activity_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_uid,
    v_uid,
    p_community_id,
    'trade_post_created',
    'trade_post',
    v_trade_post_id,
    jsonb_build_object(
      'post_kind', p_post_kind,
      'exchange_mode', p_exchange_mode
    )
  );

  return v_trade_post_id;
end;
$$;

-- 3. Create community_card_lending_offers table
create table if not exists public.community_card_lending_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  trade_post_id uuid not null references public.trade_posts(id) on delete cascade,
  lender_id uuid not null references public.app_users(id) on delete cascade,
  lender_collection_item_id uuid references public.collection_items(id) on delete set null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint community_card_lending_offers_unique unique (trade_post_id, lender_id)
);

create index if not exists community_card_lending_offers_post_idx
  on public.community_card_lending_offers(trade_post_id, created_at desc);

create index if not exists community_card_lending_offers_lender_idx
  on public.community_card_lending_offers(lender_id, created_at desc);

alter table public.community_card_lending_offers enable row level security;

create policy community_card_lending_offers_select on public.community_card_lending_offers
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_posts post
      where post.id = trade_post_id
        and private.is_active_community_member(post.community_id, (select auth.uid()))
    )
  );

create policy community_card_lending_offers_insert on public.community_card_lending_offers
  for insert to authenticated
  with check (
    lender_id = (select auth.uid())
    and exists (
      select 1 from public.trade_posts post
      where post.id = trade_post_id
        and post.post_kind = 'borrow_card'
        and post.status = 'open'
        and post.author_id <> (select auth.uid())
        and private.is_active_community_member(post.community_id, (select auth.uid()))
    )
  );

create policy community_card_lending_offers_update on public.community_card_lending_offers
  for update to authenticated
  using (
    lender_id = (select auth.uid())
    or exists (
      select 1 from public.trade_posts post
      where post.id = trade_post_id
        and post.author_id = (select auth.uid())
    )
  );

-- 4. Create community_card_loans table
create table if not exists public.community_card_loans (
  id uuid primary key default extensions.gen_random_uuid(),
  trade_post_id uuid references public.trade_posts(id) on delete set null,
  community_id uuid not null references public.communities(id) on delete cascade,
  lender_id uuid not null references public.app_users(id) on delete cascade,
  borrower_id uuid not null references public.app_users(id) on delete cascade,
  card_variant_id uuid not null references public.card_variants(id) on delete restrict,
  condition public.item_condition not null default 'near_mint',
  language public.language_code not null default 'EN',
  quantity integer not null default 1,
  source_collection_item_id uuid references public.collection_items(id) on delete set null,
  lent_at timestamptz not null default now(),
  lent_value_amount numeric(14,2) not null,
  lent_value_currency public.currency_code not null default 'EUR',
  lender_returned_at timestamptz,
  borrower_returned_at timestamptz,
  status text not null default 'active' check (status in ('active', 'returned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_card_loans_users_idx
  on public.community_card_loans(lender_id, borrower_id, status);

create index if not exists community_card_loans_borrower_idx
  on public.community_card_loans(borrower_id, status);

create index if not exists community_card_loans_lender_idx
  on public.community_card_loans(lender_id, status);

alter table public.community_card_loans enable row level security;

create policy community_card_loans_select on public.community_card_loans
  for select to authenticated
  using (
    lender_id = (select auth.uid())
    or borrower_id = (select auth.uid())
    or exists (
      select 1 from public.community_memberships mem
      where mem.community_id = community_id
        and mem.user_id = (select auth.uid())
        and mem.role in ('moderator', 'administrator')
        and mem.status = 'active'
    )
  );

create policy community_card_loans_update on public.community_card_loans
  for update to authenticated
  using (
    lender_id = (select auth.uid())
    or borrower_id = (select auth.uid())
  );

-- 5. RPC Functions for Offers, Acceptance, and Mutual Return
create or replace function public.offer_to_lend_card_v1(
  p_trade_post_id uuid,
  p_collection_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.trade_posts%rowtype;
  v_offer_id uuid;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;

  select * into v_post
  from public.trade_posts
  where id = p_trade_post_id and deleted_at is null;

  if not found then
    raise exception 'Trade post not found';
  end if;

  if v_post.post_kind <> 'borrow_card' then
    raise exception 'This post is not requesting a card loan';
  end if;

  if v_post.author_id = v_uid then
    raise exception 'You cannot lend a card to your own request';
  end if;

  if v_post.status <> 'open' then
    raise exception 'This borrow post is no longer accepting offers';
  end if;

  insert into public.community_card_lending_offers (
    trade_post_id,
    lender_id,
    lender_collection_item_id,
    status
  ) values (
    p_trade_post_id,
    v_uid,
    p_collection_item_id,
    'offered'
  )
  on conflict (trade_post_id, lender_id)
  do update set
    lender_collection_item_id = excluded.lender_collection_item_id,
    status = 'offered',
    created_at = now()
  returning id into v_offer_id;

  return v_offer_id;
end;
$$;

create or replace function public.accept_lending_offer_v1(
  p_offer_id uuid,
  p_lent_value_amount numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.community_card_lending_offers%rowtype;
  v_post public.trade_posts%rowtype;
  v_wanted public.trade_post_wanted_items%rowtype;
  v_loan_id uuid;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;

  select * into v_offer
  from public.community_card_lending_offers
  where id = p_offer_id;

  if not found then
    raise exception 'Lending offer not found';
  end if;

  select * into v_post
  from public.trade_posts
  where id = v_offer.trade_post_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Associated trade post not found';
  end if;

  if v_post.author_id <> v_uid then
    raise exception 'Only the post author can select a lender';
  end if;

  if v_post.status <> 'open' then
    raise exception 'This post has already been closed or completed';
  end if;

  select * into v_wanted
  from public.trade_post_wanted_items
  where trade_post_id = v_post.id
  limit 1;

  if not found then
    raise exception 'Post has no specified wanted card printing';
  end if;

  -- 1. Create the loan record
  insert into public.community_card_loans (
    trade_post_id,
    community_id,
    lender_id,
    borrower_id,
    card_variant_id,
    condition,
    language,
    quantity,
    source_collection_item_id,
    lent_at,
    lent_value_amount,
    lent_value_currency,
    status
  ) values (
    v_post.id,
    v_post.community_id,
    v_offer.lender_id,
    v_post.author_id,
    v_wanted.card_variant_id,
    coalesce(v_wanted.desired_condition, 'near_mint'),
    coalesce(v_wanted.desired_language, 'EN'),
    coalesce(v_wanted.quantity, 1),
    v_offer.lender_collection_item_id,
    now(),
    greatest(coalesce(p_lent_value_amount, 0), 0),
    'EUR',
    'active'
  )
  returning id into v_loan_id;

  -- 2. Mark this offer accepted, decline any others
  update public.community_card_lending_offers
  set status = 'accepted'
  where id = p_offer_id;

  update public.community_card_lending_offers
  set status = 'declined'
  where trade_post_id = v_post.id and id <> p_offer_id;

  -- 3. Close the trade post
  update public.trade_posts
  set status = 'completed'
  where id = v_post.id;

  -- 4. Activity log
  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id, metadata
  ) values (
    v_post.author_id,
    v_uid,
    v_post.community_id,
    'trade_loan_created',
    'community_card_loan',
    v_loan_id,
    jsonb_build_object(
      'lender_id', v_offer.lender_id,
      'borrower_id', v_post.author_id,
      'post_id', v_post.id
    )
  );

  return v_loan_id;
end;
$$;

create or replace function public.confirm_card_return_v1(
  p_loan_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_loan public.community_card_loans%rowtype;
  v_is_lender boolean;
  v_is_borrower boolean;
  v_lender_confirmed boolean;
  v_borrower_confirmed boolean;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;

  select * into v_loan
  from public.community_card_loans
  where id = p_loan_id
  for update;

  if not found then
    raise exception 'Loan record not found';
  end if;

  if v_loan.status = 'returned' then
    return 'already_returned';
  end if;

  v_is_lender := (v_loan.lender_id = v_uid);
  v_is_borrower := (v_loan.borrower_id = v_uid);

  if not (v_is_lender or v_is_borrower) then
    raise exception 'Only the lender or borrower can confirm return';
  end if;

  if v_is_lender then
    v_loan.lender_returned_at := coalesce(v_loan.lender_returned_at, now());
  end if;

  if v_is_borrower then
    v_loan.borrower_returned_at := coalesce(v_loan.borrower_returned_at, now());
  end if;

  v_lender_confirmed := (v_loan.lender_returned_at is not null);
  v_borrower_confirmed := (v_loan.borrower_returned_at is not null);

  if v_lender_confirmed and v_borrower_confirmed then
    update public.community_card_loans
    set
      lender_returned_at = v_loan.lender_returned_at,
      borrower_returned_at = v_loan.borrower_returned_at,
      status = 'returned',
      updated_at = now()
    where id = p_loan_id;

    insert into public.activity_logs (
      user_id, actor_id, community_id, activity_type, entity_type, entity_id, metadata
    ) values (
      v_loan.lender_id,
      v_uid,
      v_loan.community_id,
      'trade_loan_returned',
      'community_card_loan',
      p_loan_id,
      jsonb_build_object('borrower_id', v_loan.borrower_id)
    );

    return 'fully_returned';
  else
    update public.community_card_loans
    set
      lender_returned_at = v_loan.lender_returned_at,
      borrower_returned_at = v_loan.borrower_returned_at,
      updated_at = now()
    where id = p_loan_id;

    return 'partially_returned';
  end if;
end;
$$;

-- Grants
grant select, insert, update on public.community_card_lending_offers to authenticated;
grant select, update on public.community_card_loans to authenticated;
grant execute on function public.offer_to_lend_card_v1(uuid, uuid) to authenticated;
grant execute on function public.accept_lending_offer_v1(uuid, numeric) to authenticated;
grant execute on function public.confirm_card_return_v1(uuid) to authenticated;

-- Add to realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_card_lending_offers'
    ) then
      execute 'alter publication supabase_realtime add table public.community_card_lending_offers';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_card_loans'
    ) then
      execute 'alter publication supabase_realtime add table public.community_card_loans';
    end if;
  end if;
exception when others then
  null;
end $$;
