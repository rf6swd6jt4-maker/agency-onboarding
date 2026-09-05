import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    WORKSPACE_DOCUMENT_REQUEST_HEADER,
    WORKSPACE_SHELL_INTERNAL_PREFIX,
    workspaceShellRuntime,
    workspaceProductForPath,
    workspaceRouteUsesShell,
    workspaceShellRoute,
} from "../lib/workspace-shell.ts"
import { workspaceTabIdFromUrl } from "../lib/workspace-tabs.ts"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("only shell-hosted workspace panels use the internal shell route", () => {
    for (const pathname of [
        "/scaylup/relationships",
        "/scaylup/relationships/relationship-1",
        "/scaylup/communications",
        "/scaylup/leadgen/polls",
        "/scaylup/settings",
    ]) assert.equal(workspaceRouteUsesShell(pathname), true, pathname)

    for (const pathname of [
        "/scaylup",
        "/scaylup/onboarding-builder",
        "/scaylup/admin/okrs/okr-1",
        "/workspaces",
        `${WORKSPACE_SHELL_INTERNAL_PREFIX}/scaylup`,
    ]) assert.equal(workspaceRouteUsesShell(pathname), false, pathname)

    assert.equal(workspaceShellRoute("scaylup"), `${WORKSPACE_SHELL_INTERNAL_PREFIX}/scaylup`)
    assert.equal(workspaceProductForPath("/scaylup/leadgen/polls"), "leadgen")
    assert.equal(workspaceProductForPath("/scaylup/relationships"), "client-work")
})

test("one-document workspace is the default with an immediate frame rollback", () => {
    assert.equal(workspaceShellRuntime(undefined), "document")
    assert.equal(workspaceShellRuntime("document"), "document")
    assert.equal(workspaceShellRuntime("frames"), "frames")
    assert.equal(workspaceShellRuntime("FRAMES"), "frames")
    assert.equal(WORKSPACE_DOCUMENT_REQUEST_HEADER, "x-betelgeze-workspace-document")
})

test("frame markers are recovered from the original request path", () => {
    assert.equal(workspaceTabIdFromUrl("/scaylup/relationships?__betelgeze_tab=tab-2"), "tab-2")
    assert.equal(workspaceTabIdFromUrl("/scaylup/relationships"), null)
    assert.equal(workspaceTabIdFromUrl("not a valid url", "not an origin"), null)
})

test("top-level panels rewrite to the shell while framed panels bypass shell bootstrap", () => {
    const proxy = source("proxy.ts")
    const shellPage = source("app/~workspace-shell/[workspaceSlug]/page.tsx")
    const topBar = source("components/workspace/WorkspaceTopBar.tsx")
    const frameCheck = topBar.indexOf("workspaceTabIdFromUrl(currentPath)")
    const firstShellQuery = topBar.indexOf('supabaseAdmin.from("user_profiles")')

    assert.match(proxy, /!request\.nextUrl\.searchParams\.has\(WORKSPACE_TAB_FRAME_PARAM\) && workspaceRouteUsesShell\(path\)/)
    assert.match(proxy, /withRewrite\(request, workspaceShellRoute\(workspaceSlug\), headers\)/)
    assert.match(shellPage, /requireWorkspaceAccess\(workspaceSlug\)/)
    assert.match(shellPage, /workspaceAccess=\{access\}/)
    assert.match(shellPage, /initialWorkspaceUrl=\{currentPath \?\? undefined\}/)
    assert.ok(frameCheck >= 0 && firstShellQuery > frameCheck)
    assert.match(topBar.slice(frameCheck, firstShellQuery), /return <WorkspaceTabBridge/)
})

test("document mode keeps one shell mounted around routed panel content", () => {
    const proxy = source("proxy.ts")
    const layout = source("app/[workspaceSlug]/layout.tsx")
    const topBar = source("components/workspace/WorkspaceTopBar.tsx")
    const client = source("components/workspace/WorkspaceTopBarClient.tsx")

    assert.match(proxy, /workspaceShellRuntime\(\) === "frames"/)
    assert.match(proxy, /headers\.set\(WORKSPACE_DOCUMENT_REQUEST_HEADER, "1"\)/)
    assert.match(layout, /documentShell/)
    assert.match(layout, /documentContent=\{<WorkspacePanelChrome/)
    assert.match(topBar, /&& !documentShell\) return null/)
    assert.match(client, /router\.push\(url, \{ scroll: false \}\)/)
    assert.match(client, /router\.replace\(url, \{ scroll: false \}\)/)
    assert.match(client, /window\.addEventListener\("popstate", restoreBrowserHistoryTab\)/)
    assert.match(client, /WORKSPACE_BROWSER_TAB_STATE_KEY/)
    assert.match(client, /<WorkspaceDocumentRuntimeProvider/)
    assert.match(client, /\{documentContent\}/)
})
