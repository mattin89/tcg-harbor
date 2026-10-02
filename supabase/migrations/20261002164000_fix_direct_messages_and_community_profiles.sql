-- Fix direct messages execution permissions and trigger security context.
-- Grant authenticated users execute privileges on normalize_user_text,
-- and set guard_direct_message to security definer with empty search path.
grant execute on function public.normalize_user_text(text) to authenticated;

alter function public.guard_direct_message() security definer;

-- Revert security_invoker on community_member_profiles view.
-- The view already specifies security_barrier = true and filters by active community
-- membership or moderation in its WHERE clause. Reverting security_invoker allows
-- members of the same community to view peer usernames and avatars without being
-- blocked by table-level RLS on user_profiles, while keeping private fields in
-- user_profiles (addresses, billing, etc.) inaccessible to other users.
alter view public.community_member_profiles set (security_invoker = false);
