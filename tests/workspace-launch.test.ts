import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    parseWorkspaceLaunchHint,
    serializeWorkspaceLaunchHint,
    WORKSPACE_LAUNCH_COOKIE,
} from "../lib/workspace-launch.ts"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("workspace launch hints are narrow, same-workspace, and safe to rewrite", () => {
    const value = serializeWorkspaceLaunchHint({
        workspaceSlug: "scaylup",
        tabId: "2df849d2-61f8-43f4-8291-a950a98573cf",
        url: "/scaylup/relationships/client-1?view=work&__betelgeze_tab=stale#timeline",
    })
    assert.ok(value)
    assert.deepEqual(parseWorkspaceLaunchHint(value), {
        workspaceSlug: "scaylup",
        tabId: "2df849d2-61f8-43f4-8291-a950a98573cf",
        url: "/scaylup/relationships/client-1?view=work#timeline",
    })
    assert.equal(parseWorkspaceLaunchHint(encodeURIComponent(JSON.stringify({ workspaceSlug: "scaylup", tabId: "tab-1", url: "/another/settings" }))), null)
    assert.equal(parseWorkspaceLaunchHint(encodeURIComponent(JSON.stringify({ workspaceSlug: "../admin", tabId: "tab-1", url: "/admin" }))), null)
    assert.equal(parseWorkspaceLaunchHint("not-json"), null)
})

test("cold app launch rewrites an authenticated user to the saved panel", () => {
    const proxy = source("proxy.ts")
    const logout = source("app/logout/route.ts")
    assert.match(proxy, new RegExp(`request\\.cookies\\.get\\(WORKSPACE_LAUNCH_COOKIE\\)`))
    assert.match(proxy, /workspaceRouteUsesShell\(new URL\(launchHint\.url, request\.url\)\.pathname\)/)
    assert.match(proxy, /withRewrite\(request, workspaceShellRoute\(launchHint\.workspaceSlug\), headers, launchHint\.url\)/)
    assert.match(logout, new RegExp(`response\\.cookies\\.set\\(WORKSPACE_LAUNCH_COOKIE, "", \\{ path: "/", maxAge: 0 \\}\\)`))
    assert.equal(WORKSPACE_LAUNCH_COOKIE, "betelgeze-last-workspace")
})

test("the first workspace panel is server-rendered before tab restoration", () => {
    const shellPage = source("app/~workspace-shell/[workspaceSlug]/page.tsx")
    const topBar = source("components/workspace/WorkspaceTopBar.tsx")
    const client = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shellPage, /const initialTab: WorkspaceInitialTab/)
    assert.match(topBar, /initialTab=\{launchTab\}/)
    assert.match(client, /useState<WorkspaceTab\[]>\(\[initialTab\]\)/)
    assert.match(client, /const frameTabs = orderWorkspaceTabsByStableIds\(tabs, tabFrameOrder\)/)
    assert.doesNotMatch(client, /\{tabsHydrated && frameTabs\.map/)
    assert.match(client, /type: "probe"/)
    assert.match(source("components/workspace/WorkspaceTabBridge.tsx"), /message\.type === "probe"[\s\S]*type: "location"/)
})

test("workspace launch uses one narrow access bootstrap and defers secondary shell reads", () => {
    const bootstrap = source("lib/workspace-shell-bootstrap.ts")
    const migration = source("supabase/migrations/20260906110000_workspace_launch_bootstrap.sql")
    const topBar = source("components/workspace/WorkspaceTopBar.tsx")
    const client = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(bootstrap, /supabaseAdmin\.rpc\("workspace_shell_bootstrap"/)
    assert.match(bootstrap, /fell back to legacy queries/)
    assert.match(migration, /returns jsonb[\s\S]*security definer/)
    assert.match(migration, /revoke all on function public\.workspace_shell_bootstrap\(text, uuid\) from public, anon, authenticated/)
    assert.match(migration, /coalesce\(revision\.definition->>'templateId', revision\.definition->>'template_id'\) = 'appointment-setting'/)
    assert.doesNotMatch(topBar, /auth\.admin\.getUserById|workspaceMembers=|workItemOptions=|relationshipOptions=/)
    assert.match(client, /if \(!initialPanelReady \|\| shellSecondaryRequestedRef\.current\) return/)
    assert.match(client, /dynamic\(\(\) => import\("@\/components\/workspace\/WorkspaceCreateModal"\)/)
    assert.match(client, /dynamic\(\(\) => import\("@\/components\/workspace\/ShellRelationshipContextPanel"\)/)
})

test("launch telemetry records usable-panel and realtime readiness separately", () => {
    const client = source("components/workspace/WorkspaceTopBarClient.tsx")
    const performance = source("lib/workspace-launch-performance.ts")
    const endpoint = source("app/api/workspaces/[workspaceSlug]/performance/launch/route.ts")
    const migration = source("supabase/migrations/20260906110000_workspace_launch_bootstrap.sql")
    assert.match(client, /stage: "usable"/)
    assert.match(client, /stage: "presence"/)
    assert.match(performance, /responseStart/)
    assert.match(performance, /first-contentful-paint/)
    assert.match(performance, /proxy-session/)
    assert.match(endpoint, /workspace_launch_metrics/)
    assert.match(endpoint, /VERCEL_GIT_COMMIT_SHA/)
    assert.match(migration, /unique \(workspace_id, launch_id\)/)
})
