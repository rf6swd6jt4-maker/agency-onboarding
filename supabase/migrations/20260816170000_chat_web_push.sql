create table if not exists public.web_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_success_at timestamptz,
    failure_count integer not null default 0 check (failure_count >= 0)
);

create index if not exists web_push_subscriptions_user_idx
on public.web_push_subscriptions(user_id);

create table if not exists public.communications_active_sessions (
    user_id uuid not null references auth.users(id) on delete cascade,
    tab_id uuid not null,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key (user_id, tab_id)
);

create index if not exists communications_active_sessions_recent_idx
on public.communications_active_sessions(user_id, last_seen_at desc);

alter table public.web_push_subscriptions enable row level security;
alter table public.communications_active_sessions enable row level security;

create or replace function public.increment_web_push_failure(subscription_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
    update public.web_push_subscriptions
    set failure_count = failure_count + 1,
        updated_at = now()
    where id = subscription_id;
$$;

revoke all on function public.increment_web_push_failure(uuid) from public, anon, authenticated;
grant execute on function public.increment_web_push_failure(uuid) to service_role;

-- These capability-bearing records are only accessed through authenticated
-- server routes using the service role. Browser clients never read them.
revoke all on public.web_push_subscriptions from anon, authenticated;
revoke all on public.communications_active_sessions from anon, authenticated;
