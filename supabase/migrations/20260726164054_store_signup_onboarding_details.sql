-- Persist the physical-store identity supplied during Auth signup so the
-- reviewed store application can be prefilled after email confirmation.
-- These fields are deliberately untrusted onboarding data and never grant a
-- role, store assignment, community permission, or public listing.

begin;

alter table public.user_profiles
  add column store_signup_name text,
  add column store_signup_address_line_1 text,
  add column store_signup_city text,
  add column store_signup_postcode text,
  add column store_signup_country_code text,
  add column store_signup_website_url text,
  add constraint user_profiles_store_signup_name_length
    check (store_signup_name is null or length(store_signup_name) between 2 and 160),
  add constraint user_profiles_store_signup_address_length
    check (store_signup_address_line_1 is null or length(store_signup_address_line_1) between 2 and 200),
  add constraint user_profiles_store_signup_city_length
    check (store_signup_city is null or length(store_signup_city) between 2 and 120),
  add constraint user_profiles_store_signup_postcode_length
    check (store_signup_postcode is null or length(store_signup_postcode) between 2 and 24),
  add constraint user_profiles_store_signup_country_shape
    check (store_signup_country_code is null or store_signup_country_code ~ '^[A-Z]{2}$'),
  add constraint user_profiles_store_signup_website_https
    check (
      store_signup_website_url is null
      or (
        length(store_signup_website_url) <= 500
        and store_signup_website_url ~* '^https://[^[:space:]<>]+$'
        and split_part(split_part(store_signup_website_url, '://', 2), '/', 1) !~ '@'
      )
    );

comment on column public.user_profiles.store_signup_name is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';
comment on column public.user_profiles.store_signup_address_line_1 is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';
comment on column public.user_profiles.store_signup_city is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';
comment on column public.user_profiles.store_signup_postcode is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';
comment on column public.user_profiles.store_signup_country_code is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';
comment on column public.user_profiles.store_signup_website_url is
  'Private, user-editable store onboarding data. Never use for authorization or public discovery.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_account_kind public.account_kind;
  v_store_name text;
  v_store_address text;
  v_store_city text;
  v_store_postcode text;
  v_store_country text;
  v_store_website text;
begin
  insert into public.app_users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();

  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if v_username !~ '^[a-z0-9][a-z0-9_.-]{2,29}$'
     or exists (select 1 from public.user_profiles p where lower(p.username) = v_username) then
    v_username := 'user_' || replace(substr(new.id::text, 1, 13), '-', '');
  end if;

  v_account_kind := case
    when new.raw_user_meta_data ->> 'account_kind' = 'store' then 'store'::public.account_kind
    else 'player'::public.account_kind
  end;

  if v_account_kind = 'store' then
    v_store_name := nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_name'), 160), '');
    v_store_address := nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_address_line_1'), 200), '');
    v_store_city := nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_city'), 120), '');
    v_store_postcode := nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_postcode'), 24), '');
    v_store_country := upper(nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_country_code'), 2), ''));
    v_store_website := nullif(left(public.normalize_user_text(new.raw_user_meta_data ->> 'store_website_url'), 500), '');

    -- Direct Auth API callers can bypass the browser form. Invalid optional
    -- metadata is discarded rather than allowing an untrusted value to abort
    -- identity creation or to become an authorization signal.
    if v_store_name is not null and length(v_store_name) < 2 then v_store_name := null; end if;
    if v_store_address is not null and length(v_store_address) < 2 then v_store_address := null; end if;
    if v_store_city is not null and length(v_store_city) < 2 then v_store_city := null; end if;
    if v_store_postcode is not null and length(v_store_postcode) < 2 then v_store_postcode := null; end if;
    if v_store_country is not null and v_store_country !~ '^[A-Z]{2}$' then v_store_country := null; end if;
    if v_store_website is not null and not (
      v_store_website ~* '^https://[^[:space:]<>]+$'
      and split_part(split_part(v_store_website, '://', 2), '/', 1) !~ '@'
    ) then
      v_store_website := null;
    end if;
  end if;

  insert into public.user_profiles (
    user_id, username, display_name, avatar_url, account_kind,
    store_signup_name, store_signup_address_line_1, store_signup_city,
    store_signup_postcode, store_signup_country_code, store_signup_website_url
  ) values (
    new.id,
    v_username,
    nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    v_account_kind,
    v_store_name,
    v_store_address,
    v_store_city,
    v_store_postcode,
    v_store_country,
    v_store_website
  )
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

commit;
