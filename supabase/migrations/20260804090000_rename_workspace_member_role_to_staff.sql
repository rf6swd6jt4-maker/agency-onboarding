alter table public.workspace_memberships
drop constraint if exists workspace_memberships_role_check;

alter table public.workspace_invitations
drop constraint if exists workspace_invitations_role_check;

update public.workspace_memberships
set role = 'staff'
where role = 'member';

update public.workspace_invitations
set role = 'staff'
where role = 'member';

alter table public.workspace_memberships
add constraint workspace_memberships_role_check
check (role in ('owner', 'admin', 'staff'));

alter table public.workspace_invitations
add constraint workspace_invitations_role_check
check (role in ('staff', 'admin'));

create or replace function public.is_workspace_member(
    target_workspace uuid,
    allowed_roles text[] default array['owner', 'admin', 'staff']
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.workspace_memberships
        where workspace_id = target_workspace
          and user_id = auth.uid()
          and role = any(allowed_roles)
    );
$$;
