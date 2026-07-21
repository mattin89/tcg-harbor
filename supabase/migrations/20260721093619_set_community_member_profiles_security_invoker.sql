-- Evaluate underlying permissions and RLS using the querying role instead of
-- the view owner. This keeps the member directory from bypassing table RLS.
begin;

alter view public.community_member_profiles
  set (security_invoker = true);

commit;
