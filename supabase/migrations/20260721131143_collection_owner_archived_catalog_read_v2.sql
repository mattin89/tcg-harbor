-- Keep an owner's existing holdings readable after a managed catalog row is
-- retired. These policies add only SELECT visibility, only for authenticated
-- owners with an active collection item, and do not make archived products
-- public or addable again.

begin;

create policy card_variants_collection_owner_archived_read
on public.card_variants
for select
to authenticated
using (
  archived_at is not null
  and (select auth.uid()) is not null
  and id in (
    select item.card_variant_id
    from public.collection_items item
    where item.owner_id = (select auth.uid())
      and item.deleted_at is null
      and item.card_variant_id is not null
  )
);

create policy sealed_products_collection_owner_archived_read
on public.sealed_products
for select
to authenticated
using (
  archived_at is not null
  and (select auth.uid()) is not null
  and id in (
    select item.sealed_product_id
    from public.collection_items item
    where item.owner_id = (select auth.uid())
      and item.deleted_at is null
      and item.sealed_product_id is not null
  )
);

-- PostgREST applies RLS independently to embedded parent relations. An owner
-- therefore also needs narrowly-scoped access to an archived base card and set
-- referenced by their archived printing.
create policy cards_collection_owner_archived_read
on public.cards
for select
to authenticated
using (
  archived_at is not null
  and (select auth.uid()) is not null
  and id in (
    select variant.card_id
    from public.card_variants variant
    where variant.id in (
      select item.card_variant_id
      from public.collection_items item
      where item.owner_id = (select auth.uid())
        and item.deleted_at is null
        and item.card_variant_id is not null
    )
  )
);

create policy card_sets_collection_owner_archived_read
on public.card_sets
for select
to authenticated
using (
  archived_at is not null
  and (select auth.uid()) is not null
  and (
    id in (
      select card.card_set_id
      from public.cards card
      where card.id in (
        select variant.card_id
        from public.card_variants variant
        where variant.id in (
          select item.card_variant_id
          from public.collection_items item
          where item.owner_id = (select auth.uid())
            and item.deleted_at is null
            and item.card_variant_id is not null
        )
      )
    )
    or id in (
      select product.card_set_id
      from public.sealed_products product
      where product.id in (
        select item.sealed_product_id
        from public.collection_items item
        where item.owner_id = (select auth.uid())
          and item.deleted_at is null
          and item.sealed_product_id is not null
      )
    )
  )
);

commit;
