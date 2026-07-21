-- TCG Harbor: production account intent, store applications, and approval.
--
-- `account_kind` controls onboarding only. It is deliberately NOT an
-- authorization role: every account retains player features, while store
-- capabilities come exclusively from reviewed store_administrators rows and
-- the protected app_users.roles array.

begin;

create type public.account_kind as enum ('player', 'store');
create type public.store_application_status as enum (
  'pending', 'under_review', 'approved', 'rejected', 'withdrawn'
);

alter table public.user_profiles
  add column account_kind public.account_kind not null default 'player';

comment on column public.user_profiles.account_kind is
  'Untrusted onboarding preference. Never use this field to authorize store actions.';

create table public.store_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  applicant_user_id uuid not null references public.app_users(id) on delete cascade,
  status public.store_application_status not null default 'pending',
  store_name text not null,
  contact_name text not null,
  contact_email text not null,
  phone text,
  website_url text,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  region text,
  postcode text not null,
  country_code char(2) not null default 'DE',
  latitude double precision not null,
  longitude double precision not null,
  timezone text not null default 'Europe/Berlin',
  applicant_note text,
  evidence_url text,
  reviewer_id uuid references public.app_users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  approved_store_id uuid references public.stores(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_applications_store_name_length
    check (length(btrim(store_name)) between 2 and 160),
  constraint store_applications_contact_name_length
    check (length(btrim(contact_name)) between 2 and 120),
  constraint store_applications_contact_email_shape
    check (
      contact_email = lower(btrim(contact_email))
      and length(contact_email) between 3 and 320
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint store_applications_address_lengths check (
    length(btrim(address_line_1)) between 2 and 240
    and (address_line_2 is null or length(address_line_2) <= 240)
    and length(btrim(city)) between 2 and 120
    and (region is null or length(region) <= 120)
    and length(btrim(postcode)) between 2 and 24
  ),
  constraint store_applications_country_code_upper
    check (country_code = upper(country_code)),
  constraint store_applications_coordinates
    check (latitude between -90 and 90 and longitude between -180 and 180),
  constraint store_applications_optional_lengths check (
    (phone is null or length(phone) <= 40)
    and (website_url is null or length(website_url) <= 2048)
    and (evidence_url is null or length(evidence_url) <= 2048)
    and (applicant_note is null or length(applicant_note) <= 4000)
    and (review_note is null or length(review_note) <= 4000)
    and length(timezone) between 1 and 80
  ),
  constraint store_applications_https_urls check (
    (
      website_url is null
      or (
        website_url ~* '^https://[^[:space:]<>]+$'
        and split_part(split_part(website_url, '://', 2), '/', 1) !~ '@'
      )
    )
    and (
      evidence_url is null
      or (
        evidence_url ~* '^https://[^[:space:]<>]+$'
        and split_part(split_part(evidence_url, '://', 2), '/', 1) !~ '@'
      )
    )
  ),
  constraint store_applications_review_state check (
    (
      status in ('approved', 'rejected')
      and reviewed_at is not null
    )
    or status not in ('approved', 'rejected')
  ),
  constraint store_applications_approved_store check (
    (status = 'approved' and approved_store_id is not null)
    or (status <> 'approved' and approved_store_id is null)
  )
);

create unique index store_applications_one_open_per_applicant
  on public.store_applications (applicant_user_id)
  where status in ('pending', 'under_review');
create unique index store_applications_approved_store_unique
  on public.store_applications (approved_store_id)
  where approved_store_id is not null;
create index store_applications_review_queue
  on public.store_applications (status, submitted_at)
  where status in ('pending', 'under_review');
create index store_applications_applicant_history
  on public.store_applications (applicant_user_id, submitted_at desc);

comment on table public.store_applications is
  'Private store registration evidence and review state. Applicants see only their own rows; platform administrators see the review queue.';

create trigger store_applications_updated_at
  before update on public.store_applications
  for each row execute function public.set_updated_at();

-- Capture the requested onboarding path when Auth creates the application
-- profile. The value remains an untrusted preference and never grants a role.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_account_kind public.account_kind;
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

  insert into public.user_profiles (
    user_id, username, display_name, avatar_url, account_kind
  ) values (
    new.id,
    v_username,
    nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    v_account_kind
  )
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Verified and active are both required for public discovery and community
-- access. This guarantees that submitted-but-unapproved stores remain private.
drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores for select to anon, authenticated
  using (is_verified and is_active and deleted_at is null);

create policy stores_operator_read on public.stores for select to authenticated
  using (
    private.is_store_administrator(id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

alter table public.stores
  add constraint stores_website_url_https check (
    website_url is null
    or (
      website_url ~* '^https://[^[:space:]<>]+$'
      and split_part(split_part(website_url, '://', 2), '/', 1) !~ '@'
    )
  );

drop policy if exists communities_public_preview on public.communities;
create policy communities_public_preview on public.communities for select to anon, authenticated
  using (
    is_active and deleted_at is null
    and exists (
      select 1
      from public.stores s
      where s.id = store_id
        and s.is_verified
        and s.is_active
        and s.deleted_at is null
    )
  );

create policy communities_operator_read on public.communities for select to authenticated
  using (
    private.is_store_administrator(store_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

create or replace function private.is_active_community_member(
  p_community_id uuid,
  p_user_id uuid default auth.uid()
)
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
      and s.is_verified and s.is_active and s.deleted_at is null
      and u.status = 'active'
  );
$$;

-- Remove the broad table-level UPDATE privilege inherited from the initial
-- migration. Store operators may edit profile fields, but verification,
-- activation, deletion, IDs, and slugs stay server/platform controlled.
revoke update on public.stores from authenticated;
grant update (
  name, description, address_line_1, address_line_2, city, region, postcode,
  country_code, latitude, longitude, timezone, opening_hours, contact_email,
  phone, website_url, image_url
) on public.stores to authenticated;

alter table public.store_applications enable row level security;

create policy store_applications_select_own
  on public.store_applications for select to authenticated
  using (applicant_user_id = (select auth.uid()));

create policy store_applications_select_platform
  on public.store_applications for select to authenticated
  using (private.has_app_role('platform_administrator', (select auth.uid())));

create or replace function public.submit_store_application(
  p_store_name text,
  p_contact_name text,
  p_contact_email text,
  p_address_line_1 text,
  p_city text,
  p_postcode text,
  p_country_code text,
  p_latitude double precision,
  p_longitude double precision,
  p_timezone text,
  p_address_line_2 text default null,
  p_region text default null,
  p_phone text default null,
  p_website_url text default null,
  p_evidence_url text default null,
  p_applicant_note text default null
)
returns public.store_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.store_applications%rowtype;
  v_store_name text := public.normalize_user_text(p_store_name);
  v_contact_name text := public.normalize_user_text(p_contact_name);
  v_contact_email text := lower(coalesce(public.normalize_user_text(p_contact_email), ''));
  v_address_line_1 text := public.normalize_user_text(p_address_line_1);
  v_city text := public.normalize_user_text(p_city);
  v_postcode text := public.normalize_user_text(p_postcode);
  v_country_code text := upper(coalesce(public.normalize_user_text(p_country_code), ''));
  v_timezone text := coalesce(public.normalize_user_text(p_timezone), 'Europe/Berlin');
  v_website_url text := public.normalize_user_text(p_website_url);
  v_evidence_url text := public.normalize_user_text(p_evidence_url);
begin
  if v_uid is null or not exists (
    select 1 from public.app_users u where u.id = v_uid and u.status = 'active'
  ) then
    raise exception 'An active authenticated account is required';
  end if;

  if v_store_name is null or length(v_store_name) not between 2 and 160 then
    raise exception 'Store name must contain between 2 and 160 characters';
  end if;
  if v_contact_name is null or length(v_contact_name) not between 2 and 120 then
    raise exception 'Contact name must contain between 2 and 120 characters';
  end if;
  if v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid contact email is required';
  end if;
  if v_address_line_1 is null or v_city is null or v_postcode is null then
    raise exception 'A complete store address is required';
  end if;
  if v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Country code must contain two letters';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180 then
    raise exception 'Valid store coordinates are required';
  end if;
  if v_website_url is not null and not (
    v_website_url ~* '^https://[^[:space:]<>]+$'
    and split_part(split_part(v_website_url, '://', 2), '/', 1) !~ '@'
  ) then
    raise exception 'Store website must be a public HTTPS URL without embedded credentials';
  end if;
  if v_evidence_url is not null and not (
    v_evidence_url ~* '^https://[^[:space:]<>]+$'
    and split_part(split_part(v_evidence_url, '://', 2), '/', 1) !~ '@'
  ) then
    raise exception 'Verification evidence must be a public HTTPS URL without embedded credentials';
  end if;
  if exists (
    select 1 from public.store_applications a
    where a.applicant_user_id = v_uid and a.status in ('pending', 'under_review')
  ) then
    raise exception 'An application is already awaiting review';
  end if;
  if exists (
    select 1 from public.store_administrators a
    where a.user_id = v_uid and a.revoked_at is null
  ) then
    raise exception 'This account already manages an approved store';
  end if;

  update public.user_profiles
  set account_kind = 'store'
  where user_id = v_uid;

  insert into public.store_applications (
    applicant_user_id, store_name, contact_name, contact_email, phone,
    website_url, address_line_1, address_line_2, city, region, postcode,
    country_code, latitude, longitude, timezone, applicant_note, evidence_url
  ) values (
    v_uid, v_store_name, v_contact_name, v_contact_email,
    public.normalize_user_text(p_phone), v_website_url,
    v_address_line_1, public.normalize_user_text(p_address_line_2), v_city,
    public.normalize_user_text(p_region), v_postcode, v_country_code,
    p_latitude, p_longitude, v_timezone,
    public.normalize_user_text(p_applicant_note),
    v_evidence_url
  ) returning * into v_application;

  insert into public.activity_logs (
    user_id, actor_id, activity_type, entity_type, entity_id
  ) values (
    v_uid, v_uid, 'store_application_submitted', 'store_application', v_application.id
  );

  return v_application;
end;
$$;

create or replace function public.withdraw_store_application(p_application_id uuid)
returns public.store_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.store_applications%rowtype;
begin
  update public.store_applications
  set status = 'withdrawn'
  where id = p_application_id
    and applicant_user_id = v_uid
    and status in ('pending', 'under_review')
  returning * into v_application;

  if not found then
    raise exception 'Open store application not found';
  end if;

  insert into public.activity_logs (
    user_id, actor_id, activity_type, entity_type, entity_id
  ) values (
    v_uid, v_uid, 'store_application_withdrawn', 'store_application', v_application.id
  );

  return v_application;
end;
$$;

create or replace function public.begin_store_application_review(p_application_id uuid)
returns public.store_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.store_applications%rowtype;
begin
  if v_uid is null or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Platform administrator access required';
  end if;

  select * into v_application
  from public.store_applications
  where id = p_application_id
  for update;

  if not found or v_application.status not in ('pending', 'under_review') then
    raise exception 'Open store application not found';
  end if;
  if v_application.applicant_user_id = v_uid then
    raise exception 'Reviewers cannot review their own store application';
  end if;

  if v_application.status = 'pending' then
    update public.store_applications
    set status = 'under_review', reviewer_id = v_uid
    where id = p_application_id
    returning * into v_application;
  end if;

  return v_application;
end;
$$;

create or replace function public.review_store_application(
  p_application_id uuid,
  p_decision public.store_application_status,
  p_review_note text default null
)
returns public.store_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_application public.store_applications%rowtype;
  v_store_id uuid;
  v_community_id uuid;
  v_slug_base text;
  v_slug text;
  v_review_note text := public.normalize_user_text(p_review_note);
begin
  if v_uid is null or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Platform administrator access required';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if p_decision = 'rejected' and (v_review_note is null or length(v_review_note) < 3) then
    raise exception 'A rejection reason is required';
  end if;

  select * into v_application
  from public.store_applications
  where id = p_application_id
  for update;

  if not found or v_application.status not in ('pending', 'under_review') then
    raise exception 'Open store application not found';
  end if;
  if v_application.applicant_user_id = v_uid then
    raise exception 'Reviewers cannot decide their own store application';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1
      from public.app_users applicant
      where applicant.id = v_application.applicant_user_id
        and applicant.status = 'active'
    ) then
      raise exception 'Only an active applicant can receive store access';
    end if;

    v_slug_base := trim(both '-' from regexp_replace(
      lower(v_application.store_name), '[^a-z0-9]+', '-', 'g'
    ));
    if v_slug_base = '' then v_slug_base := 'store'; end if;
    v_slug := left(v_slug_base, 48) || '-' || substr(v_application.id::text, 1, 8);

    insert into public.stores (
      slug, name, address_line_1, address_line_2, city, region, postcode,
      country_code, latitude, longitude, timezone, contact_email, phone,
      website_url, is_verified, is_active
    ) values (
      v_slug, v_application.store_name, v_application.address_line_1,
      v_application.address_line_2, v_application.city, v_application.region,
      v_application.postcode, v_application.country_code,
      v_application.latitude, v_application.longitude, v_application.timezone,
      v_application.contact_email, v_application.phone,
      v_application.website_url, true, true
    ) returning id into v_store_id;

    insert into public.communities (store_id, name, description, is_active)
    values (
      v_store_id,
      v_application.store_name || ' Community',
      'Official local player community for ' || v_application.store_name || '.',
      true
    ) returning id into v_community_id;

    insert into public.store_administrators (
      store_id, user_id, assigned_by
    ) values (
      v_store_id, v_application.applicant_user_id, v_uid
    );

    insert into public.community_memberships (
      community_id, user_id, role, status
    ) values (
      v_community_id, v_application.applicant_user_id, 'moderator', 'active'
    )
    on conflict (community_id, user_id) do update set
      role = 'moderator', status = 'active', suspended_at = null,
      suspended_by = null, suspension_reason = null, left_at = null;

    update public.app_users
    set roles = case
      when 'store_administrator'::public.app_role = any(roles) then roles
      else array_append(roles, 'store_administrator'::public.app_role)
    end
    where id = v_application.applicant_user_id;
  end if;

  update public.store_applications
  set status = p_decision,
      reviewer_id = v_uid,
      review_note = v_review_note,
      reviewed_at = now(),
      approved_store_id = case when p_decision = 'approved' then v_store_id else null end
  where id = p_application_id
  returning * into v_application;

  insert into public.notifications (
    user_id, kind, title, body, action_url
  ) values (
    v_application.applicant_user_id,
    'system',
    case when p_decision = 'approved'
      then 'Store application approved'
      else 'Store application reviewed'
    end,
    case when p_decision = 'approved'
      then v_application.store_name || ' is now verified.'
      else coalesce(v_review_note, 'Your application was not approved.')
    end,
    case when p_decision = 'approved' then '/store-admin' else '/settings' end
  );

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id,
    metadata
  ) values (
    v_application.applicant_user_id, v_uid, v_community_id,
    case when p_decision = 'approved'
      then 'store_application_approved'
      else 'store_application_rejected'
    end,
    'store_application', v_application.id,
    jsonb_build_object('store_id', v_store_id, 'decision', p_decision)
  );

  return v_application;
end;
$$;

grant select on public.store_applications to authenticated;

revoke execute on function public.submit_store_application(
  text, text, text, text, text, text, text, double precision,
  double precision, text, text, text, text, text, text, text
) from public, anon;
revoke execute on function public.withdraw_store_application(uuid) from public, anon;
revoke execute on function public.begin_store_application_review(uuid) from public, anon;
revoke execute on function public.review_store_application(
  uuid, public.store_application_status, text
) from public, anon;

grant execute on function public.submit_store_application(
  text, text, text, text, text, text, text, double precision,
  double precision, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.withdraw_store_application(uuid) to authenticated;
grant execute on function public.begin_store_application_review(uuid) to authenticated;
grant execute on function public.review_store_application(
  uuid, public.store_application_status, text
) to authenticated;

-- Revoke implicit function execution from PUBLIC for trigger/internal helpers.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- Application decisions can refresh an applicant's open onboarding screen in
-- real time. Subscriber visibility still passes through the policies above.
alter table public.store_applications replica identity full;
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'store_applications'
     ) then
    execute 'alter publication supabase_realtime add table public.store_applications';
  end if;
end;
$$;

commit;
