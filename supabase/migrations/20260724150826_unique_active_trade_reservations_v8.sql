-- Reserve physical collection copies while a trade is active, and consume the
-- offered inventory when the author completes the trade. Closed posts release
-- their reservation; completed and closed posts remain immutable history.

begin;

create or replace function private.active_trade_reserved_quantity_v8(
  p_collection_item_id uuid,
  p_excluding_offered_item_id uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(offered.quantity), 0)::bigint
  from public.trade_post_offered_items offered
  join public.trade_posts post on post.id = offered.trade_post_id
  where offered.source_collection_item_id = p_collection_item_id
    and offered.id is distinct from p_excluding_offered_item_id
    and post.status in ('open', 'discussing')
    and post.deleted_at is null;
$$;

revoke all on function private.active_trade_reserved_quantity_v8(uuid, uuid)
  from public, anon, authenticated;

-- Replace the existing identity guard so every offered collection copy is
-- checked against reservations across all communities. Locking the collection
-- row serializes simultaneous submissions for the same physical holding.
create or replace function public.guard_trade_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_author uuid;
  v_post_status public.trade_status;
  v_post_deleted_at timestamptz;
  v_source public.collection_items%rowtype;
  v_source_id uuid;
  v_old_source_id uuid;
  v_reserved bigint;
  v_available bigint;
begin
  v_source_id := nullif(to_jsonb(new) ->> 'source_collection_item_id', '')::uuid;
  if tg_op = 'UPDATE' then
    v_old_source_id := nullif(to_jsonb(old) ->> 'source_collection_item_id', '')::uuid;
  end if;

  select post.author_id, post.status, post.deleted_at
  into v_author, v_post_status, v_post_deleted_at
  from public.trade_posts post
  where post.id = new.trade_post_id
    and post.deleted_at is null;
  if not found then
    raise exception 'Trade post not found';
  end if;
  if auth.uid() is not null and v_author <> auth.uid() then
    raise exception 'Only the trade author may add items';
  end if;
  if tg_op = 'UPDATE' and (
    new.trade_post_id <> old.trade_post_id
    or new.card_variant_id is distinct from old.card_variant_id
    or new.sealed_product_id is distinct from old.sealed_product_id
    or (
      tg_table_name = 'trade_post_offered_items'
      and v_source_id is distinct from v_old_source_id
    )
  ) then
    raise exception 'Trade item identity is immutable; replace the item to recapture market references';
  end if;

  if tg_table_name = 'trade_post_offered_items' then
    if v_source_id is null then
      raise exception 'Every offered card must reference its owned collection item';
    end if;

    select collection_item.*
    into v_source
    from public.collection_items collection_item
    where collection_item.id = v_source_id
      and collection_item.deleted_at is null
    for update;

    if not found or v_source.owner_id <> v_author then
      raise exception 'Offered source item must belong to the trade author';
    end if;
    if v_source.card_variant_id is distinct from new.card_variant_id
       or v_source.sealed_product_id is distinct from new.sealed_product_id
       or v_source.condition <> new.condition
       or v_source.language <> new.language
       or new.quantity > v_source.quantity then
      raise exception 'Offered details must match the owned collection item and available quantity';
    end if;

    if v_post_status in ('open', 'discussing') and v_post_deleted_at is null then
      v_reserved := private.active_trade_reserved_quantity_v8(v_source.id, new.id);
      v_available := greatest(v_source.quantity::bigint - v_reserved, 0);
      if new.quantity::bigint > v_available then
        raise exception
          'Only % unreserved copies of this card are available. Close another active trade before listing it again.',
          v_available
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Collection changes may not reduce or remove inventory already promised by
-- another open/discussing trade.
create or replace function private.guard_collection_trade_reservations_v8()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_quantity bigint;
  v_reserved bigint;
begin
  v_effective_quantity := case when new.deleted_at is null then new.quantity else 0 end;
  v_reserved := private.active_trade_reserved_quantity_v8(new.id, null);

  if v_effective_quantity < v_reserved then
    raise exception
      'This card has % copies reserved by active trades. Close those trades before reducing the collection quantity.',
      v_reserved
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_collection_trade_reservations_v8()
  from public, anon, authenticated;

drop trigger if exists collection_trade_reservation_guard_v8
  on public.collection_items;
create trigger collection_trade_reservation_guard_v8
  before update of quantity, deleted_at on public.collection_items
  for each row execute function private.guard_collection_trade_reservations_v8();

-- A completed trade represents a real transfer. Consume each offered holding
-- after the post status changes, allowing the collection reservation guard to
-- count only other still-active trades.
create or replace function private.consume_completed_trade_inventory_v8()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offered record;
  v_item public.collection_items%rowtype;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  for v_offered in
    select
      offered.source_collection_item_id as collection_item_id,
      sum(offered.quantity)::integer as quantity
    from public.trade_post_offered_items offered
    where offered.trade_post_id = new.id
      and offered.source_collection_item_id is not null
    group by offered.source_collection_item_id
    order by offered.source_collection_item_id
  loop
    select collection_item.*
    into v_item
    from public.collection_items collection_item
    where collection_item.id = v_offered.collection_item_id
      and collection_item.owner_id = new.author_id
      and collection_item.deleted_at is null
    for update;

    if not found or v_item.quantity < v_offered.quantity then
      raise exception
        'The offered card is no longer available in the required quantity. The trade was not completed.'
        using errcode = '23514';
    end if;

    if v_item.quantity = v_offered.quantity then
      update public.collection_items
      set deleted_at = transaction_timestamp()
      where id = v_item.id;
    else
      update public.collection_items
      set quantity = quantity - v_offered.quantity
      where id = v_item.id;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.consume_completed_trade_inventory_v8()
  from public, anon, authenticated;

drop trigger if exists trade_completed_inventory_consume_v8
  on public.trade_posts;
create trigger trade_completed_inventory_consume_v8
  after update of status on public.trade_posts
  for each row execute function private.consume_completed_trade_inventory_v8();

create or replace function private.guard_trade_post_lifecycle_v8()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('completed', 'closed') and new.status is distinct from old.status then
    raise exception 'Completed and closed trades are immutable history'
      using errcode = '23514';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Deleted trade posts cannot be restored'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_trade_post_lifecycle_v8()
  from public, anon, authenticated;

drop trigger if exists trade_post_lifecycle_guard_v8
  on public.trade_posts;
create trigger trade_post_lifecycle_guard_v8
  before update of status, deleted_at on public.trade_posts
  for each row execute function private.guard_trade_post_lifecycle_v8();

-- Completed/closed rows are audit history and cannot be reopened. Completing a
-- post is author-only because it changes that author's collection; moderators
-- retain the ability to close a post without changing inventory.
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
  v_uid uuid := auth.uid();
  v_post public.trade_posts%rowtype;
begin
  if v_uid is null then
    raise exception 'A signed-in account is required';
  end if;
  if p_status is null then
    raise exception 'Trade status is required';
  end if;

  select trade_post.*
  into v_post
  from public.trade_posts trade_post
  where trade_post.id = p_trade_post_id
    and trade_post.deleted_at is null
  for update;

  if not found then
    raise exception 'Trade post not found';
  end if;
  if v_post.status = p_status then
    return;
  end if;
  if v_post.status in ('completed', 'closed') then
    raise exception 'Completed and closed trades are immutable history';
  end if;
  if p_status = 'completed' and v_post.author_id <> v_uid then
    raise exception 'Only the trade author may complete a trade';
  end if;
  if v_post.author_id <> v_uid
     and not (
       p_status = 'closed'
       and private.can_moderate_community(v_post.community_id, v_uid)
     ) then
    raise exception 'Trade author access required';
  end if;

  update public.trade_posts
  set status = p_status
  where id = p_trade_post_id;

  insert into public.activity_logs (
    user_id,
    actor_id,
    community_id,
    activity_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_post.author_id,
    v_uid,
    v_post.community_id,
    'trade_status_changed',
    'trade_post',
    v_post.id,
    jsonb_build_object('status', p_status::text)
  );
end;
$$;

revoke all on function public.set_community_trade_post_status_v6(
  uuid,
  public.trade_status
) from public, anon, authenticated;
grant execute on function public.set_community_trade_post_status_v6(
  uuid,
  public.trade_status
) to authenticated;

-- Fail closed if an older deployment already contains more active promises than
-- the corresponding collection quantity. Historical completed/closed posts do
-- not reserve inventory and are intentionally preserved.
do $$
begin
  if exists (
    select 1
    from public.trade_post_offered_items offered
    join public.trade_posts post on post.id = offered.trade_post_id
    join public.collection_items collection_item
      on collection_item.id = offered.source_collection_item_id
    where post.status in ('open', 'discussing')
      and post.deleted_at is null
      and collection_item.deleted_at is null
    group by offered.source_collection_item_id, collection_item.quantity
    having sum(offered.quantity) > collection_item.quantity
  ) then
    raise exception 'Existing active trade reservations exceed collection inventory';
  end if;
end;
$$;

commit;
