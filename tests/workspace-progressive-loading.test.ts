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
    assert.match(shell, /setTimeout\(\(\) => \{[\s\S]*warmWorkspaceTab\(tabId\)[\s\S]*\}, 60\)/)
    assert.match(shell, /message\.type === "location"[\s\S]*markTabFrameReady\(message\.tabId\)/)
    assert.match(bridge, /startRefreshTransition\(\(\) => router\.refresh\(\)\)/)
    assert.doesNotMatch(bridge, /window\.location\.reload\(\)/)
})

test("complete in-memory lists filter through native history without a server navigation", () => {
    const rail = source("components/panel/FilterRail.tsx")
    const results = source("components/panel/InstantFilterResults.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")

    assert.match(rail, /window\.history\.pushState/)
    assert.match(rail, /data-workspace-instant-filter/)
    assert.match(results, /useSearchParams\(\)/)
    assert.match(bridge, /hasAttribute\("data-workspace-instant-filter"\)\) return/)
    for (const path of [
        "app/[workspaceSlug]/relationships/page.tsx",
        "app/[workspaceSlug]/work-items/page.tsx",
        "app/[workspaceSlug]/work/page.tsx",
        "app/[workspaceSlug]/admin/maintenance/page.tsx",
        "app/[workspaceSlug]/onboarding/page.tsx",
    ]) assert.match(source(path), /<InstantFilterResults/, path)
})

test("panel tabs prefetch their exact frame route and detail tabs reuse list identity while loading", () => {
    const tabs = source("components/panel/PanelTabs.tsx")
    const list = source("components/list/List.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const loading = source("components/workspace/DetailRouteLoading.tsx")

    assert.match(tabs, /workspaceTabFrameUrl\(item\.href, tabId/)
    assert.match(tabs, /router\.prefetch\(item\.navigationHref\)/)
    assert.match(list, /data-workspace-detail-preview/)
    assert.match(bridge, /detailPreview: detailPreview \?\? undefined/)
    assert.match(shell, /<WorkspaceTabOpeningState[^>]*detailPreview=\{activeTab\.detailPreview\}/)
    assert.match(loading, /readWorkspaceDetailPreview\(window\.location\.pathname\)/)
    assert.match(loading, /<DetailFieldsLoading label=\{`Loading \$\{title\} details`\} \/>/)
    assert.doesNotMatch(loading, /animate-pulse/)
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

test("relationship detail streams fields before the independently loaded timeline", () => {
    const page = source("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx")
    const workspace = source("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipDealWorkspace.tsx")
    const gantt = source("lib/relationship-gantt.ts")
    const configuration = source("lib/onboarding/configuration.ts")

    assert.match(page, /const planPromise = getRelationshipGanttPlan/)
    assert.doesNotMatch(page, /ensureCurrentRelationshipStage/)
    assert.match(page, /<Suspense fallback=\{<DetailFieldsLoading label="Loading relationship details" rows=\{8\} \/>\}>/)
    assert.match(workspace, /use\(planPromise\)/)
    assert.match(workspace, /<DetailContentLoading label="Loading relationship timeline"/)
    assert.match(configuration, /rawConfiguration\(workspaceId, false\)/)
    assert.match(gantt, /\.eq\("relationship_id", relationship\.id\)/)
    assert.match(gantt, /\.in\("work_item_id", batch\)/)
    assert.match(gantt, /\.in\("parent_work_item_id", batch\)/)
    assert.doesNotMatch(gantt, /from\("work_item_assignees"\)\.select\("work_item_id, user_id"\)\.eq\("workspace_id", relationship\.workspace_id\)\s*[,)]/)
})

test("detail bootstrap queries share access reads and defer editor-only choices", () => {
    const access = source("lib/workspace-access.ts")
    const onboarding = source("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx")
    const workItem = source("app/[workspaceSlug]/work-items/[id]/page.tsx")
    const workItemFields = source("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx")
    const editorOptions = source("app/api/workspaces/[workspaceSlug]/work-items/[id]/editor-options/route.ts")

    assert.match(access, /const loadRelationshipScope = cache/)
    assert.match(access, /const loadWorkItemAccessRows = cache/)
    assert.match(onboarding, /const normalizedSnapshotPromise/)
    assert.match(onboarding, /const serviceRevisionsPromise/)
    assert.match(onboarding, /const summaryPromise = Promise\.all/)
    assert.match(onboarding, /const activityPromise = Promise\.all/)
    assert.match(onboarding, /<DetailFieldsLoading label="Loading onboarding details"/)
    assert.match(onboarding, /<DetailContentLoading label="Loading onboarding activity"/)
    assert.match(workItem, /includeAvailableWorkItems: false/)
    assert.match(workItem, /editorOptionsHref=/)
    assert.match(workItemFields, /fetch\(props\.editorOptionsHref/)
    assert.match(editorOptions, /listWorkItemEditorCandidates/)
    assert.match(editorOptions, /"Cache-Control": "private, no-store"/)
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
        "/agency/admin/okrs",
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
    const currentLoading = source("components/workspace/CurrentPanelRouteLoading.tsx")
    const opening = source("components/workspace/WorkspaceTabOpeningState.tsx")
    assert.match(loading, /function CommunicationsLoading/)
    assert.match(loading, /lg:grid-cols-\[22rem_minmax\(0,1fr\)\]/)
    assert.match(loading, /function AssetsLoading/)
    assert.match(loading, /aspect-\[4\/3\]/)
    assert.match(loading, /function RelationshipsLoading/)
    assert.match(loading, /function OnboardingLoading/)
    assert.match(loading, /function SettingsLoading/)
    assert.match(loading, /function OkrTableSkeleton/)
    assert.match(loading, /tabs=\{\["Work", "OKRs", "Maintenance", "Activity"\]\} activeTab=\{activeTab\}/)
    assert.match(loading, /tabs=\{\["Leads", "Polls"\]\} activeTab=\{title\}/)
    assert.match(loading, /tabs=\{\["Work Items", "Assets"\]\} activeTab="Assets"/)
    assert.match(loading, /variant === "admin-okrs"[\s\S]*?<AdminLoading section="okrs"/)
    assert.match(currentLoading, /searchParams\.get\("view"\) === "okrs"[\s\S]*?"admin-okrs"/)
    assert.match(currentLoading, /searchParams\.get\("mode"\) === "team"[\s\S]*?"communications-team"/)
    assert.match(opening, /nested === "okrs"[\s\S]*?"admin-okrs"/)
    assert.match(source("components/admin/AdminPanelNav.tsx"), /admin\/okrs/)

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
        "admin/okrs": "admin-okrs",
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

test("shell-hosted loading states own their local desktop width without a second sidebar offset", () => {
    const loading = source("components/workspace/PanelRouteLoading.tsx")
    const detailLoading = source("components/workspace/DetailRouteLoading.tsx")
    const styles = source("app/globals.css")

    assert.match(loading, /<main data-workspace-loading-root/)
    assert.match(detailLoading, /<main data-workspace-loading-root/)
    assert.match(styles, /main:not\(\[data-onboarding-full-window-preview\]\):not\(\[data-workspace-loading-root\]\)/)
    assert.match(loading, /className="absolute inset-0 overflow-hidden bg-black text-white"/)
    assert.doesNotMatch(loading, /className="fixed inset-0 overflow-hidden bg-black text-white"/)
})
