-- Reinstall Builder Realtime authorization through a security-definer check.
-- Direct joins from realtime.messages policies can be filtered by the joined
-- public tables' RLS, which prevents otherwise-authorized editors joining the
-- same private Presence and Broadcast channel.

create or replace function public.can_access_onboarding_builder_realtime(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_topic ~ '^onboarding-builder:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1
           from public.workspaces workspace
           join public.workspace_memberships membership on membership.workspace_id = workspace.id
           where workspace.slug = split_part(p_topic, ':', 2)
             and membership.user_id = auth.uid()
             and membership.role in ('owner', 'admin')
             and workspace.status = 'active'
       );
$$;

revoke all on function public.can_access_onboarding_builder_realtime(text) from public, anon;
grant execute on function public.can_access_onboarding_builder_realtime(text) to authenticated;

do $$
begin
    if to_regclass('realtime.messages') is not null then
        execute 'drop policy if exists "onboarding admins receive builder realtime" on realtime.messages';
        execute 'drop policy if exists "onboarding admins send builder realtime" on realtime.messages';
        execute $policy$
            create policy "onboarding admins receive builder realtime"
            on realtime.messages for select to authenticated
            using (public.can_access_onboarding_builder_realtime(realtime.topic()))
        $policy$;
        execute $policy$
            create policy "onboarding admins send builder realtime"
            on realtime.messages for insert to authenticated
            with check (public.can_access_onboarding_builder_realtime(realtime.topic()))
        $policy$;
    end if;
end;
$$;
