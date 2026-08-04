import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import test from "node:test"
import { okrAttainment, okrGap, okrKeyResultProgress, okrTargetMet } from "../lib/admin/okr-metrics.ts"

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
    const maintenance = await readFile("lib/admin/maintenance.ts", "utf8")
    assert.ok(maintenance.indexOf('console.error("Platform automation failure"') < maintenance.indexOf('supabaseAdmin.rpc("upsert_platform_failure_work_item"'))
    await assert.rejects(access("vercel.json"))
    await assert.rejects(access("app/api/admin/maintenance/monitor/route.ts"))
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
    assert.match(migration, /workspace admins read activity console/)
    assert.match(activityPage, /Activity Console/)
    for (const source of [leadgen, onboarding, stripe, whatsapp, gantt]) assert.match(source, /recordAdminActivity|recordClientAdminActivity/)
})
