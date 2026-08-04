create or replace function public.validate_admin_workspace_user()
returns trigger
language plpgsql
set search_path = public
as $$
declare target_user_id uuid;
begin
    target_user_id := case
        when tg_table_name = 'workspace_okrs' then nullif(to_jsonb(new)->>'owner_user_id', '')::uuid
        when tg_table_name = 'workspace_maintenance_routing' then nullif(to_jsonb(new)->>'responsible_user_id', '')::uuid
        else null
    end;
    if target_user_id is null or not exists (
        select 1 from public.workspace_memberships
        where workspace_id = new.workspace_id
          and user_id = target_user_id
          and role in ('owner', 'admin')
    ) then raise exception 'Responsible user must be a workspace owner or admin'; end if;
    return new;
end;
$$;
