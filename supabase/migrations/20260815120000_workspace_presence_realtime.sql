-- Workspace shell Presence is private to members of the named active workspace.

create or replace function public.can_access_workspace_presence_realtime(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_topic ~ '^workspace-presence:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1
           from public.workspaces workspace
           join public.workspace_memberships membership on membership.workspace_id = workspace.id
           where workspace.slug = split_part(p_topic, ':', 2)
             and membership.user_id = auth.uid()
             and workspace.status = 'active'
       );
$$;

revoke all on function public.can_access_workspace_presence_realtime(text) from public, anon;
grant execute on function public.can_access_workspace_presence_realtime(text) to authenticated;

do $$
begin
    if to_regclass('realtime.messages') is not null then
        execute 'drop policy if exists "workspace members receive workspace presence" on realtime.messages';
        execute 'drop policy if exists "workspace members send workspace presence" on realtime.messages';
        execute $policy$
            create policy "workspace members receive workspace presence"
            on realtime.messages for select to authenticated
            using (public.can_access_workspace_presence_realtime(realtime.topic()))
        $policy$;
        execute $policy$
            create policy "workspace members send workspace presence"
            on realtime.messages for insert to authenticated
            with check (public.can_access_workspace_presence_realtime(realtime.topic()))
        $policy$;
    end if;
end;
$$;
