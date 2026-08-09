import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"
import { maintenanceBugTitle, resolveMaintenanceError } from "../lib/admin/error-catalogue.ts"
import { okrAttainment, okrGap, okrKeyResultProgress, okrTargetMet, okrTrendScale } from "../lib/admin/okr-metrics.ts"
import { okrDisplayStatus, okrDisplayTitle } from "../lib/admin/okr-title.ts"
import { workItemPriorityLabel, workItemPriorityOptions, workItemPrioritySelectionOptions } from "../lib/work-item-priority.ts"

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

test("OKR trend scales preserve direction, reverse-progress room, zero, and target overshoot", () => {
    assert.deepEqual(okrTrendScale({ baseline: 100, target: 500, values: [100, 310], comparator: "at_least" }), { min: 0, max: 500, showZero: true })
    assert.deepEqual(okrTrendScale({ baseline: 100, target: 500, values: [100, 550], comparator: "at_least" }), { min: 0, max: 570, showZero: true })
    assert.deepEqual(okrTrendScale({ baseline: 100, target: 50, values: [100, 70], comparator: "at_most" }), { min: 50, max: 110, showZero: false })
    assert.deepEqual(okrTrendScale({ baseline: 100, target: 50, values: [100, 1], comparator: "at_most" }), { min: 0, max: 110, showZero: true })
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

test("committed OKRs move into review automatically after their deadline", () => {
    assert.equal(okrDisplayStatus({ status: "draft", deadline: "2026-08-01", today: "2026-08-06" }), "Draft")
    assert.equal(okrDisplayStatus({ status: "active", deadline: "2026-08-06", today: "2026-08-06" }), "Committed")
    assert.equal(okrDisplayStatus({ status: "active", deadline: "2026-08-05", today: "2026-08-06" }), "In review")
    assert.equal(okrDisplayStatus({ status: "completed", deadline: "2026-08-01", today: "2026-08-06" }), "Completed")
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

test("OKRs are editable drafts until Commit classifies and selectively locks them", async () => {
    const [migration, lifecycleMigration, reportingMigration, testModeMigration, actions, topBar, detail, workspace] = await Promise.all([
        readFile("supabase/migrations/20260804190000_okr_objective_types.sql", "utf8"),
        readFile("supabase/migrations/20260805090000_okr_draft_commit_and_work_links.sql", "utf8"),
        readFile("supabase/migrations/20260805130000_compact_okr_reporting.sql", "utf8"),
        readFile("supabase/migrations/20260806160000_okr_test_mode.sql", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/okrs/[okrId]/page.tsx", "utf8"),
        readFile("components/admin/OkrWorkspace.tsx", "utf8"),
    ])
    assert.match(migration, /add column if not exists objective text/)
    assert.match(migration, /set objective = title/)
    assert.match(migration, /sync_workspace_okr_system_title/)
    assert.match(migration, /objective_type in \('aspirational', 'committed'\)/)
    assert.match(lifecycleMigration, /alter column objective_type drop not null/)
    assert.match(lifecycleMigration, /new\.status = 'draft'[\s\S]*'Draft Objective: '/)
    assert.match(reportingMigration, /reporting_cadence text/)
    assert.match(reportingMigration, /reporting_started_on date/)
    assert.match(reportingMigration, /reported_on date/)
    assert.match(reportingMigration, /Choose a reporting cadence for every Key Result before committing/)
    assert.match(reportingMigration, /new\.description is distinct from old\.description/)
    assert.match(reportingMigration, /Closed OKRs are read-only/)
    assert.match(testModeMigration, /is_test boolean not null default false/)
    assert.match(testModeMigration, /Display-only Test marker/)
    assert.match(testModeMigration, /old\.status <> 'draft' and new\.is_test is distinct from old\.is_test/)
    assert.match(testModeMigration, /before update of is_test/)
    assert.match(actions, /value\(formData, "objective"\)/)
    assert.match(actions, /objective_type: null/)
    assert.match(actions, /is_test: isTest/)
    assert.match(actions, /status: "draft"/)
    assert.match(actions, /export async function updateDraftOkrKeyResultMetric/)
    assert.match(actions, /metric: "baseline_value" \| "target_value"/)
    assert.match(actions, /metric === "baseline_value" \? \{ baseline_value: metricValue \} : \{ target_value: metricValue \}/)
    assert.match(actions, /export async function commitOkr[\s\S]*status: "active", objective_type: "committed"/)
    assert.match(actions, /requireDraftOkr/)
    assert.doesNotMatch(actions, /value\(formData, "title"\)[\s\S]{0,500}workspace_okrs/)
    assert.match(topBar, /Objective<input name="objective"/)
    assert.match(topBar, />Deadline<input name="period_end"/)
    assert.doesNotMatch(topBar, /name="objective_type"/)
    assert.doesNotMatch(topBar, /name="status" defaultValue="draft"/)
    assert.match(detail, /redirect\(`\/\$\{workspace\.slug\}\/admin\?view=okrs#okr-\$\{okr\.id\}`\)/)
    assert.match(workspace, /commitOkr/)
    assert.match(workspace, /No Key Results/)
    assert.match(workspace, /ProgressRing/)
    assert.match(workspace, /Add work/)
    assert.match(workspace, /ObjectiveDetails/)
    assert.match(workspace, /DraftKeyResultForm/)
    assert.match(workspace, /updateActiveOkrDetails/)
    assert.match(workspace, /updateActiveOkrKeyResultDescription/)
})

test("KR cadence is explicit, locked at commit, and available once for legacy active KRs", async () => {
    const [migration, actions, workspace, reporting] = await Promise.all([
        readFile("supabase/migrations/20260805130000_compact_okr_reporting.sql", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
        readFile("components/admin/OkrWorkspace.tsx", "utf8"),
        readFile("lib/admin/okr-reporting.ts", "utf8"),
    ])
    assert.match(migration, /reporting_cadence in \('daily', 'weekly', 'manual'\)/)
    assert.match(migration, /set reporting_cadence = 'manual'[\s\S]*okr\.status in \('completed', 'cancelled'\)/)
    assert.match(migration, /old\.reporting_cadence is null and new\.reporting_cadence is not null[\s\S]*new\.reporting_started_on := current_date/)
    assert.match(migration, /Committed Key Result cadence is locked/)
    assert.match(actions, /reportingCadence\(formData\)/)
    assert.match(actions, /setOkrKeyResultCadence/)
    assert.match(actions, /updateActiveOkrDetails/)
    assert.match(actions, /updateActiveOkrKeyResultDescription/)
    assert.match(actions, /reported_on: reportedOn/)
    assert.match(workspace, /Choose cadence…/)
    assert.match(workspace, /This one-time choice starts accountability today and locks permanently/)
    assert.match(reporting, /buildOkrReportingDays/)
    assert.match(reporting, /startOfUtcWeek/)
})

test("the OKRs tab is a metric table with popup-only Objective and Key Result details", async () => {
    const [adminPage, workspace, search, actions] = await Promise.all([
        readFile("app/[workspaceSlug]/admin/page.tsx", "utf8"),
        readFile("components/admin/OkrWorkspace.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
    ])
    assert.match(adminPage, /<OkrWorkspace/)
    assert.match(adminPage, /objective_type !== "aspirational"/)
    assert.doesNotMatch(adminPage, /href=\{`\/\$\{workspace\.slug\}\/admin\/okrs/)
    assert.match(workspace, /OkrMetricTable/)
    assert.match(workspace, /role="table"/)
    assert.match(workspace, />Key Result</)
    assert.match(workspace, />Base</)
    assert.match(workspace, />Current</)
    assert.match(workspace, />Target</)
    assert.match(workspace, /grid-cols-\[minmax\(0,1fr\)_repeat\(2,5\.25rem\)\]/)
    assert.match(workspace, /overflow-x-hidden sm:overflow-x-auto/)
    assert.match(workspace, /hidden items-center justify-end border-l border-neutral-900 px-4 sm:flex">Base/)
    assert.match(workspace, /break-words text-\[13px\] font-medium leading-5/)
    assert.match(workspace, /okrs\.flatMap\(\(okr\)/)
    assert.match(workspace, /okr\.key_results\.map\(\(result\)/)
    assert.match(workspace, /result\.actions\.map\(\(action\)/)
    assert.match(workspace, /href=\{`\/\$\{workspaceSlug\}\/work-items\/\$\{action\.id\}`\}/)
    assert.doesNotMatch(workspace, /href=\{`\/\$\{workspaceSlug\}\/admin\/okrs/)
    assert.match(workspace, /type: "objective"/)
    assert.match(workspace, /type: "result"/)
    assert.match(workspace, /type: "add-objective"/)
    assert.match(workspace, /type: "add-result"/)
    assert.match(workspace, /type: "add-work"/)
    assert.match(workspace, /type: "measurement"/)
    assert.doesNotMatch(workspace, /toggledIds/)
    assert.match(workspace, /ObjectiveDetails/)
    assert.match(workspace, /KeyResultDetails/)
    assert.match(workspace, /AccountabilityTracker/)
    assert.match(workspace, /okrReportingPeriodIndex\(startDate, today\)/)
    assert.match(workspace, /windowStart: periodStart/)
    assert.match(workspace, /startDate=\{okr\.period_start\}/)
    assert.match(workspace, /Previous reporting period/)
    assert.match(workspace, /Next reporting period/)
    assert.match(workspace, /<linearGradient id=\{gradientId\}/)
    assert.match(workspace, /const reportsByDay = new Map/)
    assert.match(workspace, /const carryMeasurement =/)
    assert.match(workspace, /const series = \[\{ id: "carry"/)
    assert.match(workspace, /const plotRight = 490/)
    assert.match(workspace, /className="text-\[12px\] sm:text-\[9px\]"/)
    assert.match(workspace, /className="text-\[14px\] sm:text-\[10px\]"/)
    assert.doesNotMatch(workspace, /tick\.label/)
    assert.match(workspace, /const unchanged = plotted\.filter/)
    assert.match(workspace, /onPointerEnter=\{\(\) => setActiveId\(point\.id\)\}/)
    assert.match(workspace, /day\.state === "missed" \? <rect/)
    assert.match(workspace, /reportTime\(measurement\.measured_at\)/)
    assert.match(workspace, /<time dateTime=\{measurement\.measured_at\}>/)
    assert.doesNotMatch(workspace, /y1=\{y\(result\.target_value\)\}|y1=\{y\(result\.baseline_value\)\}/)
    assert.doesNotMatch(workspace, /35-day trend|trailing 35 days|Target \{formatOkrMetricValue/)
    assert.match(workspace, /draft \? "Starts" : "Started"/)
    assert.match(workspace, /name="is_test"/)
    assert.match(workspace, /<SquarePill tone="yellow">Test<\/SquarePill>/)
    assert.match(workspace, /key=\{`add-result-\$\{okr\.id\}`\}/)
    assert.match(workspace, /h-10 border-b border-neutral-800 bg-black sm:hidden/)
    assert.match(workspace, />\+<\/span> Add Key Result<\/button>/)
    assert.match(workspace, /function MetricEditor/)
    assert.match(workspace, /absolute bottom-full right-0/)
    assert.match(workspace, /draft\.length \+ 2/)
    assert.match(workspace, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/)
    assert.match(workspace, /formRef\.current\.requestSubmit\(\)/)
    assert.match(workspace, /draft === String\(value\)/)
    assert.match(workspace, /document\.addEventListener\("click", consumeClick, \{ capture: true, once: true \}\)/)
    assert.match(workspace, /clickEvent\.stopPropagation\(\)/)
    assert.doesNotMatch(workspace, /aria-label=\{`Save \$\{label\}`\}/)
    assert.match(workspace, /group min-h-12 cursor-pointer/)
    assert.match(workspace, /px-3 py-1\.5 pl-4/)
    assert.match(workspace, /updateDraftOkrKeyResultMetric\.bind/)
    assert.match(workspace, /addOkrMeasurement\.bind/)
    assert.match(workspace, /name="reported_on" value=\{today\}/)
    assert.match(workspace, /selectedReports\.map\(\(measurement\)/)
    assert.match(workspace, /size="compact"/)
    assert.match(workspace, />Recorded</)
    assert.match(workspace, />Notes</)
    assert.match(workspace, /touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain/)
    assert.match(workspace, /grid-cols-\[minmax\(0,1fr\)_repeat\(2,5rem\)\]/)
    assert.match(workspace, /hidden sm:block/)
    assert.doesNotMatch(workspace, /overflow-x-auto rounded-lg/)
    assert.match(workspace, /TrendChart/)
    assert.match(workspace, /okrDisplayStatus/)
    assert.match(workspace, /Add Objective/)
    assert.match(workspace, /Add Key Result/)
    assert.match(workspace, /Added \{formatRelativeTime\(action\.created_at\)\}/)
    assert.doesNotMatch(workspace, />Draft<\/SquarePill>/)
    assert.match(search, /admin\?view=okrs#okr-/)
    assert.match(search, /admin\?view=okrs#key-result-/)
    assert.match(actions, /return \{ ok: true, href: okrsHref\(slug, `okr-\$\{okr\.id\}`\) \}/)
})

test("work-item Links combine relationships and committed Key Results", async () => {
    const [migration, priorityMigration, fields, actions, page] = await Promise.all([
        readFile("supabase/migrations/20260805090000_okr_draft_commit_and_work_links.sql", "utf8"),
        readFile("supabase/migrations/20260809120000_admin_work_priority_queue.sql", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
    ])
    assert.match(migration, /OKR work links must stay inside one workspace/)
    assert.doesNotMatch(migration, /area = 'admin'[\s\S]*visibility = 'admins_only'/)
    assert.match(priorityMigration, /expected_movement numeric/)
    assert.match(priorityMigration, /impact_hypothesis text/)
    assert.match(priorityMigration, /workspace_okr_work_items_expected_movement_check[\s\S]*not valid/)
    assert.match(priorityMigration, /workspace_okr_work_items_impact_hypothesis_check[\s\S]*not valid/)
    assert.match(priorityMigration, /new\.expected_movement is null or new\.expected_movement <= 0/)
    assert.match(priorityMigration, /never updates actual measurements/)
    assert.match(fields, /Field label="Links"/)
    assert.match(fields, /Committed Key Results/)
    assert.match(fields, /Expected movement/)
    assert.match(fields, /Impact hypothesis/)
    assert.match(fields, /<RoundPill tone="sky">\{result\.code\}<\/RoundPill>/)
    assert.match(actions, /export async function updateWorkItemLinks/)
    assert.match(actions, /Work can only be linked to committed Key Results/)
    assert.match(page, /listActiveWorkspaceKeyResults/)
    assert.match(page, /`KR-\$\{shortId\(result\.id\)\}`/)
})

test("manual work priorities use time-horizon language", () => {
    assert.deepEqual(workItemPriorityOptions.map((option) => option.label), ["Must do now", "Can be done tomorrow", "Can be done this week", "Backlog"])
    assert.equal(workItemPrioritySelectionOptions[0].label, "System generated")
    assert.equal(workItemPriorityLabel(1), "Must do now")
    assert.equal(workItemPriorityLabel(5), "Backlog")
})

test("manual priority overrides are nullable and independent from the system seed", async () => {
    const [migration, actions, fields] = await Promise.all([
        readFile("supabase/migrations/20260809140000_work_item_priority_overrides.sql", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
    ])
    assert.match(migration, /add column if not exists priority_override integer/)
    assert.match(migration, /priority_override is null or priority_override between 1 and 4/)
    assert.match(actions, /update\(\{ priority_override: priorityOverride \}\)/)
    assert.match(fields, /System generated lets the queue decide/)
})

test("KR-linked work requires one execution owner while collaborators remain separate", async () => {
    const [migration, adminActions, workActions, fields, queue] = await Promise.all([
        readFile("supabase/migrations/20260809150000_multi_owner_admin_queue.sql", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("components/admin/AdminWorkQueue.tsx", "utf8"),
    ])
    assert.match(migration, /add column if not exists execution_owner_id uuid/)
    assert.match(migration, /KR-linked work requires an execution owner/)
    assert.match(migration, /validate_okr_work_execution_owner/)
    assert.match(adminActions, /execution_owner_id: executionOwnerId/)
    assert.match(adminActions, /Choose an execution owner for this work item before linking/)
    assert.match(workActions, /keyResultLinkCount && !executionOwnerId/)
    assert.match(fields, /execution owner drives completion forecasts/)
    assert.match(queue, /Business/)
    assert.match(queue, /My work/)
})

test("the one-time OKR reset is exact, idempotent, and fails closed around repurposed work", async () => {
    const [migration, finalization] = await Promise.all([
        readFile("supabase/migrations/20260809130000_clear_existing_okr_test_data.sql", "utf8"),
        readFile("supabase/migrations/20260809131000_finalize_okr_work_estimates.sql", "utf8"),
    ])
    assert.match(migration, /Fixed IDs make this migration idempotent/)
    assert.equal((migration.match(/::uuid/g) ?? []).length, 5)
    assert.match(migration, /additional linked work; review the reset migration/)
    assert.match(migration, /item\.area is distinct from 'admin' or item\.kind is distinct from 'okr_action' or item\.visibility is distinct from 'admins_only'/)
    assert.match(migration, /work_item_relationships/)
    assert.match(migration, /asset_work_items/)
    assert.match(migration, /disable trigger enforce_draft_okr_key_result_definition/)
    assert.equal((migration.match(/enable trigger enforce_draft_okr_key_result_definition/g) ?? []).length, 2)
    assert.match(migration, /exception when others then[\s\S]*enable trigger enforce_draft_okr_key_result_definition[\s\S]*raise;/)
    assert.ok(migration.indexOf("delete from public.workspace_okrs") < migration.indexOf("delete from public.work_items"))
    assert.match(migration, /Key Results, measurements, and OKR-work links cascade from the OKRs/)
    assert.doesNotMatch(migration, /delete from public\.workspace_okrs\s*;/)
    assert.doesNotMatch(migration, /delete from public\.work_items\s*;/)
    assert.match(finalization, /validate constraint workspace_okr_work_items_expected_movement_check/)
    assert.match(finalization, /validate constraint workspace_okr_work_items_impact_hypothesis_check/)
    assert.match(finalization, /alter column expected_movement set not null/)
    assert.match(finalization, /alter column impact_hypothesis set not null/)
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

test("Admin Work and Maintenance keep compact list rows while OKRs use the unified workspace", async () => {
    const [adminPage, workQueue, navigation, maintenancePage, detail, actions] = await Promise.all([
        readFile("app/[workspaceSlug]/admin/page.tsx", "utf8"),
        readFile("components/admin/AdminWorkQueue.tsx", "utf8"),
        readFile("components/admin/AdminPanelNav.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/maintenance/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/admin/actions.ts", "utf8"),
    ])
    assert.match(navigation, /key: "work", label: "Work"/)
    assert.doesNotMatch(navigation, /Overview/)
    assert.match(adminPage, /listAdminWorkItems/)
    assert.match(adminPage, /OkrWorkspace/)
    assert.match(adminPage, /okrAttention/)
    assert.match(workQueue, /Work queue/)
    assert.match(workQueue, /overflow-hidden rounded-2xl border/)
    assert.match(workQueue, /System priority/)
    assert.match(workQueue, /Manual override/)
    assert.match(workQueue, /Work item completed/)
    assert.doesNotMatch(workQueue, /Completed and canceled/)
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
