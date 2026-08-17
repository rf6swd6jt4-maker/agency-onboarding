-- Add workspace-owned Twilio SMS/MMS and separate the logical conversation
-- message from each provider delivery. One Betelgeze bubble can therefore be
-- mirrored to WhatsApp and SMS without duplicating the conversation.

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'twilio_sms', 'clickup'));

alter table public.workspace_connection_attempts
    drop constraint if exists workspace_connection_attempts_provider_check;
alter table public.workspace_connection_attempts
    add constraint workspace_connection_attempts_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'twilio_sms'));

insert into public.workspace_integrations (
    workspace_id,
    provider,
    enabled,
    mode,
    connection_status,
    config_hint
)
select id, 'twilio_sms', false, 'disabled', 'not_connected', '{}'::jsonb
from public.workspaces
on conflict (workspace_id, provider) do nothing;

alter table public.client_communication_channels
    drop constraint if exists client_communication_channels_client_id_key;

create unique index if not exists client_communication_channels_workspace_client_provider_unique
on public.client_communication_channels(workspace_id, client_id, provider);

alter table public.relationships
    add column if not exists communication_primary_provider text not null default 'meta_whatsapp',
    add column if not exists communication_delivery_mode text not null default 'mirror';

alter table public.relationships
    drop constraint if exists relationships_communication_primary_provider_check;
alter table public.relationships
    add constraint relationships_communication_primary_provider_check
    check (communication_primary_provider in ('meta_whatsapp', 'twilio_sms'));

alter table public.relationships
    drop constraint if exists relationships_communication_delivery_mode_check;
alter table public.relationships
    add constraint relationships_communication_delivery_mode_check
    check (communication_delivery_mode in ('primary_only', 'primary_with_fallback', 'mirror'));

alter table public.client_messages
    add column if not exists reply_to_message_id uuid references public.client_messages(id) on delete set null;

create index if not exists client_messages_reply_to_message_idx
on public.client_messages(workspace_id, reply_to_message_id)
where reply_to_message_id is not null;

create table if not exists public.communication_message_deliveries (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid references public.relationships(id) on delete cascade,
    client_message_id uuid not null references public.client_messages(id) on delete cascade,
    communication_channel_id uuid references public.client_communication_channels(id) on delete set null,
    provider text not null check (provider in ('meta_whatsapp', 'twilio_sms')),
    provider_message_id text,
    destination text not null,
    status text not null default 'sending',
    error text,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_message_id, provider)
);

create unique index if not exists communication_deliveries_provider_message_unique
on public.communication_message_deliveries(provider, provider_message_id)
where provider_message_id is not null;

create index if not exists communication_deliveries_workspace_relationship_idx
on public.communication_message_deliveries(workspace_id, relationship_id, created_at desc);

insert into public.communication_message_deliveries (
    workspace_id,
    relationship_id,
    client_message_id,
    communication_channel_id,
    provider,
    provider_message_id,
    destination,
    status,
    error,
    sent_at,
    delivered_at,
    read_at,
    failed_at,
    raw_payload,
    created_at,
    updated_at
)
select
    workspace_id,
    relationship_id,
    id,
    communication_channel_id,
    'meta_whatsapp',
    coalesce(provider_message_id, whatsapp_message_id),
    coalesce(to_address, from_address, 'whatsapp:unknown'),
    status,
    error,
    sent_at,
    delivered_at,
    read_at,
    failed_at,
    raw_payload,
    created_at,
    created_at
from public.client_messages
where provider = 'meta_whatsapp'
  and relationship_id is not null
on conflict (client_message_id, provider) do nothing;

update public.client_messages message
set reply_to_message_id = target.id
from public.client_messages target
where message.reply_to_message_id is null
  and message.workspace_id = target.workspace_id
  and message.relationship_id = target.relationship_id
  and message.reply_to_whatsapp_message_id is not null
  and message.reply_to_whatsapp_message_id in (target.provider_message_id, target.whatsapp_message_id);

alter table public.communication_message_deliveries enable row level security;

drop policy if exists "workspace members read communication deliveries" on public.communication_message_deliveries;
create policy "workspace members read communication deliveries"
on public.communication_message_deliveries for select to authenticated
using (public.is_workspace_member(workspace_id));

alter table public.communication_message_deliveries replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'communication_message_deliveries'
       ) then
        alter publication supabase_realtime add table public.communication_message_deliveries;
    end if;
end;
$$;

comment on table public.communication_message_deliveries is
    'Per-provider attempts for one logical client_messages conversation message.';
comment on column public.relationships.communication_primary_provider is
    'Preferred client channel when more than one messaging provider is available.';
comment on column public.relationships.communication_delivery_mode is
    'Whether outbound logical messages use only the primary, fall back, or mirror to all available channels.';
