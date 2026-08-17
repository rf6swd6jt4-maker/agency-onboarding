create table if not exists public.chat_push_notification_states (
    subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    conversation_kind text not null check (conversation_kind in ('client', 'native')),
    conversation_id uuid not null,
    message_id uuid not null,
    message_created_at timestamptz not null,
    created_at timestamptz not null default now(),
    primary key (subscription_id, conversation_kind, conversation_id)
);

alter table public.chat_push_notification_states enable row level security;
revoke all on public.chat_push_notification_states from anon, authenticated;

create or replace function public.claim_chat_push_notification(
    p_subscription_id uuid,
    p_workspace_id uuid,
    p_conversation_kind text,
    p_conversation_id uuid,
    p_message_id uuid,
    p_message_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    subscription_user_id uuid;
    read_through timestamptz;
    inserted_count integer;
begin
    if p_conversation_kind not in ('client', 'native') then
        return false;
    end if;

    select user_id into subscription_user_id
    from public.web_push_subscriptions
    where id = p_subscription_id;

    if subscription_user_id is null then
        return false;
    end if;

    if p_conversation_kind = 'client' then
        select last_read_at into read_through
        from public.communication_read_cursors
        where workspace_id = p_workspace_id
          and relationship_id = p_conversation_id
          and user_id = subscription_user_id;
    else
        select last_read_at into read_through
        from public.workspace_native_read_cursors
        where workspace_id = p_workspace_id
          and conversation_id = p_conversation_id
          and user_id = subscription_user_id;
    end if;

    if read_through is not null and read_through >= p_message_created_at then
        return false;
    end if;

    insert into public.chat_push_notification_states (
        subscription_id,
        workspace_id,
        conversation_kind,
        conversation_id,
        message_id,
        message_created_at
    ) values (
        p_subscription_id,
        p_workspace_id,
        p_conversation_kind,
        p_conversation_id,
        p_message_id,
        p_message_created_at
    )
    on conflict (subscription_id, conversation_kind, conversation_id) do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count = 1;
end;
$$;

create or replace function public.clear_read_chat_push_notifications(
    p_user_id uuid,
    p_conversation_kind text,
    p_conversation_id uuid,
    p_read_through timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.chat_push_notification_states state
    using public.web_push_subscriptions subscription
    where state.subscription_id = subscription.id
      and subscription.user_id = p_user_id
      and state.conversation_kind = p_conversation_kind
      and state.conversation_id = p_conversation_id
      and state.message_created_at <= p_read_through;
$$;

revoke all on function public.claim_chat_push_notification(uuid, uuid, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.clear_read_chat_push_notifications(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_chat_push_notification(uuid, uuid, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.clear_read_chat_push_notifications(uuid, text, uuid, timestamptz) to service_role;
