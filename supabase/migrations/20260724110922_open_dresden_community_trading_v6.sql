-- TCG Harbor: open Dresden test community and account-scoped trading v6.
--
-- The test community is intentionally joinable without a physical QR. Trade
-- posts remain member-only and are created atomically through narrow RPCs.
-- Money is represented as exact EUR cents; zero on an offering post means a
-- free giveaway. Offered cards must resolve to the author's live collection.

begin;

alter table public.communities
  add column join_mode text not null default 'qr',
  add constraint communities_join_mode check (join_mode in ('qr', 'open'));

comment on column public.communities.join_mode is
  'qr requires an active physical-store code; open permits a signed-in active account to join directly.';

alter table public.trade_posts
  add column post_kind text not null default 'offering_card',
  add column exchange_mode text not null default 'specific_card',
  add column cash_amount_cents integer,
  add column cash_currency public.currency_code,
  add constraint trade_posts_post_kind check (
    post_kind in ('offering_card', 'seeking_card')
  ),
  add constraint trade_posts_exchange_mode check (
    exchange_mode in ('money', 'any_card', 'specific_card', 'open')
  ),
  add constraint trade_posts_cash_terms check (
    (
      exchange_mode = 'money'
      and cash_currency = 'EUR'
      and cash_amount_cents between 0 and 100000000
    )
    or
    (
      exchange_mode = 'money'
      and post_kind = 'seeking_card'
      and cash_currency = 'EUR'
      and cash_amount_cents is null
    )
    or
    (
      exchange_mode <> 'money'
      and cash_amount_cents is null
      and cash_currency is null
    )
  );

comment on column public.trade_posts.post_kind is
  'offering_card advertises an owned card; seeking_card advertises a wanted catalog card.';
comment on column public.trade_posts.exchange_mode is
  'money, any_card, specific_card, or open. The meaning is read together with post_kind.';
comment on column public.trade_posts.cash_amount_cents is
  'Exact EUR cents. Zero on an offering_card money post is a free giveaway; null is allowed only for an unspecified seeking-card budget.';

create or replace function public.guard_trade_post_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.community_id <> old.community_id
     or new.author_id <> old.author_id
     or new.post_kind <> old.post_kind
     or new.exchange_mode <> old.exchange_mode
     or new.cash_amount_cents is distinct from old.cash_amount_cents
     or new.cash_currency is distinct from old.cash_currency
     or new.created_at <> old.created_at
     or new.client_request_id <> old.client_request_id then
    raise exception 'Trade ownership, community, and terms are immutable';
  end if;
  new.notes := public.normalize_user_text(new.notes);
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := statement_timestamp();
  elsif new.status <> 'completed' then
    new.completed_at := old.completed_at;
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_at := statement_timestamp();
  elsif new.status <> 'closed' then
    new.closed_at := old.closed_at;
  end if;
  return new;
end;
$$;

create or replace function public.join_open_community_v6(p_community_id uuid)
returns table (outcome text, community_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_store_id uuid;
  v_name text;
  v_existing_status public.membership_status;
  v_reactivated boolean := false;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;
  if not exists (
    select 1
    from public.app_users app_user
    where app_user.id = v_uid and app_user.status = 'active'
  ) then
    raise exception 'An active account is required';
  end if;

  select community.store_id, community.name
  into v_store_id, v_name
  from public.communities community
  join public.stores store on store.id = community.store_id
  where community.id = p_community_id
    and community.join_mode = 'open'
    and community.is_active
    and community.deleted_at is null
    and store.is_verified
    and store.is_active
    and store.deleted_at is null
  for update of community;

  if not found then
    raise exception 'Open community not found';
  end if;

  select membership.status
  into v_existing_status
  from public.community_memberships membership
  where membership.community_id = p_community_id
    and membership.user_id = v_uid
  for update;

  if found and v_existing_status = 'active' then
    return query select 'already_member'::text, p_community_id;
    return;
  elsif found and v_existing_status = 'suspended' then
    raise exception 'This membership is suspended';
  elsif found and v_existing_status = 'left' then
    update public.community_memberships membership
    set role = case
          when private.is_store_administrator(v_store_id, v_uid)
            then 'moderator'::public.membership_role
          else 'member'::public.membership_role
        end,
        status = 'active',
        joined_via_code_id = null,
        joined_at = statement_timestamp(),
        last_read_chat_at = null,
        suspended_at = null,
        suspended_by = null,
        suspension_reason = null,
        suspension_authority = null,
        left_at = null
    where membership.community_id = p_community_id
      and membership.user_id = v_uid;
    v_reactivated := true;
  else
    insert into public.community_memberships (
      community_id, user_id, role, status, joined_via_code_id
    ) values (
      p_community_id,
      v_uid,
      case
        when private.is_store_administrator(v_store_id, v_uid)
          then 'moderator'::public.membership_role
        else 'member'::public.membership_role
      end,
      'active',
      null
    );
  end if;

  insert into public.notifications (
    user_id, kind, title, body, community_id, action_url, metadata
  ) values (
    v_uid,
    'community_joined',
    case when v_reactivated then 'Community rejoined' else 'Community joined' end,
    v_name,
    p_community_id,
    '/communities/' || p_community_id::text,
    jsonb_build_object('join_method', 'open')
  );

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id, metadata
  ) values (
    v_uid,
    v_uid,
    p_community_id,
    case when v_reactivated then 'community_rejoined' else 'community_joined' end,
    'community',
    p_community_id,
    jsonb_build_object('join_method', 'open')
  );

  return query
    select case when v_reactivated then 'rejoined' else 'joined' end, p_community_id;
end;
$$;

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
  if p_post_kind not in ('offering_card', 'seeking_card') then
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
      raise exception 'Seeking posts require one wanted catalog card';
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

create or replace function public.set_community_trade_post_status_v6(
  p_trade_post_id uuid,
  p_status public.trade_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.trade_posts%rowtype;
begin
  select trade_post.*
  into v_post
  from public.trade_posts trade_post
  where trade_post.id = p_trade_post_id
    and trade_post.deleted_at is null
  for update;

  if not found then
    raise exception 'Trade post not found';
  end if;
  if auth.uid() is null
     or (
       v_post.author_id <> auth.uid()
       and not private.can_moderate_community(v_post.community_id, auth.uid())
     ) then
    raise exception 'Trade author or community moderator access required';
  end if;

  update public.trade_posts
  set status = p_status
  where id = p_trade_post_id;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id, metadata
  ) values (
    v_post.author_id,
    auth.uid(),
    v_post.community_id,
    'trade_status_changed',
    'trade_post',
    v_post.id,
    jsonb_build_object('status', p_status::text)
  );
end;
$$;

-- One deterministic, approved test location at Dresden Frauenkirche.
insert into public.stores (
  id,
  slug,
  name,
  description,
  address_line_1,
  city,
  region,
  postcode,
  country_code,
  latitude,
  longitude,
  timezone,
  opening_hours,
  is_verified,
  is_active
) values (
  '5b46755e-4d45-4f8e-a5aa-d9b2ec8cd601',
  'test-dresden-community',
  'Test Dresden Community',
  'Open TCG Harbor test community for exercising local card trading flows. This is a test location, not a claim of a physical card retailer.',
  'An der Frauenkirche',
  'Dresden',
  'Saxony',
  '01067',
  'DE',
  51.05195,
  13.74161,
  'Europe/Berlin',
  '{}'::jsonb,
  true,
  true
)
on conflict (id) do update
set slug = excluded.slug,
    name = excluded.name,
    description = excluded.description,
    address_line_1 = excluded.address_line_1,
    city = excluded.city,
    region = excluded.region,
    postcode = excluded.postcode,
    country_code = excluded.country_code,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    timezone = excluded.timezone,
    is_verified = true,
    is_active = true,
    deleted_at = null;

insert into public.communities (
  id,
  store_id,
  name,
  description,
  rules,
  is_active,
  join_mode
) values (
  '5b46755e-4d45-4f8e-a5aa-d9b2ec8cd602',
  '5b46755e-4d45-4f8e-a5aa-d9b2ec8cd601',
  'Test Dresden Community',
  'An open Dresden community for testing card offers, wanted-card posts, giveaways, purchases, and card-for-card trades.',
  'Use test-friendly descriptions, inspect cards before any in-person exchange, and never publish payment credentials or private collection details.',
  true,
  'open'
)
on conflict (id) do update
set store_id = excluded.store_id,
    name = excluded.name,
    description = excluded.description,
    rules = excluded.rules,
    is_active = true,
    join_mode = 'open',
    deleted_at = null;

-- Direct multi-table writes could leave incomplete posts. The authenticated
-- client uses the atomic RPCs above; RLS remains the read boundary.
revoke insert, update, delete on table public.trade_posts from authenticated;
revoke insert, update, delete on table public.trade_post_offered_items from authenticated;
revoke insert, update, delete on table public.trade_post_wanted_items from authenticated;

revoke execute on function public.join_open_community_v6(uuid)
  from public, anon, authenticated;
revoke execute on function public.create_community_trade_post_v6(
  uuid, text, text, uuid, uuid, uuid, uuid, integer,
  public.item_condition, integer, text, uuid
) from public, anon, authenticated;
revoke execute on function public.set_community_trade_post_status_v6(
  uuid, public.trade_status
) from public, anon, authenticated;

grant execute on function public.join_open_community_v6(uuid)
  to authenticated;
grant execute on function public.create_community_trade_post_v6(
  uuid, text, text, uuid, uuid, uuid, uuid, integer,
  public.item_condition, integer, text, uuid
) to authenticated;
grant execute on function public.set_community_trade_post_status_v6(
  uuid, public.trade_status
) to authenticated;

commit;
