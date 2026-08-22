import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { visibleWorkspacePresence, workspacePresenceRoster } from "../lib/workspace-presence.ts"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("presence trusts the server member directory, excludes the current user, and deduplicates tabs", () => {
    const visible = visibleWorkspacePresence({
        mine: [{ sessionId: "mine-1", userId: "me", name: "Spoofed me", avatarSrc: null, activePath: "/old", updatedAt: "2026-08-15T12:00:00.000Z" }],
        first: [{ sessionId: "peer-1", userId: "peer", name: "Spoofed peer", avatarSrc: "/spoof.png", activePath: "/old", updatedAt: "2026-08-15T12:00:00.000Z" }],
        second: [{ sessionId: "peer-2", userId: "peer", name: "Another spoof", avatarSrc: null, activePath: "/new", updatedAt: "2026-08-15T12:01:00.000Z" }],
        intruder: [{ sessionId: "bad-1", userId: "not-a-member", name: "Intruder", avatarSrc: null, activePath: "/", updatedAt: "2026-08-15T12:02:00.000Z" }],
    }, "me", [
        { id: "me", name: "Current user", avatarSrc: "/me.png" },
        { id: "peer", name: "Trusted peer", avatarSrc: "/peer.png" },
    ])

    assert.deepEqual(visible, [{
        sessionId: "peer-2",
        userId: "peer",
        name: "Trusted peer",
        avatarSrc: "/peer.png",
        activePath: "/new",
        updatedAt: "2026-08-15T12:01:00.000Z",
    }])
})

test("workspace presence roster includes active and inactive peers without duplicating the current user", () => {
    const active = [{ sessionId: "peer-1", userId: "peer", name: "Active peer", avatarSrc: null, activePath: "/workspace", updatedAt: "2026-08-15T12:00:00.000Z" }]
    const roster = workspacePresenceRoster([
        { id: "me", name: "Current user", avatarSrc: "/me.png" },
        { id: "peer", name: "Active peer", avatarSrc: "/peer.png" },
        { id: "offline", name: "Inactive peer", avatarSrc: null },
    ], active, "me")

    assert.deepEqual(roster, [
        { id: "peer", name: "Active peer", avatarSrc: "/peer.png", active: true, activePath: "/workspace", updatedAt: "2026-08-15T12:00:00.000Z" },
        { id: "offline", name: "Inactive peer", avatarSrc: null, active: false, activePath: null, updatedAt: null },
    ])
})

test("workspace navigation keeps frame content mounted and reports progress inline", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")
    const navigationCase = shell.slice(shell.indexOf('message.type === "navigation-start"'), shell.indexOf('message.type === "open-tab"'))

    assert.match(shell, /beginTabNavigation\(tabId, url\)/)
    assert.match(shell, /navigationStateByTab\[tab\.id\]\?\.status === "loading"/)
    assert.match(shell, /retryActiveNavigation/)
    assert.doesNotMatch(navigationCase, /setRouteLoadingTabId/)
    assert.match(bridge, /await flushWorkspaceAutosaves\(\)/)
    assert.match(shell, /frameTabs\.map\(\(tab\) =>/)
    assert.match(shell, /hidden=\{!active\}/)
})

test("chat sends stay local and refreshed tabs remain covered until their frame load completes", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")
    const composer = source("components/communications/MessageComposer.tsx")

    assert.match(composer, /data-workspace-mutation-scope="local"/)
    assert.match(bridge, /event\.target\.dataset\.workspaceMutationScope === "local"\) return/)
    assert.match(shell, /if \(refresh\) setRouteLoadingTabId\(tab\.id\)/)
    assert.match(shell, /setRouteLoadingTabId\(\(current\) => current === tabId \? null : current\)/)
})

test("workspace frames acknowledge readiness with the current activation state", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const bridge = source("components/workspace/WorkspaceTabBridge.tsx")

    assert.match(bridge, /type: "location"/)
    assert.match(shell, /message\.type === "location"[\s\S]*postToTab\(message\.tabId, \{ type: "activate", active: message\.tabId === activeTabIdRef\.current, refresh: false \}\)/)
    assert.match(shell, /message\.type === "location-replace"[\s\S]*postToTab\(message\.tabId, \{ type: "activate", active: message\.tabId === activeTabIdRef\.current, refresh: false \}\)/)
})

test("workspace mutations treat business failures as failures and forms opt into background behavior explicitly", () => {
    const runtime = source("lib/workspace-mutations.ts")
    const overlay = source("components/GlobalLoadingOverlay.tsx")
    const autosave = source("components/workspace/WorkspaceAutosaveForm.tsx")

    assert.match(runtime, /value as \{ ok\?: unknown \}\)\.ok === false/)
    assert.match(overlay, /dataset\.workspaceMutation === "background"/)
    assert.match(overlay, /isServerAction && !backgroundMutation/)
    assert.match(overlay, /!url\.pathname\.includes\("\/activity\/"\)/)
    assert.match(autosave, /pendingRef\.current = next/)
    assert.match(autosave, /while \(pendingRef\.current\)/)
    assert.match(autosave, /lastSavedRef\.current = submittedSnapshot/)
    assert.match(autosave, /window\.setTimeout\(\(\) => void saveLatest\(\), debounceMs\)/)
    assert.match(autosave, /failedRef\.current = submitted/)
})

test("relationship background autosave uses notes_summary and optimistic concurrency", () => {
    const actions = source("app/[workspaceSlug]/relationships/actions.ts")
    const start = actions.indexOf("export async function saveRelationshipBackgroundDetails")
    const end = actions.indexOf("export async function saveRelationshipCommercialDetails", start)
    const backgroundAction = actions.slice(start, end)

    assert.match(backgroundAction, /notes_summary: input\.description/)
    assert.doesNotMatch(backgroundAction, /\bdescription:\s*input\.description/)
    assert.match(backgroundAction, /expectedUpdatedAt/)
    assert.match(backgroundAction, /conflict: true/)
    assert.match(backgroundAction, /\.eq\("updated_at", input\.expectedUpdatedAt\)/)
})

test("representative workspace forms declare their loading behavior", () => {
    for (const path of [
        "components/admin/WorkspaceOfficerSettings.tsx",
        "components/admin/WorkspaceOnboardingDomain.tsx",
        "components/admin/PendingWorkspaceInvitations.tsx",
        "app/[workspaceSlug]/settings/page.tsx",
        "app/[workspaceSlug]/leadgen/new/page.tsx",
    ]) {
        assert.match(source(path), /data-workspace-mutation="background"/, path)
    }

    for (const path of [
        "components/leadgen/ManualSettingsForm.tsx",
        "components/list/ListActionMenu.tsx",
        "components/list/MobileCardActionSurface.tsx",
        "components/admin/RemoveInvoiceForm.tsx",
    ]) {
        assert.match(source(path), /runWorkspaceMutation/, path)
    }

    const account = source("components/account/AccountMenu.tsx")
    assert.doesNotMatch(account, /data-workspace-mutation="background"/)
})

test("desktop and mobile shell place peer avatars next to the requested account controls", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const desktopSearch = shell.indexOf('aria-label="Search Betelgeze"')
    const desktopPresence = shell.indexOf("<WorkspacePresenceAvatars", desktopSearch)
    const mobileSection = shell.indexOf('<div className="flex h-9 items-center -space-x-2 md:space-x-0">')
    const mobilePresence = shell.indexOf("<WorkspacePresenceAvatars", mobileSection)
    const mobileAccount = shell.indexOf("<AccountMenu", mobilePresence)

    assert.ok(desktopSearch >= 0 && desktopPresence > desktopSearch)
    assert.ok(mobileSection >= 0 && mobilePresence > mobileSection && mobileAccount > mobilePresence)
    assert.match(shell, /data-icon-button type="button" key=\{member\.id\}/)
    assert.match(shell, /h-\[30px\] w-\[30px\][^\"]*md:h-7 md:w-7/)
    assert.match(shell, /className="flex h-9 items-center -space-x-2 md:space-x-0"/)
    assert.match(shell, /className="flex h-9 items-center md:hidden"/)
    assert.match(shell, /style=\{\{ zIndex: index \+ 1 \}\}/)
    assert.match(shell, /buttonClassName="relative z-20 h-9 w-9"/)
    assert.match(shell, /activity\/presence/)
})
