-- Native WhatsApp reactions and a reusable workspace sticker tray.

create table if not exists public.communication_reactions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    client_message_id uuid not null references public.client_messages(id) on delete cascade,
    direction text not null check (direction in ('inbound', 'outbound')),
    reactor_user_id uuid references auth.users(id) on delete set null,
    reactor_address text,
    emoji text not null check (char_length(emoji) between 1 and 32),
    provider_message_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_message_id, direction)
);

create index if not exists communication_reactions_workspace_relationship_idx
on public.communication_reactions(workspace_id, relationship_id, updated_at desc);

alter table public.communication_reactions enable row level security;

drop policy if exists "workspace members read communication reactions" on public.communication_reactions;
create policy "workspace members read communication reactions"
on public.communication_reactions for select to authenticated
using (public.is_workspace_member(workspace_id));

create table if not exists public.communication_stickers (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_by uuid references auth.users(id) on delete set null,
    file_name text not null,
    storage_path text not null unique,
    size_bytes integer not null check (size_bytes between 1 and 102400),
    created_at timestamptz not null default now()
);

create index if not exists communication_stickers_workspace_created_idx
on public.communication_stickers(workspace_id, created_at);

alter table public.communication_stickers enable row level security;

drop policy if exists "workspace members read communication stickers" on public.communication_stickers;
create policy "workspace members read communication stickers"
on public.communication_stickers for select to authenticated
using (public.is_workspace_member(workspace_id));

alter table public.communication_reactions replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'communication_reactions'
       ) then
        alter publication supabase_realtime add table public.communication_reactions;
    end if;
end;
$$;
