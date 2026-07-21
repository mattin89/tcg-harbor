-- Consume the per-add purchase context exactly once. The previous trigger
-- implementation used transaction-local GUCs but left them populated after a
-- lot was captured, so a later positive quantity update in the same trusted
-- transaction could inherit purchase metadata from the prior add.

begin;

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
    perform pg_catalog.set_config('tcg_harbor.purchase_unit_amount', '', true);
    perform pg_catalog.set_config('tcg_harbor.purchase_currency', '', true);
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

  -- Clear immediately after reading so no later collection mutation in this
  -- transaction can reuse another addition's immutable purchase metadata.
  perform pg_catalog.set_config('tcg_harbor.purchase_unit_amount', '', true);
  perform pg_catalog.set_config('tcg_harbor.purchase_currency', '', true);

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

-- A conflicting INSERT ... ON CONFLICT DO NOTHING executes the BEFORE INSERT
-- staging trigger but has no row for the AFTER ROW capture trigger. Clear the
-- context once after every INSERT statement as a final backstop. Statement
-- triggers run after all row triggers, so successful additions consume their
-- own values first.
create or replace function private.clear_collection_lot_purchase_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('tcg_harbor.purchase_unit_amount', '', true);
  perform pg_catalog.set_config('tcg_harbor.purchase_currency', '', true);
  return null;
end;
$$;

drop trigger if exists collection_lot_purchase_context_statement_clear
  on public.collection_items;
create trigger collection_lot_purchase_context_statement_clear
  after insert on public.collection_items
  for each statement execute function private.clear_collection_lot_purchase_context();

revoke execute on function public.capture_collection_acquisition_lot()
  from public, anon, authenticated;
revoke execute on function private.clear_collection_lot_purchase_context()
  from public, anon, authenticated;

commit;
