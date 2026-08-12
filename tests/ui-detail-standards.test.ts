import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const directDetailPages = [
    "app/[workspaceSlug]/relationships/[relationshipId]/page.tsx",
    "app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx",
    "app/[workspaceSlug]/work/[relationshipId]/page.tsx",
    "app/[workspaceSlug]/work-items/[id]/page.tsx",
    "app/[workspaceSlug]/assets/[id]/page.tsx",
    "app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx",
    "app/[workspaceSlug]/admin/activity/[eventId]/page.tsx",
]

test("record detail routes use the shared detail header and danger-zone anatomy", async () => {
    const pages = await Promise.all(directDetailPages.map(async (path) => ({ path, source: await readFile(path, "utf8") })))

    for (const page of pages) {
        assert.match(page.source, /<DetailPageHeader/, `${page.path} must use DetailPageHeader`)
        assert.match(page.source, /<DetailDangerZone|<OnboardingDangerZone/, `${page.path} must end with the shared danger-zone treatment`)
        assert.doesNotMatch(page.source, /Danger zone placeholder/, `${page.path} must not show a page-local danger placeholder`)
    }
})

test("detail field implementations use the shared borderless field rows", async () => {
    const sharedFields = await readFile("components/detail/DetailFields.tsx", "utf8")
    const relationshipFields = await readFile("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipDealWorkspace.tsx", "utf8")
    const workItemFields = await readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8")

    assert.match(sharedFields, /mt-5 grid grid-cols-1 lg:grid-cols-2/)
    assert.match(sharedFields, /border-b border-neutral-900 py-2/)
    assert.doesNotMatch(sharedFields, /rounded-[^\s"]+ border/)
    assert.match(relationshipFields, /<DetailFields>/)
    assert.match(workItemFields, /<DetailFields>/)
})

test("the detail danger zone preserves archive-before-delete ordering and visual tones", async () => {
    const source = await readFile("components/detail/DetailDangerZone.tsx", "utf8")

    assert.match(source, /border-t border-red-950\/70/)
    assert.match(source, /divide-y divide-neutral-900/)
    assert.match(source, /tone === "delete"/)
    assert.match(source, /border border-red-900\/80/)
})
