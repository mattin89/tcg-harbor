-- TCG Harbor: secure, per-physical-store QR community invitations.
--
-- The QR contains a high-entropy bearer token. Only its SHA-256 digest is
-- persisted; the raw token is returned exactly once by generate/rotate RPCs.
-- One primary in-store QR may be active per physical store. Historical rows
-- remain available as redacted audit metadata to authorized store operators.

begin;

-- ---------------------------------------------------------------------------
-- Primary QR lifecycle metadata
-- ---------------------------------------------------------------------------

alter table public.store_join_codes
  add column is_primary_qr boolean not null default false,
  add column rotated_from_id uuid references public.store_join_codes(id) on delete set null,
  add column rotated_to_id uuid references public.store_join_codes(id) on delete set null,
  add column deactivated_by uuid references public.app_users(id) on delete set null,
  add column deactivation_reason text;

-- Persist suspension authority at the time of moderation. Looking up the
-- suspender's current role is insufficient because that role can later be
-- revoked, which could let a lower-privilege moderator reverse the action.
alter table public.community_memberships
  add column suspension_authority text;

-- Existing suspension provenance did not record authority. Treat it
-- conservatively as platform-level; a platform administrator can review and
-- explicitly lift those historical suspensions.
update public.community_memberships
set suspension_authority = 'platform_administrator'
where status = 'suspended';

alter table public.community_memberships
  add constraint community_memberships_suspension_authority check (
    (
      status = 'suspended'
      and suspension_authority is not null
      and suspension_authority in (
        'community_moderator', 'store_administrator', 'platform_administrator'
      )
    )
    or (status <> 'suspended' and suspension_authority is null)
  );

comment on column public.community_memberships.suspension_authority is
  'Immutable authority tier captured when a suspension is imposed; used to prevent lower-tier reversal.';

-- Extend the immutable moderation ledger with the explicit operation that
-- removes store-level authority. Reusing a generic membership action would
-- obscure the security boundary that actually changed.
alter table public.moderation_actions
  drop constraint moderation_actions_type,
  drop constraint moderation_actions_target_shape,
  add constraint moderation_actions_type check (
    action_type in (
      'message_removed', 'membership_status_changed',
      'membership_role_changed', 'store_administrator_revoked'
    )
  ),
  add constraint moderation_actions_target_shape check (
    (
      action_type = 'message_removed'
      and community_message_id is not null
      and community_membership_id is null
    )
    or
    (
      action_type in (
        'membership_status_changed', 'membership_role_changed',
        'store_administrator_revoked'
      )
      and community_membership_id is not null
      and community_message_id is null
    )
  );

alter table public.store_join_codes
  add constraint store_join_codes_hash_is_sha256
    check (octet_length(code_hash) = 32),
  add constraint store_join_codes_deactivation_reason_length
    check (deactivation_reason is null or length(deactivation_reason) between 1 and 500),
  add constraint store_join_codes_rotation_not_self check (
    (rotated_from_id is null or rotated_from_id <> id)
    and (rotated_to_id is null or rotated_to_id <> id)
  ),
  add constraint store_join_codes_active_has_no_deactivation_metadata check (
    deactivated_at is not null
    or (
      deactivated_by is null
      and deactivation_reason is null
      and rotated_to_id is null
    )
  ),
  add constraint store_join_codes_primary_is_persistent check (
    not is_primary_qr or (expires_at is null and max_uses is null)
  );

-- Older deployments did not constrain labels. Normalize only rows that would
-- otherwise abort this migration, then enforce the bound for every new write.
update public.store_join_codes
set label = left(public.normalize_user_text(label), 120)
where label is not null
  and length(btrim(label)) not between 1 and 120;

alter table public.store_join_codes
  add constraint store_join_codes_label_length
    check (label is null or length(btrim(label)) between 1 and 120);

-- Defense in depth for a hosted project that was accidentally loaded with the
-- documented local-only seed. These fixed IDs are public fixtures and must not
-- remain redeemable in production. During `db reset`, seed.sql runs after the
-- migrations and intentionally recreates them for local development only.
update public.store_join_codes
set deactivated_at = coalesce(deactivated_at, statement_timestamp()),
    deactivation_reason = coalesce(deactivation_reason, 'known_demo_fixture_retired')
where id in (
  '22000000-0000-4000-8000-000000000001'::uuid,
  '22000000-0000-4000-8000-000000000002'::uuid,
  '22000000-0000-4000-8000-000000000003'::uuid,
  '22000000-0000-4000-8000-000000000004'::uuid,
  '22000000-0000-4000-8000-000000000005'::uuid,
  '22000000-0000-4000-8000-000000000006'::uuid
);

create unique index store_join_codes_one_active_primary_per_store
  on public.store_join_codes (store_id)
  where is_primary_qr and deactivated_at is null;

create unique index store_join_codes_rotation_source_unique
  on public.store_join_codes (rotated_from_id)
  where rotated_from_id is not null;

create unique index store_join_codes_rotation_target_unique
  on public.store_join_codes (rotated_to_id)
  where rotated_to_id is not null;

create index store_join_codes_primary_history_idx
  on public.store_join_codes (store_id, created_at desc)
  include (community_id, code_prefix, use_count, deactivated_at)
  where is_primary_qr;

comment on column public.store_join_codes.code_hash is
  'SHA-256 digest of a high-entropy bearer token. Never expose through the Data API.';
comment on column public.store_join_codes.is_primary_qr is
  'True only for the physical in-store QR invitation managed through the dedicated QR RPCs.';

-- Internal insertion primitive. Its callers must authorize and lock the store
-- first. The function is not exposed to any Data API role.
create or replace function private.insert_primary_store_qr_invite(
  p_store_id uuid,
  p_community_id uuid,
  p_label text,
  p_created_by uuid,
  p_rotated_from_id uuid default null
)
returns table (
  invite_id uuid,
  store_id uuid,
  community_id uuid,
  raw_token text,
  token_prefix text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_raw_token text;
  v_label text := coalesce(public.normalize_user_text(p_label), 'In-store QR');
  v_created_at timestamptz := statement_timestamp();
begin
  if length(v_label) not between 1 and 120 then
    raise exception 'QR label must contain between 1 and 120 characters';
  end if;

  -- 32 random bytes provide 256 bits of entropy. Hex plus a fixed prefix is
  -- URL-path safe without additional encoding or normalization.
  v_raw_token := 'thq_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.store_join_codes (
    store_id,
    community_id,
    code_hash,
    code_prefix,
    label,
    created_by,
    created_at,
    updated_at,
    is_primary_qr,
    rotated_from_id
  ) values (
    p_store_id,
    p_community_id,
    extensions.digest(v_raw_token, 'sha256'),
    left(v_raw_token, 12),
    v_label,
    p_created_by,
    v_created_at,
    v_created_at,
    true,
    p_rotated_from_id
  )
  returning id into v_id;

  return query
  select v_id, p_store_id, p_community_id, v_raw_token,
    left(v_raw_token, 12), v_created_at;
end;
$$;

revoke all on function private.insert_primary_store_qr_invite(
  uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Store-facing QR management RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_store_qr_invites(p_store_id uuid)
returns table (
  invite_id uuid,
  store_id uuid,
  community_id uuid,
  token_prefix text,
  label text,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  use_count integer,
  last_used_at timestamptz,
  revoked_at timestamptz,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  return query
  select
    join_code.id,
    join_code.store_id,
    join_code.community_id,
    join_code.code_prefix,
    join_code.label,
    join_code.created_at,
    join_code.expires_at,
    join_code.max_uses,
    join_code.use_count,
    join_code.last_used_at,
    join_code.deactivated_at,
    (
      join_code.deactivated_at is null
      and (join_code.expires_at is null or join_code.expires_at > statement_timestamp())
      and (join_code.max_uses is null or join_code.use_count < join_code.max_uses)
      and store.is_verified
      and store.is_active
      and store.deleted_at is null
      and community.is_active
      and community.deleted_at is null
    )
  from public.store_join_codes join_code
  join public.stores store on store.id = join_code.store_id
  join public.communities community on community.id = join_code.community_id
  where join_code.store_id = p_store_id
    and join_code.is_primary_qr
  order by join_code.created_at desc;
end;
$$;

create or replace function public.generate_store_qr_invite(
  p_store_id uuid,
  p_label text default 'In-store QR'
)
returns table (
  invite_id uuid,
  store_id uuid,
  community_id uuid,
  raw_token text,
  token_prefix text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_community_id uuid;
  v_invite record;
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  select community.id
  into v_community_id
  from public.stores store
  join public.communities community on community.store_id = store.id
  where store.id = p_store_id
    and store.is_verified
    and store.is_active
    and store.deleted_at is null
    and community.is_active
    and community.deleted_at is null
  for update of store, community;

  if not found then
    raise exception 'An approved active store community is required';
  end if;
  if exists (
    select 1
    from public.store_join_codes join_code
    where join_code.store_id = p_store_id
      and join_code.is_primary_qr
      and join_code.deactivated_at is null
  ) then
    raise exception 'This store already has an active QR invite; rotate it instead';
  end if;

  select * into v_invite
  from private.insert_primary_store_qr_invite(
    p_store_id, v_community_id, p_label, v_uid, null
  );

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id
  ) values (
    v_uid, v_uid, v_community_id,
    'store_qr_invite_generated', 'store_join_code', v_invite.invite_id
  );

  return query
  select v_invite.invite_id, v_invite.store_id, v_invite.community_id,
    v_invite.raw_token, v_invite.token_prefix, v_invite.created_at;
end;
$$;

create or replace function public.rotate_store_qr_invite(
  p_store_id uuid,
  p_label text default null
)
returns table (
  invite_id uuid,
  store_id uuid,
  community_id uuid,
  raw_token text,
  token_prefix text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_community_id uuid;
  v_previous_id uuid;
  v_previous_label text;
  v_invite record;
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  select community.id
  into v_community_id
  from public.stores store
  join public.communities community on community.store_id = store.id
  where store.id = p_store_id
    and store.is_verified
    and store.is_active
    and store.deleted_at is null
    and community.is_active
    and community.deleted_at is null
  for update of store, community;

  if not found then
    raise exception 'An approved active store community is required';
  end if;

  select join_code.id, join_code.label
  into v_previous_id, v_previous_label
  from public.store_join_codes join_code
  where join_code.store_id = p_store_id
    and join_code.is_primary_qr
    and join_code.deactivated_at is null
  for update;

  if not found then
    raise exception 'Active store QR invite not found; generate one first';
  end if;

  update public.store_join_codes
  set deactivated_at = statement_timestamp(),
      deactivated_by = v_uid,
      deactivation_reason = 'rotated'
  where id = v_previous_id;

  select * into v_invite
  from private.insert_primary_store_qr_invite(
    p_store_id,
    v_community_id,
    coalesce(p_label, v_previous_label, 'In-store QR'),
    v_uid,
    v_previous_id
  );

  update public.store_join_codes
  set rotated_to_id = v_invite.invite_id
  where id = v_previous_id;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id, metadata
  ) values (
    v_uid, v_uid, v_community_id,
    'store_qr_invite_rotated', 'store_join_code', v_invite.invite_id,
    jsonb_build_object('rotated_from_invite_id', v_previous_id)
  );

  return query
  select v_invite.invite_id, v_invite.store_id, v_invite.community_id,
    v_invite.raw_token, v_invite.token_prefix, v_invite.created_at;
end;
$$;

create or replace function public.revoke_store_qr_invite(
  p_store_id uuid,
  p_reason text default null
)
returns table (invite_id uuid, revoked_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite_id uuid;
  v_community_id uuid;
  v_revoked_at timestamptz := statement_timestamp();
  v_reason text := coalesce(public.normalize_user_text(p_reason), 'revoked_by_store');
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Revocation reason cannot exceed 500 characters';
  end if;

  -- Revocation remains available when a store/community is inactive so an
  -- operator can always invalidate a leaked or retired bearer token.
  perform 1
  from public.stores store
  where store.id = p_store_id
  for update;

  update public.store_join_codes join_code
  set deactivated_at = v_revoked_at,
      deactivated_by = v_uid,
      deactivation_reason = v_reason
  where join_code.store_id = p_store_id
    and join_code.is_primary_qr
    and join_code.deactivated_at is null
  returning join_code.id, join_code.community_id
  into v_invite_id, v_community_id;

  if not found then
    raise exception 'Active store QR invite not found';
  end if;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id,
    metadata
  ) values (
    v_uid, v_uid, v_community_id,
    'store_qr_invite_revoked', 'store_join_code', v_invite_id,
    jsonb_build_object('reason', v_reason)
  );

  return query select v_invite_id, v_revoked_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Harden the legacy token endpoints and support safe membership reactivation
-- ---------------------------------------------------------------------------

create or replace function public.validate_store_join_code(p_code text)
returns table (
  store_id uuid,
  community_id uuid,
  store_name text,
  community_name text,
  code_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (
    select 1
    from public.app_users app_user
    where app_user.id = v_uid and app_user.status = 'active'
  ) then
    raise exception 'An active authenticated account is required';
  end if;
  if p_code is null or length(btrim(p_code)) not between 8 and 160 then
    return;
  end if;

  return query
  select
    store.id,
    community.id,
    store.name,
    community.name,
    case
      when join_code.deactivated_at is not null then 'revoked'
      when join_code.expires_at is not null
        and join_code.expires_at <= statement_timestamp() then 'expired'
      when join_code.max_uses is not null
        and join_code.use_count >= join_code.max_uses then 'expired'
      when not store.is_verified
        or not store.is_active
        or store.deleted_at is not null
        or not community.is_active
        or community.deleted_at is not null then 'revoked'
      else 'valid'
    end
  from public.store_join_codes join_code
  join public.stores store on store.id = join_code.store_id
  join public.communities community on community.id = join_code.community_id
  where join_code.code_hash = extensions.digest(btrim(p_code), 'sha256')
  limit 1;
end;
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
  v_reactivated boolean := false;
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (
    select 1
    from public.app_users app_user
    where app_user.id = v_uid and app_user.status = 'active'
  ) then
    raise exception 'An active authenticated account is required';
  end if;

  if p_request_fingerprint is not null then
    v_fingerprint := extensions.digest(left(p_request_fingerprint, 512), 'sha256');
  end if;

  -- Serialize the per-account decision before counting attempts. This closes
  -- the concurrent-call race in the original implementation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 5)
  );

  if (
    select count(*)
    from public.store_join_attempts attempt
    where attempt.user_id = v_uid
      and attempt.attempted_at > statement_timestamp() - interval '15 minutes'
  ) >= 10 then
    -- Do not append a row for every blocked call: that would make the rate
    -- limiter itself a write-amplification path.
    return query
      select 'rate_limited'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  if p_code is null or length(btrim(p_code)) not between 8 and 160 then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, left(coalesce(btrim(p_code), ''), 16), v_fingerprint, 'invalid'
    );
    return query
      select 'invalid'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  select *
  into v_code
  from public.store_join_codes join_code
  where join_code.code_hash = extensions.digest(btrim(p_code), 'sha256')
  for update;

  if not found then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, left(btrim(p_code), 16), v_fingerprint, 'invalid'
    );
    return query
      select 'invalid'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  if v_code.deactivated_at is not null then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'revoked'
    );
    return query
      select 'revoked'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  if (v_code.expires_at is not null and v_code.expires_at <= statement_timestamp())
     or (v_code.max_uses is not null and v_code.use_count >= v_code.max_uses) then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'expired'
    );
    return query
      select 'expired'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.communities community
    join public.stores store on store.id = community.store_id
    where community.id = v_code.community_id
      and community.store_id = v_code.store_id
      and community.is_active
      and community.deleted_at is null
      and store.is_verified
      and store.is_active
      and store.deleted_at is null
  ) then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'revoked'
    );
    return query
      select 'revoked'::public.join_attempt_outcome, null::uuid;
    return;
  end if;

  select membership.status
  into v_existing_status
  from public.community_memberships membership
  where membership.community_id = v_code.community_id
    and membership.user_id = v_uid
  for update;

  if found and v_existing_status = 'active' then
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'already_member'
    );
    return query
      select 'already_member'::public.join_attempt_outcome, v_code.community_id;
    return;
  elsif found and v_existing_status = 'suspended' then
    -- A bearer token must never bypass a moderator suspension.
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'revoked'
    );
    return query
      select 'revoked'::public.join_attempt_outcome, null::uuid;
    return;
  elsif found and v_existing_status = 'left' then
    update public.community_memberships
    set role = case
          when private.is_store_administrator(v_code.store_id, v_uid)
            then 'moderator'::public.membership_role
          else 'member'::public.membership_role
        end,
        status = 'active',
        joined_via_code_id = v_code.id,
        joined_at = statement_timestamp(),
        last_read_chat_at = null,
        suspended_at = null,
        suspended_by = null,
        suspension_reason = null,
        suspension_authority = null,
        left_at = null
    where community_id = v_code.community_id
      and user_id = v_uid;
    v_reactivated := true;
  else
    insert into public.community_memberships (
      community_id, user_id, role, status, joined_via_code_id
    ) values (
      v_code.community_id,
      v_uid,
      case
        when private.is_store_administrator(v_code.store_id, v_uid)
          then 'moderator'::public.membership_role
        else 'member'::public.membership_role
      end,
      'active',
      v_code.id
    );
  end if;

  update public.store_join_codes
  set use_count = use_count + 1,
      last_used_at = statement_timestamp()
  where id = v_code.id;

  insert into public.store_join_attempts (
    user_id, code_prefix, request_fingerprint_hash, outcome
  ) values (
    v_uid, v_code.code_prefix, v_fingerprint, 'joined'
  );

  insert into public.notifications (
    user_id, kind, title, body, community_id, action_url
  )
  select
    v_uid,
    'community_joined',
    case when v_reactivated then 'Community rejoined' else 'Community joined' end,
    community.name,
    community.id,
    '/communities/' || community.id::text
  from public.communities community
  where community.id = v_code.community_id;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id,
    metadata
  ) values (
    v_uid,
    v_uid,
    v_code.community_id,
    case when v_reactivated then 'community_rejoined' else 'community_joined' end,
    'community',
    v_code.community_id,
    jsonb_build_object(
      'join_code_id', v_code.id,
      'membership_reactivated', v_reactivated
    )
  );

  return query
    select 'joined'::public.join_attempt_outcome, v_code.community_id;
end;
$$;

-- Legacy non-primary codes remain available for narrowly scoped future uses,
-- but now receive the same entropy and approved-store requirements.
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
  v_label text := public.normalize_user_text(p_label);
begin
  if v_uid is null or not (
    private.is_store_administrator(p_store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;
  if p_expires_at is not null and p_expires_at <= statement_timestamp() then
    raise exception 'Expiry must be in the future';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'max_uses must be positive';
  end if;
  if v_label is not null and length(v_label) > 120 then
    raise exception 'Join-code label cannot exceed 120 characters';
  end if;

  select community.id
  into v_community_id
  from public.stores store
  join public.communities community on community.store_id = store.id
  where store.id = p_store_id
    and store.is_verified
    and store.is_active
    and store.deleted_at is null
    and community.is_active
    and community.deleted_at is null
  for update of store, community;

  if not found then
    raise exception 'An approved active store community is required';
  end if;

  v_raw_code := 'thj_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.store_join_codes (
    store_id, community_id, code_hash, code_prefix, label, expires_at,
    max_uses, created_by, is_primary_qr
  ) values (
    p_store_id, v_community_id,
    extensions.digest(v_raw_code, 'sha256'), left(v_raw_code, 12), v_label,
    p_expires_at, p_max_uses, v_uid, false
  ) returning id into v_id;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id
  ) values (
    v_uid, v_uid, v_community_id,
    'store_join_code_generated', 'store_join_code', v_id
  );

  return query select v_id, v_raw_code;
end;
$$;

create or replace function public.deactivate_store_join_code(p_join_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.store_join_codes%rowtype;
begin
  select *
  into v_code
  from public.store_join_codes join_code
  where join_code.id = p_join_code_id
  for update;

  if not found or v_uid is null or not (
    private.is_store_administrator(v_code.store_id, v_uid)
    or private.has_app_role('platform_administrator', v_uid)
  ) then
    raise exception 'Store administrator access required';
  end if;

  if v_code.deactivated_at is null then
    update public.store_join_codes
    set deactivated_at = statement_timestamp(),
        deactivated_by = v_uid,
        deactivation_reason = 'deactivated'
    where id = p_join_code_id;

    insert into public.activity_logs (
      user_id, actor_id, community_id, activity_type, entity_type, entity_id
    ) values (
      v_uid, v_uid, v_code.community_id,
      'store_join_code_deactivated', 'store_join_code', v_code.id
    );
  end if;
end;
$$;

create or replace function public.leave_community(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_store_id uuid;
  v_membership_id uuid;
  v_membership_role public.membership_role;
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (
       select 1
       from public.app_users app_user
       where app_user.id = v_uid and app_user.status = 'active'
     ) then
    raise exception 'An active authenticated account is required';
  end if;

  -- Store then community matches the revocation RPC lock order. A store
  -- administrator must relinquish the authoritative assignment through the
  -- platform workflow; changing only membership would leave admin powers live.
  select community.store_id
  into v_store_id
  from public.communities community
  where community.id = p_community_id;

  if not found then
    raise exception 'Community not found';
  end if;

  perform 1
  from public.stores store
  where store.id = v_store_id
  for share;

  perform 1
  from public.communities community
  where community.id = p_community_id
    and community.store_id = v_store_id
  for share;
  if not found then
    raise exception 'Community changed concurrently';
  end if;

  perform 1
  from public.store_administrators administrator
  where administrator.store_id = v_store_id
    and administrator.user_id = v_uid
    and administrator.revoked_at is null
  for share;

  if found then
    raise exception 'An active store administrator cannot leave; a platform administrator must explicitly revoke the store assignment first';
  end if;

  select membership.id, membership.role
  into v_membership_id, v_membership_role
  from public.community_memberships membership
  where membership.community_id = p_community_id
    and membership.user_id = v_uid
    and membership.status = 'active'
  for update;

  if not found then
    raise exception 'Active membership not found';
  end if;

  update public.community_memberships
  set status = 'left',
      suspended_at = null,
      suspended_by = null,
      suspension_reason = null,
      suspension_authority = null,
      left_at = statement_timestamp()
  where id = v_membership_id;

  -- Serialize the denormalized global-role reconciliation across communities.
  perform 1 from public.app_users where id = v_uid for update;

  if v_membership_role = 'moderator'
     and not exists (
       select 1
       from public.community_memberships membership
       where membership.user_id = v_uid
         and membership.role = 'moderator'
         and membership.status = 'active'
         and membership.id <> v_membership_id
     ) then
    update public.app_users
    set roles = case
      when cardinality(array_remove(roles, 'community_moderator'::public.app_role)) = 0
        then array['collector'::public.app_role]
      else array_remove(roles, 'community_moderator'::public.app_role)
    end
    where id = v_uid;
  end if;

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id
  ) values (
    v_uid, v_uid, p_community_id,
    'community_left', 'community', p_community_id
  );
end;
$$;

-- A suspension cannot be relabeled as "left" and then bypassed by redeeming a
-- QR invite. Only an explicit reactivation by an equal-or-higher authority
-- clears it, and authority is evaluated from the immutable captured tier.
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
  v_target_is_platform boolean;
  v_target_is_store_admin boolean;
  v_actor_authority text;
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
  if p_status is null then
    raise exception 'Membership status is required';
  end if;
  if p_status = v_membership.status then
    raise exception 'Membership already has the requested status';
  end if;

  v_actor_is_platform := private.has_app_role('platform_administrator', v_uid);
  v_actor_is_store_admin := private.is_store_administrator(v_store_id, v_uid);
  v_actor_authority := case
    when v_actor_is_platform then 'platform_administrator'
    when v_actor_is_store_admin then 'store_administrator'
    else 'community_moderator'
  end;

  v_target_is_platform := private.has_app_role(
    'platform_administrator', v_membership.user_id
  );

  select exists (
    select 1
    from public.store_administrators administrator
    where administrator.store_id = v_store_id
      and administrator.user_id = v_membership.user_id
      and administrator.revoked_at is null
  ) into v_target_is_store_admin;

  if v_target_is_platform and not v_actor_is_platform then
    raise exception 'Only a platform administrator may moderate another platform administrator';
  end if;
  if v_target_is_store_admin and p_status in ('suspended', 'left') then
    raise exception 'An active store administrator assignment must be explicitly revoked with revoke_store_administrator before suspending or removing community access';
  end if;
  if v_target_is_store_admin and not v_actor_is_platform then
    raise exception 'Only a platform administrator may moderate a store administrator';
  end if;
  if v_membership.role = 'moderator'
     and not (v_actor_is_store_admin or v_actor_is_platform) then
    raise exception 'Community moderators cannot moderate another moderator';
  end if;

  if v_membership.status = 'suspended' then
    if p_status <> 'active' then
      raise exception 'A suspended membership must be explicitly reactivated before another status change';
    end if;
    if v_membership.suspension_authority = 'platform_administrator'
       and not v_actor_is_platform then
      raise exception 'Only a platform administrator may reverse this suspension';
    end if;
    if v_membership.suspension_authority = 'store_administrator'
       and not (v_actor_is_store_admin or v_actor_is_platform) then
      raise exception 'Only a store or platform administrator may reverse this suspension';
    end if;
  end if;

  update public.community_memberships
  set status = p_status,
      suspended_at = case when p_status = 'suspended' then statement_timestamp() else null end,
      suspended_by = case when p_status = 'suspended' then v_uid else null end,
      suspension_reason = case when p_status = 'suspended' then v_reason else null end,
      suspension_authority = case when p_status = 'suspended' then v_actor_authority else null end,
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
    jsonb_build_object(
      'old_status', v_membership.status,
      'new_status', p_status,
      'actor_authority', v_actor_authority,
      'reversed_suspension_authority', case
        when v_membership.status = 'suspended'
          then v_membership.suspension_authority
        else null
      end
    )
  );
end;
$$;

-- Store-level authority and community membership are intentionally separate,
-- but an active assignment must retain a moderator membership so the UI and
-- audit model cannot imply a demotion that did not actually remove powers.
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
  v_target_is_platform boolean;
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
  if p_role is null then
    raise exception 'Membership role is required';
  end if;
  v_actor_is_platform := private.has_app_role('platform_administrator', v_uid);
  v_target_is_platform := private.has_app_role(
    'platform_administrator', v_membership.user_id
  );
  select exists (
    select 1
    from public.store_administrators administrator
    where administrator.store_id = v_store_id
      and administrator.user_id = v_membership.user_id
      and administrator.revoked_at is null
  ) into v_target_is_store_admin;

  if v_target_is_platform and not v_actor_is_platform then
    raise exception 'Only a platform administrator may change another platform administrator role';
  end if;
  if v_target_is_store_admin then
    if v_membership.role = 'moderator' and p_role = 'moderator' then
      return;
    end if;
    if v_membership.role <> 'moderator' and p_role = 'moderator' then
      -- Repair a legacy inconsistent row; this restores the required state and
      -- is recorded by the ordinary role-change audit below.
      null;
    else
      raise exception 'An active store administrator must remain a community moderator; use revoke_store_administrator to remove the store assignment atomically';
    end if;
  end if;
  if p_role = v_membership.role then
    return;
  end if;
  if p_role = 'moderator' and v_membership.status <> 'active' then
    raise exception 'Only an active member can become a moderator';
  end if;

  update public.community_memberships
  set role = p_role
  where id = p_membership_id;

  -- Serialize the denormalized global-role reconciliation across communities.
  perform 1
  from public.app_users app_user
  where app_user.id = v_membership.user_id
  for update;

  if p_role = 'moderator' then
    update public.app_users
    set roles = case
      when 'community_moderator'::public.app_role = any(roles) then roles
      else array_append(roles, 'community_moderator'::public.app_role)
    end
    where id = v_membership.user_id;
  elsif not exists (
    select 1
    from public.community_memberships membership
    where membership.user_id = v_membership.user_id
      and membership.role = 'moderator'
      and membership.status = 'active'
      and membership.id <> p_membership_id
  ) then
    update public.app_users
    set roles = case
      when cardinality(array_remove(roles, 'community_moderator'::public.app_role)) = 0
        then array['collector'::public.app_role]
      else array_remove(roles, 'community_moderator'::public.app_role)
    end
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
    jsonb_build_object(
      'old_role', v_membership.role,
      'new_role', p_role,
      'repaired_store_administrator_membership',
        v_target_is_store_admin and v_membership.role <> 'moderator'
    )
  );
end;
$$;

create or replace function public.revoke_store_administrator(
  p_store_id uuid,
  p_user_id uuid,
  p_membership_status public.membership_status default 'suspended',
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := public.normalize_user_text(p_reason);
  v_assignment public.store_administrators%rowtype;
  v_community_id uuid;
  v_membership public.community_memberships%rowtype;
  v_actor_roles public.app_role[];
  v_actor_status public.account_status;
  v_remaining_effective_admin_count integer;
  v_revoked_at timestamptz := statement_timestamp();
begin
  -- Cheap authorization before taking business-row locks, followed by a
  -- locked revalidation below to close concurrent role-revocation races.
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not private.has_app_role('platform_administrator', v_uid) then
    raise exception 'Platform administrator access required';
  end if;
  if p_store_id is null or p_user_id is null then
    raise exception 'Store and administrator are required';
  end if;
  if p_user_id = v_uid then
    raise exception 'Platform administrators cannot revoke their own store assignment';
  end if;
  if p_membership_status is null
     or p_membership_status not in ('active', 'suspended', 'left') then
    raise exception 'Membership status must be active, suspended, or left';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 1000 then
    raise exception 'A revocation reason between 3 and 1000 characters is required';
  end if;

  -- Store first serializes last-administrator decisions made through this RPC.
  perform 1
  from public.stores store
  where store.id = p_store_id
  for update;
  if not found then
    raise exception 'Store not found';
  end if;

  select administrator.*
  into v_assignment
  from public.store_administrators administrator
  where administrator.store_id = p_store_id
    and administrator.user_id = p_user_id
  for update;
  if not found or v_assignment.revoked_at is not null then
    raise exception 'Active store administrator assignment not found';
  end if;

  -- Lock every active assignment in deterministic order before counting. The
  -- store lock serializes this RPC; row locks also protect against trusted SQL
  -- updates that target an existing assignment concurrently.
  perform administrator.user_id
  from public.store_administrators administrator
  where administrator.store_id = p_store_id
    and administrator.revoked_at is null
  order by administrator.user_id
  for update;

  select community.id
  into v_community_id
  from public.communities community
  where community.store_id = p_store_id
    and community.deleted_at is null
  for update;
  if not found then
    raise exception 'Current store community not found';
  end if;

  select membership.*
  into v_membership
  from public.community_memberships membership
  where membership.community_id = v_community_id
    and membership.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Store administrator membership is missing; repair the assignment before revocation';
  end if;

  -- Existing membership-role functions lock membership before app_users, so
  -- retain that order. Lock actor/target users deterministically, then recheck
  -- platform authority while the rows cannot change.
  perform app_user.id
  from public.app_users app_user
  where app_user.id in (v_uid, p_user_id)
    or exists (
      select 1
      from public.store_administrators administrator
      where administrator.store_id = p_store_id
        and administrator.user_id = app_user.id
        and administrator.revoked_at is null
    )
  order by app_user.id
  for update;

  select app_user.roles, app_user.status
  into v_actor_roles, v_actor_status
  from public.app_users app_user
  where app_user.id = v_uid;
  if not found
     or v_actor_status <> 'active'
     or not ('platform_administrator'::public.app_role = any(v_actor_roles)) then
    raise exception 'Platform administrator access was revoked during this operation';
  end if;
  if not exists (
    select 1 from public.app_users app_user where app_user.id = p_user_id
  ) then
    raise exception 'Target application user not found';
  end if;

  select count(*)::integer
  into v_remaining_effective_admin_count
  from public.store_administrators administrator
  join public.app_users app_user on app_user.id = administrator.user_id
  where administrator.store_id = p_store_id
    and administrator.user_id <> p_user_id
    and administrator.revoked_at is null
    and app_user.status = 'active';

  if v_remaining_effective_admin_count < 1 then
    raise exception 'The last effective store administrator cannot be revoked; assign an active replacement first or use a dedicated store-closure workflow';
  end if;

  update public.store_administrators
  set revoked_at = v_revoked_at
  where store_id = p_store_id
    and user_id = p_user_id
    and revoked_at is null;
  if not found then
    raise exception 'Store administrator assignment changed concurrently';
  end if;

  update public.community_memberships
  set role = 'member',
      status = p_membership_status,
      suspended_at = case
        when p_membership_status = 'suspended' then v_revoked_at else null
      end,
      suspended_by = case
        when p_membership_status = 'suspended' then v_uid else null
      end,
      suspension_reason = case
        when p_membership_status = 'suspended' then v_reason else null
      end,
      suspension_authority = case
        when p_membership_status = 'suspended' then 'platform_administrator' else null
      end,
      left_at = case
        when p_membership_status = 'left' then v_revoked_at else null
      end
  where id = v_membership.id;

  if not exists (
    select 1
    from public.store_administrators administrator
    where administrator.user_id = p_user_id
      and administrator.revoked_at is null
  ) then
    update public.app_users
    set roles = case
      when cardinality(array_remove(roles, 'store_administrator'::public.app_role)) = 0
        then array['collector'::public.app_role]
      else array_remove(roles, 'store_administrator'::public.app_role)
    end
    where id = p_user_id;
  end if;

  if not exists (
    select 1
    from public.community_memberships membership
    where membership.user_id = p_user_id
      and membership.role = 'moderator'
      and membership.status = 'active'
  ) then
    update public.app_users
    set roles = case
      when cardinality(array_remove(roles, 'community_moderator'::public.app_role)) = 0
        then array['collector'::public.app_role]
      else array_remove(roles, 'community_moderator'::public.app_role)
    end
    where id = p_user_id;
  end if;

  insert into public.moderation_actions (
    community_id, actor_id, target_user_id, community_membership_id,
    action_type, reason, metadata
  ) values (
    v_community_id,
    v_uid,
    p_user_id,
    v_membership.id,
    'store_administrator_revoked',
    v_reason,
    jsonb_build_object(
      'store_id', p_store_id,
      'old_membership_role', v_membership.role,
      'old_membership_status', v_membership.status,
      'new_membership_role', 'member',
      'new_membership_status', p_membership_status,
      'revoked_at', v_revoked_at,
      'remaining_effective_administrators', v_remaining_effective_admin_count
    )
  );

  insert into public.activity_logs (
    user_id, actor_id, community_id, activity_type, entity_type, entity_id,
    metadata
  ) values (
    p_user_id,
    v_uid,
    v_community_id,
    'store_administrator_revoked',
    'store',
    p_store_id,
    jsonb_build_object(
      'membership_status', p_membership_status,
      'reason', v_reason
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Data API surface (explicit for the May 2026 opt-in grant defaults)
-- ---------------------------------------------------------------------------

alter table public.store_join_codes enable row level security;
alter table public.store_join_attempts enable row level security;

-- Hashes, request fingerprints, and rotation internals have no direct client
-- table access. Store operators receive only the redacted list RPC projection.
revoke all on table public.store_join_codes, public.store_join_attempts
  from public, anon, authenticated;
revoke select on public.store_join_code_admin_view from anon, authenticated;
revoke insert, update, delete on table public.store_administrators
  from anon, authenticated;

revoke execute on function public.list_store_qr_invites(uuid),
  public.generate_store_qr_invite(uuid, text),
  public.rotate_store_qr_invite(uuid, text),
  public.revoke_store_qr_invite(uuid, text),
  public.validate_store_join_code(text),
  public.redeem_store_join_code(text, text),
  public.create_store_join_code(uuid, text, timestamptz, integer),
  public.deactivate_store_join_code(uuid)
  from public, anon, authenticated;

grant execute on function public.list_store_qr_invites(uuid),
  public.generate_store_qr_invite(uuid, text),
  public.rotate_store_qr_invite(uuid, text),
  public.revoke_store_qr_invite(uuid, text),
  public.validate_store_join_code(text),
  public.redeem_store_join_code(text, text),
  public.create_store_join_code(uuid, text, timestamptz, integer),
  public.deactivate_store_join_code(uuid)
  to authenticated;

-- Store administrators already satisfy can_moderate_community through their
-- active store_administrators assignment. Deletion stays a guarded soft-delete
-- so every action preserves actor, target, message, channel, reason, and time.
revoke delete on table public.community_messages from anon, authenticated;
revoke insert, update, delete on table public.moderation_actions
  from anon, authenticated;
revoke execute on function public.moderate_community_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.moderate_community_message(uuid, text)
  to authenticated;
revoke execute on function public.moderate_community_membership(
  uuid, public.membership_status, text
) from public, anon, authenticated;
grant execute on function public.moderate_community_membership(
  uuid, public.membership_status, text
) to authenticated;
revoke execute on function public.leave_community(uuid),
  public.set_community_membership_role(uuid, public.membership_role),
  public.revoke_store_administrator(
    uuid, uuid, public.membership_status, text
  ) from public, anon, authenticated;
grant execute on function public.leave_community(uuid),
  public.set_community_membership_role(uuid, public.membership_role),
  public.revoke_store_administrator(
    uuid, uuid, public.membership_status, text
  ) to authenticated;

commit;

-- Security/operations notes:
-- 1. QR URLs must use /join/store#token=<raw_token>. The client must extract
--    the fragment and immediately replace browser history before validation.
--    The bearer invitation must not enter analytics, error reporting, logs,
--    screenshots, support transcripts, or a server-visible path/query string.
-- 2. Suspended memberships intentionally cannot be reactivated by QR redemption.
-- 3. Revocation works for inactive stores; generation and rotation require a
--    verified, active store and active community.
-- 4. Run integration tests against hosted Supabase for cross-store denial,
--    concurrent generation/rotation/redemption, RLS, and Data API grants.
