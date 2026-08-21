create or replace function public.sync_workspace_system_teams()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    target_workspace uuid;
    target_user uuid;
    admin_team_id uuid;
    maintenance_team_id uuid;
begin
    if tg_op = 'DELETE' then
        target_workspace := old.workspace_id;
        target_user := old.user_id;
    else
        target_workspace := new.workspace_id;
        target_user := new.user_id;
    end if;

    -- Membership rows cascade after their workspace has already been removed.
    -- In that case there is nothing left to synchronise, and recreating system
    -- teams would violate workspace_teams_workspace_id_fkey.
    if not exists (
        select 1
        from public.workspaces
        where id = target_workspace
    ) then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    insert into public.workspace_teams(workspace_id, name, kind, created_by)
    values
        (target_workspace, 'Admins', 'admins', target_user),
        (target_workspace, 'Maintenance', 'maintenance', target_user)
    on conflict do nothing;

    select id into admin_team_id from public.workspace_teams where workspace_id = target_workspace and kind = 'admins';
    select id into maintenance_team_id from public.workspace_teams where workspace_id = target_workspace and kind = 'maintenance';

    if tg_op = 'DELETE' then
        delete from public.workspace_team_members where workspace_id = target_workspace and user_id = target_user;
        return old;
    end if;

    if new.role in ('owner', 'admin') then
        insert into public.workspace_team_members(workspace_id, team_id, user_id, added_by)
        values (target_workspace, admin_team_id, target_user, target_user)
        on conflict do nothing;
    else
        delete from public.workspace_team_members where team_id = admin_team_id and user_id = target_user;
    end if;

    if new.role = 'owner' then
        insert into public.workspace_team_members(workspace_id, team_id, user_id, added_by)
        values (target_workspace, maintenance_team_id, target_user, target_user)
        on conflict do nothing;
    end if;
    return new;
end;
$$;
