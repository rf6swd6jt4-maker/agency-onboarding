import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("workspace tabs warm likely destinations and reveal streamed frames at the bridge handshake", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")

    assert.match(shell, /tabWarmTimeoutRef/)
    assert.match(shell, /setTimeout\(\(\) => \{[\s\S]*warmWorkspaceTab\(tabId\)[\s\S]*\}, 120\)/)
    assert.match(shell, /message\.type === "location"[\s\S]*markTabFrameReady\(message\.tabId\)/)
    assert.match(bridge, /startRefreshTransition\(\(\) => router\.refresh\(\)\)/)
    assert.doesNotMatch(bridge, /window\.location\.reload\(\)/)
})

test("heavy panel homes stream their useful core before secondary metadata", () => {
    const relationships = source("app/[workspaceSlug]/relationships/page.tsx")
    const onboarding = source("app/[workspaceSlug]/onboarding/page.tsx")
    const settings = source("app/[workspaceSlug]/settings/page.tsx")

    assert.match(relationships, /<Suspense fallback=\{<RelationshipsPanelFallback \/>\}>/)
    assert.match(relationships, /<Suspense fallback=\{<RelationshipSecondaryFallback \/>\}>/)
    assert.match(onboarding, /<Suspense fallback=\{<OnboardingPanelFallback \/>\}>/)
    assert.match(onboarding, /\.in\("metadata->>session_id", sessionIds\)/)
    for (const section of ["ServicesSettingsSection", "OnboardingSettingsSection", "AgencyBrandingSettingsSection", "ConnectionsSettingsSection", "UsersSettingsSection", "TeamsSettingsSection", "LeadgenSettingsSection"]) {
        assert.match(settings, new RegExp(`<Suspense[^>]*>[\\s\\S]*?<${section}`, "u"), `${section} must keep an independent loading boundary`)
    }
})

test("relationship detail loading is read-scaled and repairs workflow only when missing", () => {
    const page = source("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx")
    const gantt = source("lib/relationship-gantt.ts")

    assert.match(page, /if \(!workflowStageExists/)
    assert.match(page, /const planPromise = loadRelationshipPlan/)
    assert.match(page, /<Suspense fallback=\{<RelationshipWorkspaceFallback \/>\}>/)
    assert.match(gantt, /\.eq\("relationship_id", relationship\.id\)/)
    assert.match(gantt, /\.in\("work_item_id", batch\)/)
    assert.match(gantt, /\.in\("parent_work_item_id", batch\)/)
    assert.doesNotMatch(gantt, /from\("work_item_assignees"\)\.select\("work_item_id, user_id"\)\.eq\("workspace_id", relationship\.workspace_id\)\s*[,)]/)
})

test("panel routes have instant fallbacks and shared lists defer off-screen paint", () => {
    const list = source("components/list/List.tsx")
    assert.match(list, /\[content-visibility:auto\]/)
    assert.match(list, /\[contain-intrinsic-size:auto_88px\]/)

    for (const route of ["admin", "appointment-setting", "assets", "communications", "leadgen", "onboarding", "relationships", "settings", "work", "work-items"]) {
        assert.equal(existsSync(new URL(`../app/[workspaceSlug]/${route}/loading.tsx`, import.meta.url)), true, `${route} needs a route loading boundary`)
    }
    assert.equal(existsSync(new URL("../app/[workspaceSlug]/relationships/[relationshipId]/loading.tsx", import.meta.url)), true)
})
