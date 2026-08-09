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
    "app/[workspaceSlug]/communications/page.tsx",
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

test("the Assets sibling keeps the shared Library shell without becoming a canonical list", async () => {
    const source = await readFile("app/[workspaceSlug]/assets/page.tsx", "utf8")
    assert.match(source, /<PanelTabHeader/)
    assert.match(source, /<LibraryTabs/)
    assert.match(source, /<QuickStats/)
    assert.doesNotMatch(source, /<List ariaLabel=/)
})
