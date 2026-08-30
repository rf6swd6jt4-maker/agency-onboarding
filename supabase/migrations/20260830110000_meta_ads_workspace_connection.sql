-- Meta Ads is an optional workspace connection. It is created only when the
-- trusted Meta Ads service template is installed; new workspaces do not get a
-- speculative connection row.

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'twilio_sms', 'clickup'));

alter table public.workspace_connection_attempts
    drop constraint if exists workspace_connection_attempts_provider_check;
alter table public.workspace_connection_attempts
    add constraint workspace_connection_attempts_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'twilio_sms'));

create or replace function public.install_onboarding_service_template(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_definition jsonb,
    p_template_id text,
    p_connection_provider text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_saved jsonb;
begin
    if p_service_id is not null then
        raise exception 'Service templates can only be installed as new services';
    end if;
    if p_template_id <> 'meta-ads' or p_connection_provider <> 'meta_ads' then
        raise exception 'Unknown service template setup';
    end if;
    if p_definition ->> 'templateId' <> p_template_id
        or not (coalesce(p_definition -> 'requiredConnectionKeys', '[]'::jsonb) @> jsonb_build_array(p_connection_provider)) then
        raise exception 'Service template setup does not match its trusted definition';
    end if;

    v_saved := public.save_onboarding_service_revision(
        p_workspace_id,
        p_actor_user_id,
        null,
        p_definition
    );

    insert into public.workspace_integrations (
        workspace_id,
        provider,
        enabled,
        mode,
        connection_status,
        config_hint
    ) values (
        p_workspace_id,
        p_connection_provider,
        false,
        'disabled',
        'not_connected',
        '{}'::jsonb
    ) on conflict (workspace_id, provider) do nothing;

    return v_saved || jsonb_build_object(
        'template_id', p_template_id,
        'connection_provider', p_connection_provider
    );
end;
$$;

revoke all on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) to service_role;

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
            candidate_config_hint ->> 'business_id',
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
        connected_account_id = coalesce(
            previous_config_hint ->> 'account_id',
            previous_config_hint ->> 'waba_id',
            previous_config_hint ->> 'business_id'
        ),
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
