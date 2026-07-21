begin;

-- Bind a collection add to the identity that initiated it in the browser.
-- This closes the account-switch race between catalog resolution and the RPC.
create or replace function public.add_or_merge_collection_item_v2(
  p_expected_owner_id uuid,
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
begin
  if p_expected_owner_id is distinct from v_uid then
    raise exception 'The active account changed before the collection item was saved'
      using errcode = '42501';
  end if;

  return public.add_or_merge_collection_item(
    p_card_variant_id,
    p_sealed_product_id,
    p_condition,
    p_quantity,
    p_private_note,
    p_purchase_unit_amount,
    p_purchase_currency
  );
end;
$$;

revoke all on function public.add_or_merge_collection_item_v2(
  uuid, uuid, uuid, public.item_condition, integer, text, numeric, public.currency_code
) from public, anon, authenticated;

grant execute on function public.add_or_merge_collection_item_v2(
  uuid, uuid, uuid, public.item_condition, integer, text, numeric, public.currency_code
) to authenticated;

-- Force browser clients onto the owner-bound endpoint. The v2 wrapper executes
-- the legacy implementation as its database owner after validating auth.uid().
revoke execute on function public.add_or_merge_collection_item(
  uuid, uuid, public.item_condition, integer, text, numeric, public.currency_code
) from public, anon, authenticated;

commit;
