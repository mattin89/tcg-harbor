begin;

-- Community trade posts are a shared member feed. The existing RLS policy on
-- trade_posts remains the authorization boundary for every Realtime event.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication publication
    where publication.pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication is unavailable';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename = 'trade_posts'
  ) then
    execute 'alter publication supabase_realtime add table public.trade_posts';
  end if;
end
$migration$;

commit;
