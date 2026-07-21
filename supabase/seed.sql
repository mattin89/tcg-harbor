-- TCG Harbor deterministic demo fixtures
--
-- IMPORTANT AUTH PLACEHOLDERS
-- Create these users through Supabase Auth (Admin API, dashboard, or local auth).
-- If your Auth fixture tooling supports explicit IDs, preserve the UUIDs below;
-- otherwise replace the four v_* UUID constants in the conditional DO block with
-- the generated auth.users IDs, then rerun this seed for private/user-owned fixtures.
-- The seed never writes password hashes or auth credentials directly.
--
-- demo@tcgharbor.local      00000000-0000-4000-8000-000000000001
-- alex@tcgharbor.local      00000000-0000-4000-8000-000000000002
-- marina@tcgharbor.local    00000000-0000-4000-8000-000000000003
-- store-admin@tcgharbor.local 00000000-0000-4000-8000-000000000004
-- Suggested local-only password for all four: HarborDemo2026! (set through Auth, not SQL)
--
-- All prices are DEMO FIXTURES, not live Cardmarket/TCGPlayer data. Product/card
-- names are catalog metadata; image_url is intentionally NULL unless a permitted
-- image source is configured.

begin;

insert into public.games (id, slug, name, publisher, is_active)
values (
  '10000000-0000-4000-8000-000000000001',
  'one-piece-card-game',
  'One Piece Card Game',
  'Bandai',
  true
)
on conflict (id) do update set name = excluded.name, publisher = excluded.publisher, is_active = true;

insert into public.card_sets (id, game_id, code, name, release_date) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OP01', 'Romance Dawn', '2022-12-02'),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'OP05', 'Awakening of the New Era', '2023-12-08'),
  ('11000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'OP06', 'Wings of the Captain', '2024-03-15'),
  ('11000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'ST10', 'The Three Captains', '2023-11-10')
on conflict (id) do update set name = excluded.name, release_date = excluded.release_date, archived_at = null;

insert into public.cards (
  id, game_id, card_set_id, card_number, name, rarity, card_type, colors, release_date
) values
  ('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','OP01-001','Roronoa Zoro','Leader','Leader',array['Red'],'2022-12-02'),
  ('12000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','OP01-016','Nami','Rare','Character',array['Red'],'2022-12-02'),
  ('12000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','OP01-025','Roronoa Zoro','Super Rare','Character',array['Red'],'2022-12-02'),
  ('12000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','OP01-047','Trafalgar Law','Leader','Leader',array['Red','Green'],'2022-12-02'),
  ('12000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','OP01-051','Eustass Kid','Super Rare','Character',array['Green'],'2022-12-02'),
  ('12000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-002','Belo Betty','Leader','Leader',array['Red','Yellow'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-006','Koala','Rare','Character',array['Red'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-041','Sakazuki','Leader','Leader',array['Blue','Black'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-060','Monkey.D.Luffy','Secret Rare','Character',array['Purple'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-074','Eustass Kid','Super Rare','Character',array['Purple'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-091','Rebecca','Rare','Character',array['Black'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','OP05-119','Monkey.D.Luffy','Secret Rare','Character',array['Purple'],'2023-12-08'),
  ('12000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-022','Yamato','Leader','Leader',array['Green','Yellow'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-035','Hody Jones','Leader','Leader',array['Green'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-042','Vinsmoke Reiju','Leader','Leader',array['Blue','Purple'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000016','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-069','Vinsmoke Reiju','Super Rare','Character',array['Purple'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-086','Gecko Moria','Leader','Leader',array['Black'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000018','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','OP06-093','Perona','Rare','Character',array['Black'],'2024-03-15'),
  ('12000000-0000-4000-8000-000000000019','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','ST10-001','Trafalgar Law','Leader','Leader',array['Red','Purple'],'2023-11-10'),
  ('12000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','ST10-006','Monkey.D.Luffy','Leader','Leader',array['Red','Purple'],'2023-11-10')
on conflict (id) do update set name = excluded.name, rarity = excluded.rarity, archived_at = null;

insert into public.card_variants (id, card_id, variant_identifier, variant_name, language) values
  ('13000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000003','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000004','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000005','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000006','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000007','12000000-0000-4000-8000-000000000007','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000008','12000000-0000-4000-8000-000000000008','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000009','12000000-0000-4000-8000-000000000009','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000010','12000000-0000-4000-8000-000000000010','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000011','12000000-0000-4000-8000-000000000011','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000012','12000000-0000-4000-8000-000000000012','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000013','12000000-0000-4000-8000-000000000013','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000014','12000000-0000-4000-8000-000000000014','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000015','12000000-0000-4000-8000-000000000015','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000016','12000000-0000-4000-8000-000000000016','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000017','12000000-0000-4000-8000-000000000017','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000018','12000000-0000-4000-8000-000000000018','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000019','12000000-0000-4000-8000-000000000019','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000020','12000000-0000-4000-8000-000000000020','base','Base','EN'),
  ('13000000-0000-4000-8000-000000000101','12000000-0000-4000-8000-000000000002','parallel-aa','Alternate Art','EN'),
  ('13000000-0000-4000-8000-000000000102','12000000-0000-4000-8000-000000000009','parallel-aa','Alternate Art','EN'),
  ('13000000-0000-4000-8000-000000000103','12000000-0000-4000-8000-000000000012','parallel-aa','Alternate Art','EN'),
  ('13000000-0000-4000-8000-000000000104','12000000-0000-4000-8000-000000000013','parallel-aa','Alternate Art','EN'),
  ('13000000-0000-4000-8000-000000000105','12000000-0000-4000-8000-000000000016','parallel-aa','Alternate Art','EN')
on conflict (id) do update set variant_name = excluded.variant_name, archived_at = null;

insert into public.sealed_products (
  id, game_id, card_set_id, name, product_type, language, region, release_date
) values
  ('14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Romance Dawn Booster Box','booster_box','EN','Europe','2022-12-02'),
  ('14000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Romance Dawn Booster Pack','booster_pack','EN','Europe','2022-12-02'),
  ('14000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','Awakening of the New Era Booster Box','booster_box','EN','United States','2023-12-08'),
  ('14000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','Wings of the Captain Booster Box','booster_box','EN','Europe','2024-03-15'),
  ('14000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','The Three Captains Starter Deck','starter_deck','EN','Global','2023-11-10'),
  ('14000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001',null,'Demo Tournament Pack','tournament_product','EN','Global','2024-06-01')
on conflict (id) do update set name = excluded.name, archived_at = null;

insert into public.pricing_providers (
  id, slug, name, market_region, native_currency, data_mode, is_enabled,
  credential_secret_name, requests_per_minute, min_refresh_interval_seconds
) values
  ('15000000-0000-4000-8000-000000000001','cardmarket','Cardmarket','europe','EUR','demo_fixture',true,'CARDMARKET_API_CREDENTIALS',20,900),
  ('15000000-0000-4000-8000-000000000002','tcgplayer','TCGPlayer','united_states','USD','demo_fixture',true,'TCGPLAYER_API_CREDENTIALS',20,900)
on conflict (id) do update set data_mode = 'demo_fixture', is_enabled = true;

insert into public.stores (
  id, slug, name, description, address_line_1, city, region, postcode, country_code,
  latitude, longitude, timezone, opening_hours, contact_email, is_verified
) values
  ('20000000-0000-4000-8000-000000000001','anchor-games-berlin','Anchor Games Berlin','Demo fixture store and local collector community.','Torstrasse 101','Berlin','Berlin','10119','DE',52.52980,13.40110,'Europe/Berlin','{"mon":{"open":"12:00","close":"20:00"},"sat":{"open":"10:00","close":"20:00"}}','berlin@example.invalid',true),
  ('20000000-0000-4000-8000-000000000002','canal-card-club','Canal Card Club','Demo fixture near central Amsterdam.','Prinsengracht 220','Amsterdam','North Holland','1016 HD','NL',52.37310,4.88310,'Europe/Amsterdam','{"tue":{"open":"12:00","close":"20:00"},"sun":{"open":"11:00","close":"18:00"}}','amsterdam@example.invalid',true),
  ('20000000-0000-4000-8000-000000000003','le-phare-tcg','Le Phare TCG','Demo fixture community in Paris.','18 Rue du Temple','Paris','Ile-de-France','75004','FR',48.85920,2.35720,'Europe/Paris','{"wed":{"open":"11:00","close":"20:00"},"sat":{"open":"10:00","close":"21:00"}}','paris@example.invalid',true),
  ('20000000-0000-4000-8000-000000000004','harbor-cards-nyc','Harbor Cards NYC','Demo fixture store community in New York.','42 W 14th Street','New York','NY','10011','US',40.73630,-73.99520,'America/New_York','{"mon":{"open":"11:00","close":"21:00"},"sun":{"open":"12:00","close":"18:00"}}','nyc@example.invalid',true),
  ('20000000-0000-4000-8000-000000000005','sound-side-games','Sound Side Games','Demo fixture store community in Seattle.','1510 4th Avenue','Seattle','WA','98101','US',47.61020,-122.33600,'America/Los_Angeles','{"fri":{"open":"11:00","close":"22:00"},"sat":{"open":"10:00","close":"22:00"}}','seattle@example.invalid',true),
  ('20000000-0000-4000-8000-000000000006','golden-gate-card-room','Golden Gate Card Room','Demo fixture store community in San Francisco.','650 Market Street','San Francisco','CA','94104','US',37.78810,-122.40210,'America/Los_Angeles','{"thu":{"open":"12:00","close":"21:00"},"sun":{"open":"11:00","close":"19:00"}}','sf@example.invalid',true)
on conflict (id) do update set name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
  opening_hours = excluded.opening_hours, is_active = true, deleted_at = null;

insert into public.communities (id, store_id, name, description, rules) values
  ('21000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Anchor Games Berlin Crew','Local trades and play at Anchor Games.','Meet in public store areas. No cash listings or sale prices.'),
  ('21000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Canal Card Club Community','Amsterdam collectors and local trades.','Be kind. Trade posts are barter only.'),
  ('21000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Le Phare Local Crew','Paris community demo.','Protect member privacy and meet safely.'),
  ('21000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','Harbor Cards NYC Community','New York local collector community.','No sales, auctions, payments, or shipping offers.'),
  ('21000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','Sound Side Collectors','Seattle local collector community.','Use market values only as references, never guarantees.'),
  ('21000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','Golden Gate Collectors','San Francisco local collector community.','Respect blocks, reports, and moderator decisions.')
on conflict (id) do update set name = excluded.name, description = excluded.description, is_active = true, deleted_at = null;

-- Public demo QR/manual codes. Production-generated raw codes are returned once by
-- create_store_join_code() and only their digests are stored.
-- /join/HARBOR-BERLIN-DEMO-2026
-- /join/HARBOR-AMSTERDAM-DEMO-2026
-- /join/HARBOR-PARIS-DEMO-2026
-- /join/HARBOR-NYC-DEMO-2026
-- /join/HARBOR-SEATTLE-DEMO-2026
-- /join/HARBOR-SF-DEMO-2026
insert into public.store_join_codes (
  id, store_id, community_id, code_hash, code_prefix, label, max_uses
) values
  ('22000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',extensions.digest('HARBOR-BERLIN-DEMO-2026','sha256'),'HARBOR-BER','Demo fixture — simulate scan',10000),
  ('22000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002',extensions.digest('HARBOR-AMSTERDAM-DEMO-2026','sha256'),'HARBOR-AMS','Demo fixture — simulate scan',10000),
  ('22000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000003',extensions.digest('HARBOR-PARIS-DEMO-2026','sha256'),'HARBOR-PAR','Demo fixture — simulate scan',10000),
  ('22000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','21000000-0000-4000-8000-000000000004',extensions.digest('HARBOR-NYC-DEMO-2026','sha256'),'HARBOR-NYC','Demo fixture — simulate scan',10000),
  ('22000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','21000000-0000-4000-8000-000000000005',extensions.digest('HARBOR-SEATTLE-DEMO-2026','sha256'),'HARBOR-SEA','Demo fixture — simulate scan',10000),
  ('22000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000006','21000000-0000-4000-8000-000000000006',extensions.digest('HARBOR-SF-DEMO-2026','sha256'),'HARBOR-SF-','Demo fixture — simulate scan',10000)
on conflict (id) do update set
  deactivated_at = null,
  deactivated_by = null,
  deactivation_reason = null,
  rotated_to_id = null,
  max_uses = excluded.max_uses;

-- Stable provider mappings: provider IDs + catalog UUIDs, never display-name matching.
with ranked as (
  select v.id, v.variant_identifier, v.language, row_number() over (order by v.id) as rn
  from public.card_variants v
  join public.cards c on c.id = v.card_id
  where c.game_id = '10000000-0000-4000-8000-000000000001' and v.archived_at is null
), rows_to_insert as (
  select
    p.id as provider_id,
    r.id as card_variant_id,
    p.slug || '-card-' || replace(r.id::text, '-', '') as provider_product_id,
    r.language,
    r.variant_identifier,
    jsonb_build_object(
      'demo_fixture', true,
      'seed_base', round((3.50 + r.rn * 4.35 + case when r.rn > 20 then 55 else 0 end)::numeric, 2),
      'seed_trend', case when r.rn % 4 = 0 then -0.0045 when r.rn % 3 = 0 then 0.0065 else 0.0025 end,
      'unavailable', (p.slug = 'tcgplayer' and r.rn = 18)
    ) as metadata
  from ranked r cross join public.pricing_providers p
  where p.id in ('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002')
)
insert into public.provider_catalog_mappings (
  provider_id, card_variant_id, provider_product_id, condition, language, variant_key,
  mapping_metadata, verified_at
)
select provider_id, card_variant_id, provider_product_id, 'near_mint', language,
  variant_identifier, metadata, '2026-07-16 08:00:00+00'
from rows_to_insert
on conflict do nothing;

-- User-owned fixtures are conditional so a clean local reset succeeds before demo
-- Auth accounts exist. Create Auth users with the UUID placeholders above and rerun.
do $$
declare
  v_demo uuid := '00000000-0000-4000-8000-000000000001';
  v_alex uuid := '00000000-0000-4000-8000-000000000002';
  v_marina uuid := '00000000-0000-4000-8000-000000000003';
  v_admin uuid := '00000000-0000-4000-8000-000000000004';
  v_berlin uuid := '21000000-0000-4000-8000-000000000001';
  v_amsterdam uuid := '21000000-0000-4000-8000-000000000002';
  v_paris uuid := '21000000-0000-4000-8000-000000000003';
  v_conversation uuid := '33000000-0000-4000-8000-000000000001';
begin
  -- Backfill application shadows if Auth users were provisioned before this migration.
  insert into public.app_users (id, email)
  select u.id, u.email from auth.users u
  where u.id in (v_demo, v_alex, v_marina, v_admin)
  on conflict (id) do update set email = excluded.email, status = 'active';

  insert into public.user_profiles (
    user_id, username, display_name, primary_market, preferred_currency,
    approximate_city, timezone, onboarding_completed_at
  )
  select u.id,
    case u.id when v_demo then 'mario_demo' when v_alex then 'alex_collects'
      when v_marina then 'marina_cards' else 'anchor_admin' end,
    case u.id when v_demo then 'Mario Demo' when v_alex then 'Alex'
      when v_marina then 'Marina' else 'Anchor Games Team' end,
    case when u.id = v_alex then 'united_states'::public.market_region else 'europe'::public.market_region end,
    case when u.id = v_alex then 'USD'::public.currency_code else 'EUR'::public.currency_code end,
    case u.id when v_demo then 'Berlin' when v_alex then 'New York'
      when v_marina then 'Berlin' else 'Berlin' end,
    case when u.id = v_alex then 'America/New_York' else 'Europe/Berlin' end,
    '2026-07-01 10:00:00+00'
  from auth.users u where u.id in (v_demo, v_alex, v_marina, v_admin)
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    primary_market = excluded.primary_market,
    preferred_currency = excluded.preferred_currency,
    approximate_city = excluded.approximate_city,
    timezone = excluded.timezone,
    onboarding_completed_at = excluded.onboarding_completed_at,
    deleted_at = null;

  insert into public.notification_preferences (user_id)
  select u.id from auth.users u where u.id in (v_demo, v_alex, v_marina, v_admin)
  on conflict (user_id) do nothing;

  if exists (select 1 from public.app_users where id = v_admin) then
    update public.app_users set roles = array['collector','store_administrator']::public.app_role[] where id = v_admin;
    insert into public.store_administrators (store_id, user_id)
    values ('20000000-0000-4000-8000-000000000001', v_admin)
    on conflict (store_id, user_id) do update set revoked_at = null;
  end if;
  if exists (select 1 from public.app_users where id = v_marina) then
    update public.app_users set roles = array['collector','community_moderator']::public.app_role[] where id = v_marina;
  end if;

  if exists (select 1 from public.app_users where id = v_demo) then
    -- 25 card holdings (including five parallels), with mixed quantities/cost basis.
    insert into public.collection_items (
      owner_id, card_variant_id, condition, language, quantity, acquired_on,
      purchase_unit_amount, purchase_currency, private_note
    )
    select
      v_demo,
      v.id,
      'near_mint',
      v.language,
      case when row_number() over (order by v.id) % 5 = 0 then 3
           when row_number() over (order by v.id) % 3 = 0 then 2 else 1 end,
      '2026-05-01'::date + ((row_number() over (order by v.id))::integer % 40),
      case when row_number() over (order by v.id) % 4 = 0
        then round((7 + row_number() over (order by v.id)) * 1.15, 2) else null end,
      case when row_number() over (order by v.id) % 4 = 0 then 'EUR'::public.currency_code else null end,
      case when row_number() over (order by v.id) in (2, 21)
        then 'Private demo note — never exposed through community policies.' else null end
    from public.card_variants v
    join public.cards c on c.id = v.card_id
    where c.game_id = '10000000-0000-4000-8000-000000000001' and v.archived_at is null
    order by v.id
    on conflict do nothing;

    insert into public.collection_items (
      owner_id, sealed_product_id, condition, language, quantity, acquired_on,
      purchase_unit_amount, purchase_currency, private_note
    )
    select
      v_demo, s.id, 'sealed', s.language,
      case when row_number() over (order by s.id) in (2,5) then 2 else 1 end,
      '2026-04-15'::date + ((row_number() over (order by s.id))::integer * 5),
      round((35 + row_number() over (order by s.id) * 28)::numeric, 2), 'EUR',
      case when row_number() over (order by s.id) = 1 then 'Keep sealed; private note.' else null end
    from public.sealed_products s
    where s.game_id = '10000000-0000-4000-8000-000000000001' and s.archived_at is null
    order by s.id
    on conflict do nothing;

    -- Backdated inventory events make historical charts distinguish acquisitions
    -- and quantity changes from pure market movement.
    insert into public.collection_quantity_history (
      collection_item_id, owner_id, quantity, effective_at, reason
    )
    select ci.id, ci.owner_id,
      case when ci.quantity > 1 then ci.quantity - 1 else ci.quantity end,
      (ci.acquired_on::timestamp at time zone 'UTC') + interval '12 hours',
      'demo_acquisition'
    from public.collection_items ci
    where ci.owner_id = v_demo and ci.deleted_at is null and ci.acquired_on is not null
    on conflict (collection_item_id, effective_at, reason) do nothing;
    insert into public.collection_quantity_history (
      collection_item_id, owner_id, quantity, effective_at, reason
    )
    select ci.id, ci.owner_id, ci.quantity, '2026-07-10 12:00:00+00', 'demo_quantity_increase'
    from public.collection_items ci
    where ci.owner_id = v_demo and ci.deleted_at is null and ci.quantity > 1
    on conflict (collection_item_id, effective_at, reason) do nothing;

    -- Three memberships satisfy the demo requirement without exposing any profile location.
    insert into public.community_memberships (community_id, user_id, joined_via_code_id, joined_at) values
      (v_berlin, v_demo, '22000000-0000-4000-8000-000000000001', '2026-06-01 15:00:00+00'),
      (v_amsterdam, v_demo, '22000000-0000-4000-8000-000000000002', '2026-06-08 11:00:00+00'),
      (v_paris, v_demo, '22000000-0000-4000-8000-000000000003', '2026-06-15 13:00:00+00')
    on conflict (community_id, user_id) do nothing;

    insert into public.community_messages (
      community_id, author_id, body, client_message_id, created_at
    ) values
      (v_berlin,v_demo,'Welcome aboard — who is joining the Friday trade night?','34000000-0000-4000-8000-000000000001','2026-07-13 17:05:00+00'),
      (v_berlin,v_demo,'I can bring a few OP05 cards for local trades.','34000000-0000-4000-8000-000000000002','2026-07-13 17:08:00+00'),
      (v_amsterdam,v_demo,'Thanks for the warm welcome. I will visit next month.','34000000-0000-4000-8000-000000000003','2026-07-14 09:10:00+00'),
      (v_paris,v_demo,'Looking forward to the community meetup.','34000000-0000-4000-8000-000000000004','2026-07-15 16:20:00+00')
    on conflict (author_id, client_message_id) do nothing;

    insert into public.trade_posts (
      id, community_id, author_id, status, notes, meetup_preference,
      client_request_id, created_at, completed_at, closed_at
    ) values
      ('30000000-0000-4000-8000-000000000001',v_berlin,v_demo,'open','Looking to trade locally during Friday night. Market references are informational only.','at_store','35000000-0000-4000-8000-000000000001','2026-07-12 18:00:00+00',null,null),
      ('30000000-0000-4000-8000-000000000002',v_amsterdam,v_demo,'completed','Completed in person; no payment or sale involved.','at_store','35000000-0000-4000-8000-000000000002','2026-07-04 12:00:00+00','2026-07-06 15:00:00+00',null),
      ('30000000-0000-4000-8000-000000000003',v_paris,v_demo,'closed','Closed after changing collection priorities.','either','35000000-0000-4000-8000-000000000003','2026-06-25 10:00:00+00',null,'2026-07-02 10:00:00+00')
    on conflict (id) do nothing;

    insert into public.trade_post_offered_items (
      id, trade_post_id, source_collection_item_id, card_variant_id, quantity, condition, language
    )
    select '31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',ci.id,ci.card_variant_id,1,ci.condition,ci.language
    from public.collection_items ci where ci.owner_id=v_demo and ci.card_variant_id='13000000-0000-4000-8000-000000000009' and ci.deleted_at is null
    on conflict (id) do nothing;
    insert into public.trade_post_offered_items (
      id, trade_post_id, source_collection_item_id, card_variant_id, quantity, condition, language
    )
    select '31000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',ci.id,ci.card_variant_id,1,ci.condition,ci.language
    from public.collection_items ci where ci.owner_id=v_demo and ci.card_variant_id='13000000-0000-4000-8000-000000000007' and ci.deleted_at is null
    on conflict (id) do nothing;
    insert into public.trade_post_offered_items (
      id, trade_post_id, source_collection_item_id, card_variant_id, quantity, condition, language
    )
    select '31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',ci.id,ci.card_variant_id,1,ci.condition,ci.language
    from public.collection_items ci where ci.owner_id=v_demo and ci.card_variant_id='13000000-0000-4000-8000-000000000016' and ci.deleted_at is null
    on conflict (id) do nothing;

    insert into public.trade_post_wanted_items (
      id, trade_post_id, card_variant_id, quantity, desired_condition, desired_language
    ) values
      ('32000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000104',1,'near_mint','EN'),
      ('32000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000003',1,'near_mint','EN'),
      ('32000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000101',1,'excellent','EN')
    on conflict (id) do nothing;

    insert into public.notifications (id,user_id,kind,title,body,community_id,trade_post_id,action_url,created_at) values
      ('36000000-0000-4000-8000-000000000001',v_demo,'community_joined','Welcome to Anchor Games Berlin Crew','Membership confirmed.',v_berlin,null,'/communities/'||v_berlin::text,'2026-06-01 15:00:01+00'),
      ('36000000-0000-4000-8000-000000000002',v_demo,'matching_trade','A local trade may match your collection','Demo fixture notification.',v_berlin,'30000000-0000-4000-8000-000000000001','/communities/'||v_berlin::text,'2026-07-12 18:01:00+00'),
      ('36000000-0000-4000-8000-000000000003',v_demo,'trade_status_changed','Trade post completed','Your local trade was marked completed.',v_amsterdam,'30000000-0000-4000-8000-000000000002','/communities/'||v_amsterdam::text,'2026-07-06 15:00:00+00')
    on conflict (id) do nothing;
  end if;

  if exists (select 1 from public.app_users where id = v_alex) then
    insert into public.community_memberships (community_id,user_id,joined_via_code_id,joined_at)
    values (v_berlin,v_alex,'22000000-0000-4000-8000-000000000001','2026-06-20 12:00:00+00')
    on conflict (community_id,user_id) do nothing;
    insert into public.community_messages (community_id,author_id,body,client_message_id,created_at)
    values (v_berlin,v_alex,'I will be there Friday and can bring a Yamato parallel.','34000000-0000-4000-8000-000000000005','2026-07-13 17:12:00+00')
    on conflict (author_id,client_message_id) do nothing;
  end if;

  if exists (select 1 from public.app_users where id = v_marina) then
    insert into public.community_memberships (community_id,user_id,role,joined_via_code_id,joined_at)
    values (v_berlin,v_marina,'moderator','22000000-0000-4000-8000-000000000001','2026-05-15 12:00:00+00')
    on conflict (community_id,user_id) do update set role='moderator',status='active',suspended_at=null,suspended_by=null,suspension_reason=null,left_at=null;
  end if;

  -- DM fixtures exist only when both Auth users exist. The same shared-community
  -- invariant enforced by create_direct_conversation() is true here.
  if exists (select 1 from public.app_users where id = v_demo)
     and exists (select 1 from public.app_users where id = v_alex) then
    insert into public.direct_conversations (
      id,participant_low_id,participant_high_id,context_community_id,created_at,last_message_at
    ) values (
      v_conversation,v_demo,v_alex,v_berlin,'2026-07-13 17:20:00+00','2026-07-13 17:26:00+00'
    ) on conflict (id) do nothing;
    insert into public.direct_conversation_participants (conversation_id,user_id,last_read_at) values
      (v_conversation,v_demo,'2026-07-13 17:27:00+00'),
      (v_conversation,v_alex,'2026-07-13 17:25:00+00')
    on conflict (conversation_id,user_id) do nothing;
    insert into public.direct_messages (id,conversation_id,sender_id,body,client_message_id,created_at) values
      ('37000000-0000-4000-8000-000000000001',v_conversation,v_demo,'Hi Alex — shall we compare cards at the store on Friday?','38000000-0000-4000-8000-000000000001','2026-07-13 17:21:00+00'),
      ('37000000-0000-4000-8000-000000000002',v_conversation,v_alex,'Sounds good. I will message when I arrive.','38000000-0000-4000-8000-000000000002','2026-07-13 17:26:00+00')
    on conflict (id) do nothing;
  end if;
end;
$$;

commit;

-- Catalog history can be seeded without Auth users and is kept in its own
-- transaction so conditional private fixtures never prevent public demo data.
begin;


with ranked as (
  select s.id, s.language, row_number() over (order by s.id) as rn
  from public.sealed_products s
  where s.game_id = '10000000-0000-4000-8000-000000000001' and s.archived_at is null
), rows_to_insert as (
  select
    p.id as provider_id,
    r.id as sealed_product_id,
    p.slug || '-sealed-' || replace(r.id::text, '-', '') as provider_product_id,
    r.language,
    jsonb_build_object(
      'demo_fixture', true,
      'seed_base', round((24 + r.rn * 31.50)::numeric, 2),
      'seed_trend', case when r.rn % 2 = 0 then -0.0035 else 0.0055 end,
      'unavailable', (p.slug = 'cardmarket' and r.rn = 6)
    ) as metadata
  from ranked r cross join public.pricing_providers p
  where p.id in ('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002')
)
insert into public.provider_catalog_mappings (
  provider_id, sealed_product_id, provider_product_id, condition, language, variant_key,
  mapping_metadata, verified_at
)
select provider_id, sealed_product_id, provider_product_id, 'sealed', language,
  'sealed', metadata, '2026-07-16 08:00:00+00'
from rows_to_insert
on conflict do nothing;

-- Thirty-one daily observations per provider/asset. Quantity history is separate,
-- allowing portfolio calculations to distinguish inventory changes from performance.
insert into public.price_snapshots (
  mapping_id, provider_id, card_variant_id, sealed_product_id, currency, market_value,
  condition, language, observed_at, data_mode
)
select
  m.id,
  m.provider_id,
  m.card_variant_id,
  m.sealed_product_id,
  p.native_currency,
  case when coalesce((m.mapping_metadata ->> 'unavailable')::boolean, false) then null else
    round((
      (m.mapping_metadata ->> 'seed_base')::numeric
      * case when p.native_currency = 'USD' then 1.09 else 1 end
      * (1 + (m.mapping_metadata ->> 'seed_trend')::numeric * (30 - d.day)
           + 0.018 * sin((d.day + abs(hashtext(m.provider_product_id)) % 11)::double precision / 3.1))
    )::numeric, 2)
  end,
  m.condition,
  m.language,
  '2026-07-16 08:00:00+00'::timestamptz - make_interval(days => d.day),
  'demo_fixture'
from public.provider_catalog_mappings m
join public.pricing_providers p on p.id = m.provider_id
cross join generate_series(0, 30) as d(day)
where m.disabled_at is null
  and p.id in ('15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002')
on conflict (mapping_id, observed_at) do update set market_value = excluded.market_value;

insert into public.provider_raw_responses (
  provider_id, provider_request_id, http_status, fetched_at, response_payload, payload_sha256, purge_after
)
select
  m.provider_id,
  'demo-current-' || m.id::text,
  200,
  '2026-07-16 08:00:00+00',
  jsonb_build_object('fixture', true, 'warning', 'Demo market data — not a live provider response'),
  extensions.digest(
    jsonb_build_object('fixture', true, 'warning', 'Demo market data — not a live provider response')::text,
    'sha256'
  ),
  '2026-08-15 08:00:00+00'
from public.provider_catalog_mappings m
where m.disabled_at is null
on conflict (provider_id, provider_request_id) do nothing;

insert into public.price_quotes (
  mapping_id, provider_id, card_variant_id, sealed_product_id, provider_product_id,
  provider_request_id, raw_response_id, region, currency, market_value, low_value, average_value, trend_value,
  condition, language, variant_key, fetched_at, cached_at, expires_at, freshness, data_mode,
  is_currency_converted
)
select
  m.id, m.provider_id, m.card_variant_id, m.sealed_product_id, m.provider_product_id,
  'demo-current-' || m.id::text,
  r.id,
  p.market_region, p.native_currency,
  s.market_value,
  case when s.market_value is null then null else round(s.market_value * 0.91, 2) end,
  case when s.market_value is null then null else round(s.market_value * 1.02, 2) end,
  case when s.market_value is null then null else round(s.market_value * 0.98, 2) end,
  m.condition, m.language, m.variant_key,
  '2026-07-16 08:00:00+00', '2026-07-16 08:00:00+00', '2026-07-16 08:15:00+00',
  case when s.market_value is null then 'unavailable'::public.quote_freshness else 'fresh'::public.quote_freshness end,
  'demo_fixture', false
from public.provider_catalog_mappings m
join public.pricing_providers p on p.id = m.provider_id
join public.provider_raw_responses r
  on r.provider_id = m.provider_id and r.provider_request_id = 'demo-current-' || m.id::text
join public.price_snapshots s on s.mapping_id = m.id and s.observed_at = '2026-07-16 08:00:00+00'
where m.disabled_at is null
on conflict do nothing;

-- Backfill system-captured references for trade items that were conditionally
-- inserted before the quote fixture transaction. Authenticated clients have no
-- INSERT/UPDATE grant on this table.
with item_targets as (
  select i.id as offered_item_id, null::uuid as wanted_item_id, i.card_variant_id, i.sealed_product_id
  from public.trade_post_offered_items i
  union all
  select null::uuid, i.id, i.card_variant_id, i.sealed_product_id
  from public.trade_post_wanted_items i
), latest as (
  select distinct on (t.offered_item_id, t.wanted_item_id, q.provider_id)
    t.offered_item_id, t.wanted_item_id, q.provider_id, q.id as source_quote_id,
    q.currency, q.market_value, q.fetched_at, q.data_mode
  from item_targets t
  join public.price_quotes q
    on q.card_variant_id is not distinct from t.card_variant_id
   and q.sealed_product_id is not distinct from t.sealed_product_id
  order by t.offered_item_id, t.wanted_item_id, q.provider_id, q.fetched_at desc
)
insert into public.trade_item_market_references (
  offered_item_id, wanted_item_id, provider_id, source_quote_id, currency, market_value, captured_at, data_mode
)
select offered_item_id, wanted_item_id, provider_id, source_quote_id, currency, market_value, fetched_at, data_mode
from latest
on conflict do nothing;

commit;
