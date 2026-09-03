alter table public.client_sales
    add column if not exists sms_consent_token text;

update public.client_sales
set sms_consent_token = encode(extensions.gen_random_bytes(32), 'hex')
where sms_consent_token is null;

alter table public.client_sales
    alter column sms_consent_token set default encode(extensions.gen_random_bytes(32), 'hex'),
    alter column sms_consent_token set not null;

create unique index if not exists client_sales_sms_consent_token_unique
on public.client_sales(sms_consent_token);

alter table public.client_sales
    drop constraint if exists client_sales_sms_consent_token_format;
alter table public.client_sales
    add constraint client_sales_sms_consent_token_format
    check (sms_consent_token ~ '^[a-f0-9]{64}$');

create table if not exists public.relationship_sms_consents (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    client_sale_id uuid not null references public.client_sales(id) on delete cascade,
    phone_e164 text not null,
    status text not null default 'pending'
        check (status in ('pending', 'sending_confirmation', 'awaiting_confirmation', 'confirmed', 'send_failed', 'opted_out')),
    disclosure_version text not null,
    disclosure_text text not null,
    source_url text not null,
    source_host text not null,
    source_ip text,
    user_agent text,
    consented_at timestamptz not null,
    confirmation_sent_at timestamptz,
    confirmed_at timestamptz,
    opted_out_at timestamptz,
    initial_message_id uuid references public.client_messages(id) on delete set null,
    initial_provider_message_id text,
    confirmation_provider_message_id text,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_sale_id),
    unique (workspace_id, id),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, client_sale_id) references public.client_sales(workspace_id, id) on delete cascade
);

create index if not exists relationship_sms_consents_active_phone_idx
on public.relationship_sms_consents(workspace_id, phone_e164, updated_at desc)
where status in ('sending_confirmation', 'awaiting_confirmation', 'confirmed');

drop trigger if exists relationship_sms_consents_updated_at on public.relationship_sms_consents;
create trigger relationship_sms_consents_updated_at
before update on public.relationship_sms_consents
for each row execute function public.set_updated_at();

alter table public.relationship_sms_consents enable row level security;

drop policy if exists "service scoped staff read relationship SMS consents" on public.relationship_sms_consents;
create policy "service scoped staff read relationship SMS consents"
on public.relationship_sms_consents for select to authenticated
using (public.workspace_user_can_access_relationship(workspace_id, relationship_id));

comment on table public.relationship_sms_consents is
    'Auditable web opt-in and subsequent SMS confirmation state for one sold-client onboarding flow.';
comment on column public.relationship_sms_consents.disclosure_text is
    'Exact unchecked-checkbox disclosure accepted by the recipient at consented_at.';
comment on column public.client_sales.sms_consent_token is
    'Opaque public token used only to resolve the sold-client SMS consent page.';
