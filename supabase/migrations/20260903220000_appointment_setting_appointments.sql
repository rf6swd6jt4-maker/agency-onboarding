-- First native Appointment Setting record. One shared table is partitioned by
-- relationship and the exact sold Appointment Setting service.

create table if not exists public.appointment_setting_appointments (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    service_id uuid not null,
    contact_name text not null check (char_length(btrim(contact_name)) between 1 and 160),
    phone text not null check (char_length(btrim(phone)) between 1 and 64),
    appointment_at timestamptz not null,
    appointment_timezone text not null default 'UTC'
        check (char_length(appointment_timezone) between 1 and 100),
    created_by uuid references auth.users(id) on delete set null,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id),
    foreign key (workspace_id, relationship_id)
        references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, service_id)
        references public.onboarding_services(workspace_id, id) on delete restrict
);

create index if not exists appointment_setting_appointments_relationship_idx
on public.appointment_setting_appointments(workspace_id, relationship_id, appointment_at, id);

create index if not exists appointment_setting_appointments_service_idx
on public.appointment_setting_appointments(workspace_id, service_id, appointment_at);

create or replace function public.appointment_setting_service_is_available(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_service_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.relationship_services relationship_service
        join public.onboarding_services service
          on service.workspace_id = relationship_service.workspace_id
         and service.id = relationship_service.service_id
        where relationship_service.workspace_id = p_workspace_id
          and relationship_service.relationship_id = p_relationship_id
          and relationship_service.service_id = p_service_id
          and service.state <> 'archived'
          and exists (
              select 1
              from public.onboarding_service_revisions revision
              where revision.workspace_id = service.workspace_id
                and revision.service_id = service.id
                and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
          )
    )
$$;

create or replace function public.workspace_user_can_manage_appointment_setting(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_service_id uuid,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.appointment_setting_service_is_available(p_workspace_id, p_relationship_id, p_service_id)
       and case public.workspace_role_for_user(p_workspace_id, p_user_id)
            when 'owner' then true
            when 'admin' then true
            when 'staff' then exists (
                select 1
                from public.workspace_member_service_access member_access
                join public.workspace_service_capabilities capability
                  on capability.workspace_id = member_access.workspace_id
                 and capability.service_id = member_access.service_id
                where member_access.workspace_id = p_workspace_id
                  and member_access.user_id = p_user_id
                  and member_access.service_id = p_service_id
                  and capability.capability = 'appointment_setting.manage'
            )
            else false
       end
$$;

create or replace function public.validate_appointment_setting_appointment_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.appointment_setting_service_is_available(new.workspace_id, new.relationship_id, new.service_id) then
        raise exception 'APPOINTMENT_SETTING_SERVICE_REQUIRED' using errcode = '23503';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_appointment_setting_appointment_scope on public.appointment_setting_appointments;
create trigger validate_appointment_setting_appointment_scope
before insert or update of workspace_id, relationship_id, service_id
on public.appointment_setting_appointments
for each row execute function public.validate_appointment_setting_appointment_scope();

drop trigger if exists appointment_setting_appointments_updated_at on public.appointment_setting_appointments;
create trigger appointment_setting_appointments_updated_at
before update on public.appointment_setting_appointments
for each row execute function public.set_updated_at();

alter table public.appointment_setting_appointments enable row level security;

drop policy if exists "assigned appointment setting users read appointments" on public.appointment_setting_appointments;
create policy "assigned appointment setting users read appointments"
on public.appointment_setting_appointments for select to authenticated
using (public.workspace_user_can_manage_appointment_setting(workspace_id, relationship_id, service_id));

revoke all on function public.appointment_setting_service_is_available(uuid, uuid, uuid) from public, anon;
revoke all on function public.workspace_user_can_manage_appointment_setting(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.validate_appointment_setting_appointment_scope() from public, anon, authenticated;
grant execute on function public.appointment_setting_service_is_available(uuid, uuid, uuid) to service_role;
grant execute on function public.workspace_user_can_manage_appointment_setting(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.validate_appointment_setting_appointment_scope() to service_role;

revoke all on table public.appointment_setting_appointments from anon, authenticated;
grant select on table public.appointment_setting_appointments to authenticated;
grant all on table public.appointment_setting_appointments to service_role;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1
           from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'appointment_setting_appointments'
       ) then
        alter publication supabase_realtime add table public.appointment_setting_appointments;
    end if;
end;
$$;
