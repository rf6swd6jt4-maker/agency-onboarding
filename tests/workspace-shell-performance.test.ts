import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    WORKSPACE_SHELL_INTERNAL_PREFIX,
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
    assert.match(shellPage, /requireWorkspaceShellBootstrap\(workspaceSlug\)/)
    assert.match(shellPage, /workspaceAccess=\{access\}/)
    assert.match(shellPage, /initialWorkspaceUrl=\{initialUrl\}/)
    assert.match(shellPage, /initialTab=\{initialTab\}/)
    assert.ok(frameCheck >= 0 && firstShellQuery > frameCheck)
    assert.match(topBar.slice(frameCheck, firstShellQuery), /return <WorkspaceTabBridge/)
})
