import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"
import { maintenanceBugTitle, resolveMaintenanceError } from "../lib/admin/error-catalogue.ts"
import { okrAttainment, okrGap, okrKeyResultProgress, okrTargetMet } from "../lib/admin/okr-metrics.ts"
import { okrDisplayTitle } from "../lib/admin/okr-title.ts"
import { workItemPriorityLabel, workItemPriorityOptions } from "../lib/work-item-priority.ts"

test("OKR progress moves from baseline to target and clamps to 0-100", () => {
    assert.equal(okrKeyResultProgress({ baseline: 100, target: 300, current: 100 }), 0)
    assert.equal(okrKeyResultProgress({ baseline: 100, target: 300, current: 200 }), 50)
    assert.equal(okrKeyResultProgress({ baseline: 100, target: 300, current: 400 }), 100)
    assert.equal(okrKeyResultProgress({ baseline: 10, target: 5, current: 7.5 }), 50)
    assert.equal(okrKeyResultProgress({ baseline: 10, target: 5, current: 4 }), 100)
})

test("at-least and at-most targets calculate target state and remaining gap", () => {
    assert.equal(okrTargetMet("at_least", 65, 65), true)
    assert.equal(okrTargetMet("at_least", 60, 65), false)
    assert.equal(okrGap("at_least", 60, 65), 5)
    assert.equal(okrTargetMet("at_most", 5, 5), true)
    assert.equal(okrTargetMet("at_most", 7, 5), false)
    assert.equal(okrGap("at_most", 7, 5), 2)
})

test("overall attainment is an equal-weight average", () => {
    assert.equal(okrAttainment([]), 0)
    assert.equal(okrAttainment([100, 50, 0]), 50)
})

test("OKR names are system-generated from type, objective, and deadline", () => {
    assert.equal(okrDisplayTitle({ objectiveType: null, objective: "Agree the sales plan", deadline: "2026-09-30" }), "Draft Objective: Agree the sales plan by 30 Sept 2026")
    assert.equal(okrDisplayTitle({ objectiveType: "committed", objective: "Reach product-market fit", deadline: "2026-12-31" }), "Committed Objective: Reach product-market fit by 31 Dec 2026")
    assert.equal(okrDisplayTitle({ objectiveType: "aspirational", objective: "Become the category leader", deadline: "2027-03-01" }), "Aspirational Objective: Become the category leader by 1 Mar 2027")
})

test("Admin persistence is additive, private, append-only, and concurrency-safe", async () => {
    const migration = await readFile("supabase/migrations/20260804110000_admin_okr_maintenance.sql", "utf8")
    assert.match(migration, /visibility text not null default 'workspace'/)
    assert.match(migration, /alter column lifecycle_phase drop not null/)
    assert.match(migration, /'onboarding', 'onboarding_review', 'fulfilment'/)
    assert.doesNotMatch(migration, /'onboarding_complete'/)
    assert.match(migration, /workspace admins append okr measurements/)
    assert.doesNotMatch(migration, /workspace admins manage okr measurements/)
    assert.match(migration, /work_items_open_failure_fingerprint_unique/)
    assert.match(migration, /upsert_platform_failure_work_item/)
    assert.match(migration, /occurrence_count = public\.work_items\.occurrence_count \+ 1/)
    assert.match(migration, /workspace_members_can_read_work_item_relationships/)
})

test("OKRs are editable drafts until Commit classifies and locks them", async () => {
    const [migration, lifecycleMigration, actions, topBar, detail, detailClient] = await Promise.all([
        readFile("supabase/migrations/20260804190000_okr_objective_types.sql", "utf8"),
        readFile("supabase/migrations/20260805090000_okr_draft_commit_and_work_links.sql", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/okrs/[okrId]/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/okrs/[okrId]/OkrDetailClient.tsx", "utf8"),
    ])
    assert.match(migration, /add column if not exists objective text/)
    assert.match(migration, /set objective = title/)
    assert.match(migration, /sync_workspace_okr_system_title/)
    assert.match(migration, /objective_type in \('aspirational', 'committed'\)/)
    assert.match(lifecycleMigration, /alter column objective_type drop not null/)
    assert.match(lifecycleMigration, /new\.status = 'draft'[\s\S]*'Draft Objective: '/)
    assert.match(actions, /value\(formData, "objective"\)/)
    assert.match(actions, /objective_type: null/)
    assert.match(actions, /status: "draft"/)
    assert.match(actions, /export async function commitOkr[\s\S]*status: "active", objective_type: "committed"/)
    assert.match(actions, /requireDraftOkr/)
    assert.doesNotMatch(actions, /value\(formData, "title"\)[\s\S]{0,500}workspace_okrs/)
    assert.match(topBar, /Objective<input name="objective"/)
    assert.match(topBar, />Deadline<input name="period_end"/)
    assert.doesNotMatch(topBar, /name="objective_type"/)
    assert.doesNotMatch(topBar, /name="status" defaultValue="draft"/)
    assert.doesNotMatch(detail, /AdminPanelNav|WorkspaceBanner|Back to OKRs/)
    assert.match(detail, /OKR \{shortId\(okr\.id\)\}/)
    assert.match(detail, /okrDisplayTitle/)
    assert.match(detailClient, /Commit OKR/)
    assert.match(detailClient, /No Key Results/)
    assert.match(detailClient, /ProgressRing/)
    assert.match(detailClient, /Add work item/)
})

test("work-item Links combine relationships and committed Key Results", async () => {
    const [migration, fields, actions, page] = await Promise.all([
        readFile("supabase/migrations/20260805090000_okr_draft_commit_and_work_links.sql", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
    ])
    assert.match(migration, /OKR work links must stay inside one workspace/)
    assert.doesNotMatch(migration, /area = 'admin'[\s\S]*visibility = 'admins_only'/)
    assert.match(fields, /Field label="Links"/)
    assert.match(fields, /Committed Key Results/)
    assert.match(fields, /<RoundPill tone="sky">\{result\.code\}<\/RoundPill>/)
    assert.match(actions, /export async function updateWorkItemLinks/)
    assert.match(actions, /Work can only be linked to committed Key Results/)
    assert.match(page, /listActiveWorkspaceKeyResults/)
    assert.match(page, /`KR-\$\{shortId\(result\.id\)\}`/)
})

test("manual work priorities use time-horizon language", () => {
    assert.deepEqual(workItemPriorityOptions.map((option) => option.label), ["Must do now", "Can be done tomorrow", "Can be done this week", "Backlog"])
    assert.equal(workItemPriorityLabel(1), "Must do now")
    assert.equal(workItemPriorityLabel(5), "Backlog")
})

test("service-role query paths explicitly exclude private work for Staff surfaces", async () => {
    const [relationships, topBar, search, detail] = await Promise.all([
        readFile("lib/relationships.ts", "utf8"),
        readFile("components/workspace/WorkspaceTopBar.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
    ])
    assert.match(relationships, /\.eq\("visibility", "workspace"\)/)
    assert.match(topBar, /\.eq\("visibility", "workspace"\)/)
    assert.match(search, /canAccessPrivatePanels[\s\S]*\.eq\("visibility", "admins_only"\)[\s\S]*Promise\.resolve\(\{ data: \[\], error: null \}\)/)
    assert.match(search, /\.eq\("visibility", "workspace"\)/)
    assert.match(detail, /item\.visibility === "admins_only" && role === "staff"/)
})

test("maintenance is event-driven and logs to console before creating Work Items", async () => {
    const [maintenance, migration] = await Promise.all([
        readFile("lib/admin/maintenance.ts", "utf8"),
        readFile("supabase/migrations/20260804180000_coded_admin_work_items.sql", "utf8"),
    ])
    assert.ok(maintenance.indexOf('console.error("Platform automation failure"') < maintenance.indexOf('supabaseAdmin.rpc("upsert_platform_failure_work_item"'))
    assert.match(maintenance, /resolveMaintenanceError/)
    assert.match(migration, /format\('Bug: %s - %s'/)
    assert.match(migration, /'Admin work: ' \|\| p_summary/)
    await assert.rejects(access("vercel.json"))
    await assert.rejects(access("app/api/admin/maintenance/monitor/route.ts"))
})

test("maintenance errors use stable catalogue codes with specific and broad fallbacks", () => {
    assert.equal(maintenanceBugTitle(resolveMaintenanceError({ category: "communications", source: "client_sales", operation: "send_consent_template", diagnostics: { error: "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME" } })), "Bug: BGE-4101 - WhatsApp consent template not configured")
    assert.equal(resolveMaintenanceError({ category: "communications", source: "client_sales", operation: "send_consent_template", diagnostics: { error: "OAuth token expired" } }).code, "BGE-4103")
    assert.equal(resolveMaintenanceError({ category: "system_health", source: "next_error_boundary", operation: "app", diagnostics: { error: "column status does not exist; migration missing" } }).code, "BGE-6201")
    assert.equal(resolveMaintenanceError({ category: "integrations", source: "future_provider", operation: "unknown" }).code, "BGE-9005")
})

test("Admin Work, OKRs, and Maintenance use compact list rows", async () => {
    const [adminPage, navigation, maintenancePage, detail, actions] = await Promise.all([
        readFile("app/[workspaceSlug]/admin/page.tsx", "utf8"),
        readFile("components/admin/AdminPanelNav.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/maintenance/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
    ])
    assert.match(navigation, /key: "work", label: "Work"/)
    assert.doesNotMatch(navigation, /Overview/)
    assert.match(adminPage, /listAdminWorkItems/)
    assert.match(adminPage, /overflow-hidden rounded-2xl border/)
    assert.doesNotMatch(adminPage, /md:grid-cols-2 xl:grid-cols-3/)
    assert.doesNotMatch(maintenancePage, /diagnosticSummary|failure_fingerprint|line-clamp-2/)
    assert.match(maintenancePage, /occurrence/)
    assert.doesNotMatch(detail, /Private Admin work/)
    assert.match(detail, /<SquarePill[^>]*>Admin<\/SquarePill>/)
    assert.match(actions, /description: `Admin work: \$\{description \|\| title\}`/)
})

test("the private activity console covers core automation producers", async () => {
    const [migration, activityPage, leadgen, onboarding, stripe, whatsapp, gantt] = await Promise.all([
        readFile("supabase/migrations/20260804123000_admin_activity_console.sql", "utf8"),
        readFile("app/[workspaceSlug]/admin/activity/page.tsx", "utf8"),
        readFile("lib/leadgen/osm-worker.ts", "utf8"),
        readFile("lib/onboarding/canonical.ts", "utf8"),
        readFile("app/api/stripe/webhook/route.ts", "utf8"),
        readFile("lib/client-messages/clickup-bridge.ts", "utf8"),
        readFile("app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts", "utf8"),
    ])
    assert.ok(migration.indexOf('drop policy if exists "workspace admins read activity console"') < migration.indexOf('create policy "workspace admins read activity console"'))
    assert.match(migration, /workspace admins read activity console/)
    assert.match(activityPage, /Activity Console/)
    for (const source of [leadgen, onboarding, stripe, whatsapp, gantt]) assert.match(source, /recordAdminActivity|recordClientAdminActivity/)
})

test("Create OKR uses the shared shell modal and is never preloaded for Staff", async () => {
    const [adminPage, topBar, topBarClient, actions] = await Promise.all([
        readFile("app/[workspaceSlug]/admin/page.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBar.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
    ])
    assert.doesNotMatch(adminPage, /Private workspace operations/)
    assert.doesNotMatch(adminPage, /action=\{createOkr/)
    assert.match(topBar, /workspaceRole === "owner" \|\| workspaceRole === "admin"[\s\S]*: \{ data: \[\] \}/)
    assert.match(topBarClient, /\{canCreateOkr && <button/)
    assert.match(topBarClient, /openCreate\("okr"\)/)
    assert.ok(topBarClient.indexOf('openCreate("asset")') < topBarClient.indexOf('openCreate("okr")'))
    assert.match(actions, /createOkrFromModal[\s\S]*reportPlatformFailure[\s\S]*failure has been recorded for Admin review/)
})

test("workspace error screens report authenticated incidents to maintenance and Admin Activity", async () => {
    const [errorPage, globalError, reporter, endpoint] = await Promise.all([
        readFile("app/error.tsx", "utf8"),
        readFile("app/global-error.tsx", "utf8"),
        readFile("components/errors/ErrorBoundaryReporter.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/activity/errors/route.ts", "utf8"),
    ])
    assert.match(errorPage, /ErrorBoundaryReporter/)
    assert.match(globalError, /ErrorBoundaryReporter/)
    assert.ok(reporter.indexOf("console.error(error)") < reporter.indexOf("fetch("))
    assert.match(endpoint, /requireWorkspace\(workspaceSlug\)/)
    assert.match(endpoint, /reportPlatformFailure/)
})

test("global officer overrides category routing while preserving category fallbacks", async () => {
    const [migration, triggerFix, maintenance, settings, officerSettings, settingsActions, maintenancePage, adminPage] = await Promise.all([
        readFile("supabase/migrations/20260804160000_global_maintenance_officer.sql", "utf8"),
        readFile("supabase/migrations/20260804170000_fix_admin_officer_validation.sql", "utf8"),
        readFile("lib/admin/maintenance.ts", "utf8"),
        readFile("app/[workspaceSlug]/settings/page.tsx", "utf8"),
        readFile("components/admin/WorkspaceOfficerSettings.tsx", "utf8"),
        readFile("app/[workspaceSlug]/settings/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/admin/maintenance/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/page.tsx", "utf8"),
    ])
    assert.match(migration, /'global'.*'leadgen'/s)
    assert.match(triggerFix, /to_jsonb\(new\)->>'owner_user_id'/)
    assert.match(triggerFix, /to_jsonb\(new\)->>'responsible_user_id'/)
    assert.doesNotMatch(triggerFix, /new\.owner_user_id|new\.responsible_user_id/)
    assert.ok(maintenance.indexOf('route.category === "global"') < maintenance.indexOf("route.category === category"))
    assert.match(settings, /id="officers"/)
    assert.match(settings, /key=\{`\$\{officerRoutes\.get\("global"\)/)
    assert.match(officerSettings, /The category choices below stay saved and resume automatically/)
    assert.match(officerSettings, /value=\{globalOfficer\}/)
    assert.match(officerSettings, /value=\{categoryOfficers\[category\.key\]/)
    assert.doesNotMatch(officerSettings, /defaultValue=/)
    assert.match(settingsActions, /MAINTENANCE_ROUTE_KEYS/)
    assert.match(settingsActions, /reportPlatformFailure/)
    assert.match(settingsActions, /source: "settings_officers"/)
    assert.doesNotMatch(maintenancePage, /Save routing|saveMaintenanceRouting/)
    assert.match(adminPage, /listAdminWorkItems/)
})

test("Settings and search expose one Lead Gen section without duplicate group headings", async () => {
    const [settings, search, shell] = await Promise.all([
        readFile("app/[workspaceSlug]/settings/page.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
    ])
    assert.match(settings, /\{ id: "leadgen", label: "Lead Gen"/)
    assert.doesNotMatch(settings, /\{ id: "leadgen-automation", label:/)
    assert.doesNotMatch(settings, /title="Lead Gen Automation"|title="Lead Gen Targeting"|title="Lead Gen Sources"/)
    assert.match(search, /settings-officers/)
    assert.match(search, /settings-leadgen".*label: "Lead Gen"/)
    assert.match(search, /\$\{settingsPath\} > Lead Gen > Poll Automation/)
    assert.match(shell, /settings#officers/)
    assert.match(shell, /settings#leadgen/)
})
