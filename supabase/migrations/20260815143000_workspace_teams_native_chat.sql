-- Workspace-scoped teams, durable presence, fulfilment routing, and native chat.

alter table public.workspace_memberships
    add column if not exists last_seen_at timestamptz;

create table if not exists public.workspace_teams (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 2 and 80),
    kind text not null default 'custom' check (kind in ('admins', 'maintenance', 'custom')),
    created_by uuid references auth.users(id) on delete set null,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id),
    check ((kind in ('admins', 'maintenance') and archived_at is null) or kind = 'custom')
);

create unique index if not exists workspace_teams_system_kind_unique
on public.workspace_teams(workspace_id, kind)
where kind in ('admins', 'maintenance');

create unique index if not exists workspace_teams_active_name_unique
on public.workspace_teams(workspace_id, lower(name))
where archived_at is null;

create table if not exists public.workspace_team_members (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    team_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    added_by uuid references auth.users(id) on delete set null,
    added_at timestamptz not null default now(),
    foreign key (workspace_id, team_id) references public.workspace_teams(workspace_id, id) on delete cascade,
    primary key (team_id, user_id)
);

create index if not exists workspace_team_members_workspace_user_idx
on public.workspace_team_members(workspace_id, user_id);

create table if not exists public.workspace_team_service_responsibilities (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    team_id uuid not null,
    service_id uuid not null,
    responsible_user_id uuid not null references auth.users(id) on delete restrict,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, team_id) references public.workspace_teams(workspace_id, id) on delete cascade,
    foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id) on delete cascade,
    primary key (team_id, service_id)
);

alter table public.relationships
    add column if not exists fulfilment_team_id uuid;

alter table public.relationships
    drop constraint if exists relationships_fulfilment_team_fkey;
alter table public.relationships
    add constraint relationships_fulfilment_team_fkey
    foreign key (workspace_id, fulfilment_team_id)
    references public.workspace_teams(workspace_id, id) on delete set null;

create index if not exists relationships_fulfilment_team_idx
on public.relationships(workspace_id, fulfilment_team_id)
where fulfilment_team_id is not null;

create table if not exists public.workspace_native_conversations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    kind text not null check (kind in ('direct', 'team')),
    team_id uuid,
    direct_user_one uuid references auth.users(id) on delete cascade,
    direct_user_two uuid references auth.users(id) on delete cascade,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, id),
    foreign key (workspace_id, team_id) references public.workspace_teams(workspace_id, id) on delete cascade,
    check (
        (kind = 'team' and team_id is not null and direct_user_one is null and direct_user_two is null)
        or
        (kind = 'direct' and team_id is null and direct_user_one is not null and direct_user_two is not null and direct_user_one::text < direct_user_two::text)
    )
);

create unique index if not exists workspace_native_conversations_team_unique
on public.workspace_native_conversations(workspace_id, team_id)
where kind = 'team';

create unique index if not exists workspace_native_conversations_direct_unique
on public.workspace_native_conversations(workspace_id, direct_user_one, direct_user_two)
where kind = 'direct';

create table if not exists public.workspace_native_conversation_participants (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    foreign key (workspace_id, conversation_id) references public.workspace_native_conversations(workspace_id, id) on delete cascade,
    primary key (conversation_id, user_id)
);

create table if not exists public.workspace_native_messages (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_id uuid not null,
    sender_user_id uuid not null references auth.users(id) on delete cascade,
    client_request_id uuid,
    body text not null default '' check (char_length(body) <= 8000),
    reply_to_message_id uuid references public.workspace_native_messages(id) on delete set null,
    attachment jsonb,
    created_at timestamptz not null default now(),
    edited_at timestamptz,
    foreign key (workspace_id, conversation_id) references public.workspace_native_conversations(workspace_id, id) on delete cascade,
    unique (workspace_id, id),
    check (btrim(body) <> '' or attachment is not null),
    check (attachment is null or jsonb_typeof(attachment) = 'object')
);

create unique index if not exists workspace_native_messages_request_unique
on public.workspace_native_messages(workspace_id, client_request_id)
where client_request_id is not null;

create index if not exists workspace_native_messages_conversation_created_idx
on public.workspace_native_messages(conversation_id, created_at desc);

create table if not exists public.workspace_native_reactions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_id uuid not null,
    message_id uuid not null,
    reactor_user_id uuid not null references auth.users(id) on delete cascade,
    emoji text not null check (char_length(emoji) between 1 and 32),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, conversation_id) references public.workspace_native_conversations(workspace_id, id) on delete cascade,
    foreign key (workspace_id, message_id) references public.workspace_native_messages(workspace_id, id) on delete cascade,
    unique (message_id, reactor_user_id)
);

create table if not exists public.workspace_native_read_cursors (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    last_read_message_id uuid references public.workspace_native_messages(id) on delete set null,
    last_read_at timestamptz not null default now(),
    foreign key (workspace_id, conversation_id) references public.workspace_native_conversations(workspace_id, id) on delete cascade,
    primary key (conversation_id, user_id)
);

create or replace function public.native_conversation_can_read(target_conversation uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.workspace_native_conversations conversation
        join public.workspace_memberships membership
          on membership.workspace_id = conversation.workspace_id
         and membership.user_id = target_user
        where conversation.id = target_conversation
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and (
                exists (
                    select 1 from public.workspace_team_members team_member
                    where team_member.team_id = conversation.team_id and team_member.user_id = target_user
                )
                or (membership.role in ('owner', 'admin') and exists (
                    select 1 from public.workspace_teams team
                    where team.id = conversation.team_id and team.archived_at is not null
                ))
            ))
          )
    );
$$;

create or replace function public.native_conversation_can_write(target_conversation uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.workspace_native_conversations conversation
        join public.workspace_memberships membership
          on membership.workspace_id = conversation.workspace_id
         and membership.user_id = target_user
        left join public.workspace_teams team on team.id = conversation.team_id
        where conversation.id = target_conversation
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and team.archived_at is null and exists (
                select 1 from public.workspace_team_members team_member
                where team_member.team_id = conversation.team_id and team_member.user_id = target_user
            ))
          )
    );
$$;

revoke all on function public.native_conversation_can_read(uuid, uuid) from public, anon;
revoke all on function public.native_conversation_can_write(uuid, uuid) from public, anon;
grant execute on function public.native_conversation_can_read(uuid, uuid) to authenticated, service_role;
grant execute on function public.native_conversation_can_write(uuid, uuid) to authenticated, service_role;

create or replace function public.validate_workspace_team_member()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Team members must belong to the workspace'; end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_team_member on public.workspace_team_members;
create trigger validate_workspace_team_member
before insert or update of workspace_id, user_id on public.workspace_team_members
for each row execute function public.validate_workspace_team_member();

create or replace function public.validate_workspace_team_service_responsibility()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1
        from public.workspace_team_members member
        join public.workspace_teams team on team.id = member.team_id
        where member.workspace_id = new.workspace_id
          and member.team_id = new.team_id
          and member.user_id = new.responsible_user_id
          and team.kind = 'custom'
          and team.archived_at is null
    ) then raise exception 'Service responsibility must belong to an active custom team member'; end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_team_service_responsibility on public.workspace_team_service_responsibilities;
create trigger validate_workspace_team_service_responsibility
before insert or update on public.workspace_team_service_responsibilities
for each row execute function public.validate_workspace_team_service_responsibility();

create or replace function public.validate_relationship_fulfilment_team()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.fulfilment_team_id is not null and not exists (
        select 1 from public.workspace_teams
        where workspace_id = new.workspace_id
          and id = new.fulfilment_team_id
          and kind = 'custom'
          and archived_at is null
    ) then raise exception 'Fulfilment team must be an active custom workspace team'; end if;
    return new;
end;
$$;

drop trigger if exists validate_relationship_fulfilment_team on public.relationships;
create trigger validate_relationship_fulfilment_team
before insert or update of workspace_id, fulfilment_team_id on public.relationships
for each row execute function public.validate_relationship_fulfilment_team();

create or replace function public.validate_workspace_maintenance_routing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1
        from public.workspace_teams team
        join public.workspace_team_members member on member.team_id = team.id
        where team.workspace_id = new.workspace_id
          and team.kind = 'maintenance'
          and member.user_id = new.responsible_user_id
    ) then raise exception 'Responsible user must belong to the Maintenance team'; end if;
    return new;
end;
$$;

drop trigger if exists validate_workspace_maintenance_routing on public.workspace_maintenance_routing;
create trigger validate_workspace_maintenance_routing
before insert or update of workspace_id, responsible_user_id on public.workspace_maintenance_routing
for each row execute function public.validate_workspace_maintenance_routing();

create or replace function public.create_native_team_conversation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    insert into public.workspace_native_conversations(workspace_id, kind, team_id, created_by)
    values (new.workspace_id, 'team', new.id, new.created_by)
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists create_native_team_conversation on public.workspace_teams;
create trigger create_native_team_conversation
after insert on public.workspace_teams
for each row execute function public.create_native_team_conversation();

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

drop trigger if exists sync_workspace_system_teams on public.workspace_memberships;
create trigger sync_workspace_system_teams
after insert or update or delete on public.workspace_memberships
for each row execute function public.sync_workspace_system_teams();

create or replace function public.prepare_native_conversation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.kind = 'direct' and new.direct_user_one::text > new.direct_user_two::text then
        declare swap_user uuid;
        begin
            swap_user := new.direct_user_one;
            new.direct_user_one := new.direct_user_two;
            new.direct_user_two := swap_user;
        end;
    end if;
    return new;
end;
$$;

drop trigger if exists prepare_native_conversation on public.workspace_native_conversations;
create trigger prepare_native_conversation
before insert or update of direct_user_one, direct_user_two on public.workspace_native_conversations
for each row execute function public.prepare_native_conversation();

create or replace function public.sync_native_direct_participants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.kind = 'direct' then
        insert into public.workspace_native_conversation_participants(workspace_id, conversation_id, user_id)
        values
            (new.workspace_id, new.id, new.direct_user_one),
            (new.workspace_id, new.id, new.direct_user_two)
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists sync_native_direct_participants on public.workspace_native_conversations;
create trigger sync_native_direct_participants
after insert on public.workspace_native_conversations
for each row execute function public.sync_native_direct_participants();

create or replace function public.touch_native_conversation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    update public.workspace_native_conversations
    set updated_at = new.created_at
    where id = new.conversation_id;
    return new;
end;
$$;

drop trigger if exists touch_native_conversation on public.workspace_native_messages;
create trigger touch_native_conversation
after insert on public.workspace_native_messages
for each row execute function public.touch_native_conversation();

insert into public.workspace_teams(workspace_id, name, kind)
select id, 'Admins', 'admins' from public.workspaces
on conflict do nothing;

insert into public.workspace_teams(workspace_id, name, kind)
select id, 'Maintenance', 'maintenance' from public.workspaces
on conflict do nothing;

insert into public.workspace_team_members(workspace_id, team_id, user_id)
select membership.workspace_id, team.id, membership.user_id
from public.workspace_memberships membership
join public.workspace_teams team on team.workspace_id = membership.workspace_id and team.kind = 'admins'
where membership.role in ('owner', 'admin')
on conflict do nothing;

insert into public.workspace_team_members(workspace_id, team_id, user_id)
select distinct route.workspace_id, team.id, route.responsible_user_id
from public.workspace_maintenance_routing route
join public.workspace_teams team on team.workspace_id = route.workspace_id and team.kind = 'maintenance'
on conflict do nothing;

insert into public.workspace_team_members(workspace_id, team_id, user_id)
select membership.workspace_id, team.id, membership.user_id
from public.workspace_memberships membership
join public.workspace_teams team on team.workspace_id = membership.workspace_id and team.kind = 'maintenance'
where membership.role = 'owner'
on conflict do nothing;

-- The legacy Officers screen allowed one global route. Expand it into explicit
-- category ownership before removing the legacy key, then fill any remaining
-- categories with the workspace owner so every workspace is immediately valid.
insert into public.workspace_maintenance_routing(
    workspace_id,
    category,
    responsible_user_id,
    updated_by,
    updated_at
)
select
    route.workspace_id,
    category.name,
    route.responsible_user_id,
    route.updated_by,
    route.updated_at
from public.workspace_maintenance_routing route
cross join (values
    ('services'),
    ('leadgen'),
    ('onboarding'),
    ('billing'),
    ('communications'),
    ('integrations'),
    ('system_health')
) as category(name)
where route.category = 'global'
on conflict (workspace_id, category) do nothing;

insert into public.workspace_maintenance_routing(
    workspace_id,
    category,
    responsible_user_id,
    updated_by
)
select
    membership.workspace_id,
    category.name,
    membership.user_id,
    membership.user_id
from public.workspace_memberships membership
cross join (values
    ('services'),
    ('leadgen'),
    ('onboarding'),
    ('billing'),
    ('communications'),
    ('integrations'),
    ('system_health')
) as category(name)
where membership.role = 'owner'
on conflict (workspace_id, category) do nothing;

delete from public.workspace_maintenance_routing where category = 'global';

insert into public.workspace_native_conversations(workspace_id, kind, team_id, created_by)
select team.workspace_id, 'team', team.id, team.created_by
from public.workspace_teams team
on conflict do nothing;

alter table public.workspace_teams enable row level security;
alter table public.workspace_team_members enable row level security;
alter table public.workspace_team_service_responsibilities enable row level security;
alter table public.workspace_native_conversations enable row level security;
alter table public.workspace_native_conversation_participants enable row level security;
alter table public.workspace_native_messages enable row level security;
alter table public.workspace_native_reactions enable row level security;
alter table public.workspace_native_read_cursors enable row level security;

drop policy if exists "workspace members read teams" on public.workspace_teams;
create policy "workspace members read teams" on public.workspace_teams
for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "workspace members read team members" on public.workspace_team_members;
create policy "workspace members read team members" on public.workspace_team_members
for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "workspace members read team service responsibilities" on public.workspace_team_service_responsibilities;
create policy "workspace members read team service responsibilities" on public.workspace_team_service_responsibilities
for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists "participants read native conversations" on public.workspace_native_conversations;
create policy "participants read native conversations" on public.workspace_native_conversations
for select to authenticated using (public.native_conversation_can_read(id));
drop policy if exists "participants read native conversation participants" on public.workspace_native_conversation_participants;
create policy "participants read native conversation participants" on public.workspace_native_conversation_participants
for select to authenticated using (public.native_conversation_can_read(conversation_id));
drop policy if exists "participants read native messages" on public.workspace_native_messages;
create policy "participants read native messages" on public.workspace_native_messages
for select to authenticated using (public.native_conversation_can_read(conversation_id));
drop policy if exists "participants read native reactions" on public.workspace_native_reactions;
create policy "participants read native reactions" on public.workspace_native_reactions
for select to authenticated using (public.native_conversation_can_read(conversation_id));
drop policy if exists "participants read native cursors" on public.workspace_native_read_cursors;
create policy "participants read native cursors" on public.workspace_native_read_cursors
for select to authenticated using (public.native_conversation_can_read(conversation_id));

alter table public.workspace_native_conversations replica identity full;
alter table public.workspace_team_members replica identity full;
alter table public.workspace_native_messages replica identity full;
alter table public.workspace_native_reactions replica identity full;
alter table public.workspace_native_read_cursors replica identity full;

do $$
declare table_name text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach table_name in array array['workspace_team_members', 'workspace_native_conversations', 'workspace_native_messages', 'workspace_native_reactions', 'workspace_native_read_cursors'] loop
            if not exists (
                select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
            ) then
                execute format('alter publication supabase_realtime add table public.%I', table_name);
            end if;
        end loop;
    end if;
end;
$$;
