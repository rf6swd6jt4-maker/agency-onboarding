-- Communications is the canonical workspace messaging surface. Keep message
-- attribution, provider delivery state, staff read cursors, and realtime
-- access durable without depending on the retired ClickUp bridge.

alter table public.client_communication_channels
    alter column clickup_channel_id drop not null;

alter table public.client_communication_channels
    drop constraint if exists client_communication_channels_provider_external_address_key;

create unique index if not exists client_communication_channels_workspace_provider_address_unique
on public.client_communication_channels(workspace_id, provider, external_address);

alter table public.client_messages
    add column if not exists sender_kind text,
    add column if not exists sender_user_id uuid references auth.users(id) on delete set null,
    add column if not exists automation_kind text,
    add column if not exists automation_label text,
    add column if not exists client_request_id uuid,
    add column if not exists sent_at timestamptz,
    add column if not exists delivered_at timestamptz,
    add column if not exists read_at timestamptz,
    add column if not exists failed_at timestamptz;

update public.client_messages
set sender_kind = case
    when direction = 'inbound' then 'client'
    when provider in ('clickup', 'clickup_chat') then 'legacy'
    when raw_payload ? 'outbox_id'
      or raw_payload ? 'template_name'
      or raw_payload ? 'onboarding_url'
      or raw_payload ? 'client_sale_id' then 'automation'
    else 'legacy'
end
where sender_kind is null;

update public.client_messages
set
    automation_kind = coalesce(
        automation_kind,
        nullif(raw_payload ->> 'kind', ''),
        case
            when raw_payload ? 'template_name' then 'consent_template'
            when raw_payload ? 'onboarding_url' then 'onboarding_link'
            else null
        end
    ),
    automation_label = coalesce(
        automation_label,
        case
            when raw_payload ->> 'kind' = 'module_update' then 'Onboarding update'
            when raw_payload ? 'outbox_id' then 'Onboarding link'
            when raw_payload ? 'template_name' then 'Consent request'
            when raw_payload ? 'onboarding_url' then 'Onboarding link'
            else null
        end
    )
where sender_kind = 'automation';

update public.client_messages
set
    sent_at = case
        when status in ('sent', 'delivered', 'read', 'whatsapp_sent', 'whatsapp_delivered', 'whatsapp_read')
            then coalesce(sent_at, created_at)
        else sent_at
    end,
    delivered_at = case
        when status in ('delivered', 'read', 'whatsapp_delivered', 'whatsapp_read')
            then coalesce(delivered_at, created_at)
        else delivered_at
    end,
    read_at = case
        when status in ('read', 'whatsapp_read') then coalesce(read_at, created_at)
        else read_at
    end,
    failed_at = case
        when status in ('failed', 'send_failed', 'delivery_failed') then coalesce(failed_at, created_at)
        else failed_at
    end;

alter table public.client_messages
    drop constraint if exists client_messages_sender_kind_check;

alter table public.client_messages
    add constraint client_messages_sender_kind_check
    check (sender_kind is null or sender_kind in ('client', 'staff', 'automation', 'legacy'));

create unique index if not exists client_messages_workspace_request_unique
on public.client_messages(workspace_id, client_request_id)
where client_request_id is not null;

create index if not exists client_messages_workspace_created_idx
on public.client_messages(workspace_id, created_at desc);

create table if not exists public.communication_read_cursors (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    last_read_message_id uuid references public.client_messages(id) on delete set null,
    last_read_at timestamptz not null default now(),
    primary key (workspace_id, relationship_id, user_id)
);

create index if not exists communication_read_cursors_relationship_idx
on public.communication_read_cursors(workspace_id, relationship_id, last_read_at desc);

alter table public.communication_read_cursors enable row level security;

drop policy if exists "workspace members read communication cursors" on public.communication_read_cursors;
create policy "workspace members read communication cursors"
on public.communication_read_cursors for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members manage their communication cursor" on public.communication_read_cursors;
create policy "workspace members manage their communication cursor"
on public.communication_read_cursors for all to authenticated
using (user_id = auth.uid() and public.is_workspace_member(workspace_id))
with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

alter table public.client_messages replica identity full;
alter table public.communication_read_cursors replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'client_messages'
        ) then
            alter publication supabase_realtime add table public.client_messages;
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'communication_read_cursors'
        ) then
            alter publication supabase_realtime add table public.communication_read_cursors;
        end if;
    end if;
end;
$$;

create or replace function public.can_access_communications_realtime(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_topic ~ '^communications:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
       and exists (
           select 1
           from public.workspaces workspace
           join public.workspace_memberships membership on membership.workspace_id = workspace.id
           where workspace.slug = split_part(p_topic, ':', 2)
             and membership.user_id = auth.uid()
             and membership.role in ('owner', 'admin', 'staff')
             and workspace.status = 'active'
       );
$$;

revoke all on function public.can_access_communications_realtime(text) from public, anon;
grant execute on function public.can_access_communications_realtime(text) to authenticated;

do $$
begin
    if to_regclass('realtime.messages') is not null then
        execute 'drop policy if exists "workspace members receive communications realtime" on realtime.messages';
        execute 'drop policy if exists "workspace members send communications realtime" on realtime.messages';
        execute $policy$
            create policy "workspace members receive communications realtime"
            on realtime.messages for select to authenticated
            using (public.can_access_communications_realtime(realtime.topic()))
        $policy$;
        execute $policy$
            create policy "workspace members send communications realtime"
            on realtime.messages for insert to authenticated
            with check (public.can_access_communications_realtime(realtime.topic()))
        $policy$;
    end if;
end;
$$;
