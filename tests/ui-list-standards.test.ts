import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const canonicalListPages = [
    "app/[workspaceSlug]/leadgen/page.tsx",
    "app/[workspaceSlug]/leadgen/polls/page.tsx",
    "app/[workspaceSlug]/relationships/page.tsx",
    "app/[workspaceSlug]/onboarding/page.tsx",
    "app/[workspaceSlug]/work/page.tsx",
    "app/[workspaceSlug]/work-items/page.tsx",
    "app/[workspaceSlug]/admin/maintenance/page.tsx",
    "app/[workspaceSlug]/admin/activity/page.tsx",
]

test("canonical platform lists use the shared header and two-row list primitives", async () => {
    const pages = await Promise.all(canonicalListPages.map(async (path) => ({ path, source: await readFile(path, "utf8") })))

    for (const page of pages) {
        assert.match(page.source, /<PanelTabHeader/, `${page.path} must use PanelTabHeader`)
        assert.match(page.source, /<List ariaLabel=/, `${page.path} must use List`)
        assert.match(page.source, /<ListItem/, `${page.path} must use ListItem`)
        assert.match(page.source, /<ListPrimaryRow>/, `${page.path} must use ListPrimaryRow`)
        assert.match(page.source, /<ListSecondaryRow>/, `${page.path} must use ListSecondaryRow`)
        assert.match(page.source, /<MobileListActionSurface/, `${page.path} must use the mobile whole-item action surface`)
    }
})

test("Communications uses its dedicated responsive conversation workspace instead of canonical List", async () => {
    const [page, workspace] = await Promise.all([
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
    ])

    assert.match(page, /<PanelTabHeader/)
    assert.match(page, /<PanelTabs/)
    assert.match(page, /<CommunicationsWorkspace/)
    assert.doesNotMatch(page, /<List ariaLabel=/)
    assert.match(workspace, /lg:sticky/)
    assert.match(workspace, /overflow-y-auto/)
    assert.match(workspace, /lg:hidden/)
    assert.match(workspace, /Back to client chats/)
    assert.match(workspace, /activeArea !== "clients"/)
})

test("the Admin work queue uses the same canonical row anatomy", async () => {
    const source = await readFile("components/admin/AdminWorkQueue.tsx", "utf8")
    for (const primitive of ["List", "ListItem", "ListPrimaryRow", "ListSecondaryRow", "ListTitle", "ListTrailing", "MobileListActionSurface"]) {
        assert.match(source, new RegExp(`<${primitive}`), `AdminWorkQueue must use ${primitive}`)
    }
    assert.match(source, /<Assignee/)
    assert.doesNotMatch(source, /rounded-full border bg-neutral-900/)
    assert.doesNotMatch(source, /border-b border-neutral-900 px-3 py-3/)
})

test("the Assets sibling keeps the shared Library shell without becoming a canonical list", async () => {
    const source = await readFile("app/[workspaceSlug]/assets/page.tsx", "utf8")
    assert.match(source, /<PanelTabHeader/)
    assert.match(source, /<LibraryTabs/)
    assert.match(source, /<QuickStats/)
    assert.doesNotMatch(source, /<List ariaLabel=/)
})
