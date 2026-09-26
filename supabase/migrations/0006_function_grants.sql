-- Security definer functions bypass RLS. Postgres grants EXECUTE to PUBLIC by default,
-- and anon/authenticated inherit PUBLIC — so the per-role revokes in 0001/0004 were not
-- enough. Only the service role (server-side) may call these. Also pin search_path.
do $$
declare
  f text;
begin
  foreach f in array array['convert_note_to_task', 'merge_tag', 'reorder_tasks', 'reorder_papers', 'replace_calendar_events']
  loop
    if exists (select 1 from pg_proc where proname = f and pronamespace = 'public'::regnamespace) then
      execute format('revoke execute on function public.%I from public, anon, authenticated', f);
      execute format('grant execute on function public.%I to service_role', f);
      execute format('alter function public.%I set search_path = public, pg_temp', f);
    end if;
  end loop;
end
$$;
