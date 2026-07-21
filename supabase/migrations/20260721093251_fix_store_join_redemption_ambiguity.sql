-- Qualify the community membership update in store QR redemption. The
-- function's `community_id` output parameter otherwise conflicts with the
-- table column at runtime when a former member redeems a valid code.
begin;

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::text, 5)
  );

  if (
    select count(*)
    from public.store_join_attempts attempt
    where attempt.user_id = v_uid
      and attempt.attempted_at > statement_timestamp() - interval '15 minutes'
  ) >= 10 then
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
    insert into public.store_join_attempts (
      user_id, code_prefix, request_fingerprint_hash, outcome
    ) values (
      v_uid, v_code.code_prefix, v_fingerprint, 'revoked'
    );
    return query
      select 'revoked'::public.join_attempt_outcome, null::uuid;
    return;
  elsif found and v_existing_status = 'left' then
    update public.community_memberships as membership
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
    where membership.community_id = v_code.community_id
      and membership.user_id = v_uid;
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

revoke execute on function public.redeem_store_join_code(text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_store_join_code(text, text)
  to authenticated;

commit;
