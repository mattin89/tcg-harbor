-- Migration: push_daily_card_prices_v1
-- Called by the daily CI catalog sync job (service role only).
-- Writes today's market prices into each active user's card_price_history,
-- maintaining a 30-day rolling window. Acquisition-time prices stored in
-- collection_acquisition_market_references are never touched here.

create or replace function public.push_daily_card_prices(
  p_price_date  text,
  p_prices      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff_date        text;
  v_updated_count      integer := 0;
  v_user_record        record;
  v_item               jsonb;
  v_asset_id           text;
  v_holding_id         text;
  v_cm_price           numeric;
  v_tcp_price          numeric;
  v_cm_today           jsonb := '{}'::jsonb;
  v_tcp_today          jsonb := '{}'::jsonb;
  v_current_history    jsonb;
  v_cm_history         jsonb;
  v_tcp_history        jsonb;
  v_pruned_cm          jsonb;
  v_pruned_tcp         jsonb;
begin
  -- 30-day cutoff: ISO-8601 lexicographic comparison is correct for YYYY-MM-DD date strings
  v_cutoff_date := (p_price_date::date - interval '30 days')::date::text;

  for v_user_record in
    select
      ci.owner_id as user_id,
      jsonb_agg(
        jsonb_build_object(
          'holding_id', 'holding-' || ci.id::text,
          'asset_id', coalesce(
            cv.external_identifiers->>'tcg_harbor_asset_id',
            sp.external_identifiers->>'tcg_harbor_asset_id'
          )
        )
      ) filter (where coalesce(
        cv.external_identifiers->>'tcg_harbor_asset_id',
        sp.external_identifiers->>'tcg_harbor_asset_id'
      ) is not null) as items
    from public.collection_items ci
    left join public.card_variants cv on cv.id = ci.card_variant_id
    left join public.sealed_products sp on sp.id = ci.sealed_product_id
    where ci.deleted_at is null and ci.quantity > 0
    group by ci.owner_id
  loop
    if v_user_record.items is null or jsonb_array_length(v_user_record.items) = 0 then
      continue;
    end if;

    v_cm_today  := '{}'::jsonb;
    v_tcp_today := '{}'::jsonb;

    for v_item in select * from jsonb_array_elements(v_user_record.items) loop
      v_asset_id := v_item->>'asset_id';
      v_holding_id := v_item->>'holding_id';

      if v_asset_id is not null and p_prices ? v_asset_id then
        if (p_prices->v_asset_id->>'cardmarket') is not null then
          v_cm_price := (p_prices->v_asset_id->>'cardmarket')::numeric;
          if v_cm_price > 0 then
            v_cm_today := jsonb_set(v_cm_today, array[v_asset_id], to_jsonb(v_cm_price));
            if v_holding_id is not null then
              v_cm_today := jsonb_set(v_cm_today, array[v_holding_id], to_jsonb(v_cm_price));
            end if;
          end if;
        end if;

        if (p_prices->v_asset_id->>'tcgplayer') is not null then
          v_tcp_price := (p_prices->v_asset_id->>'tcgplayer')::numeric;
          if v_tcp_price > 0 then
            v_tcp_today := jsonb_set(v_tcp_today, array[v_asset_id], to_jsonb(v_tcp_price));
            if v_holding_id is not null then
              v_tcp_today := jsonb_set(v_tcp_today, array[v_holding_id], to_jsonb(v_tcp_price));
            end if;
          end if;
        end if;
      end if;
    end loop;

    if v_cm_today = '{}'::jsonb and v_tcp_today = '{}'::jsonb then
      continue;
    end if;

    select card_price_history into v_current_history
    from public.user_profiles where user_id = v_user_record.user_id;

    if not found then continue; end if;

    v_cm_history  := coalesce(v_current_history->'cardmarket',  '{}'::jsonb);
    v_tcp_history := coalesce(v_current_history->'tcgplayer', '{}'::jsonb);

    v_cm_history  := jsonb_set(v_cm_history,  array[p_price_date], v_cm_today);
    v_tcp_history := jsonb_set(v_tcp_history, array[p_price_date], v_tcp_today);

    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    into v_pruned_cm
    from jsonb_each(v_cm_history) t(k, v)
    where k >= v_cutoff_date;

    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    into v_pruned_tcp
    from jsonb_each(v_tcp_history) t(k, v)
    where k >= v_cutoff_date;

    update public.user_profiles
    set card_price_history = jsonb_build_object(
      'cardmarket', v_pruned_cm,
      'tcgplayer',  v_pruned_tcp
    )
    where user_id = v_user_record.user_id;

    v_updated_count := v_updated_count + 1;
  end loop;

  return jsonb_build_object('updated_profiles', v_updated_count);
end;
$$;

revoke execute on function public.push_daily_card_prices(text, jsonb) from public, anon, authenticated;
grant  execute on function public.push_daily_card_prices(text, jsonb) to service_role;

comment on function public.push_daily_card_prices(text, jsonb) is
  'Called by the daily CI catalog sync. Writes today market prices into each active user card_price_history rolling window and prunes entries older than 30 days.';