-- Keep one durable pinned message on each client or native conversation.

alter table public.relationships
    add column if not exists communication_pinned_message_id uuid;

alter table public.relationships
    drop constraint if exists relationships_communication_pinned_message_fkey;
alter table public.relationships
    add constraint relationships_communication_pinned_message_fkey
    foreign key (communication_pinned_message_id)
    references public.client_messages(id) on delete set null;

create index if not exists relationships_communication_pinned_message_idx
on public.relationships(workspace_id, communication_pinned_message_id)
where communication_pinned_message_id is not null;

alter table public.workspace_native_conversations
    add column if not exists pinned_message_id uuid;

alter table public.workspace_native_conversations
    drop constraint if exists workspace_native_conversations_pinned_message_fkey;
alter table public.workspace_native_conversations
    add constraint workspace_native_conversations_pinned_message_fkey
    foreign key (pinned_message_id)
    references public.workspace_native_messages(id) on delete set null;

create index if not exists workspace_native_conversations_pinned_message_idx
on public.workspace_native_conversations(workspace_id, pinned_message_id)
where pinned_message_id is not null;

alter table public.relationships replica identity full;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'relationships'
    ) then
        alter publication supabase_realtime add table public.relationships;
    end if;
end
$$;
