-- Optional Google Ads connection, installed atomically with its service template.
alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'google_ads', 'twilio_sms', 'clickup'));

alter table public.workspace_connection_attempts
    drop constraint if exists workspace_connection_attempts_provider_check;
alter table public.workspace_connection_attempts
    add constraint workspace_connection_attempts_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'google_ads', 'twilio_sms'));

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
    if not (coalesce(p_template_id = 'meta-ads' and p_connection_provider = 'meta_ads', false)
        or coalesce(p_template_id = 'google-ads' and p_connection_provider = 'google_ads', false)) then
        raise exception 'Unknown service template setup';
    end if;
    if p_definition ->> 'templateId' is distinct from p_template_id
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

-- Prevent one manager from activating in two workspaces, including concurrent checks.
create unique index if not exists workspace_integrations_google_ads_manager_unique
    on public.workspace_integrations (connected_account_id)
    where provider = 'google_ads' and enabled and mode = 'connected';

-- The verified credential and hint must belong to the same candidate, even if
-- another owner browser stages a replacement while Google's response is pending.
create or replace function public.activate_google_ads_manager_candidate(
    p_workspace_id uuid,
    p_expected_candidate text,
    p_verified_hint jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_candidate text;
begin
    select candidate_config_encrypted into v_candidate
    from public.workspace_integrations
    where workspace_id = p_workspace_id and provider = 'google_ads'
    for update;
    if v_candidate is null or v_candidate is distinct from p_expected_candidate then
        raise exception 'The pending connection changed. Verify the latest connection again.';
    end if;
    update public.workspace_integrations set candidate_config_hint = p_verified_hint
    where workspace_id = p_workspace_id and provider = 'google_ads';
    perform public.activate_workspace_integration_candidate(p_workspace_id, 'google_ads');
end;
$$;
revoke all on function public.activate_google_ads_manager_candidate(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_google_ads_manager_candidate(uuid, text, jsonb) to service_role;
