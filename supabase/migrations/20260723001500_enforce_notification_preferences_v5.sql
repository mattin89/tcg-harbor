-- Apply private notification choices at the final insert boundary so every
-- current and future producer receives the same server-side enforcement.
create or replace function private.notification_preference_allows_v5(
  p_user_id uuid,
  p_kind public.notification_kind
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Security/system and explicit community-membership lifecycle events are
    -- not marketing activity and remain visible regardless of optional prefs.
    when p_kind in ('system', 'community_joined') then true
    else coalesce((
      select case
        when not preferences.in_app_enabled then false
        when p_kind = 'direct_message' then preferences.direct_messages
        when p_kind = 'community_reply' then preferences.community_replies
        when p_kind in ('matching_trade', 'wanted_card_owned') then preferences.matching_trades
        when p_kind = 'trade_status_changed' then preferences.trade_updates
        else true
      end
      from public.notification_preferences preferences
      where preferences.user_id = p_user_id
    ), false)
  end;
$$;

create or replace function private.enforce_notification_preferences_v5()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Account creation always inserts the preference row. If that invariant is
  -- ever broken, suppress optional notifications instead of bypassing consent.
  if coalesce(private.notification_preference_allows_v5(new.user_id, new.kind), false) then
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists notifications_preferences_guard_v5 on public.notifications;
create trigger notifications_preferences_guard_v5
  before insert on public.notifications
  for each row execute function private.enforce_notification_preferences_v5();

revoke all on function private.notification_preference_allows_v5(uuid, public.notification_kind)
  from public, anon, authenticated;
revoke all on function private.enforce_notification_preferences_v5()
  from public, anon, authenticated;
