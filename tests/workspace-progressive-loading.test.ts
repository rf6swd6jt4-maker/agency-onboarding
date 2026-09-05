import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { workspaceRouteUsesSharedBanner } from "../lib/workspace-panel-chrome.ts"

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

test("workspace panel homes share one persistent banner inside their tab frame", () => {
    const layout = source("app/[workspaceSlug]/layout.tsx")
    const chrome = source("components/workspace/WorkspacePanelChrome.tsx")
    assert.match(layout, /workspaceTabIdFromUrl/)
    assert.match(layout, /<WorkspacePanelChrome/)
    assert.match(chrome, /workspaceRouteUsesSharedBanner\(pathname\)/)

    for (const pathname of [
        "/agency/admin",
        "/agency/admin/activity/event-id",
        "/agency/admin/maintenance",
        "/agency/appointment-setting",
        "/agency/assets",
        "/agency/leadgen",
        "/agency/leadgen/polls",
        "/agency/onboarding",
        "/agency/relationships",
        "/agency/work",
        "/agency/work-items",
    ]) assert.equal(workspaceRouteUsesSharedBanner(pathname), true, `${pathname} should retain the shared banner`)

    for (const pathname of [
        "/agency/communications",
        "/agency/settings",
        "/agency/relationships/relationship-id",
        "/agency/work-items/work-item-id",
        "/agency/assets/asset-id",
        "/agency/admin/okrs/okr-id",
        "/agency/leadgen/new",
        "/agency/leadgen/poll/poll-id",
    ]) assert.equal(workspaceRouteUsesSharedBanner(pathname), false, `${pathname} should keep its route-specific layout`)

    for (const path of [
        "app/[workspaceSlug]/admin/page.tsx",
        "app/[workspaceSlug]/appointment-setting/page.tsx",
        "app/[workspaceSlug]/assets/page.tsx",
        "app/[workspaceSlug]/leadgen/page.tsx",
        "app/[workspaceSlug]/onboarding/page.tsx",
        "app/[workspaceSlug]/relationships/page.tsx",
        "app/[workspaceSlug]/work/page.tsx",
        "app/[workspaceSlug]/work-items/page.tsx",
    ]) assert.doesNotMatch(source(path), /WorkspaceBanner/, `${path} must not rebuild shared banner chrome`)
})

test("route loading UI reflects each panel's real composition", () => {
    const loading = source("components/workspace/PanelRouteLoading.tsx")
    assert.match(loading, /function CommunicationsLoading/)
    assert.match(loading, /lg:grid-cols-\[22rem_minmax\(0,1fr\)\]/)
    assert.match(loading, /function AssetsLoading/)
    assert.match(loading, /aspect-\[4\/3\]/)
    assert.match(loading, /function RelationshipsLoading/)
    assert.match(loading, /function OnboardingLoading/)
    assert.match(loading, /function SettingsLoading/)

    const variants = {
        admin: "admin",
        "appointment-setting": "appointment-setting",
        assets: "assets",
        communications: "communications",
        leadgen: "leadgen",
        onboarding: "onboarding",
        relationships: "relationships",
        settings: "settings",
        work: "fulfilment",
        "work-items": "work-items",
    }
    for (const [route, variant] of Object.entries(variants)) {
        assert.match(source(`app/[workspaceSlug]/${route}/loading.tsx`), new RegExp(`variant=\\"${variant}\\"`), `${route} needs its own loading composition`)
    }

    const nestedVariants = {
        "admin/activity": "admin-activity",
        "admin/maintenance": "admin-maintenance",
        "leadgen/polls": "leadgen-polls",
        "admin/activity/[eventId]": "detail",
        "admin/okrs/[okrId]": "detail",
        "appointment-setting/[relationshipId]": "detail",
        "assets/[id]": "detail",
        "leadgen/new": "detail",
        "leadgen/poll/[pollId]": "detail",
        "onboarding/[relationshipId]": "detail",
        "work/[relationshipId]": "detail",
        "work-items/[id]": "detail",
    }
    for (const [route, variant] of Object.entries(nestedVariants)) {
        assert.match(source(`app/[workspaceSlug]/${route}/loading.tsx`), new RegExp(`variant=\\"${variant}\\"`), `${route} needs a route-shaped loading composition`)
    }
})
