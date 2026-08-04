alter table public.workspace_maintenance_routing
drop constraint if exists workspace_maintenance_routing_category_check;

alter table public.workspace_maintenance_routing
add constraint workspace_maintenance_routing_category_check
check (category in ('global', 'leadgen', 'onboarding', 'billing', 'communications', 'integrations', 'system_health'));
