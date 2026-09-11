-- TCG Harbor: store member approval toggle, join requests, and manager member removal.
begin;

-- Add manual approval toggle to stores table (default false for automatic join)
alter table public.stores
  add column if not exists requires_member_approval boolean not null default false;

grant update (requires_member_approval) on public.stores to authenticated;

-- Pending and reviewed store community join requests
create table if not exists public.store_join_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text check (note is null or length(note) <= 300),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.app_users(id) on delete set null,
  constraint store_join_requests_unique_user_store unique (store_id, user_id)
);

alter table public.store_join_requests enable row level security;

-- Applicants can view their own join requests
create policy store_join_requests_select_own
  on public.store_join_requests for select to authenticated
  using (user_id = (select auth.uid()));

-- Store administrators and platform administrators can view join requests for their store
create policy store_join_requests_select_store_admin
  on public.store_join_requests for select to authenticated
  using (
    private.is_store_administrator(store_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

-- Function for a player to submit a join request with an optional note
create or replace function public.submit_store_join_request(
  p_store_id uuid,
  p_note text default null
)
returns public.store_join_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.store_join_requests%rowtype;
  v_clean_note text := left(coalesce(btrim(p_note), ''), 300);
begin
  if v_uid is null or not exists (
    select 1 from public.app_users u where u.id = v_uid and u.status = 'active'
  ) then
    raise exception 'An active authenticated account is required';
  end if;

  if not exists (
    select 1 from public.stores s where s.id = p_store_id and s.is_active and s.deleted_at is null
  ) then
    raise exception 'Store not found';
  end if;

  if v_clean_note = '' then
    v_clean_note := null;
  end if;

  insert into public.store_join_requests (
    store_id, user_id, status, note, requested_at
  ) values (
    p_store_id, v_uid, 'pending', v_clean_note, statement_timestamp()
  )
  on conflict (store_id, user_id) do update set
    status = 'pending',
    note = coalesce(v_clean_note, store_join_requests.note),
    requested_at = statement_timestamp(),
    reviewed_at = null,
    reviewed_by = null
  returning * into v_request;

  return v_request;
end;
$$;

-- Function for store manager to approve or reject a join request
create or replace function public.review_store_join_request(
  p_request_id uuid,
  p_decision text
)
returns public.store_join_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.store_join_requests%rowtype;
  v_community_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_request
  from public.store_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Join request not found';
  end if;

  if not (
    private.is_store_administrator(v_request.store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  update public.store_join_requests
  set status = p_decision,
      reviewed_at = statement_timestamp(),
      reviewed_by = v_uid
  where id = p_request_id
  returning * into v_request;

  if p_decision = 'approved' then
    select id into v_community_id
    from public.communities
    where store_id = v_request.store_id and is_active and deleted_at is null;

    if v_community_id is not null then
      insert into public.community_memberships (
        community_id, user_id, role, status
      ) values (
        v_community_id, v_request.user_id, 'member', 'active'
      )
      on conflict (community_id, user_id) do update set
        status = 'active',
        left_at = null,
        suspended_at = null,
        suspended_by = null,
        suspension_reason = null;
    end if;
  end if;

  return v_request;
end;
$$;

-- Function for store manager to remove a member from community
create or replace function public.remove_community_member(
  p_community_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_store_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select store_id into v_store_id
  from public.communities
  where id = p_community_id;

  if not (
    private.is_store_administrator(v_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  if v_uid = p_user_id then
    raise exception 'Store managers cannot remove themselves';
  end if;

  update public.community_memberships
  set status = 'left',
      left_at = statement_timestamp()
  where community_id = p_community_id
    and user_id = p_user_id;
end;
$$;

grant execute on function public.submit_store_join_request(uuid, text) to authenticated;
grant execute on function public.review_store_join_request(uuid, text) to authenticated;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;

commit;
