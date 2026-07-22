-- Existing holdings must remain reducible and removable after their catalog
-- records are retired, but retirement must make the catalog target immutable
-- in the positive direction. The RPC remains the authoritative boundary; the
-- client-side disabled state added alongside this migration is only UX.

begin;

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
  v_catalog_active boolean := false;
  v_card_set_id uuid;
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

  -- Decreases and no-op saves intentionally bypass this block so an owner can
  -- wind down an archived holding. Positive deltas lock every relevant catalog
  -- row against concurrent archival for the remainder of this transaction.
  if p_quantity > v_item.quantity then
    if v_item.card_variant_id is not null then
      perform variant.id
      from public.card_variants variant
      join public.cards card on card.id = variant.card_id
      join public.card_sets card_set on card_set.id = card.card_set_id
      join public.games game on game.id = card.game_id
      where variant.id = v_item.card_variant_id
        and variant.archived_at is null
        and card.archived_at is null
        and card_set.archived_at is null
        and game.is_active
        and game.archived_at is null
      for share of variant, card, card_set, game;
      v_catalog_active := found;
    else
      select product.card_set_id
      into v_card_set_id
      from public.sealed_products product
      join public.games game on game.id = product.game_id
      where product.id = v_item.sealed_product_id
        and product.archived_at is null
        and game.is_active
        and game.archived_at is null
      for share of product, game;
      v_catalog_active := found;

      if v_catalog_active and v_card_set_id is not null then
        perform card_set.id
        from public.card_sets card_set
        where card_set.id = v_card_set_id
          and card_set.archived_at is null
        for share of card_set;
        v_catalog_active := found;
      end if;
    end if;

    if not v_catalog_active then
      raise exception
        'Archived catalog holdings cannot be increased. Decrease or remove this holding instead.'
        using errcode = '55000';
    end if;
  end if;

  update public.collection_items
  set quantity = p_quantity
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs, but restate the narrow boundary
-- so a fresh database and an upgraded database converge on the same grants.
revoke all on function public.set_collection_item_quantity(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.set_collection_item_quantity(uuid, integer)
  to authenticated;

commit;
