-- TCG Harbor: store chat channels and moderation hardening.
--
-- This migration keeps `communities` as the store membership boundary and adds
-- channels underneath it. Existing clients that omit channel_id continue to
-- post into the community's default channel through the insert guard.

begin;

-- ---------------------------------------------------------------------------
-- Store-scoped chat channels
-- ---------------------------------------------------------------------------

create table public.community_channels (
  id uuid primary key default extensions.gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  archived_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint community_channels_id_community_unique unique (id, community_id),
  constraint community_channels_slug_shape check (
    slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint community_channels_name_length check (length(btrim(name)) between 1 and 80),
  constraint community_channels_description_length check (
    description is null or length(description) <= 2000
  ),
  constraint community_channels_archive_consistent check (
    (is_active and archived_at is null and archived_by is null)
    or (not is_active and archived_at is not null)
  ),
  constraint community_channels_default_stays_active check (
    not is_default or (is_active and archived_at is null)
  )
);

create unique index community_channels_community_slug_unique
  on public.community_channels (community_id, lower(slug))
  where archived_at is null;
create unique index community_channels_one_default_unique
  on public.community_channels (community_id)
  where is_default;
create index community_channels_active_feed_idx
  on public.community_channels (community_id, created_at, id)
  where is_active and archived_at is null;

comment on table public.community_channels is
  'Named chat streams inside a store community. Community membership remains the access boundary.';
comment on column public.community_channels.is_default is
  'Exactly one non-archivable default channel is backfilled for every community.';

-- Every existing community receives a stable default destination before
-- community_messages.channel_id becomes mandatory.
insert into public.community_channels (
  community_id, slug, name, description, is_default, is_active
)
select
  community.id,
  'general',
  'General',
  'The main community chat.',
  true,
  true
from public.communities community
where not exists (
  select 1
  from public.community_channels channel
  where channel.community_id = community.id and channel.is_default
);

-- Store approvals create communities after this migration has been applied.
-- Keep that path compatible without coupling the approval RPC to channel IDs.
create or replace function public.create_default_community_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.community_channels (
    community_id, slug, name, description, is_default, is_active
  ) values (
    new.id, 'general', 'General', 'The main community chat.', true, true
  )
  on conflict do nothing;
  return new;
end;
$$;

create trigger community_default_channel_after_insert
  after insert on public.communities
  for each row execute function public.create_default_community_channel();

alter table public.community_messages
  add column channel_id uuid;

update public.community_messages message
set channel_id = channel.id
from public.community_channels channel
where channel.community_id = message.community_id
  and channel.is_default
  and message.channel_id is null;

do $$
begin
  if exists (select 1 from public.community_messages where channel_id is null) then
    raise exception 'Every existing community message must resolve to a default channel';
  end if;
end;
$$;

alter table public.community_messages
  alter column channel_id set not null,
  add constraint community_messages_channel_community_fk
    foreign key (channel_id, community_id)
    references public.community_channels(id, community_id)
    on delete restrict;

create index community_messages_channel_feed_idx
  on public.community_messages (channel_id, created_at desc, id desc)
  where deleted_at is null;

comment on column public.community_messages.channel_id is
  'Required store-community channel. The composite foreign key prevents cross-community attachment.';

-- ---------------------------------------------------------------------------
-- Immutable moderation audit
-- ---------------------------------------------------------------------------

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  community_id uuid not null references public.communities(id) on delete restrict,
  actor_id uuid not null,
  target_user_id uuid,
  community_message_id uuid,
  community_membership_id uuid,
  action_type text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint moderation_actions_type check (
    action_type in ('message_removed', 'membership_status_changed', 'membership_role_changed')
  ),
  constraint moderation_actions_target_shape check (
    (action_type = 'message_removed'
      and community_message_id is not null and community_membership_id is null)
    or
    (action_type in ('membership_status_changed', 'membership_role_changed')
      and community_membership_id is not null and community_message_id is null)
  ),
  constraint moderation_actions_reason_length check (reason is null or length(reason) <= 1000),
  constraint moderation_actions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index moderation_actions_community_time_idx
  on public.moderation_actions (community_id, created_at desc, id desc);
create index moderation_actions_target_user_idx
  on public.moderation_actions (target_user_id, created_at desc)
  where target_user_id is not null;
create index moderation_actions_message_idx
  on public.moderation_actions (community_message_id)
  where community_message_id is not null;
create index moderation_actions_membership_idx
  on public.moderation_actions (community_membership_id)
  where community_membership_id is not null;

comment on table public.moderation_actions is
  'Append-only audit of message and membership moderation. UUID targets are intentionally retained as immutable evidence.';

create or replace function public.reject_moderation_action_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Moderation actions are immutable';
end;
$$;

create trigger moderation_actions_immutable_guard
  before update or delete on public.moderation_actions
  for each row execute function public.reject_moderation_action_mutation();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

-- A community moderator must now be an active application user inside an active
-- community and active store. Store and platform administrators retain their
-- existing paths, subject to those same operational-state checks.
create or replace function private.can_moderate_community(
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
    from public.communities community
    join public.stores store on store.id = community.store_id
    join public.app_users app_user on app_user.id = p_user_id
    where community.id = p_community_id
      and community.is_active
      and community.deleted_at is null
      and store.is_verified
      and store.is_active
      and store.deleted_at is null
      and app_user.status = 'active'
      and (
        private.has_app_role('platform_administrator', p_user_id)
        or private.is_store_administrator(store.id, p_user_id)
        or exists (
          select 1
          from public.community_memberships membership
          where membership.community_id = community.id
            and membership.user_id = p_user_id
            and membership.status = 'active'
            and membership.role = 'moderator'
        )
      )
  );
$$;

-- Channel creation and lifecycle changes are narrower than message moderation:
-- community moderators cannot restructure a store's channels.
create or replace function private.can_manage_community_channels(
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
    from public.communities community
    join public.stores store on store.id = community.store_id
    where community.id = p_community_id
      and community.is_active
      and community.deleted_at is null
      and store.is_verified
      and store.is_active
      and store.deleted_at is null
      and (
        private.is_store_administrator(store.id, p_user_id)
        or private.has_app_role('platform_administrator', p_user_id)
      )
  );
$$;

-- Store administrators need the same deliberately narrow member directory as
-- members in order to act on reports and membership moderation. Private profile,
-- location, email, and collection fields remain absent.
create or replace view public.community_member_profiles
with (security_barrier = true)
as
select
  membership.community_id,
  profile.user_id,
  profile.username,
  profile.display_name,
  profile.avatar_url,
  membership.role,
  membership.joined_at
from public.community_memberships membership
join public.user_profiles profile
  on profile.user_id = membership.user_id
  and profile.deleted_at is null
where membership.status = 'active'
  and (
    private.is_active_community_member(membership.community_id, auth.uid())
    or private.can_moderate_community(membership.community_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Field-whitelisted community and channel RPCs
-- ---------------------------------------------------------------------------

-- Direct community UPDATE is revoked below. This RPC deliberately exposes only
-- presentation and rules fields, never store_id, is_active, or deleted_at.
create or replace function public.update_community_profile(
  p_community_id uuid,
  p_name text,
  p_description text,
  p_rules text
)
returns public.communities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.normalize_user_text(p_name);
  v_community public.communities%rowtype;
begin
  if not private.can_manage_community_channels(p_community_id, auth.uid()) then
    raise exception 'Store administrator access required';
  end if;
  if v_name is null then raise exception 'Community name cannot be empty'; end if;

  update public.communities
  set name = v_name,
      description = public.normalize_user_text(p_description),
      rules = public.normalize_user_text(p_rules)
  where id = p_community_id
  returning * into v_community;

  if not found then raise exception 'Community not found'; end if;
  return v_community;
end;
$$;

create or replace function public.create_community_channel(
  p_community_id uuid,
  p_name text,
  p_slug text,
  p_description text default null
)
returns public.community_channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.normalize_user_text(p_name);
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_channel public.community_channels%rowtype;
begin
  if v_uid is null or not private.can_manage_community_channels(p_community_id, v_uid) then
    raise exception 'Store administrator access required';
  end if;
  if v_name is null then raise exception 'Channel name cannot be empty'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Channel slug is invalid';
  end if;

  insert into public.community_channels (
    community_id, slug, name, description, created_by
  ) values (
    p_community_id,
    v_slug,
    v_name,
    public.normalize_user_text(p_description),
    v_uid
  )
  returning * into v_channel;

  return v_channel;
end;
$$;

create or replace function public.update_community_channel(
  p_channel_id uuid,
  p_name text,
  p_slug text,
  p_description text default null
)
returns public.community_channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_channel public.community_channels%rowtype;
  v_name text := public.normalize_user_text(p_name);
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  select * into v_channel
  from public.community_channels
  where id = p_channel_id
  for update;

  if not found or v_uid is null
     or not private.can_manage_community_channels(v_channel.community_id, v_uid) then
    raise exception 'Store administrator access required';
  end if;
  if not v_channel.is_active or v_channel.archived_at is not null then
    raise exception 'Archived channels cannot be edited';
  end if;
  if v_name is null then raise exception 'Channel name cannot be empty'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Channel slug is invalid';
  end if;

  update public.community_channels
  set name = v_name,
      slug = v_slug,
      description = public.normalize_user_text(p_description)
  where id = p_channel_id
  returning * into v_channel;

  return v_channel;
end;
$$;

create or replace function public.archive_community_channel(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_channel public.community_channels%rowtype;
begin
  select * into v_channel
  from public.community_channels
  where id = p_channel_id
  for update;

  if not found or v_uid is null
     or not private.can_manage_community_channels(v_channel.community_id, v_uid) then
    raise exception 'Store administrator access required';
  end if;
  if v_channel.is_default then raise exception 'The default channel cannot be archived'; end if;
  if v_channel.archived_at is not null then return; end if;

  update public.community_channels
  set is_active = false,
      archived_at = statement_timestamp(),
      archived_by = v_uid
  where id = p_channel_id;
end;
$$;

create trigger community_channels_updated_at
  before update on public.community_channels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Message integrity and moderation
-- ---------------------------------------------------------------------------

create or replace function public.guard_community_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.body := public.normalize_user_text(new.body);
  if new.body is null then raise exception 'Message body cannot be empty'; end if;

  -- Authenticate before any privileged lookup. Because this trigger is
  -- SECURITY DEFINER, checking first prevents forged authors from using
  -- distinguishable validation errors to probe another user's membership,
  -- channels, or reply targets.
  if v_uid is not null then
    if new.author_id is distinct from v_uid then
      raise exception 'Message author must be the authenticated user';
    end if;
    if new.deleted_at is not null or new.deleted_by is not null then
      raise exception 'New messages cannot be pre-deleted';
    end if;
  end if;

  -- Compatibility for clients written before channels existed.
  if new.channel_id is null then
    select channel.id into new.channel_id
    from public.community_channels channel
    where channel.community_id = new.community_id
      and channel.is_default
      and channel.is_active
      and channel.archived_at is null;
    if not found then raise exception 'Active default channel not found'; end if;
  end if;

  if not exists (
    select 1
    from public.community_channels channel
    where channel.id = new.channel_id
      and channel.community_id = new.community_id
      and channel.is_active
      and channel.archived_at is null
  ) then
    raise exception 'An active channel in the same community is required';
  end if;
  if not private.is_active_community_member(new.community_id, new.author_id) then
    raise exception 'Active community membership required';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1
    from public.community_messages reply
    where reply.id = new.reply_to_id
      and reply.community_id = new.community_id
      and reply.channel_id = new.channel_id
      and reply.deleted_at is null
  ) then
    raise exception 'Reply target is outside this channel';
  end if;

  if v_uid is not null then
    new.created_at := statement_timestamp();
    -- Serialize the rate decision for one author. SECURITY DEFINER makes the
    -- count include messages hidden by member RLS (including soft deletions),
    -- while this transaction-scoped lock closes the concurrent-insert race.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.author_id::text, 0)
    );
    if (
      select count(*)
      from public.community_messages message
      where message.author_id = v_uid
        and message.created_at > now() - interval '1 minute'
    ) >= 12 then
      raise exception 'Community message rate limit exceeded';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_community_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.id <> old.id
     or new.community_id <> old.community_id
     or new.channel_id <> old.channel_id
     or new.author_id <> old.author_id
     or new.reply_to_id is distinct from old.reply_to_id
     or new.body <> old.body
     or new.created_at <> old.created_at
     or new.client_message_id <> old.client_message_id then
    raise exception 'Community message content and identity are immutable';
  end if;

  -- There is no client-visible restore transition. This also stops an author
  -- from undoing a moderator removal after learning the row identifier.
  if old.deleted_at is not null then
    raise exception 'Deleted community messages cannot be restored or changed';
  end if;
  if new.deleted_at is null then
    raise exception 'Community messages may only be updated by soft deletion';
  end if;
  if v_uid is null then raise exception 'Authenticated deletion required'; end if;
  if v_uid <> old.author_id and not private.can_moderate_community(old.community_id, v_uid) then
    raise exception 'Message author or community moderator access required';
  end if;

  -- Ignore client-supplied deletion provenance and assign both fields on the
  -- server. They become immutable immediately after this transition.
  new.deleted_at := statement_timestamp();
  new.deleted_by := v_uid;
  return new;
end;
$$;

create or replace function public.moderate_community_message(
  p_message_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.community_messages%rowtype;
  v_reason text := public.normalize_user_text(p_reason);
begin
  select * into v_message
  from public.community_messages
  where id = p_message_id
  for update;

  if not found or v_uid is null
     or not private.can_moderate_community(v_message.community_id, v_uid) then
    raise exception 'Community moderator access required';
  end if;
  if v_message.deleted_at is not null then raise exception 'Message is already deleted'; end if;

  update public.community_messages
  set deleted_at = statement_timestamp(), deleted_by = v_uid
  where id = p_message_id;

  insert into public.moderation_actions (
    community_id, actor_id, target_user_id, community_message_id,
    action_type, reason, metadata
  ) values (
    v_message.community_id,
    v_uid,
    v_message.author_id,
    v_message.id,
    'message_removed',
    v_reason,
    jsonb_build_object('channel_id', v_message.channel_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership moderation hierarchy and audit
-- ---------------------------------------------------------------------------

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
declare
  v_uid uuid := auth.uid();
  v_membership public.community_memberships%rowtype;
  v_store_id uuid;
  v_reason text := public.normalize_user_text(p_reason);
  v_actor_is_platform boolean;
  v_actor_is_store_admin boolean;
  v_target_is_store_admin boolean;
  v_suspender_is_platform boolean := false;
  v_suspender_is_store_admin boolean := false;
begin
  select membership.*
  into v_membership
  from public.community_memberships membership
  join public.communities community on community.id = membership.community_id
  where membership.id = p_membership_id
  for update of membership;

  if not found or v_uid is null
     or not private.can_moderate_community(v_membership.community_id, v_uid) then
    raise exception 'Community moderator access required';
  end if;
  select community.store_id into v_store_id
  from public.communities community
  where community.id = v_membership.community_id;
  if v_membership.user_id = v_uid then
    raise exception 'Moderators cannot moderate their own membership';
  end if;
  if p_status is null then raise exception 'Membership status is required'; end if;
  if p_status = v_membership.status then
    raise exception 'Membership already has the requested status';
  end if;

  v_actor_is_platform := private.has_app_role('platform_administrator', v_uid);
  v_actor_is_store_admin := private.is_store_administrator(v_store_id, v_uid);
  select exists (
    select 1
    from public.store_administrators administrator
    where administrator.store_id = v_store_id
      and administrator.user_id = v_membership.user_id
      and administrator.revoked_at is null
  ) into v_target_is_store_admin;

  if v_target_is_store_admin and not v_actor_is_platform then
    raise exception 'Only a platform administrator may moderate a store administrator';
  end if;
  if v_membership.role = 'moderator'
     and not (v_actor_is_store_admin or v_actor_is_platform) then
    raise exception 'Community moderators cannot moderate another moderator';
  end if;

  if p_status = 'active'
     and v_membership.status = 'suspended'
     and v_membership.suspended_by is not null then
    v_suspender_is_platform := private.has_app_role(
      'platform_administrator', v_membership.suspended_by
    );
    v_suspender_is_store_admin := private.is_store_administrator(
      v_store_id, v_membership.suspended_by
    );
    if v_suspender_is_platform and not v_actor_is_platform then
      raise exception 'Only a platform administrator may reverse this suspension';
    end if;
    if v_suspender_is_store_admin
       and not (v_actor_is_store_admin or v_actor_is_platform) then
      raise exception 'Only a store or platform administrator may reverse this suspension';
    end if;
  end if;

  update public.community_memberships
  set status = p_status,
      suspended_at = case when p_status = 'suspended' then statement_timestamp() else null end,
      suspended_by = case when p_status = 'suspended' then v_uid else null end,
      suspension_reason = case when p_status = 'suspended' then v_reason else null end,
      left_at = case when p_status = 'left' then statement_timestamp() else null end
  where id = p_membership_id;

  insert into public.moderation_actions (
    community_id, actor_id, target_user_id, community_membership_id,
    action_type, reason, metadata
  ) values (
    v_membership.community_id,
    v_uid,
    v_membership.user_id,
    v_membership.id,
    'membership_status_changed',
    v_reason,
    jsonb_build_object('old_status', v_membership.status, 'new_status', p_status)
  );
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
  v_uid uuid := auth.uid();
  v_membership public.community_memberships%rowtype;
  v_store_id uuid;
  v_actor_is_platform boolean;
  v_target_is_store_admin boolean;
begin
  select membership.*
  into v_membership
  from public.community_memberships membership
  join public.communities community on community.id = membership.community_id
  where membership.id = p_membership_id
  for update of membership;

  if not found or v_uid is null
     or not private.can_manage_community_channels(v_membership.community_id, v_uid) then
    raise exception 'Store administrator access required';
  end if;
  select community.store_id into v_store_id
  from public.communities community
  where community.id = v_membership.community_id;

  v_actor_is_platform := private.has_app_role('platform_administrator', v_uid);
  select exists (
    select 1
    from public.store_administrators administrator
    where administrator.store_id = v_store_id
      and administrator.user_id = v_membership.user_id
      and administrator.revoked_at is null
  ) into v_target_is_store_admin;

  if v_target_is_store_admin and not v_actor_is_platform then
    raise exception 'Only a platform administrator may change a store administrator role';
  end if;
  if p_role = 'moderator' and v_membership.status <> 'active' then
    raise exception 'Only an active member can become a moderator';
  end if;
  if p_role = v_membership.role then return; end if;

  update public.community_memberships
  set role = p_role
  where id = p_membership_id;

  if p_role = 'moderator' then
    update public.app_users
    set roles = array_append(roles, 'community_moderator'::public.app_role)
    where id = v_membership.user_id
      and not ('community_moderator'::public.app_role = any(roles));
  elsif not exists (
    select 1
    from public.community_memberships membership
    where membership.user_id = v_membership.user_id
      and membership.role = 'moderator'
      and membership.status = 'active'
      and membership.id <> p_membership_id
  ) then
    update public.app_users
    set roles = array_remove(roles, 'community_moderator'::public.app_role)
    where id = v_membership.user_id;
  end if;

  insert into public.moderation_actions (
    community_id, actor_id, target_user_id, community_membership_id,
    action_type, metadata
  ) values (
    v_membership.community_id,
    v_uid,
    v_membership.user_id,
    v_membership.id,
    'membership_role_changed',
    jsonb_build_object('old_role', v_membership.role, 'new_role', p_role)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS, grants, and Realtime
-- ---------------------------------------------------------------------------

alter table public.community_channels enable row level security;
alter table public.moderation_actions enable row level security;

create policy community_channels_member_select
  on public.community_channels
  for select to authenticated
  using (
    is_active
    and archived_at is null
    and private.is_active_community_member(community_id, (select auth.uid()))
  );

create policy community_channels_moderator_select
  on public.community_channels
  for select to authenticated
  using (
    private.can_moderate_community(community_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

create policy moderation_actions_moderator_select
  on public.moderation_actions
  for select to authenticated
  using (
    private.can_moderate_community(community_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

-- Members receive only live, non-deleted channel content. Moderators retain a
-- separate evidence path for deleted or archived-channel messages.
drop policy if exists community_messages_member_select on public.community_messages;
create policy community_messages_member_select
  on public.community_messages
  for select to authenticated
  using (
    deleted_at is null
    and private.is_active_community_member(community_id, (select auth.uid()))
    and exists (
      select 1
      from public.community_channels channel
      where channel.id = community_messages.channel_id
        and channel.community_id = community_messages.community_id
        and channel.is_active
        and channel.archived_at is null
    )
  );

create policy community_messages_moderator_select
  on public.community_messages
  for select to authenticated
  using (
    private.can_moderate_community(community_id, (select auth.uid()))
    or private.has_app_role('platform_administrator', (select auth.uid()))
  );

drop policy if exists community_messages_member_insert on public.community_messages;
create policy community_messages_member_insert
  on public.community_messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.is_active_community_member(community_id, (select auth.uid()))
    and exists (
      select 1
      from public.community_channels channel
      where channel.id = community_messages.channel_id
        and channel.community_id = community_messages.community_id
        and channel.is_active
        and channel.archived_at is null
    )
  );

drop policy if exists community_messages_author_or_moderator_update on public.community_messages;
create policy community_messages_author_soft_delete
  on public.community_messages
  for update to authenticated
  using (author_id = (select auth.uid()) and deleted_at is null)
  with check (author_id = (select auth.uid()));

-- Sensitive community lifecycle fields are no longer directly writable by an
-- authenticated client. Presentation changes go through update_community_profile;
-- platform lifecycle operations remain trusted-server work until a dedicated
-- approval/lifecycle RPC is introduced.
drop policy if exists communities_moderator_update on public.communities;
revoke update on public.communities from authenticated;

revoke all on public.community_channels, public.moderation_actions
  from public, anon, authenticated;
grant select on public.community_channels, public.moderation_actions to authenticated;

revoke execute on function public.reject_moderation_action_mutation()
  from public, anon, authenticated;
revoke execute on function public.create_default_community_channel()
  from public, anon, authenticated;
revoke execute on function private.can_manage_community_channels(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.can_moderate_community(uuid, uuid)
  from public, anon;
grant execute on function private.can_moderate_community(uuid, uuid) to authenticated;

revoke execute on function public.update_community_profile(uuid, text, text, text),
  public.create_community_channel(uuid, text, text, text),
  public.update_community_channel(uuid, text, text, text),
  public.archive_community_channel(uuid),
  public.moderate_community_message(uuid, text)
  from public, anon;
grant execute on function public.update_community_profile(uuid, text, text, text),
  public.create_community_channel(uuid, text, text, text),
  public.update_community_channel(uuid, text, text, text),
  public.archive_community_channel(uuid),
  public.moderate_community_message(uuid, text)
  to authenticated;

-- Reassert the intended privileges for the replaced membership RPCs.
revoke execute on function public.moderate_community_membership(
  uuid, public.membership_status, text
), public.set_community_membership_role(uuid, public.membership_role)
  from public, anon;
grant execute on function public.moderate_community_membership(
  uuid, public.membership_status, text
), public.set_community_membership_role(uuid, public.membership_role)
  to authenticated;

alter table public.community_channels replica identity full;
alter table public.moderation_actions replica identity full;

-- Publication membership is conditional and idempotent for hosted Supabase,
-- local databases without Realtime, and repeated schema-validation runs.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_channels'
    ) then
      execute 'alter publication supabase_realtime add table public.community_channels';
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'moderation_actions'
    ) then
      execute 'alter publication supabase_realtime add table public.moderation_actions';
    end if;
  end if;
end;
$$;

commit;

-- Design/test caveats:
-- 1. General is intentionally non-archivable. A future set-default RPC is needed
--    before products can replace or archive the default channel.
-- 2. Archived-channel messages remain readable to authorized moderators as
--    evidence, while ordinary members see only active, non-deleted content.
-- 3. moderation_actions stores immutable UUID evidence without target foreign
--    keys so account erasure cannot silently rewrite the audit. Define retention
--    and pseudonymization policy before handling real moderation reports.
-- 4. Integration tests must exercise cross-store channel mutation denial,
--    moderator hierarchy, deleted-message restore denial, and Realtime RLS.
