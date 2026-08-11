-- Bookends are retained as immutable history for already-materialized sessions,
-- but future authoring and composition use ordinary mandatory modules.

create or replace function public.onboarding_bookend_as_module_definition(
    p_kind text,
    p_definition jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
    v_definition jsonb := coalesce(p_definition, '{}'::jsonb);
    v_steps jsonb := coalesce(v_definition->'steps', '[]'::jsonb);
    v_step jsonb;
    v_blocks jsonb;
    v_next_steps jsonb := '[]'::jsonb;
    v_checklist jsonb;
    v_title text := case when p_kind = 'welcome' then 'Welcome' else 'All done' end;
    v_estimate text := case when p_kind = 'welcome' then '2 minutes' else 'A few moments' end;
begin
    if jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) = 0 then
        v_steps := jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid(),
            'key', case when p_kind = 'welcome' then 'welcome' else 'all-done' end,
            'blocks', jsonb_build_array(
                jsonb_build_object(
                    'id', gen_random_uuid(), 'name', 'Header block', 'kind', 'header',
                    'title', coalesce(nullif(v_definition->>'title', ''), v_title),
                    'description', coalesce(v_definition->>'body', ''),
                    'estimatedTime', v_estimate, 'showComposedModuleSummary', false,
                    'layout', jsonb_build_object('width', 'standard', 'alignment', 'left', 'spacingBefore', 'normal', 'spacingAfter', 'normal')
                ),
                jsonb_build_object(
                    'id', gen_random_uuid(), 'name', 'Estimated time', 'kind', 'estimate',
                    'estimatedTime', v_estimate,
                    'layout', jsonb_build_object('width', 'standard', 'alignment', 'left', 'spacingBefore', 'compact', 'spacingAfter', 'compact')
                )
            ),
            'navigation', jsonb_build_object('backLabel', 'Back', 'continueLabel', case when p_kind = 'welcome' then 'Start onboarding' else 'Continue' end)
        ));
    end if;

    v_checklist := case when p_kind = 'welcome' then
        jsonb_build_object(
            'id', gen_random_uuid(), 'name', 'Onboarding summary', 'kind', 'checklist',
            'title', 'Your onboarding includes:', 'source', 'modules', 'items', '[]'::jsonb, 'footer', '',
            'layout', jsonb_build_object('width', 'wide', 'alignment', 'left', 'spacingBefore', 'normal', 'spacingAfter', 'normal')
        )
    else
        jsonb_build_object(
            'id', gen_random_uuid(), 'name', 'What happens now', 'kind', 'checklist',
            'title', 'What happens next?', 'source', 'custom',
            'items', jsonb_build_array('Our team reviews your information.', 'Your project moves into fulfilment.', 'We’ll contact you if anything else is needed.'),
            'footer', 'You can close this page now. There is nothing else you need to do at this stage.',
            'layout', jsonb_build_object('width', 'wide', 'alignment', 'left', 'spacingBefore', 'normal', 'spacingAfter', 'normal')
        )
    end;

    for v_step in select value from jsonb_array_elements(v_steps) with ordinality as item(value, position) order by position loop
        v_blocks := coalesce(v_step->'blocks', '[]'::jsonb);
        select coalesce(jsonb_agg(
            case when block->>'kind' = 'header'
                then jsonb_set(block, '{showComposedModuleSummary}', 'false'::jsonb, true)
                else block end
            order by position
        ), '[]'::jsonb)
        into v_blocks
        from jsonb_array_elements(v_blocks) with ordinality as item(block, position);

        if jsonb_array_length(v_next_steps) = 0
           and not exists (select 1 from jsonb_array_elements(v_blocks) block where block->>'kind' = 'checklist') then
            v_blocks := v_blocks || jsonb_build_array(v_checklist);
        end if;
        v_next_steps := v_next_steps || jsonb_build_array(jsonb_set(v_step, '{blocks}', v_blocks, true));
    end loop;

    return jsonb_build_object(
        'name', v_title,
        'description', case when p_kind = 'welcome' then 'Introduces the onboarding.' else 'Closes the onboarding.' end,
        'isTest', false,
        'mandatory', true,
        'placement', case when p_kind = 'welcome' then 'start' else 'end' end,
        'schemaVersion', 2,
        'steps', v_next_steps
    );
end;
$$;

insert into public.onboarding_modules (workspace_id, internal_code, status, created_by, created_at, updated_at)
select distinct configuration.workspace_id,
       case when configuration.configuration_type = 'welcome' then 'system-welcome' else 'system-completion' end,
       'active', configuration.created_by, min(configuration.created_at), max(configuration.updated_at)
from public.onboarding_configuration_revisions configuration
where configuration.configuration_type in ('welcome', 'completion')
group by configuration.workspace_id, configuration.configuration_type, configuration.created_by
on conflict (workspace_id, internal_code) do nothing;

insert into public.onboarding_module_revisions (
    workspace_id, module_id, revision_number, status, definition, definition_hash,
    created_by, updated_by, published_by, published_at, created_at, updated_at
)
select configuration.workspace_id,
       module.id,
       configuration.revision_number,
       configuration.status,
       converted.definition,
       md5(converted.definition::text),
       configuration.created_by,
       configuration.updated_by,
       configuration.published_by,
       configuration.published_at,
       configuration.created_at,
       configuration.updated_at
from public.onboarding_configuration_revisions configuration
join public.onboarding_modules module
  on module.workspace_id = configuration.workspace_id
 and module.internal_code = case when configuration.configuration_type = 'welcome' then 'system-welcome' else 'system-completion' end
cross join lateral (
    select public.onboarding_bookend_as_module_definition(configuration.configuration_type, configuration.definition) as definition
) converted
where configuration.configuration_type in ('welcome', 'completion')
  and not exists (
      select 1 from public.onboarding_module_revisions existing
      where existing.module_id = module.id
        and existing.status = configuration.status
        and existing.revision_number is not distinct from configuration.revision_number
  );

drop function public.onboarding_bookend_as_module_definition(text, jsonb);
