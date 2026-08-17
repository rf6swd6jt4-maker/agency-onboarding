alter table public.communications_active_sessions
    add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
    add column if not exists conversation_kind text,
    add column if not exists conversation_id uuid,
    add column if not exists connection_live boolean not null default false;

alter table public.communications_active_sessions
    drop constraint if exists communications_active_sessions_conversation_kind_check;

alter table public.communications_active_sessions
    add constraint communications_active_sessions_conversation_kind_check
    check (conversation_kind is null or conversation_kind in ('client', 'native'));

create index if not exists communications_active_sessions_conversation_recent_idx
on public.communications_active_sessions(workspace_id, conversation_kind, conversation_id, last_seen_at desc)
where connection_live = true;
