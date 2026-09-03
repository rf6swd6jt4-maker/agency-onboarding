create or replace function public.enforce_onboarding_block_requirements()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_session_step_id uuid;
begin
    if new.native_kind <> 'onboarding_step' or new.status <> 'done' or old.status = 'done' then return new; end if;
    begin v_session_step_id := nullif(new.metadata->>'session_step_id', '')::uuid;
    exception when others then v_session_step_id := null; end;
    if v_session_step_id is not null and exists (
        select 1
        from public.relationship_onboarding_session_blocks block
        join public.relationship_onboarding_sessions session
          on session.workspace_id = block.workspace_id
         and session.id = block.session_id
        where block.workspace_id = new.workspace_id
          and block.session_step_id = v_session_step_id
          and not session.is_test
          and block.required
          and not exists (
              select 1 from public.onboarding_block_requirements requirement
              where requirement.workspace_id = block.workspace_id and requirement.session_block_id = block.id
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Complete the required video or link before continuing.';
    end if;
    return new;
end;
$$;
