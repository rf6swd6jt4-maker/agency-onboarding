create table if not exists public.workspace_sms_opt_ins (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    submitted_name text not null check (char_length(submitted_name) between 1 and 200),
    phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    status text not null default 'active' check (status in ('active', 'opted_out')),
    disclosure_version text not null,
    disclosure_text text not null,
    source_url text not null,
    source_host text not null,
    source_ip text,
    user_agent text,
    consented_at timestamptz not null,
    opted_out_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, phone_e164),
    unique (workspace_id, id)
);

drop trigger if exists workspace_sms_opt_ins_updated_at on public.workspace_sms_opt_ins;
create trigger workspace_sms_opt_ins_updated_at
before update on public.workspace_sms_opt_ins
for each row execute function public.set_updated_at();

alter table public.workspace_sms_opt_ins enable row level security;

drop policy if exists "workspace members read SMS opt-ins" on public.workspace_sms_opt_ins;
create policy "workspace members read SMS opt-ins"
on public.workspace_sms_opt_ins for select to authenticated
using (public.is_workspace_member(workspace_id));

alter table public.client_sales
    add column if not exists sms_recipient_e164 text;

update public.client_sales sale
set sms_recipient_e164 = normalized.phone_e164
from public.relationships relationship
cross join lateral (
    select case
        when relationship.primary_phone ~ '^\s*\+' then '+' || regexp_replace(relationship.primary_phone, '[^0-9]', '', 'g')
        when relationship.primary_phone ~ '^\s*00' then '+' || substring(regexp_replace(relationship.primary_phone, '[^0-9]', '', 'g') from 3)
        when regexp_replace(relationship.primary_phone, '[^0-9]', '', 'g') ~ '^[0-9]{10}$' then '+1' || regexp_replace(relationship.primary_phone, '[^0-9]', '', 'g')
        else '+' || regexp_replace(relationship.primary_phone, '[^0-9]', '', 'g')
    end as phone_e164
) normalized
where sale.workspace_id = relationship.workspace_id
  and sale.relationship_id = relationship.id
  and sale.sms_recipient_e164 is null
  and relationship.primary_phone is not null
  and normalized.phone_e164 ~ '^\+[1-9][0-9]{7,14}$';

alter table public.client_sales
    drop constraint if exists client_sales_sms_recipient_e164_format;
alter table public.client_sales
    add constraint client_sales_sms_recipient_e164_format
    check (sms_recipient_e164 is null or sms_recipient_e164 ~ '^\+[1-9][0-9]{7,14}$');

create index if not exists client_sales_pending_sms_recipient_idx
on public.client_sales(workspace_id, sms_recipient_e164, created_at desc)
where sms_recipient_e164 is not null and consent_template_sent_at is null;

alter table public.relationship_sms_consents
    add column if not exists workspace_sms_opt_in_id uuid;

insert into public.workspace_sms_opt_ins (
    workspace_id,
    submitted_name,
    phone_e164,
    status,
    disclosure_version,
    disclosure_text,
    source_url,
    source_host,
    source_ip,
    user_agent,
    consented_at,
    opted_out_at
)
select distinct on (consent.workspace_id, consent.phone_e164)
    consent.workspace_id,
    coalesce(nullif(trim(relationship.primary_person_name), ''), nullif(trim(sale.client_name), ''), 'Client'),
    consent.phone_e164,
    case when consent.status = 'opted_out' then 'opted_out' else 'active' end,
    consent.disclosure_version,
    consent.disclosure_text,
    consent.source_url,
    consent.source_host,
    consent.source_ip,
    consent.user_agent,
    consent.consented_at,
    consent.opted_out_at
from public.relationship_sms_consents consent
left join public.relationships relationship
    on relationship.workspace_id = consent.workspace_id
   and relationship.id = consent.relationship_id
left join public.client_sales sale
    on sale.workspace_id = consent.workspace_id
   and sale.id = consent.client_sale_id
order by consent.workspace_id, consent.phone_e164, consent.updated_at desc
on conflict (workspace_id, phone_e164) do nothing;

update public.relationship_sms_consents consent
set workspace_sms_opt_in_id = opt_in.id
from public.workspace_sms_opt_ins opt_in
where consent.workspace_sms_opt_in_id is null
  and opt_in.workspace_id = consent.workspace_id
  and opt_in.phone_e164 = consent.phone_e164;

alter table public.relationship_sms_consents
    drop constraint if exists relationship_sms_consents_workspace_sms_opt_in_fkey;
alter table public.relationship_sms_consents
    add constraint relationship_sms_consents_workspace_sms_opt_in_fkey
    foreign key (workspace_id, workspace_sms_opt_in_id)
    references public.workspace_sms_opt_ins(workspace_id, id)
    on delete set null (workspace_sms_opt_in_id);

create index if not exists workspace_sms_opt_ins_active_phone_idx
on public.workspace_sms_opt_ins(workspace_id, phone_e164)
where status = 'active';

comment on table public.workspace_sms_opt_ins is
    'Current agency-scoped SMS opt-in evidence collected from the public, tokenless agency-domain form.';
comment on column public.workspace_sms_opt_ins.submitted_name is
    'Name supplied by the person opting in; retained as evidence and not used to authorize a sale or match a relationship.';
comment on column public.client_sales.sms_recipient_e164 is
    'Normalized SMS number used to reconcile a public agency opt-in with a pending sale without polling.';
comment on column public.relationship_sms_consents.workspace_sms_opt_in_id is
    'Public agency opt-in record that authorized this sale-specific confirmation message.';
