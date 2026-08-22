import assert from "node:assert/strict"
import test from "node:test"
import {
    appendWorkspaceTabHistory,
    isReopenClosedTabShortcut,
    isWorkspaceOnboardingBuilderUrl,
    normalizeWorkspaceTabCustomTitle,
    normalizeWorkspaceUrl,
    orderWorkspaceTabsByStableIds,
    reorderWorkspaceTabs,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameMatchesUrl,
    workspaceTabFrameUrl,
    workspaceTabHistoryStep,
    workspaceTabIsCommunications,
    workspaceRouteCanShowRelationshipContext,
    workspaceRouteIsRecordDetail,
} from "../lib/workspace-tabs.ts"
import { ONBOARDING_BUILDER_WINDOW_TTL_MS, onboardingBuilderWindowIsFresh, onboardingBuilderWindowName } from "../lib/onboarding-builder-window.ts"

const origin = "https://dashboard.betelgeze.com"

test("normalizes rewritten workspace routes without leaking the frame marker", () => {
    const url = normalizeWorkspaceUrl(
        `/dashboard/scaylup/relationships/client-1?filter=active&${WORKSPACE_TAB_FRAME_PARAM}=tab-1#messages`,
        "scaylup",
        origin
    )

    assert.equal(url, "/scaylup/relationships/client-1?filter=active#messages")
})

test("normalizes dashboard routes to the public workspace URL", () => {
    assert.equal(
        normalizeWorkspaceUrl("/dashboard/scaylup/relationships?sort=newest", "scaylup", origin),
        "/scaylup/relationships?sort=newest"
    )
})

test("adds a tab identity while preserving filters and hash navigation", () => {
    assert.equal(
        workspaceTabFrameUrl("/scaylup/settings?section=sources#owner-phone", "tab-2", origin),
        `/scaylup/settings?section=sources&${WORKSPACE_TAB_FRAME_PARAM}=tab-2#owner-phone`
    )
})

test("recognizes only the current workspace's standalone onboarding Builder", () => {
    assert.equal(isWorkspaceOnboardingBuilderUrl("/scaylup/onboarding-builder", "scaylup", origin), true)
    assert.equal(isWorkspaceOnboardingBuilderUrl("/scaylup/onboarding-builder?module=module-1", "scaylup", origin), true)
    assert.equal(isWorkspaceOnboardingBuilderUrl("/another/onboarding-builder", "scaylup", origin), false)
    assert.equal(isWorkspaceOnboardingBuilderUrl("/scaylup/onboarding-builder/nested", "scaylup", origin), false)
    assert.equal(isWorkspaceOnboardingBuilderUrl("https://example.com/scaylup/onboarding-builder", "scaylup", origin), false)
})

test("tracks one named Builder window per workspace and expires stale presence", () => {
    assert.equal(onboardingBuilderWindowName("Scaylup & Co"), "betelgeze-onboarding-builder-Scaylup---Co")
    assert.equal(onboardingBuilderWindowIsFresh({ open: true, updatedAt: 1_000 }, 1_000 + ONBOARDING_BUILDER_WINDOW_TTL_MS - 1), true)
    assert.equal(onboardingBuilderWindowIsFresh({ open: true, updatedAt: 1_000 }, 1_000 + ONBOARDING_BUILDER_WINDOW_TTL_MS), false)
    assert.equal(onboardingBuilderWindowIsFresh({ open: false, updatedAt: 1_000 }, 1_001), false)
})

test("only treats a frame as synchronized when route, query, hash, and tab identity match", () => {
    const desired = "/scaylup/onboarding?stage=setup#client"

    assert.equal(
        workspaceTabFrameMatchesUrl(
            `https://dashboard.betelgeze.com/scaylup/onboarding?${WORKSPACE_TAB_FRAME_PARAM}=tab-2&stage=setup#client`,
            desired,
            "tab-2",
            origin
        ),
        true
    )
    assert.equal(
        workspaceTabFrameMatchesUrl(
            `https://dashboard.betelgeze.com/scaylup/leadgen/polls?${WORKSPACE_TAB_FRAME_PARAM}=tab-2`,
            desired,
            "tab-2",
            origin
        ),
        false
    )
    assert.equal(
        workspaceTabFrameMatchesUrl(
            `https://dashboard.betelgeze.com/scaylup/onboarding?stage=setup&${WORKSPACE_TAB_FRAME_PARAM}=other-tab#client`,
            desired,
            "tab-2",
            origin
        ),
        false
    )
})

test("workspace shell only supports relationship context on detail routes", () => {
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/relationships/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/onboarding/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/work/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/onboarding", "scaylup", origin), false)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/relationships", "scaylup", origin), false)
})

test("identifies the Communications workspace tab without matching other workspaces or routes", () => {
    assert.equal(workspaceTabIsCommunications("/scaylup/communications?mode=team", "scaylup", origin), true)
    assert.equal(workspaceTabIsCommunications("/another/communications", "scaylup", origin), false)
    assert.equal(workspaceTabIsCommunications("/scaylup/communications/archive", "scaylup", origin), false)
})

test("record details open as switchable workspace tabs while hubs and actions stay in place", () => {
    for (const path of [
        "/scaylup/relationships/client-1",
        "/scaylup/onboarding/client-1",
        "/scaylup/work/client-1",
        "/scaylup/work-items/item-1",
        "/scaylup/assets/asset-1",
        "/scaylup/leadgen/poll/poll-1",
        "/scaylup/admin/activity/event-1",
        "/scaylup/admin/okrs/okr-1",
    ]) assert.equal(workspaceRouteIsRecordDetail(path, "scaylup", origin), true, path)

    for (const path of [
        "/scaylup/relationships",
        "/scaylup/work-items?create=work-item",
        "/scaylup/settings#leadgen",
        "/scaylup/leadgen/polls",
        "/scaylup/admin/activity",
        "/another/relationships/client-1",
        "https://example.com/scaylup/work-items/item-1",
    ]) assert.equal(workspaceRouteIsRecordDetail(path, "scaylup", origin), false, path)
})

test("tab history cannot move before its creation page or past its newest page", () => {
    const history = ["/scaylup", "/scaylup/relationships/client-1"]

    assert.equal(workspaceTabHistoryStep(history, 0, -1), null)
    assert.deepEqual(workspaceTabHistoryStep(history, 1, -1), { historyIndex: 0, url: "/scaylup" })
    assert.deepEqual(workspaceTabHistoryStep(history, 0, 1), { historyIndex: 1, url: "/scaylup/relationships/client-1" })
    assert.equal(workspaceTabHistoryStep(history, 1, 1), null)
})

test("bounded tab history permanently keeps the page where the tab was created", () => {
    const history = Array.from({ length: 50 }, (_, index) => index === 0 ? "/created-here" : `/page-${index}`)
    const next = appendWorkspaceTabHistory(history, 49, "/page-50", 50)

    assert.equal(next.history.length, 50)
    assert.equal(next.history[0], "/created-here")
    assert.equal(next.history[49], "/page-50")
    assert.equal(next.historyIndex, 49)
})

test("recognizes the reopen-closed-tab shortcut on macOS and Windows", () => {
    assert.equal(isReopenClosedTabShortcut({ key: "T", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }), true)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }), true)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), false)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: false, ctrlKey: true, shiftKey: true, altKey: true }), false)
})

test("reorders tabs by insertion point without changing their identity", () => {
    const tabs = [{ id: "one" }, { id: "two" }, { id: "three" }]

    assert.deepEqual(reorderWorkspaceTabs(tabs, "one", 2).map((tab) => tab.id), ["two", "three", "one"])
    assert.deepEqual(reorderWorkspaceTabs(tabs, "three", 0).map((tab) => tab.id), ["three", "one", "two"])
    assert.equal(reorderWorkspaceTabs(tabs, "two", 1), tabs)
})

test("keeps iframe panels in stable mount order when tab chrome is reordered", () => {
    const reorderedTabs = [{ id: "three" }, { id: "one" }, { id: "two" }]

    assert.deepEqual(
        orderWorkspaceTabsByStableIds(reorderedTabs, ["one", "two", "three"]).map((tab) => tab.id),
        ["one", "two", "three"]
    )
})

test("normalizes custom tab titles and treats an empty title as automatic", () => {
    assert.equal(normalizeWorkspaceTabCustomTitle("  Priority   Polls  "), "Priority Polls")
    assert.equal(normalizeWorkspaceTabCustomTitle("   "), null)
    assert.equal(normalizeWorkspaceTabCustomTitle("A very long name", 6), "A very")
})
