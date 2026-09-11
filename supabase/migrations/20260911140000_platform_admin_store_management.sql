-- Platform Administrator Approved Store Management
-- Provides secure listing, updating (name, slug/username, address, owner), and deletion of stores.

create or replace function public.platform_admin_list_stores()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  address_line_1 text,
  address_line_2 text,
  city text,
  region text,
  postcode text,
  country_code text,
  latitude double precision,
  longitude double precision,
  timezone text,
  opening_hours jsonb,
  contact_email text,
  phone text,
  website_url text,
  image_url text,
  is_verified boolean,
  is_active boolean,
  created_at timestamptz,
  owner_user_id uuid,
  owner_username text,
  owner_display_name text,
  community_id uuid,
  community_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Only platform administrators may view the approved stores administration list';
  end if;

  return query
  select
    s.id,
    s.slug,
    s.name,
    s.description,
    s.address_line_1,
    s.address_line_2,
    s.city,
    s.region,
    s.postcode,
    s.country_code::text,
    s.latitude,
    s.longitude,
    s.timezone,
    s.opening_hours,
    s.contact_email,
    s.phone,
    s.website_url,
    s.image_url,
    s.is_verified,
    s.is_active,
    s.created_at,
    sa.user_id as owner_user_id,
    p.username as owner_username,
    p.display_name as owner_display_name,
    c.id as community_id,
    c.name as community_name
  from public.stores s
  left join lateral (
    select admin.user_id
    from public.store_administrators admin
    where admin.store_id = s.id
      and admin.revoked_at is null
    order by admin.assigned_at asc
    limit 1
  ) sa on true
  left join public.user_profiles p on p.user_id = sa.user_id
  left join lateral (
    select comm.id, comm.name
    from public.communities comm
    where comm.store_id = s.id
      and comm.deleted_at is null
    order by comm.created_at asc
    limit 1
  ) c on true
  where s.deleted_at is null
  order by s.is_verified desc, s.name asc;
end;
$$;

create or replace function public.platform_admin_update_store(
  p_store_id uuid,
  p_name text,
  p_slug text,
  p_address_line_1 text,
  p_city text,
  p_postcode text,
  p_country_code text,
  p_latitude double precision,
  p_longitude double precision,
  p_address_line_2 text default null,
  p_region text default null,
  p_contact_email text default null,
  p_phone text default null,
  p_website_url text default null,
  p_owner_username text default null
)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_store public.stores%rowtype;
  v_name text := public.normalize_user_text(p_name);
  v_slug text := lower(public.normalize_user_text(p_slug));
  v_address_line_1 text := public.normalize_user_text(p_address_line_1);
  v_address_line_2 text := public.normalize_user_text(p_address_line_2);
  v_city text := public.normalize_user_text(p_city);
  v_region text := public.normalize_user_text(p_region);
  v_postcode text := public.normalize_user_text(p_postcode);
  v_country_code text := upper(coalesce(public.normalize_user_text(p_country_code), ''));
  v_contact_email text := lower(coalesce(public.normalize_user_text(p_contact_email), ''));
  v_phone text := public.normalize_user_text(p_phone);
  v_website_url text := public.normalize_user_text(p_website_url);
  v_owner_username text := lower(coalesce(public.normalize_user_text(p_owner_username), ''));
  v_new_owner_id uuid;
  v_community_id uuid;
begin
  if v_uid is null or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Only platform administrators may update stores';
  end if;

  select * into v_store from public.stores where id = p_store_id and deleted_at is null;
  if not found then
    raise exception 'Store not found';
  end if;

  if v_name is null or length(v_name) not between 2 and 160 then
    raise exception 'Store name must contain between 2 and 160 characters';
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Store slug must use lowercase alphanumeric characters and hyphens';
  end if;

  if exists (
    select 1 from public.stores
    where lower(slug) = v_slug and id <> p_store_id and deleted_at is null
  ) then
    raise exception 'A store with this slug already exists';
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

  if v_contact_email <> '' and v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid contact email is required';
  end if;

  if v_website_url is not null and not (
    v_website_url ~* '^https://[^[:space:]<>]+$'
    and split_part(split_part(v_website_url, '://', 2), '/', 1) !~ '@'
  ) then
    raise exception 'Store website must be a public HTTPS URL without embedded credentials';
  end if;

  update public.stores
  set
    name = v_name,
    slug = v_slug,
    address_line_1 = v_address_line_1,
    address_line_2 = v_address_line_2,
    city = v_city,
    region = v_region,
    postcode = v_postcode,
    country_code = v_country_code,
    latitude = p_latitude,
    longitude = p_longitude,
    contact_email = nullif(v_contact_email, ''),
    phone = v_phone,
    website_url = v_website_url,
    updated_at = now()
  where id = p_store_id
  returning * into v_store;

  -- Reassign or set owner if owner_username was provided
  if v_owner_username <> '' then
    select user_id into v_new_owner_id
    from public.user_profiles
    where lower(username) = v_owner_username;

    if v_new_owner_id is not null then
      -- Revoke previous assignments if different
      update public.store_administrators
      set revoked_at = now()
      where store_id = p_store_id and revoked_at is null and user_id <> v_new_owner_id;

      -- Assign new owner
      insert into public.store_administrators (store_id, user_id, assigned_by)
      values (p_store_id, v_new_owner_id, v_uid)
      on conflict (store_id, user_id) do update set
        revoked_at = null, assigned_at = now(), assigned_by = v_uid;

      -- Ensure role in app_users
      update public.app_users
      set roles = case
        when 'store_administrator'::public.app_role = any(roles) then roles
        else array_append(roles, 'store_administrator'::public.app_role)
      end
      where id = v_new_owner_id;

      -- Ensure moderator membership in store community
      select id into v_community_id from public.communities where store_id = p_store_id and deleted_at is null limit 1;
      if v_community_id is not null then
        insert into public.community_memberships (community_id, user_id, role, status)
        values (v_community_id, v_new_owner_id, 'moderator', 'active')
        on conflict (community_id, user_id) do update set role = 'moderator', status = 'active', left_at = null;
      end if;
    end if;
  end if;

  return v_store;
end;
$$;

create or replace function public.platform_admin_delete_store(
  p_store_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Only platform administrators may delete stores';
  end if;

  if not exists (select 1 from public.stores where id = p_store_id and deleted_at is null) then
    raise exception 'Store not found';
  end if;

  -- Soft-delete store
  update public.stores
  set
    deleted_at = now(),
    is_active = false,
    updated_at = now()
  where id = p_store_id;

  -- Soft-delete associated communities
  update public.communities
  set
    deleted_at = now(),
    is_active = false,
    updated_at = now()
  where store_id = p_store_id and deleted_at is null;

  -- Revoke active store administrator assignments
  update public.store_administrators
  set revoked_at = now()
  where store_id = p_store_id and revoked_at is null;

  return true;
end;
$$;

revoke execute on function public.platform_admin_list_stores() from public, anon;
grant execute on function public.platform_admin_list_stores() to authenticated;

revoke execute on function public.platform_admin_update_store(uuid, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, text) from public, anon;
grant execute on function public.platform_admin_update_store(uuid, text, text, text, text, text, text, double precision, double precision, text, text, text, text, text, text) to authenticated;

revoke execute on function public.platform_admin_delete_store(uuid) from public, anon;
grant execute on function public.platform_admin_delete_store(uuid) to authenticated;
