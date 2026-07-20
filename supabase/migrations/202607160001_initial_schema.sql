-- TCG Harbor: initial production schema
-- PostgreSQL 15+ / Supabase. All timestamps are UTC timestamptz values.
-- auth.users is the authentication User entity; app_users is its application shadow.

begin;

create schema if not exists extensions;
create schema if not exists private;
revoke all on schema private from public;
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum (
  'collector', 'store_administrator', 'community_moderator', 'platform_administrator'
);
create type public.account_status as enum ('active', 'suspended', 'deactivated');
create type public.market_region as enum ('europe', 'united_states');
create type public.currency_code as enum ('EUR', 'USD');
create type public.catalog_asset_type as enum ('card', 'sealed_product');
create type public.item_condition as enum (
  'mint', 'near_mint', 'excellent', 'good', 'light_played', 'played', 'poor', 'sealed'
);
create type public.language_code as enum ('EN', 'DE', 'FR', 'IT', 'ES', 'PT', 'JP', 'KR', 'ZH');
create type public.sealed_product_type as enum (
  'booster_box', 'booster_pack', 'starter_deck', 'special_collection', 'gift_collection',
  'promotional_product', 'tournament_product', 'case', 'other'
);
create type public.membership_status as enum ('active', 'suspended', 'left');
create type public.membership_role as enum ('member', 'moderator');
create type public.trade_status as enum ('open', 'discussing', 'completed', 'closed');
create type public.meetup_preference as enum ('at_store', 'local_public_place', 'either');
create type public.quote_freshness as enum ('fresh', 'stale', 'unavailable');
create type public.price_data_mode as enum ('live', 'demo_fixture');
create type public.join_attempt_outcome as enum (
  'joined', 'already_member', 'invalid', 'expired', 'revoked', 'rate_limited'
);
create type public.notification_kind as enum (
  'direct_message', 'community_reply', 'matching_trade', 'wanted_card_owned',
  'trade_status_changed', 'community_joined', 'system'
);
create type public.report_reason as enum (
  'spam', 'harassment', 'fraud_or_scam', 'inappropriate_content', 'privacy', 'other'
);
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

create table public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  status public.account_status not null default 'active',
  roles public.app_role[] not null default array['collector'::public.app_role],
  last_seen_at timestamptz,
  suspended_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_email_sane check (email is null or (length(email) between 3 and 320 and email = btrim(email))),
  constraint app_users_roles_nonempty check (cardinality(roles) > 0),
  constraint app_users_deactivation_consistent check (
    (status = 'deactivated' and deactivated_at is not null) or status <> 'deactivated'
  )
);
create unique index app_users_email_unique on public.app_users (lower(email)) where email is not null;

create table public.user_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  username text not null,
  display_name text,
  avatar_url text,
  primary_market public.market_region not null default 'europe',
  preferred_currency public.currency_code not null default 'EUR',
  approximate_city text,
  approximate_postcode text,
  timezone text not null default 'UTC',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint user_profiles_username_shape check (
    username = lower(username) and username ~ '^[a-z0-9][a-z0-9_.-]{2,29}$'
  ),
  constraint user_profiles_display_name_length check (display_name is null or length(display_name) between 1 and 80),
  constraint user_profiles_location_length check (
    (approximate_city is null or length(approximate_city) <= 120)
    and (approximate_postcode is null or length(approximate_postcode) <= 24)
  )
);
create unique index user_profiles_username_unique on public.user_profiles (lower(username)) where deleted_at is null;

create table public.notification_preferences (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  direct_messages boolean not null default true,
  community_replies boolean not null default true,
  matching_trades boolean not null default true,
  trade_updates boolean not null default true,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  quiet_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_quiet_hours_object check (jsonb_typeof(quiet_hours) = 'object')
);

create table public.games (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null,
  name text not null,
  publisher text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint games_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create unique index games_slug_unique on public.games (lower(slug));

create table public.card_sets (
  id uuid primary key default extensions.gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  code text not null,
  name text not null,
  release_date date,
  image_url text,
  external_identifiers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint card_sets_code_shape check (code = upper(code) and length(code) between 2 and 24),
  constraint card_sets_external_ids_object check (jsonb_typeof(external_identifiers) = 'object'),
  unique (id, game_id)
);
create unique index card_sets_game_code_unique on public.card_sets (game_id, upper(code)) where archived_at is null;
create index card_sets_game_idx on public.card_sets (game_id, release_date desc);

create table public.cards (
  id uuid primary key default extensions.gen_random_uuid(),
  game_id uuid not null,
  card_set_id uuid not null,
  card_number text not null,
  name text not null,
  rarity text not null,
  card_type text not null,
  colors text[] not null default '{}',
  image_url text,
  release_date date,
  external_identifiers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint cards_set_game_fk foreign key (card_set_id, game_id)
    references public.card_sets(id, game_id) on delete restrict,
  constraint cards_card_number_nonempty check (length(btrim(card_number)) between 1 and 32),
  constraint cards_name_nonempty check (length(btrim(name)) between 1 and 160),
  constraint cards_external_ids_object check (jsonb_typeof(external_identifiers) = 'object')
);
create unique index cards_set_number_unique on public.cards (card_set_id, upper(card_number)) where archived_at is null;
create index cards_game_name_idx on public.cards (game_id, lower(name));
create index cards_set_idx on public.cards (card_set_id);

create table public.card_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete restrict,
  variant_identifier text not null default 'base',
  variant_name text not null default 'Base',
  language public.language_code not null default 'EN',
  image_url text,
  external_identifiers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint card_variants_identifier_nonempty check (length(btrim(variant_identifier)) between 1 and 80),
  constraint card_variants_external_ids_object check (jsonb_typeof(external_identifiers) = 'object')
);
create unique index card_variants_identity_unique
  on public.card_variants (card_id, lower(variant_identifier), language) where archived_at is null;
create index card_variants_card_idx on public.card_variants (card_id);

create table public.sealed_products (
  id uuid primary key default extensions.gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  card_set_id uuid,
  name text not null,
  product_type public.sealed_product_type not null,
  language public.language_code not null default 'EN',
  region text,
  image_url text,
  release_date date,
  external_identifiers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint sealed_products_set_game_fk foreign key (card_set_id, game_id)
    references public.card_sets(id, game_id) on delete restrict,
  constraint sealed_products_name_nonempty check (length(btrim(name)) between 1 and 200),
  constraint sealed_products_external_ids_object check (jsonb_typeof(external_identifiers) = 'object')
);
create unique index sealed_products_identity_unique
  on public.sealed_products (game_id, lower(name), product_type, language) where archived_at is null;
create index sealed_products_set_idx on public.sealed_products (card_set_id);

create table public.collection_items (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.app_users(id) on delete cascade,
  card_variant_id uuid references public.card_variants(id) on delete restrict,
  sealed_product_id uuid references public.sealed_products(id) on delete restrict,
  condition public.item_condition not null,
  language public.language_code not null,
  quantity integer not null default 1,
  acquired_on date,
  purchase_unit_amount numeric(14,2),
  purchase_currency public.currency_code,
  private_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint collection_items_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint collection_items_quantity_positive check (quantity between 1 and 100000),
  constraint collection_items_purchase_pair check (
    (purchase_unit_amount is null and purchase_currency is null)
    or (purchase_unit_amount is not null and purchase_currency is not null and purchase_unit_amount >= 0)
  ),
  constraint collection_items_note_length check (private_note is null or length(private_note) <= 4000)
);
create unique index collection_items_active_card_unique
  on public.collection_items (owner_id, card_variant_id, condition, language)
  where deleted_at is null and card_variant_id is not null;
create unique index collection_items_active_sealed_unique
  on public.collection_items (owner_id, sealed_product_id, condition, language)
  where deleted_at is null and sealed_product_id is not null;
create index collection_items_owner_active_idx on public.collection_items (owner_id, created_at desc) where deleted_at is null;
create index collection_items_card_variant_idx on public.collection_items (card_variant_id) where deleted_at is null;
create index collection_items_sealed_product_idx on public.collection_items (sealed_product_id) where deleted_at is null;

create table public.collection_quantity_history (
  id bigint generated always as identity primary key,
  collection_item_id uuid not null references public.collection_items(id) on delete cascade,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  quantity integer not null,
  effective_at timestamptz not null default now(),
  reason text not null default 'quantity_changed',
  constraint collection_quantity_history_quantity_nonnegative check (quantity >= 0),
  constraint collection_quantity_history_reason_length check (length(reason) between 1 and 80)
);
create index collection_quantity_history_lookup_idx
  on public.collection_quantity_history (owner_id, collection_item_id, effective_at desc);
create unique index collection_quantity_history_event_unique
  on public.collection_quantity_history (collection_item_id, effective_at, reason);

create table public.pricing_providers (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null,
  name text not null,
  market_region public.market_region not null,
  native_currency public.currency_code not null,
  data_mode public.price_data_mode not null default 'demo_fixture',
  is_enabled boolean not null default true,
  credential_secret_name text,
  requests_per_minute integer not null default 30,
  min_refresh_interval_seconds integer not null default 300,
  last_sync_at timestamptz,
  next_sync_allowed_at timestamptz,
  sync_lock_until timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_providers_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint pricing_providers_rate_limits check (
    requests_per_minute between 1 and 10000 and min_refresh_interval_seconds between 1 and 86400
    and consecutive_failures >= 0
  )
);
create unique index pricing_providers_slug_unique on public.pricing_providers (lower(slug));

create table public.provider_catalog_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_id uuid not null references public.pricing_providers(id) on delete cascade,
  card_variant_id uuid references public.card_variants(id) on delete cascade,
  sealed_product_id uuid references public.sealed_products(id) on delete cascade,
  provider_product_id text not null,
  provider_listing_id text,
  condition public.item_condition not null,
  language public.language_code not null,
  variant_key text not null default 'base',
  mapping_metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint provider_mappings_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint provider_mappings_product_id_nonempty check (length(btrim(provider_product_id)) between 1 and 180),
  constraint provider_mappings_metadata_object check (jsonb_typeof(mapping_metadata) = 'object')
);
create unique index provider_mappings_external_unique
  on public.provider_catalog_mappings (provider_id, provider_product_id, condition, language, variant_key)
  where disabled_at is null;
create unique index provider_mappings_card_unique
  on public.provider_catalog_mappings (provider_id, card_variant_id, condition, language, variant_key)
  where disabled_at is null and card_variant_id is not null;
create unique index provider_mappings_sealed_unique
  on public.provider_catalog_mappings (provider_id, sealed_product_id, condition, language, variant_key)
  where disabled_at is null and sealed_product_id is not null;
create index provider_mappings_card_idx on public.provider_catalog_mappings (card_variant_id);
create index provider_mappings_sealed_idx on public.provider_catalog_mappings (sealed_product_id);

-- Original licensed-provider payloads are deliberately separated from normalized
-- quotes and have no anon/authenticated API grant or RLS policy.
create table public.provider_raw_responses (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_id uuid not null references public.pricing_providers(id) on delete cascade,
  provider_request_id text not null,
  http_status smallint,
  fetched_at timestamptz not null,
  response_payload jsonb not null,
  payload_sha256 bytea not null,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  constraint provider_raw_response_request_nonempty check (length(btrim(provider_request_id)) between 1 and 240),
  constraint provider_raw_response_http_status check (http_status is null or http_status between 100 and 599),
  constraint provider_raw_response_payload_type check (jsonb_typeof(response_payload) in ('object', 'array')),
  constraint provider_raw_response_checksum check (
    payload_sha256 = extensions.digest(response_payload::text, 'sha256')
  ),
  unique (provider_id, provider_request_id)
);
create index provider_raw_responses_purge_idx on public.provider_raw_responses (purge_after) where purge_after is not null;

create table public.price_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  mapping_id uuid not null references public.provider_catalog_mappings(id) on delete cascade,
  provider_id uuid not null references public.pricing_providers(id) on delete restrict,
  card_variant_id uuid references public.card_variants(id) on delete cascade,
  sealed_product_id uuid references public.sealed_products(id) on delete cascade,
  provider_product_id text not null,
  provider_request_id text not null,
  raw_response_id uuid not null references public.provider_raw_responses(id) on delete restrict,
  region public.market_region not null,
  currency public.currency_code not null,
  market_value numeric(14,2),
  low_value numeric(14,2),
  average_value numeric(14,2),
  trend_value numeric(14,2),
  condition public.item_condition not null,
  language public.language_code not null,
  variant_key text not null default 'base',
  fetched_at timestamptz not null,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null,
  freshness public.quote_freshness not null,
  data_mode public.price_data_mode not null,
  is_currency_converted boolean not null default false,
  conversion_rate numeric(18,8),
  conversion_source text,
  created_at timestamptz not null default now(),
  constraint price_quotes_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint price_quotes_values_nonnegative check (
    (market_value is null or market_value >= 0) and (low_value is null or low_value >= 0)
    and (average_value is null or average_value >= 0) and (trend_value is null or trend_value >= 0)
  ),
  constraint price_quotes_unavailable_is_null check (freshness <> 'unavailable' or market_value is null),
  constraint price_quotes_conversion_consistent check (
    (not is_currency_converted and conversion_rate is null and conversion_source is null)
    or (is_currency_converted and conversion_rate > 0 and conversion_source is not null)
  ),
  constraint price_quotes_cache_window check (expires_at >= cached_at)
);
create index price_quotes_latest_card_idx on public.price_quotes (card_variant_id, provider_id, fetched_at desc);
create index price_quotes_latest_sealed_idx on public.price_quotes (sealed_product_id, provider_id, fetched_at desc);
create index price_quotes_mapping_idx on public.price_quotes (mapping_id, fetched_at desc);
create index price_quotes_expiry_idx on public.price_quotes (provider_id, expires_at) where freshness <> 'unavailable';
create unique index price_quotes_provider_request_unique
  on public.price_quotes (provider_id, provider_request_id);

create table public.price_snapshots (
  id bigint generated always as identity primary key,
  mapping_id uuid not null references public.provider_catalog_mappings(id) on delete cascade,
  provider_id uuid not null references public.pricing_providers(id) on delete restrict,
  card_variant_id uuid references public.card_variants(id) on delete cascade,
  sealed_product_id uuid references public.sealed_products(id) on delete cascade,
  currency public.currency_code not null,
  market_value numeric(14,2),
  condition public.item_condition not null,
  language public.language_code not null,
  observed_at timestamptz not null,
  data_mode public.price_data_mode not null,
  source_quote_id uuid references public.price_quotes(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint price_snapshots_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint price_snapshots_value_nonnegative check (market_value is null or market_value >= 0),
  unique (mapping_id, observed_at)
);
create index price_snapshots_card_history_idx
  on public.price_snapshots (card_variant_id, provider_id, observed_at desc) include (market_value, currency);
create index price_snapshots_sealed_history_idx
  on public.price_snapshots (sealed_product_id, provider_id, observed_at desc) include (market_value, currency);

create table public.stores (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  region text,
  postcode text not null,
  country_code char(2) not null,
  latitude double precision not null,
  longitude double precision not null,
  timezone text not null,
  opening_hours jsonb not null default '{}'::jsonb,
  contact_email text,
  phone text,
  website_url text,
  image_url text,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint stores_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint stores_coordinates check (latitude between -90 and 90 and longitude between -180 and 180),
  constraint stores_country_code_upper check (country_code = upper(country_code)),
  constraint stores_opening_hours_object check (jsonb_typeof(opening_hours) = 'object'),
  constraint stores_description_length check (description is null or length(description) <= 4000)
);
create unique index stores_slug_unique on public.stores (lower(slug)) where deleted_at is null;
create index stores_location_idx on public.stores (country_code, city, latitude, longitude) where deleted_at is null and is_active;

create table public.store_administrators (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  assigned_by uuid references public.app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (store_id, user_id)
);
create index store_administrators_user_idx on public.store_administrators (user_id, store_id) where revoked_at is null;

create table public.communities (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null,
  description text,
  rules text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint communities_name_length check (length(btrim(name)) between 1 and 160),
  constraint communities_text_length check (
    (description is null or length(description) <= 4000) and (rules is null or length(rules) <= 10000)
  )
);
create unique index communities_active_store_unique on public.communities (store_id) where deleted_at is null;

create table public.store_join_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  code_hash bytea not null,
  code_prefix text not null,
  label text,
  expires_at timestamptz,
  max_uses integer,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint store_join_codes_prefix_length check (length(code_prefix) between 4 and 16),
  constraint store_join_codes_use_limits check (
    use_count >= 0 and (max_uses is null or (max_uses > 0 and use_count <= max_uses))
  )
);
create unique index store_join_codes_hash_unique on public.store_join_codes (code_hash);
create index store_join_codes_active_idx
  on public.store_join_codes (store_id, expires_at) where deactivated_at is null;
create index store_join_codes_community_idx on public.store_join_codes (community_id);

create table public.community_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role public.membership_role not null default 'member',
  status public.membership_status not null default 'active',
  joined_via_code_id uuid references public.store_join_codes(id) on delete set null,
  joined_at timestamptz not null default now(),
  last_read_chat_at timestamptz,
  suspended_at timestamptz,
  suspended_by uuid references public.app_users(id) on delete set null,
  suspension_reason text,
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint community_memberships_status_timestamps check (
    (status <> 'suspended' or suspended_at is not null)
    and (status <> 'left' or left_at is not null)
  ),
  constraint community_memberships_suspension_reason_length check (
    suspension_reason is null or length(suspension_reason) <= 1000
  ),
  unique (community_id, user_id)
);
create index community_memberships_user_active_idx
  on public.community_memberships (user_id, community_id) where status = 'active';
create index community_memberships_community_active_idx
  on public.community_memberships (community_id, joined_at desc) where status = 'active';
create index community_memberships_join_code_idx on public.community_memberships (joined_via_code_id)
  where joined_via_code_id is not null;

create table public.store_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid references public.app_users(id) on delete set null,
  code_prefix text,
  request_fingerprint_hash bytea,
  outcome public.join_attempt_outcome not null,
  attempted_at timestamptz not null default now()
);
create index store_join_attempts_user_rate_idx on public.store_join_attempts (user_id, attempted_at desc);
create index store_join_attempts_fingerprint_rate_idx
  on public.store_join_attempts (request_fingerprint_hash, attempted_at desc)
  where request_fingerprint_hash is not null;

create table public.community_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.app_users(id) on delete cascade,
  reply_to_id uuid references public.community_messages(id) on delete set null,
  body text not null,
  client_message_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.app_users(id) on delete set null,
  constraint community_messages_body_length check (length(body) between 1 and 4000),
  unique (author_id, client_message_id)
);
create index community_messages_feed_idx
  on public.community_messages (community_id, created_at desc) where deleted_at is null;
create index community_messages_author_rate_idx on public.community_messages (author_id, created_at desc);
create index community_messages_reply_idx on public.community_messages (reply_to_id) where reply_to_id is not null;

create table public.trade_posts (
  id uuid primary key default extensions.gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.app_users(id) on delete cascade,
  status public.trade_status not null default 'open',
  notes text,
  meetup_preference public.meetup_preference not null default 'at_store',
  client_request_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  constraint trade_posts_notes_length check (notes is null or length(notes) <= 4000),
  constraint trade_posts_status_timestamps check (
    (status <> 'completed' or completed_at is not null)
    and (status <> 'closed' or closed_at is not null)
  ),
  unique (author_id, client_request_id)
);
create index trade_posts_community_feed_idx
  on public.trade_posts (community_id, status, created_at desc) where deleted_at is null;
create index trade_posts_author_rate_idx on public.trade_posts (author_id, created_at desc);

create table public.trade_post_offered_items (
  id uuid primary key default extensions.gen_random_uuid(),
  trade_post_id uuid not null references public.trade_posts(id) on delete cascade,
  source_collection_item_id uuid references public.collection_items(id) on delete set null,
  card_variant_id uuid references public.card_variants(id) on delete restrict,
  sealed_product_id uuid references public.sealed_products(id) on delete restrict,
  quantity integer not null,
  condition public.item_condition not null,
  language public.language_code not null,
  created_at timestamptz not null default now(),
  constraint trade_offered_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint trade_offered_quantity_positive check (quantity between 1 and 100000)
);
create index trade_offered_post_idx on public.trade_post_offered_items (trade_post_id);
create index trade_offered_card_idx on public.trade_post_offered_items (card_variant_id) where card_variant_id is not null;
create index trade_offered_sealed_idx on public.trade_post_offered_items (sealed_product_id) where sealed_product_id is not null;
create index trade_offered_source_collection_idx on public.trade_post_offered_items (source_collection_item_id)
  where source_collection_item_id is not null;

create table public.trade_post_wanted_items (
  id uuid primary key default extensions.gen_random_uuid(),
  trade_post_id uuid not null references public.trade_posts(id) on delete cascade,
  card_variant_id uuid references public.card_variants(id) on delete restrict,
  sealed_product_id uuid references public.sealed_products(id) on delete restrict,
  quantity integer not null default 1,
  desired_condition public.item_condition,
  desired_language public.language_code,
  created_at timestamptz not null default now(),
  constraint trade_wanted_exactly_one_asset check (
    (card_variant_id is not null)::integer + (sealed_product_id is not null)::integer = 1
  ),
  constraint trade_wanted_quantity_positive check (quantity between 1 and 100000)
);
create index trade_wanted_post_idx on public.trade_post_wanted_items (trade_post_id);
create index trade_wanted_card_idx on public.trade_post_wanted_items (card_variant_id) where card_variant_id is not null;
create index trade_wanted_sealed_idx on public.trade_post_wanted_items (sealed_product_id) where sealed_product_id is not null;

-- Market references are system-captured snapshots. There is intentionally no user-entered sale-price column.
create table public.trade_item_market_references (
  id uuid primary key default extensions.gen_random_uuid(),
  offered_item_id uuid references public.trade_post_offered_items(id) on delete cascade,
  wanted_item_id uuid references public.trade_post_wanted_items(id) on delete cascade,
  provider_id uuid not null references public.pricing_providers(id) on delete restrict,
  source_quote_id uuid references public.price_quotes(id) on delete set null,
  currency public.currency_code not null,
  market_value numeric(14,2),
  captured_at timestamptz not null default now(),
  data_mode public.price_data_mode not null,
  constraint trade_market_ref_exactly_one_item check (
    (offered_item_id is not null)::integer + (wanted_item_id is not null)::integer = 1
  ),
  constraint trade_market_ref_nonnegative check (market_value is null or market_value >= 0)
);
create unique index trade_market_ref_offered_unique
  on public.trade_item_market_references (offered_item_id, provider_id) where offered_item_id is not null;
create unique index trade_market_ref_wanted_unique
  on public.trade_item_market_references (wanted_item_id, provider_id) where wanted_item_id is not null;

create table public.direct_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  participant_low_id uuid not null references public.app_users(id) on delete cascade,
  participant_high_id uuid not null references public.app_users(id) on delete cascade,
  context_community_id uuid not null references public.communities(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  deleted_at timestamptz,
  constraint direct_conversations_distinct_participants check (participant_low_id <> participant_high_id),
  constraint direct_conversations_canonical_order check (participant_low_id::text < participant_high_id::text)
);
create unique index direct_conversations_pair_unique
  on public.direct_conversations (participant_low_id, participant_high_id) where deleted_at is null;
create index direct_conversations_low_idx on public.direct_conversations (participant_low_id, last_message_at desc);
create index direct_conversations_high_idx on public.direct_conversations (participant_high_id, last_message_at desc);

create table public.direct_conversation_participants (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  last_read_at timestamptz,
  hidden_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index direct_participants_user_idx on public.direct_conversation_participants (user_id, updated_at desc);

create table public.direct_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.app_users(id) on delete cascade,
  body text not null,
  client_message_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint direct_messages_body_length check (length(body) between 1 and 4000),
  unique (sender_id, client_message_id)
);
create index direct_messages_conversation_feed_idx
  on public.direct_messages (conversation_id, created_at desc) where deleted_at is null;
create index direct_messages_sender_rate_idx on public.direct_messages (sender_id, created_at desc);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null,
  body text,
  action_url text,
  actor_id uuid references public.app_users(id) on delete set null,
  community_id uuid references public.communities(id) on delete cascade,
  trade_post_id uuid references public.trade_posts(id) on delete cascade,
  direct_message_id uuid references public.direct_messages(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  constraint notifications_title_length check (length(title) between 1 and 180),
  constraint notifications_body_length check (body is null or length(body) <= 1000),
  constraint notifications_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null and dismissed_at is null;
create index notifications_community_idx on public.notifications (community_id) where community_id is not null;
create index notifications_trade_idx on public.notifications (trade_post_id) where trade_post_id is not null;
create index notifications_direct_message_idx on public.notifications (direct_message_id) where direct_message_id is not null;

create table public.user_blocks (
  blocker_id uuid not null references public.app_users(id) on delete cascade,
  blocked_user_id uuid not null references public.app_users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_user_id),
  constraint user_blocks_reason_length check (reason is null or length(reason) <= 500)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_user_id, blocker_id);

create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.app_users(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  community_message_id uuid references public.community_messages(id) on delete set null,
  trade_post_id uuid references public.trade_posts(id) on delete set null,
  direct_message_id uuid references public.direct_messages(id) on delete set null,
  reported_user_id uuid references public.app_users(id) on delete set null,
  reason public.report_reason not null,
  details text,
  status public.report_status not null default 'open',
  reviewed_by uuid references public.app_users(id) on delete set null,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_exactly_one_target check (
    (community_message_id is not null)::integer + (trade_post_id is not null)::integer
    + (direct_message_id is not null)::integer + (reported_user_id is not null)::integer = 1
  ),
  constraint reports_details_length check (details is null or length(details) <= 4000),
  constraint reports_resolution_length check (resolution_notes is null or length(resolution_notes) <= 4000),
  constraint reports_resolution_consistent check (status not in ('resolved', 'dismissed') or resolved_at is not null)
);
create index reports_moderation_queue_idx on public.reports (community_id, status, created_at) where status in ('open', 'reviewing');
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_community_message_idx on public.reports (community_message_id) where community_message_id is not null;
create index reports_trade_post_idx on public.reports (trade_post_id) where trade_post_id is not null;
create index reports_direct_message_idx on public.reports (direct_message_id) where direct_message_id is not null;
create index reports_reported_user_idx on public.reports (reported_user_id) where reported_user_id is not null;

create table public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  actor_id uuid references public.app_users(id) on delete set null,
  community_id uuid references public.communities(id) on delete cascade,
  activity_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint activity_logs_type_length check (length(activity_type) between 1 and 80),
  constraint activity_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index activity_logs_user_feed_idx on public.activity_logs (user_id, occurred_at desc);
create index activity_logs_community_idx on public.activity_logs (community_id, occurred_at desc) where community_id is not null;

-- ---------------------------------------------------------------------------
-- Shared functions and integrity triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_user_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g')), '');
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  insert into public.app_users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();

  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if v_username !~ '^[a-z0-9][a-z0-9_.-]{2,29}$'
     or exists (select 1 from public.user_profiles p where lower(p.username) = v_username) then
    v_username := 'user_' || replace(substr(new.id::text, 1, 13), '-', '');
  end if;

  insert into public.user_profiles (user_id, username, display_name, avatar_url)
  values (
    new.id,
    v_username,
    nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tcg_harbor on auth.users;
create trigger on_auth_user_created_tcg_harbor
  after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function private.has_app_role(p_role public.app_role, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users u
    where u.id = p_user_id and u.status = 'active' and p_role = any(u.roles)
  );
$$;

create or replace function private.is_active_community_member(p_community_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.community_memberships m
    join public.communities c on c.id = m.community_id
    join public.stores s on s.id = c.store_id
    join public.app_users u on u.id = m.user_id
    where m.community_id = p_community_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and c.is_active and c.deleted_at is null
      and s.is_active and s.deleted_at is null
      and u.status = 'active'
  );
$$;

create or replace function private.is_store_administrator(p_store_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.store_administrators a
    join public.app_users u on u.id = a.user_id
    where a.store_id = p_store_id and a.user_id = p_user_id
      and a.revoked_at is null and u.status = 'active'
  );
$$;

create or replace function private.can_moderate_community(p_community_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_app_role('platform_administrator', p_user_id)
    or exists (
      select 1 from public.communities c
      where c.id = p_community_id and private.is_store_administrator(c.store_id, p_user_id)
    )
    or exists (
      select 1 from public.community_memberships m
      where m.community_id = p_community_id and m.user_id = p_user_id
        and m.status = 'active' and m.role = 'moderator'
    );
$$;

create or replace function private.users_share_active_community(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_a <> p_user_b and exists (
    select 1
    from public.community_memberships a
    join public.community_memberships b on b.community_id = a.community_id
    join public.communities c on c.id = a.community_id
    join public.stores s on s.id = c.store_id
    join public.app_users ua on ua.id = a.user_id
    join public.app_users ub on ub.id = b.user_id
    where a.user_id = p_user_a and b.user_id = p_user_b
      and a.status = 'active' and b.status = 'active'
      and c.is_active and c.deleted_at is null
      and s.is_active and s.deleted_at is null
      and ua.status = 'active' and ub.status = 'active'
  );
$$;

create or replace function private.users_are_blocked(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_user_a and b.blocked_user_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_user_id = p_user_a)
  );
$$;

create or replace function private.is_direct_conversation_participant(
  p_conversation_id uuid, p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.direct_conversations c
    where c.id = p_conversation_id and c.deleted_at is null
      and p_user_id in (c.participant_low_id, c.participant_high_id)
  );
$$;

create or replace function public.validate_price_record_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mapping public.provider_catalog_mappings%rowtype;
  v_provider public.pricing_providers%rowtype;
begin
  select * into v_mapping from public.provider_catalog_mappings where id = new.mapping_id;
  if not found then raise exception 'Unknown provider mapping'; end if;
  if new.provider_id <> v_mapping.provider_id
     or new.card_variant_id is distinct from v_mapping.card_variant_id
     or new.sealed_product_id is distinct from v_mapping.sealed_product_id
     or new.condition <> v_mapping.condition
     or new.language <> v_mapping.language then
    raise exception 'Price row does not match its stable provider mapping';
  end if;
  if tg_table_name = 'price_quotes'
     and (to_jsonb(new) ->> 'provider_product_id') <> v_mapping.provider_product_id then
    raise exception 'Provider product identifier does not match mapping';
  end if;
  select * into v_provider from public.pricing_providers where id = new.provider_id;
  if tg_table_name = 'price_quotes' then
    if (to_jsonb(new) ->> 'region')::public.market_region <> v_provider.market_region then
      raise exception 'Quote region does not match provider';
    end if;
    if not coalesce((to_jsonb(new) ->> 'is_currency_converted')::boolean, false)
       and new.currency <> v_provider.native_currency then
      raise exception 'Native quote currency does not match provider';
    end if;
    if (to_jsonb(new) ->> 'raw_response_id') is not null and not exists (
      select 1 from public.provider_raw_responses r
      where r.id = (to_jsonb(new) ->> 'raw_response_id')::uuid
        and r.provider_id = new.provider_id
        and r.provider_request_id = (to_jsonb(new) ->> 'provider_request_id')
    ) then
      raise exception 'Raw provider response does not match quote request';
    end if;
  elsif new.currency <> v_provider.native_currency then
    raise exception 'Snapshots must preserve the provider native currency';
  end if;
  return new;
end;
$$;

create trigger validate_price_quote_target
  before insert or update on public.price_quotes
  for each row execute function public.validate_price_record_target();
create trigger validate_price_snapshot_target
  before insert or update on public.price_snapshots
  for each row execute function public.validate_price_record_target();

create or replace function public.validate_catalog_target_language()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_language public.language_code;
begin
  if new.card_variant_id is not null then
    select v.language into v_language from public.card_variants v where v.id = new.card_variant_id;
  else
    select s.language into v_language from public.sealed_products s where s.id = new.sealed_product_id;
  end if;
  if not found or new.language <> v_language then
    raise exception 'Catalog target language does not match the selected asset';
  end if;
  return new;
end;
$$;
create trigger collection_target_language_guard
  before insert or update of card_variant_id, sealed_product_id, language on public.collection_items
  for each row execute function public.validate_catalog_target_language();
create trigger provider_mapping_target_language_guard
  before insert or update of card_variant_id, sealed_product_id, language on public.provider_catalog_mappings
  for each row execute function public.validate_catalog_target_language();

create or replace function public.record_collection_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.collection_quantity_history (collection_item_id, owner_id, quantity, effective_at, reason)
    values (new.id, new.owner_id, new.quantity, new.created_at, 'item_added');
  elsif new.quantity is distinct from old.quantity or new.deleted_at is distinct from old.deleted_at then
    insert into public.collection_quantity_history (collection_item_id, owner_id, quantity, effective_at, reason)
    values (
      new.id, new.owner_id, case when new.deleted_at is null then new.quantity else 0 end, now(),
      case when new.deleted_at is null then 'quantity_changed' else 'item_removed' end
    );
  end if;
  return new;
end;
$$;
create trigger collection_quantity_audit
  after insert or update of quantity, deleted_at on public.collection_items
  for each row execute function public.record_collection_quantity();

create or replace function public.validate_store_join_code_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.communities c where c.id = new.community_id and c.store_id = new.store_id
  ) then
    raise exception 'Join code community must belong to the same store';
  end if;
  return new;
end;
$$;
create trigger store_join_code_relationship_guard
  before insert or update of store_id, community_id on public.store_join_codes
  for each row execute function public.validate_store_join_code_relationship();

create or replace function public.validate_membership_join_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.joined_via_code_id is not null and not exists (
    select 1 from public.store_join_codes j
    where j.id = new.joined_via_code_id and j.community_id = new.community_id
  ) then
    raise exception 'Membership join code belongs to a different community';
  end if;
  return new;
end;
$$;
create trigger membership_join_code_guard
  before insert or update of community_id, joined_via_code_id on public.community_memberships
  for each row execute function public.validate_membership_join_code();

create or replace function public.guard_community_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.body := public.normalize_user_text(new.body);
  if new.body is null then raise exception 'Message body cannot be empty'; end if;
  if not private.is_active_community_member(new.community_id, new.author_id) then
    raise exception 'Active community membership required';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.community_messages r
    where r.id = new.reply_to_id and r.community_id = new.community_id
  ) then raise exception 'Reply target is outside this community'; end if;
  if v_uid is not null then
    if new.author_id <> v_uid then raise exception 'Message author must be the authenticated user'; end if;
    new.created_at := statement_timestamp();
    if (select count(*) from public.community_messages m
        where m.author_id = v_uid and m.created_at > now() - interval '1 minute') >= 12 then
      raise exception 'Community message rate limit exceeded';
    end if;
  end if;
  return new;
end;
$$;
create trigger community_message_insert_guard
  before insert on public.community_messages
  for each row execute function public.guard_community_message();

create or replace function public.guard_community_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.community_id <> old.community_id or new.author_id <> old.author_id
     or new.body <> old.body or new.created_at <> old.created_at or new.client_message_id <> old.client_message_id then
    raise exception 'Community messages are immutable except for soft deletion';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then new.deleted_by := auth.uid(); end if;
  return new;
end;
$$;
create trigger community_message_update_guard
  before update on public.community_messages
  for each row execute function public.guard_community_message_update();

create or replace function public.guard_trade_post()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.notes := public.normalize_user_text(new.notes);
  if not private.is_active_community_member(new.community_id, new.author_id) then
    raise exception 'Active community membership required';
  end if;
  if v_uid is not null then
    if new.author_id <> v_uid then raise exception 'Trade author must be the authenticated user'; end if;
    new.created_at := statement_timestamp();
    if (select count(*) from public.trade_posts p
        where p.author_id = v_uid and p.created_at > now() - interval '1 hour') >= 6 then
      raise exception 'Trade post rate limit exceeded';
    end if;
  end if;
  return new;
end;
$$;
create trigger trade_post_insert_guard
  before insert on public.trade_posts
  for each row execute function public.guard_trade_post();

create or replace function public.guard_trade_post_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.community_id <> old.community_id or new.author_id <> old.author_id
     or new.created_at <> old.created_at or new.client_request_id <> old.client_request_id then
    raise exception 'Trade ownership and community are immutable';
  end if;
  new.notes := public.normalize_user_text(new.notes);
  if new.status = 'completed' and old.status <> 'completed' then new.completed_at := now(); end if;
  if new.status = 'closed' and old.status <> 'closed' then new.closed_at := now(); end if;
  return new;
end;
$$;
create trigger trade_post_update_guard
  before update on public.trade_posts
  for each row execute function public.guard_trade_post_update();

create or replace function public.guard_trade_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_author uuid;
  v_source public.collection_items%rowtype;
  v_source_id uuid;
  v_old_source_id uuid;
begin
  v_source_id := nullif(to_jsonb(new) ->> 'source_collection_item_id', '')::uuid;
  if tg_op = 'UPDATE' then
    v_old_source_id := nullif(to_jsonb(old) ->> 'source_collection_item_id', '')::uuid;
  end if;
  select p.author_id into v_author from public.trade_posts p
  where p.id = new.trade_post_id and p.deleted_at is null;
  if not found then raise exception 'Trade post not found'; end if;
  if auth.uid() is not null and v_author <> auth.uid() then raise exception 'Only the trade author may add items'; end if;
  if tg_op = 'UPDATE' and (
    new.trade_post_id <> old.trade_post_id
    or new.card_variant_id is distinct from old.card_variant_id
    or new.sealed_product_id is distinct from old.sealed_product_id
    or (tg_table_name = 'trade_post_offered_items'
      and v_source_id is distinct from v_old_source_id)
  ) then
    raise exception 'Trade item identity is immutable; replace the item to recapture market references';
  end if;

  if tg_table_name = 'trade_post_offered_items' and v_source_id is not null then
    select * into v_source from public.collection_items c
    where c.id = v_source_id and c.deleted_at is null;
    if not found or v_source.owner_id <> v_author then
      raise exception 'Offered source item must belong to the trade author';
    end if;
    if v_source.card_variant_id is distinct from new.card_variant_id
       or v_source.sealed_product_id is distinct from new.sealed_product_id
       or v_source.condition <> new.condition or v_source.language <> new.language
       or new.quantity > v_source.quantity then
      raise exception 'Offered details must match the owned collection item and available quantity';
    end if;
  end if;
  return new;
end;
$$;
create trigger trade_offered_item_guard
  before insert or update on public.trade_post_offered_items
  for each row execute function public.guard_trade_item();
create trigger trade_wanted_item_guard
  before insert or update on public.trade_post_wanted_items
  for each row execute function public.guard_trade_item();

create or replace function public.capture_trade_market_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.price_quotes%rowtype;
begin
  for v_quote in
    select distinct on (q.provider_id) q.*
    from public.price_quotes q
    where q.card_variant_id is not distinct from new.card_variant_id
      and q.sealed_product_id is not distinct from new.sealed_product_id
      and q.freshness <> 'unavailable'
    order by q.provider_id, q.fetched_at desc
  loop
    insert into public.trade_item_market_references (
      offered_item_id, wanted_item_id, provider_id, source_quote_id, currency, market_value, captured_at, data_mode
    ) values (
      case when tg_table_name = 'trade_post_offered_items' then new.id else null end,
      case when tg_table_name = 'trade_post_wanted_items' then new.id else null end,
      v_quote.provider_id, v_quote.id, v_quote.currency, v_quote.market_value, now(), v_quote.data_mode
    );
  end loop;
  return new;
end;
$$;
create trigger capture_offered_market_references
  after insert on public.trade_post_offered_items
  for each row execute function public.capture_trade_market_references();
create trigger capture_wanted_market_references
  after insert on public.trade_post_wanted_items
  for each row execute function public.capture_trade_market_references();

create or replace function public.validate_direct_conversation_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_active_community_member(new.context_community_id, new.participant_low_id)
     or not private.is_active_community_member(new.context_community_id, new.participant_high_id)
     or not private.users_share_active_community(new.participant_low_id, new.participant_high_id) then
    raise exception 'Direct conversation participants must share the active context community';
  end if;
  if private.users_are_blocked(new.participant_low_id, new.participant_high_id) then
    raise exception 'Blocked users cannot start a direct conversation';
  end if;
  return new;
end;
$$;
create trigger direct_conversation_integrity_guard
  before insert or update of participant_low_id, participant_high_id, context_community_id
  on public.direct_conversations
  for each row execute function public.validate_direct_conversation_integrity();

create or replace function public.validate_direct_participant_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.direct_conversations c
    where c.id = new.conversation_id
      and new.user_id in (c.participant_low_id, c.participant_high_id)
  ) then
    raise exception 'Conversation participant row does not match the canonical pair';
  end if;
  return new;
end;
$$;
create trigger direct_participant_integrity_guard
  before insert or update of conversation_id, user_id on public.direct_conversation_participants
  for each row execute function public.validate_direct_participant_integrity();

create or replace function public.create_direct_conversation(
  p_other_user_id uuid,
  p_context_community_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_conversation_id uuid;
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'A one-to-one conversation requires another user';
  end if;
  if not private.is_active_community_member(p_context_community_id, v_me)
     or not private.is_active_community_member(p_context_community_id, p_other_user_id) then
    raise exception 'Both participants must be active in the selected community';
  end if;
  if not private.users_share_active_community(v_me, p_other_user_id) then
    raise exception 'A shared active store community is required';
  end if;
  if private.users_are_blocked(v_me, p_other_user_id) then
    raise exception 'Conversation unavailable because a participant is blocked';
  end if;

  if v_me::text < p_other_user_id::text then v_low := v_me; v_high := p_other_user_id;
  else v_low := p_other_user_id; v_high := v_me; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_low::text || ':' || v_high::text, 0));
  select c.id into v_conversation_id
  from public.direct_conversations c
  where c.participant_low_id = v_low and c.participant_high_id = v_high and c.deleted_at is null;

  if v_conversation_id is null then
    insert into public.direct_conversations (participant_low_id, participant_high_id, context_community_id)
    values (v_low, v_high, p_context_community_id)
    returning id into v_conversation_id;
    insert into public.direct_conversation_participants (conversation_id, user_id)
    values (v_conversation_id, v_low), (v_conversation_id, v_high);
  else
    update public.direct_conversation_participants
    set hidden_at = null, left_at = null
    where conversation_id = v_conversation_id and user_id = v_me;
  end if;
  return v_conversation_id;
end;
$$;

create or replace function public.guard_direct_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
begin
  new.body := public.normalize_user_text(new.body);
  if new.body is null then raise exception 'Message body cannot be empty'; end if;
  select case when c.participant_low_id = new.sender_id then c.participant_high_id else c.participant_low_id end
    into v_other
  from public.direct_conversations c
  where c.id = new.conversation_id and c.deleted_at is null
    and new.sender_id in (c.participant_low_id, c.participant_high_id);
  if not found then raise exception 'Conversation participant access required'; end if;
  if not private.users_share_active_community(new.sender_id, v_other) then
    raise exception 'Participants no longer share an active store community';
  end if;
  if private.users_are_blocked(new.sender_id, v_other) then raise exception 'Message blocked'; end if;
  if v_uid is not null then
    if new.sender_id <> v_uid then raise exception 'Message sender must be the authenticated user'; end if;
    new.created_at := statement_timestamp();
    if (select count(*) from public.direct_messages m
        where m.sender_id = v_uid and m.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'Direct message rate limit exceeded';
    end if;
  end if;
  return new;
end;
$$;
create trigger direct_message_insert_guard
  before insert on public.direct_messages
  for each row execute function public.guard_direct_message();

create or replace function public.guard_direct_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.conversation_id <> old.conversation_id or new.sender_id <> old.sender_id
     or new.body <> old.body or new.created_at <> old.created_at or new.client_message_id <> old.client_message_id then
    raise exception 'Direct messages are immutable except for sender soft deletion';
  end if;
  return new;
end;
$$;
create trigger direct_message_update_guard
  before update on public.direct_messages
  for each row execute function public.guard_direct_message_update();

create or replace function public.after_direct_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
begin
  update public.direct_conversations set last_message_at = new.created_at where id = new.conversation_id;
  select case when c.participant_low_id = new.sender_id then c.participant_high_id else c.participant_low_id end
  into v_recipient from public.direct_conversations c where c.id = new.conversation_id;
  insert into public.notifications (
    user_id, kind, title, body, actor_id, direct_message_id, action_url
  ) values (
    v_recipient, 'direct_message', 'New private message', left(new.body, 160), new.sender_id,
    new.id, '/messages/' || new.conversation_id::text
  );
  return new;
end;
$$;
create trigger direct_message_after_insert
  after insert on public.direct_messages
  for each row execute function public.after_direct_message_insert();

create or replace function public.guard_direct_participant_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.conversation_id <> old.conversation_id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'Conversation participant identity is immutable';
  end if;
  return new;
end;
$$;
create trigger direct_participant_update_guard
  before update on public.direct_conversation_participants
  for each row execute function public.guard_direct_participant_update();

create or replace function public.validate_store_join_code(p_code text)
returns table (
  store_id uuid, community_id uuid, store_name text, community_name text, code_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, c.id, s.name, c.name,
    case
      when j.deactivated_at is not null then 'revoked'
      when j.expires_at is not null and j.expires_at <= now() then 'expired'
      when j.max_uses is not null and j.use_count >= j.max_uses then 'expired'
      when not s.is_active or s.deleted_at is not null or not c.is_active or c.deleted_at is not null then 'revoked'
      else 'valid'
    end
  from public.store_join_codes j
  join public.stores s on s.id = j.store_id
  join public.communities c on c.id = j.community_id
  where j.code_hash = extensions.digest(btrim(p_code), 'sha256')
  limit 1;
$$;

create or replace function public.redeem_store_join_code(
  p_code text,
  p_request_fingerprint text default null
)
returns table (outcome public.join_attempt_outcome, community_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.store_join_codes%rowtype;
  v_fingerprint bytea;
  v_existing_status public.membership_status;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_code is null or length(btrim(p_code)) < 8 then
    insert into public.store_join_attempts (user_id, code_prefix, outcome)
    values (v_uid, left(coalesce(btrim(p_code), ''), 8), 'invalid');
    return query select 'invalid'::public.join_attempt_outcome, null::uuid; return;
  end if;
  if p_request_fingerprint is not null then
    v_fingerprint := extensions.digest(p_request_fingerprint, 'sha256');
  end if;
  if (select count(*) from public.store_join_attempts a
      where a.user_id = v_uid and a.attempted_at > now() - interval '15 minutes') >= 10 then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, left(btrim(p_code), 8), v_fingerprint, 'rate_limited');
    return query select 'rate_limited'::public.join_attempt_outcome, null::uuid; return;
  end if;

  select * into v_code from public.store_join_codes j
  where j.code_hash = extensions.digest(btrim(p_code), 'sha256') for update;
  if not found then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, left(btrim(p_code), 8), v_fingerprint, 'invalid');
    return query select 'invalid'::public.join_attempt_outcome, null::uuid; return;
  end if;
  if v_code.deactivated_at is not null then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, v_code.code_prefix, v_fingerprint, 'revoked');
    return query select 'revoked'::public.join_attempt_outcome, v_code.community_id; return;
  end if;
  if (v_code.expires_at is not null and v_code.expires_at <= now())
     or (v_code.max_uses is not null and v_code.use_count >= v_code.max_uses) then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, v_code.code_prefix, v_fingerprint, 'expired');
    return query select 'expired'::public.join_attempt_outcome, v_code.community_id; return;
  end if;
  if not exists (
    select 1 from public.communities c join public.stores s on s.id = c.store_id
    where c.id = v_code.community_id and c.store_id = v_code.store_id
      and c.is_active and c.deleted_at is null and s.is_active and s.deleted_at is null
  ) then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, v_code.code_prefix, v_fingerprint, 'revoked');
    return query select 'revoked'::public.join_attempt_outcome, v_code.community_id; return;
  end if;

  select m.status into v_existing_status from public.community_memberships m
  where m.community_id = v_code.community_id and m.user_id = v_uid;
  if found then
    insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
    values (v_uid, v_code.code_prefix, v_fingerprint, 'already_member');
    return query select 'already_member'::public.join_attempt_outcome, v_code.community_id; return;
  end if;

  insert into public.community_memberships (community_id, user_id, joined_via_code_id)
  values (v_code.community_id, v_uid, v_code.id);
  update public.store_join_codes
  set use_count = use_count + 1, last_used_at = now()
  where id = v_code.id;
  insert into public.store_join_attempts (user_id, code_prefix, request_fingerprint_hash, outcome)
  values (v_uid, v_code.code_prefix, v_fingerprint, 'joined');
  insert into public.notifications (user_id, kind, title, body, community_id, action_url)
  select v_uid, 'community_joined', 'Community joined', c.name, c.id, '/communities/' || c.id::text
  from public.communities c where c.id = v_code.community_id;
  insert into public.activity_logs (user_id, actor_id, community_id, activity_type, entity_type, entity_id)
  values (v_uid, v_uid, v_code.community_id, 'community_joined', 'community', v_code.community_id);
  return query select 'joined'::public.join_attempt_outcome, v_code.community_id;
end;
$$;

create or replace function public.create_store_join_code(
  p_store_id uuid,
  p_label text default null,
  p_expires_at timestamptz default null,
  p_max_uses integer default null
)
returns table (join_code_id uuid, raw_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_community_id uuid;
  v_raw_code text;
  v_id uuid;
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then raise exception 'Store administrator access required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Expiry must be in the future'; end if;
  if p_max_uses is not null and p_max_uses <= 0 then raise exception 'max_uses must be positive'; end if;
  select c.id into v_community_id from public.communities c
  where c.store_id = p_store_id and c.is_active and c.deleted_at is null;
  if not found then raise exception 'Active store community not found'; end if;
  v_raw_code := 'TH-' || upper(encode(extensions.gen_random_bytes(18), 'hex'));
  insert into public.store_join_codes (
    store_id, community_id, code_hash, code_prefix, label, expires_at, max_uses, created_by
  ) values (
    p_store_id, v_community_id, extensions.digest(v_raw_code, 'sha256'), left(v_raw_code, 10),
    public.normalize_user_text(p_label), p_expires_at, p_max_uses, v_uid
  ) returning id into v_id;
  return query select v_id, v_raw_code;
end;
$$;

create or replace function public.deactivate_store_join_code(p_join_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_store_id uuid;
begin
  select j.store_id into v_store_id from public.store_join_codes j where j.id = p_join_code_id;
  if not found or not (
    private.is_store_administrator(v_store_id, auth.uid())
    or private.has_app_role('platform_administrator', auth.uid())
  ) then raise exception 'Store administrator access required'; end if;
  update public.store_join_codes set deactivated_at = coalesce(deactivated_at, now()) where id = p_join_code_id;
end;
$$;

create or replace function public.leave_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.community_memberships
  set status = 'left', left_at = now()
  where community_id = p_community_id and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Active membership not found'; end if;
end;
$$;

create or replace function public.mark_community_chat_read(
  p_community_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_community_member(p_community_id, auth.uid()) then
    raise exception 'Active community membership required';
  end if;
  update public.community_memberships
  set last_read_chat_at = least(coalesce(p_read_at, now()), now())
  where community_id = p_community_id and user_id = auth.uid() and status = 'active';
end;
$$;

create or replace function public.moderate_community_membership(
  p_membership_id uuid,
  p_status public.membership_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_membership public.community_memberships%rowtype;
begin
  select * into v_membership from public.community_memberships where id = p_membership_id for update;
  if not found or not private.can_moderate_community(v_membership.community_id, auth.uid()) then
    raise exception 'Community moderator access required';
  end if;
  if v_membership.user_id = auth.uid() then raise exception 'Moderators cannot moderate their own membership'; end if;
  update public.community_memberships set
    status = p_status,
    suspended_at = case when p_status = 'suspended' then now() else null end,
    suspended_by = case when p_status = 'suspended' then auth.uid() else null end,
    suspension_reason = case when p_status = 'suspended' then public.normalize_user_text(p_reason) else null end,
    left_at = case when p_status = 'left' then now() else null end
  where id = p_membership_id;
end;
$$;

create or replace function public.set_community_membership_role(
  p_membership_id uuid,
  p_role public.membership_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.community_memberships%rowtype;
  v_store_id uuid;
begin
  select m, c.store_id into v_membership, v_store_id
  from public.community_memberships m
  join public.communities c on c.id = m.community_id
  where m.id = p_membership_id
  for update of m;
  if not found or not (
    private.is_store_administrator(v_store_id, auth.uid())
    or private.has_app_role('platform_administrator', auth.uid())
  ) then raise exception 'Store administrator access required'; end if;

  update public.community_memberships set role = p_role where id = p_membership_id;
  if p_role = 'moderator' then
    update public.app_users
    set roles = array_append(roles, 'community_moderator'::public.app_role)
    where id = v_membership.user_id and not ('community_moderator'::public.app_role = any(roles));
  elsif not exists (
    select 1 from public.community_memberships m
    where m.user_id = v_membership.user_id and m.role = 'moderator'
      and m.status = 'active' and m.id <> p_membership_id
  ) then
    update public.app_users
    set roles = array_remove(roles, 'community_moderator'::public.app_role)
    where id = v_membership.user_id;
  end if;
end;
$$;

-- Updated-at triggers.
create trigger app_users_updated_at before update on public.app_users for each row execute function public.set_updated_at();
create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger notification_preferences_updated_at before update on public.notification_preferences for each row execute function public.set_updated_at();
create trigger games_updated_at before update on public.games for each row execute function public.set_updated_at();
create trigger card_sets_updated_at before update on public.card_sets for each row execute function public.set_updated_at();
create trigger cards_updated_at before update on public.cards for each row execute function public.set_updated_at();
create trigger card_variants_updated_at before update on public.card_variants for each row execute function public.set_updated_at();
create trigger sealed_products_updated_at before update on public.sealed_products for each row execute function public.set_updated_at();
create trigger collection_items_updated_at before update on public.collection_items for each row execute function public.set_updated_at();
create trigger pricing_providers_updated_at before update on public.pricing_providers for each row execute function public.set_updated_at();
create trigger provider_mappings_updated_at before update on public.provider_catalog_mappings for each row execute function public.set_updated_at();
create trigger stores_updated_at before update on public.stores for each row execute function public.set_updated_at();
create trigger communities_updated_at before update on public.communities for each row execute function public.set_updated_at();
create trigger store_join_codes_updated_at before update on public.store_join_codes for each row execute function public.set_updated_at();
create trigger memberships_updated_at before update on public.community_memberships for each row execute function public.set_updated_at();
create trigger community_messages_updated_at before update on public.community_messages for each row execute function public.set_updated_at();
create trigger trade_posts_updated_at before update on public.trade_posts for each row execute function public.set_updated_at();
create trigger direct_conversations_updated_at before update on public.direct_conversations for each row execute function public.set_updated_at();
create trigger direct_participants_updated_at before update on public.direct_conversation_participants for each row execute function public.set_updated_at();
create trigger direct_messages_updated_at before update on public.direct_messages for each row execute function public.set_updated_at();
create trigger reports_updated_at before update on public.reports for each row execute function public.set_updated_at();

create or replace function public.guard_report()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_community_id uuid;
begin
  new.details := public.normalize_user_text(new.details);
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.reporter_id <> old.reporter_id
       or new.community_id is distinct from old.community_id
       or new.community_message_id is distinct from old.community_message_id
       or new.trade_post_id is distinct from old.trade_post_id
       or new.direct_message_id is distinct from old.direct_message_id
       or new.reported_user_id is distinct from old.reported_user_id
       or new.reason <> old.reason or new.details is distinct from old.details
       or new.created_at <> old.created_at then
      raise exception 'Report targets and reporter content are immutable';
    end if;
    new.resolution_notes := public.normalize_user_text(new.resolution_notes);
    if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
      new.resolved_at := now(); new.reviewed_by := auth.uid();
    end if;
    return new;
  end if;

  if auth.uid() is not null and new.reporter_id <> auth.uid() then
    raise exception 'Reporter must be the authenticated user';
  end if;
  if new.community_message_id is not null then
    select m.community_id into v_community_id from public.community_messages m where m.id = new.community_message_id;
    if not found or new.community_id is distinct from v_community_id
       or not private.is_active_community_member(v_community_id, new.reporter_id) then
      raise exception 'Reported community message is not accessible';
    end if;
  elsif new.trade_post_id is not null then
    select p.community_id into v_community_id from public.trade_posts p where p.id = new.trade_post_id;
    if not found or new.community_id is distinct from v_community_id
       or not private.is_active_community_member(v_community_id, new.reporter_id) then
      raise exception 'Reported trade is not accessible';
    end if;
  elsif new.direct_message_id is not null then
    if new.community_id is not null or not exists (
      select 1 from public.direct_messages d
      where d.id = new.direct_message_id
        and private.is_direct_conversation_participant(d.conversation_id, new.reporter_id)
    ) then raise exception 'Reported direct message is not accessible'; end if;
  elsif new.reported_user_id is not null then
    if new.reported_user_id = new.reporter_id then raise exception 'A user cannot report themselves'; end if;
    if not private.users_share_active_community(new.reporter_id, new.reported_user_id) then
      raise exception 'User reports require a shared active community';
    end if;
  end if;
  return new;
end;
$$;
create trigger report_insert_guard before insert on public.reports for each row execute function public.guard_report();
create trigger report_update_guard before update on public.reports for each row execute function public.guard_report();

-- Privacy-preserving directory: no approximate location, market preference, email, or portfolio fields.
create or replace view public.community_member_profiles
with (security_barrier = true)
as
select
  m.community_id,
  p.user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  m.role,
  m.joined_at
from public.community_memberships m
join public.user_profiles p on p.user_id = m.user_id and p.deleted_at is null
where m.status = 'active'
  and private.is_active_community_member(m.community_id, auth.uid());

create or replace view public.store_join_code_admin_view
with (security_barrier = true)
as
select
  j.id, j.store_id, j.community_id, j.code_prefix, j.label, j.expires_at, j.max_uses,
  j.use_count, j.last_used_at, j.created_by, j.created_at, j.updated_at, j.deactivated_at
from public.store_join_codes j
where private.is_store_administrator(j.store_id, auth.uid())
   or private.has_app_role('platform_administrator', auth.uid());

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.app_users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.games enable row level security;
alter table public.card_sets enable row level security;
alter table public.cards enable row level security;
alter table public.card_variants enable row level security;
alter table public.sealed_products enable row level security;
alter table public.collection_items enable row level security;
alter table public.collection_quantity_history enable row level security;
alter table public.pricing_providers enable row level security;
alter table public.provider_catalog_mappings enable row level security;
alter table public.provider_raw_responses enable row level security;
alter table public.price_quotes enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.stores enable row level security;
alter table public.store_administrators enable row level security;
alter table public.communities enable row level security;
alter table public.store_join_codes enable row level security;
alter table public.community_memberships enable row level security;
alter table public.store_join_attempts enable row level security;
alter table public.community_messages enable row level security;
alter table public.trade_posts enable row level security;
alter table public.trade_post_offered_items enable row level security;
alter table public.trade_post_wanted_items enable row level security;
alter table public.trade_item_market_references enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.direct_conversation_participants enable row level security;
alter table public.direct_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.user_blocks enable row level security;
alter table public.reports enable row level security;
alter table public.activity_logs enable row level security;

create policy app_users_select_self on public.app_users for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_self on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_self on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy preferences_select_self on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy preferences_update_self on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy games_public_read on public.games for select to anon, authenticated
  using (is_active and archived_at is null);
create policy card_sets_public_read on public.card_sets for select to anon, authenticated
  using (archived_at is null);
create policy cards_public_read on public.cards for select to anon, authenticated
  using (archived_at is null);
create policy card_variants_public_read on public.card_variants for select to anon, authenticated
  using (archived_at is null);
create policy sealed_products_public_read on public.sealed_products for select to anon, authenticated
  using (archived_at is null);

create policy collection_select_owner on public.collection_items for select to authenticated
  using (owner_id = (select auth.uid()));
create policy collection_insert_owner on public.collection_items for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy collection_update_owner on public.collection_items for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy collection_history_select_owner on public.collection_quantity_history for select to authenticated
  using (owner_id = (select auth.uid()));

create policy pricing_providers_authenticated_read on public.pricing_providers for select to authenticated
  using (is_enabled);
create policy provider_mappings_authenticated_read on public.provider_catalog_mappings for select to authenticated
  using (disabled_at is null);
create policy price_quotes_authenticated_read on public.price_quotes for select to authenticated using (true);
create policy price_snapshots_authenticated_read on public.price_snapshots for select to authenticated using (true);

create policy stores_public_read on public.stores for select to anon, authenticated
  using (is_active and deleted_at is null);
create policy stores_admin_update on public.stores for update to authenticated
  using (
    private.is_store_administrator(id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  ) with check (
    private.is_store_administrator(id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );
create policy store_admin_assignments_select on public.store_administrators for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_store_administrator(store_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

create policy communities_public_preview on public.communities for select to anon, authenticated
  using (is_active and deleted_at is null);
create policy communities_moderator_update on public.communities for update to authenticated
  using (private.can_moderate_community(id, (select auth.uid())))
  with check (private.can_moderate_community(id, (select auth.uid())));

-- No table policy for join-code hashes or attempts. Read/admin actions use redacted views and RPCs.

create policy memberships_select_self on public.community_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy memberships_select_active_directory on public.community_memberships for select to authenticated
  using (
    status = 'active' and private.is_active_community_member(community_id, (select auth.uid()))
  );
create policy memberships_select_moderator on public.community_memberships for select to authenticated
  using (private.can_moderate_community(community_id, (select auth.uid())));

create policy community_messages_member_select on public.community_messages for select to authenticated
  using (private.is_active_community_member(community_id, (select auth.uid())));
create policy community_messages_member_insert on public.community_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.is_active_community_member(community_id, (select auth.uid()))
  );
create policy community_messages_author_or_moderator_update on public.community_messages for update to authenticated
  using (
    author_id = (select auth.uid())
    or private.can_moderate_community(community_id, (select auth.uid()))
  ) with check (
    author_id = (select auth.uid())
    or private.can_moderate_community(community_id, (select auth.uid()))
  );

create policy trade_posts_member_select on public.trade_posts for select to authenticated
  using (private.is_active_community_member(community_id, (select auth.uid())));
create policy trade_posts_member_insert on public.trade_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.is_active_community_member(community_id, (select auth.uid()))
  );
create policy trade_posts_author_or_moderator_update on public.trade_posts for update to authenticated
  using (
    author_id = (select auth.uid())
    or private.can_moderate_community(community_id, (select auth.uid()))
  ) with check (
    author_id = (select auth.uid())
    or private.can_moderate_community(community_id, (select auth.uid()))
  );

create policy trade_offered_member_select on public.trade_post_offered_items for select to authenticated
  using (exists (
    select 1 from public.trade_posts p where p.id = trade_post_id
      and private.is_active_community_member(p.community_id, (select auth.uid()))
  ));
create policy trade_offered_author_insert on public.trade_post_offered_items for insert to authenticated
  with check (exists (
    select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())
      and private.is_active_community_member(p.community_id, (select auth.uid()))
  ));
create policy trade_offered_author_update on public.trade_post_offered_items for update to authenticated
  using (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())))
  with check (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())));
create policy trade_offered_author_delete on public.trade_post_offered_items for delete to authenticated
  using (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())));

create policy trade_wanted_member_select on public.trade_post_wanted_items for select to authenticated
  using (exists (
    select 1 from public.trade_posts p where p.id = trade_post_id
      and private.is_active_community_member(p.community_id, (select auth.uid()))
  ));
create policy trade_wanted_author_insert on public.trade_post_wanted_items for insert to authenticated
  with check (exists (
    select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())
      and private.is_active_community_member(p.community_id, (select auth.uid()))
  ));
create policy trade_wanted_author_update on public.trade_post_wanted_items for update to authenticated
  using (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())))
  with check (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())));
create policy trade_wanted_author_delete on public.trade_post_wanted_items for delete to authenticated
  using (exists (select 1 from public.trade_posts p where p.id = trade_post_id and p.author_id = (select auth.uid())));

create policy trade_market_refs_member_select on public.trade_item_market_references for select to authenticated
  using (
    exists (
      select 1 from public.trade_post_offered_items i join public.trade_posts p on p.id = i.trade_post_id
      where i.id = offered_item_id and private.is_active_community_member(p.community_id, (select auth.uid()))
    ) or exists (
      select 1 from public.trade_post_wanted_items i join public.trade_posts p on p.id = i.trade_post_id
      where i.id = wanted_item_id and private.is_active_community_member(p.community_id, (select auth.uid()))
    )
  );

-- Deliberately no administrator/platform bypass on conversations or messages.
create policy direct_conversations_participant_select on public.direct_conversations for select to authenticated
  using (
    deleted_at is null and (select auth.uid()) in (participant_low_id, participant_high_id)
  );
create policy direct_participants_conversation_select on public.direct_conversation_participants for select to authenticated
  using (private.is_direct_conversation_participant(conversation_id, (select auth.uid())));
create policy direct_participants_self_update on public.direct_conversation_participants for update to authenticated
  using (user_id = (select auth.uid()) and private.is_direct_conversation_participant(conversation_id, (select auth.uid())))
  with check (user_id = (select auth.uid()) and private.is_direct_conversation_participant(conversation_id, (select auth.uid())));
create policy direct_messages_participant_select on public.direct_messages for select to authenticated
  using (private.is_direct_conversation_participant(conversation_id, (select auth.uid())));
create policy direct_messages_participant_insert on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_direct_conversation_participant(conversation_id, (select auth.uid()))
  );
create policy direct_messages_sender_update on public.direct_messages for update to authenticated
  using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));

create policy notifications_owner_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_owner_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_owner_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy user_blocks_involved_select on public.user_blocks for select to authenticated
  using ((select auth.uid()) in (blocker_id, blocked_user_id));
create policy user_blocks_owner_insert on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy user_blocks_owner_update on public.user_blocks for update to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy user_blocks_owner_delete on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy reports_reporter_select on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy reports_reporter_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy reports_community_moderator_select on public.reports for select to authenticated
  using (
    community_id is not null and direct_message_id is null
    and private.can_moderate_community(community_id, (select auth.uid()))
  );
create policy reports_platform_select on public.reports for select to authenticated
  using (private.has_app_role('platform_administrator', (select auth.uid())));
create policy reports_moderator_update on public.reports for update to authenticated
  using (
    (community_id is not null and direct_message_id is null
      and private.can_moderate_community(community_id, (select auth.uid())))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  ) with check (
    (community_id is not null and direct_message_id is null
      and private.can_moderate_community(community_id, (select auth.uid())))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

create policy activity_logs_owner_select on public.activity_logs for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- API grants. RLS remains the authorization boundary; service_role retains its
-- normal Supabase bypass for trusted ingestion/background jobs.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant usage on schema private to authenticated;

grant select on public.games, public.card_sets, public.cards, public.card_variants,
  public.sealed_products, public.stores, public.communities to anon;

grant select on public.app_users to authenticated;
grant select, update on public.user_profiles, public.notification_preferences to authenticated;
grant select on public.games, public.card_sets, public.cards, public.card_variants,
  public.sealed_products to authenticated;
grant select, insert, update on public.collection_items to authenticated;
grant select on public.collection_quantity_history to authenticated;
grant select on public.pricing_providers, public.provider_catalog_mappings,
  public.price_quotes, public.price_snapshots to authenticated;
grant select, update on public.stores, public.communities to authenticated;
grant select on public.store_administrators, public.community_memberships to authenticated;
grant select, insert, update on public.community_messages to authenticated;
grant select, insert, update on public.trade_posts to authenticated;
grant select, insert, update, delete on public.trade_post_offered_items,
  public.trade_post_wanted_items to authenticated;
grant select on public.trade_item_market_references to authenticated;
grant select on public.direct_conversations to authenticated;
grant select, update on public.direct_conversation_participants to authenticated;
grant select, insert, update on public.direct_messages to authenticated;
grant select, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.user_blocks to authenticated;
grant select, insert, update on public.reports to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.community_member_profiles, public.store_join_code_admin_view to authenticated;

revoke all on public.store_join_codes, public.store_join_attempts,
  public.provider_raw_responses from anon, authenticated;
revoke all on public.direct_conversations, public.direct_conversation_participants from anon;
revoke all on public.direct_messages from anon;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.normalize_user_text(text) from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.validate_price_record_target() from public, anon, authenticated;
revoke execute on function public.validate_catalog_target_language() from public, anon, authenticated;
revoke execute on function public.record_collection_quantity() from public, anon, authenticated;
revoke execute on function public.validate_store_join_code_relationship() from public, anon, authenticated;
revoke execute on function public.validate_membership_join_code() from public, anon, authenticated;
revoke execute on function public.guard_community_message() from public, anon, authenticated;
revoke execute on function public.guard_community_message_update() from public, anon, authenticated;
revoke execute on function public.guard_trade_post() from public, anon, authenticated;
revoke execute on function public.guard_trade_post_update() from public, anon, authenticated;
revoke execute on function public.guard_trade_item() from public, anon, authenticated;
revoke execute on function public.capture_trade_market_references() from public, anon, authenticated;
revoke execute on function public.validate_direct_conversation_integrity() from public, anon, authenticated;
revoke execute on function public.validate_direct_participant_integrity() from public, anon, authenticated;
revoke execute on function public.guard_direct_message() from public, anon, authenticated;
revoke execute on function public.guard_direct_message_update() from public, anon, authenticated;
revoke execute on function public.after_direct_message_insert() from public, anon, authenticated;
revoke execute on function public.guard_direct_participant_update() from public, anon, authenticated;
revoke execute on function public.guard_report() from public, anon, authenticated;

revoke execute on function private.has_app_role(public.app_role, uuid) from public, anon;
revoke execute on function private.is_active_community_member(uuid, uuid) from public, anon;
revoke execute on function private.is_store_administrator(uuid, uuid) from public, anon;
revoke execute on function private.can_moderate_community(uuid, uuid) from public, anon;
revoke execute on function private.users_share_active_community(uuid, uuid) from public, anon;
revoke execute on function private.users_are_blocked(uuid, uuid) from public, anon;
revoke execute on function private.is_direct_conversation_participant(uuid, uuid) from public, anon;
grant execute on function private.has_app_role(public.app_role, uuid),
  private.is_active_community_member(uuid, uuid), private.is_store_administrator(uuid, uuid),
  private.can_moderate_community(uuid, uuid), private.users_share_active_community(uuid, uuid),
  private.users_are_blocked(uuid, uuid), private.is_direct_conversation_participant(uuid, uuid)
  to authenticated;

revoke execute on function public.validate_store_join_code(text) from public;
grant execute on function public.validate_store_join_code(text) to anon, authenticated;
revoke execute on function public.redeem_store_join_code(text, text),
  public.create_store_join_code(uuid, text, timestamptz, integer),
  public.deactivate_store_join_code(uuid), public.leave_community(uuid),
  public.mark_community_chat_read(uuid, timestamptz),
  public.moderate_community_membership(uuid, public.membership_status, text),
  public.set_community_membership_role(uuid, public.membership_role),
  public.create_direct_conversation(uuid, uuid) from public, anon;
grant execute on function public.redeem_store_join_code(text, text),
  public.create_store_join_code(uuid, text, timestamptz, integer),
  public.deactivate_store_join_code(uuid), public.leave_community(uuid),
  public.mark_community_chat_read(uuid, timestamptz),
  public.moderate_community_membership(uuid, public.membership_status, text),
  public.set_community_membership_role(uuid, public.membership_role),
  public.create_direct_conversation(uuid, uuid) to authenticated;

-- Realtime tables still apply each subscriber's RLS policy.
alter table public.community_messages replica identity full;
alter table public.direct_messages replica identity full;
alter table public.notifications replica identity full;
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_messages'
    ) then execute 'alter publication supabase_realtime add table public.community_messages'; end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages'
    ) then execute 'alter publication supabase_realtime add table public.direct_messages'; end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then execute 'alter publication supabase_realtime add table public.notifications'; end if;
  end if;
end;
$$;

commit;
