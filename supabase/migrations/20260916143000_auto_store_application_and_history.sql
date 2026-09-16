-- Migration: 20260916143000_auto_store_application_and_history.sql
-- Automatically generate store_applications row upon store onboarding,
-- prevent hard deletion of application rows, and provide full application history RPC.

begin;

-- Function to prevent hard deletion of store applications
create or replace function public.prevent_store_application_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Store applications cannot be deleted. Update status to rejected or withdrawn instead.';
end;
$$;

drop trigger if exists trg_prevent_store_application_deletion on public.store_applications;
create trigger trg_prevent_store_application_deletion
  before delete on public.store_applications
  for each row execute function public.prevent_store_application_deletion();

-- Updated handle_new_auth_user trigger function
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
  v_contact_name text;
  v_app_id uuid;
  v_lat double precision;
  v_lon double precision;
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

  -- If this account registered as a store and provided a valid store name,
  -- automatically create an application record so it appears immediately in the review queue.
  if v_account_kind = 'store' and v_store_name is not null then
    v_contact_name := coalesce(nullif(left(new.raw_user_meta_data ->> 'display_name', 120), ''), v_store_name);
    if v_store_city ilike 'dresden%' then
      v_lat := 51.050409;
      v_lon := 13.737262;
    else
      v_lat := 51.165691;
      v_lon := 10.451526;
    end if;

    insert into public.store_applications (
      applicant_user_id,
      store_name,
      contact_name,
      contact_email,
      address_line_1,
      city,
      postcode,
      country_code,
      latitude,
      longitude,
      timezone,
      website_url,
      status
    ) values (
      new.id,
      v_store_name,
      v_contact_name,
      new.email,
      coalesce(v_store_address, 'Address pending review'),
      coalesce(v_store_city, 'Dresden'),
      coalesce(v_store_postcode, '01067'),
      coalesce(v_store_country, 'DE'),
      v_lat,
      v_lon,
      'Europe/Berlin',
      v_store_website,
      'pending'
    )
    on conflict do nothing
    returning id into v_app_id;

    if v_app_id is not null then
      insert into public.activity_logs (
        user_id, actor_id, activity_type, entity_type, entity_id
      ) values (
        new.id, new.id, 'store_application_submitted', 'store_application', v_app_id
      );
    end if;
  end if;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- RPC for platform administrators to list all applications across all statuses
create or replace function public.platform_admin_list_applications()
returns table (
  id uuid,
  applicant_user_id uuid,
  status text,
  store_name text,
  contact_name text,
  contact_email text,
  phone text,
  website_url text,
  address_line_1 text,
  address_line_2 text,
  city text,
  region text,
  postcode text,
  country_code text,
  latitude double precision,
  longitude double precision,
  timezone text,
  applicant_note text,
  evidence_url text,
  reviewer_id uuid,
  review_note text,
  reviewed_at timestamptz,
  approved_store_id uuid,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  applicant_username text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.applicant_user_id,
    a.status::text,
    a.store_name,
    a.contact_name,
    a.contact_email,
    a.phone,
    a.website_url,
    a.address_line_1,
    a.address_line_2,
    a.city,
    a.region,
    a.postcode,
    a.country_code::text,
    a.latitude,
    a.longitude,
    a.timezone,
    a.applicant_note,
    a.evidence_url,
    a.reviewer_id,
    a.review_note,
    a.reviewed_at,
    a.approved_store_id,
    a.submitted_at,
    a.created_at,
    a.updated_at,
    p.username as applicant_username
  from public.store_applications a
  left join public.user_profiles p on p.user_id = a.applicant_user_id
  where private.has_app_role('platform_administrator', auth.uid())
  order by a.submitted_at desc;
$$;

revoke execute on function public.platform_admin_list_applications() from public, anon;
grant execute on function public.platform_admin_list_applications() to authenticated;

commit;
