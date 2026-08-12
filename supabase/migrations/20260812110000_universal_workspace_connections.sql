-- Universal, reversible workspace connection lifecycle.
--
-- Existing workspace_integrations rows remain the active source of truth. New
-- credentials are first written to candidate_* columns, verified, and only
-- then promoted. This lets Scaylup test workspace-owned credentials without
-- deleting the platform_legacy escape hatch or its Vercel environment values.

alter table public.workspace_integrations
    add column if not exists connection_status text not null default 'not_connected',
    add column if not exists auth_method text,
    add column if not exists capabilities jsonb not null default '{}'::jsonb,
    add column if not exists last_verified_at timestamptz,
    add column if not exists last_webhook_at timestamptz,
    add column if not exists last_error text,
    add column if not exists candidate_config_encrypted text,
    add column if not exists candidate_config_hint jsonb not null default '{}'::jsonb,
    add column if not exists candidate_auth_method text,
    add column if not exists candidate_configured_at timestamptz,
    add column if not exists candidate_configured_by uuid references auth.users(id) on delete set null,
    add column if not exists previous_mode text,
    add column if not exists previous_config_encrypted text,
    add column if not exists previous_config_hint jsonb,
    add column if not exists previous_auth_method text;

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_connection_status_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_connection_status_check
    check (connection_status in ('not_connected', 'connecting', 'connected', 'needs_attention', 'degraded'));

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_auth_method_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_auth_method_check
    check (auth_method is null or auth_method in ('legacy', 'oauth', 'embedded_signup', 'manual'));

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_candidate_auth_method_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_candidate_auth_method_check
    check (candidate_auth_method is null or candidate_auth_method in ('oauth', 'embedded_signup', 'manual'));

update public.workspace_integrations
set connection_status = case
        when enabled and mode = 'platform_legacy' then 'connected'
        when enabled and mode = 'connected' and nullif(config_hint ->> 'verified_at', '') is not null then 'connected'
        when enabled and mode = 'connected' then 'needs_attention'
        else 'not_connected'
    end,
    auth_method = case
        when mode = 'platform_legacy' then 'legacy'
        when mode = 'connected' then coalesce(auth_method, 'manual')
        else auth_method
    end,
    last_verified_at = coalesce(last_verified_at, nullif(config_hint ->> 'verified_at', '')::timestamptz);

create table if not exists public.workspace_connection_attempts (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    provider text not null check (provider in ('stripe', 'meta_whatsapp')),
    auth_method text not null check (auth_method in ('oauth', 'embedded_signup', 'manual')),
    state_hash text not null unique,
    status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'expired')),
    requested_by uuid references auth.users(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    error text,
    expires_at timestamptz not null,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists workspace_connection_attempts_workspace_created_idx
    on public.workspace_connection_attempts (workspace_id, created_at desc);

alter table public.workspace_connection_attempts enable row level security;
revoke all on public.workspace_connection_attempts from anon, authenticated;

create or replace function public.activate_workspace_integration_candidate(
    p_workspace_id uuid,
    p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.workspace_integrations
    set previous_mode = mode,
        previous_config_encrypted = config_encrypted,
        previous_config_hint = config_hint,
        previous_auth_method = auth_method,
        mode = 'connected',
        enabled = true,
        config_encrypted = candidate_config_encrypted,
        config_hint = candidate_config_hint,
        auth_method = candidate_auth_method,
        connection_status = 'connected',
        capabilities = coalesce(candidate_config_hint -> 'capabilities', '{}'::jsonb),
        connected_account_id = coalesce(
            candidate_config_hint ->> 'account_id',
            candidate_config_hint ->> 'waba_id',
            connected_account_id
        ),
        configured_at = candidate_configured_at,
        configured_by = candidate_configured_by,
        last_verified_at = now(),
        last_error = null,
        candidate_config_encrypted = null,
        candidate_config_hint = '{}'::jsonb,
        candidate_auth_method = null,
        candidate_configured_at = null,
        candidate_configured_by = null
    where workspace_id = p_workspace_id
      and provider = p_provider
      and candidate_config_encrypted is not null;

    if not found then
        raise exception 'No verified connection candidate exists.';
    end if;
end;
$$;

create or replace function public.restore_workspace_integration_previous(
    p_workspace_id uuid,
    p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.workspace_integrations
    set mode = previous_mode,
        enabled = previous_mode in ('platform_legacy', 'connected'),
        config_encrypted = previous_config_encrypted,
        config_hint = coalesce(previous_config_hint, '{}'::jsonb),
        auth_method = previous_auth_method,
        connection_status = case when previous_mode in ('platform_legacy', 'connected') then 'connected' else 'not_connected' end,
        capabilities = coalesce(previous_config_hint -> 'capabilities', '{}'::jsonb),
        connected_account_id = coalesce(previous_config_hint ->> 'account_id', previous_config_hint ->> 'waba_id'),
        last_verified_at = nullif(previous_config_hint ->> 'verified_at', '')::timestamptz,
        last_error = null,
        previous_mode = null,
        previous_config_encrypted = null,
        previous_config_hint = null,
        previous_auth_method = null
    where workspace_id = p_workspace_id
      and provider = p_provider
      and previous_mode is not null;

    if not found then
        raise exception 'No previous connection is available.';
    end if;
end;
$$;

revoke all on function public.activate_workspace_integration_candidate(uuid, text) from public;
revoke all on function public.restore_workspace_integration_previous(uuid, text) from public;

comment on table public.workspace_connection_attempts is
    'Short-lived, hashed OAuth and Embedded Signup state. Service-role access only.';
comment on column public.workspace_integrations.candidate_config_encrypted is
    'Encrypted credentials waiting for provider verification and atomic promotion.';
comment on column public.workspace_integrations.previous_mode is
    'One-generation rollback target retained after a successful connection cutover.';
