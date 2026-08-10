import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const foundationPath = "supabase/migrations/20260810100000_custom_onboarding_foundation.sql"
const operationsPath = "supabase/migrations/20260810101000_custom_onboarding_operations.sql"
const seedPath = "supabase/migrations/20260810102000_custom_onboarding_seed.sql"

test("custom onboarding schema uses immutable revisions and normalized stable snapshot IDs", async () => {
    const foundation = await readFile(foundationPath, "utf8")
    for (const table of [
        "onboarding_modules", "onboarding_module_revisions", "onboarding_services",
        "onboarding_service_revisions", "onboarding_service_revision_modules",
        "onboarding_configuration_revisions", "onboarding_brand_swatches",
        "onboarding_themes", "onboarding_preview_tokens",
        "relationship_onboarding_session_modules", "relationship_onboarding_session_steps",
        "relationship_onboarding_session_fields", "onboarding_step_drafts",
        "onboarding_edit_requests", "onboarding_delivery_outbox",
    ]) assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(foundation, /source_step_id uuid/)
    assert.match(foundation, /source_field_id uuid not null/)
    assert.match(foundation, /estimated_time text/)
    assert.match(foundation, /kind in \('form', 'video', 'welcome', 'completion'\)/)
    assert.match(foundation, /source_kind in \('mandatory', 'service'\)/)
    assert.match(foundation, /No staff SELECT policy is deliberately created for onboarding_step_drafts/)
    assert.match(foundation, /Published onboarding revisions are immutable/)
    assert.match(foundation, /not exists \(select 1 from public\.workspaces where id = old\.workspace_id\)/)
    assert.match(foundation, /'authorization'.*'cookie'.*'client_secret'.*'request_body'.*'client_phone'/s)
    assert.match(foundation, /Bearer\[\[:space:\]\]\+\[A-Za-z0-9\._~\+\/=-\]\+/)
    assert.match(foundation, /\[REDACTED EMAIL\]/)
    assert.match(foundation, /\[REDACTED PHONE\]/)
    assert.match(foundation, /\[REDACTED TOKEN\]/)
    assert.match(foundation, /stripe_events_pkey primary key \(workspace_id, id\)/)
    assert.match(foundation, /client_sales_workspace_stripe_invoice_unique/)
    assert.match(foundation, /onboarding_module_revisions_workspace_id_id_unique[\s\S]+on public\.onboarding_module_revisions\(workspace_id, id\)/)
})

test("authenticated onboarding access is read-only and stable revision identities cannot be rewritten", async () => {
    const foundation = await readFile(foundationPath, "utf8")
    assert.doesNotMatch(foundation, /create policy "workspace admins manage onboarding/)
    assert.doesNotMatch(foundation, /create policy "workspace admins manage client sale/)
    assert.match(foundation, /Every write is intentionally service-role-only/)
    assert.match(foundation, /create or replace function public\.prevent_onboarding_identity_mutation/)
    assert.match(foundation, /Onboarding identity and internal code are immutable/)
    assert.match(foundation, /create trigger prevent_onboarding_module_identity_mutation/)
    assert.match(foundation, /create trigger prevent_onboarding_service_identity_mutation/)
    assert.match(foundation, /Published service assignments are immutable/)
    assert.match(foundation, /Published onboarding configuration assignments are immutable/)
    assert.match(foundation, /relationship_onboarding_sessions_relationship_workspace_fkey/)
    assert.match(foundation, /relationship_onboarding_sessions_source_sale_workspace_fkey/)
})

test("invoice freeze and paid-session creation are idempotent transactional RPCs", async () => {
    const [foundation, operations] = await Promise.all([readFile(foundationPath, "utf8"), readFile(operationsPath, "utf8")])
    assert.match(operations, /create or replace function public\.freeze_client_sale_configuration\(\s*p_workspace_id uuid,\s*p_relationship_id uuid,\s*p_actor_user_id uuid,\s*p_sale_id uuid,\s*p_correlation_id uuid/s)
    assert.match(operations, /if v_sale\.snapshot_frozen_at is not null then[\s\S]*return jsonb_build_object/)
    assert.match(operations, /billing\.invoice\.snapshot_frozen/)
    assert.match(operations, /row_number\(\) over \([\s\S]*partition by assignment\.module_id[\s\S]*item\.display_priority desc/)
    assert.match(foundation, /create or replace function public\.create_paid_onboarding_session/)
    assert.match(foundation, /source_sale_id = p_sale_id/)
    assert.match(foundation, /'created', false/)
    assert.match(foundation, /v_session_id::text \|\| ':step:' \|\| v_work_step\.id::text/)
    assert.match(foundation, /'session_id', v_session_id[\s\S]*'session_token', v_session_token[\s\S]*'composition_hash', v_composition_hash/)
})

test("all-active publishing resets only the changed module and queues side effects", async () => {
    const [foundation, operations] = await Promise.all([readFile(foundationPath, "utf8"), readFile(operationsPath, "utf8")])
    assert.match(operations, /for update of snapshot_module, session/)
    assert.match(operations, /onboarding_storage_cleanup_outbox/)
    assert.match(operations, /status = 'superseded'/)
    assert.match(operations, /delete from public\.onboarding_step_drafts/)
    assert.match(operations, /v_preceding_work_ids/)
    assert.match(operations, /v_following_work_ids/)
    assert.match(operations, /'module_revision_id', v_revision_id,[\s\S]*'definition', v_definition/)
    assert.match(operations, /requires_completion/)
    assert.match(operations, /onboarding\.link\.queued/)
    assert.match(operations, /onboarding\.module\.active_sessions_migrated/)
    assert.match(foundation, /latest_completion_migration/)
    assert.match(foundation, /composition_hash = encode\(extensions\.digest/)
})

test("outboxes reclaim crashed work and delivery failures create relationship work", async () => {
    const operations = await readFile(operationsPath, "utf8")
    for (const rpc of [
        "claim_onboarding_delivery_outbox", "finish_onboarding_delivery_outbox",
        "claim_onboarding_storage_cleanup_outbox", "finish_onboarding_storage_cleanup_outbox",
    ]) assert.match(operations, new RegExp(`create or replace function public\\.${rpc}`))
    assert.match(operations, /status = 'processing' and outbox\.locked_at < now\(\) - interval '15 minutes'/)
    assert.match(operations, /native_kind = 'onboarding_delivery_failure'/)
    assert.match(operations, /'onboarding-delivery:' \|\| v_outbox\.id::text/)
    assert.match(operations, /set status = 'done', actual_completed_at = coalesce\(actual_completed_at, now\(\)\)/)
    assert.match(operations, /least\(3600, 30 \* power/)
    assert.match(operations, /create or replace function public\.enqueue_onboarding_link_delivery/)
    assert.match(operations, /kind, destination, payload,[\s\S]*'onboarding_link'/)
    assert.match(operations, /raw_payload @> jsonb_build_object\('outbox_id', v_outbox\.id\)/)
    assert.match(operations, /set status = 'onboarding_link_sent'/)
    assert.match(operations, /set status = 'onboarding_link_failed'/)
})

test("session mutations lock tenant records and insert definitive Activity transactionally", async () => {
    const operations = await readFile(operationsPath, "utf8")
    for (const rpc of [
        "revoke_relationship_onboarding_session_token",
        "rotate_relationship_onboarding_session_token",
        "record_onboarding_edit_request",
        "complete_onboarding_session_step",
        "complete_relationship_onboarding_session",
        "archive_relationship_onboarding_session",
    ]) {
        const start = operations.indexOf(`create or replace function public.${rpc}`)
        assert.ok(start >= 0, `${rpc} is defined`)
        const body = operations.slice(start, operations.indexOf("$$;", start) + 3)
        assert.match(body, /current_user <> 'service_role'/)
        assert.match(body, /for update/)
        assert.match(body, /record_workspace_admin_activity/)
    }
    assert.match(operations, /p_form_response jsonb default null/)
    assert.match(operations, /p_uploads jsonb default '\[\]'::jsonb/)
    assert.match(operations, /v_session\.relationship_id::text \|\| '\/' \|\|[\s\S]*p_session_id::text \|\| '\/'/)
    assert.match(operations, /\(v_upload->>'size'\)::bigint <= 0/)
    assert.match(operations, /coalesce\(v_upload->>'size', ''\) !~ '\^\[0-9\]\+\$' then[\s\S]+end if;[\s\S]+if \(v_upload->>'size'\)::bigint <= 0/)
    assert.doesNotMatch(operations, /or case\s+when coalesce\(v_upload->>'size'/)
    assert.match(operations, /v_upload_native_key = any\(v_active_upload_keys\)/)
    const stepRpc = operations.slice(
        operations.indexOf("create or replace function public.complete_onboarding_session_step"),
        operations.indexOf("create or replace function public.complete_relationship_onboarding_session")
    )
    assert.doesNotMatch(stepRpc, /record_workspace_admin_activity\([\s\S]{0,1000}'response'/)
    assert.match(stepRpc, /predecessor\.status <> 'done'/)
    assert.match(stepRpc, /snapshot_step\.sort_order < v_step\.sort_order/)
})

test("published help, commercial changes, and invoice replacement use guarded RPCs", async () => {
    const operations = await readFile(operationsPath, "utf8")
    for (const rpc of [
        "save_published_onboarding_help",
        "reopen_voided_client_sale",
        "save_relationship_commercial_configuration",
    ]) assert.match(operations, new RegExp(`create or replace function public\\.${rpc}`))
    assert.match(operations, /save_published_onboarding_help[\s\S]*onboarding\.help\.published/)
    assert.match(operations, /reopen_voided_client_sale[\s\S]*stripe\.invoice\.voided_by_staff[\s\S]*stripe\.invoice\.replacement_opened/)
    assert.match(operations, /save_relationship_commercial_configuration[\s\S]*services\.relationship_assignments\.changed/)
    assert.match(operations, /v_sale\.onboarding_session_id is not null/)
    assert.match(operations, /Void and replace the sent invoice before changing services or negotiated prices/)
})

test("service archive gates ignore terminal invoices but retain live obligations", async () => {
    const [foundation, configuration] = await Promise.all([
        readFile(foundationPath, "utf8"),
        readFile("lib/onboarding/configuration.ts", "utf8"),
    ])
    assert.match(foundation, /sale\.status[\s\S]{0,220}'invoice_inactive'/)
    assert.match(foundation, /sale\.stripe_invoice_status[\s\S]{0,180}'marked_uncollectible'/)
    assert.match(configuration, /terminalSaleStatuses[\s\S]{0,240}"invoice_inactive"/)
    assert.match(configuration, /terminalSaleStatuses[\s\S]{0,240}"marked_uncollectible"/)
})

test("workspace seed translates legacy IDs and backfills frozen records without resetting progress", async () => {
    const seed = await readFile(seedPath, "utf8")
    assert.match(seed, /create or replace function public\.ensure_workspace_onboarding_seeded/)
    assert.match(seed, /create or replace function public\.onboarding_seed_uuid/)
    assert.match(seed, /create or replace function public\.backfill_workspace_onboarding_data/)
    assert.match(seed, /relationship_services_mapped/)
    assert.match(seed, /sessions_backfilled/)
    assert.match(seed, /sales_backfilled/)
    assert.match(seed, /sales_without_sessions_frozen/)
    assert.match(seed, /legacy_sale_without_session/)
    assert.match(seed, /'composition_uncertainty', true/)
    assert.doesNotMatch(seed, /if v_sale_session\.id is null then\s+continue/)
    assert.match(seed, /onboarding\.migration\.backfilled:/)
    assert.match(seed, /asset\.metadata \|\| jsonb_build_object\([\s\S]*'session_step_id'/)
    assert.doesNotMatch(seed, /delete from public\.work_items|delete from public\.assets/)
})
