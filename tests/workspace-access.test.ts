import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    canAccessWorkspacePanel,
    PRIVATE_WORKSPACE_PANELS,
    PUBLIC_WORKSPACE_PANELS,
    shouldShowPrivateWorkspacePanelIcon,
    WORKSPACE_PANELS,
} from "../lib/workspace-panels.ts"
import {
    normalizeWorkspaceRole,
    WORKSPACE_ROLES,
    workspaceRoleLabel,
    workspaceRoleMeetsMinimum,
} from "../lib/workspace-roles.ts"

const searchRoute = readFileSync("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8")
const leadgenPanel = readFileSync("app/[workspaceSlug]/leadgen/page.tsx", "utf8")
const leadgenPollsPanel = readFileSync("app/[workspaceSlug]/leadgen/polls/page.tsx", "utf8")
const leadgenPollPanel = readFileSync("app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx", "utf8")
const staffMigration = readFileSync("supabase/migrations/20260804090000_rename_workspace_member_role_to_staff.sql", "utf8")

test("workspace roles are Owner, Admin, and Staff with legacy member normalization", () => {
    assert.deepEqual(WORKSPACE_ROLES, ["owner", "admin", "staff"])
    assert.equal(normalizeWorkspaceRole("member"), "staff")
    assert.equal(workspaceRoleLabel("staff"), "Staff")
    assert.equal(workspaceRoleMeetsMinimum("staff", "admin"), false)
    assert.equal(workspaceRoleMeetsMinimum("admin", "staff"), true)
})

test("workspace panels have one explicit public block followed by one private block", () => {
    assert.deepEqual(PUBLIC_WORKSPACE_PANELS.map((panel) => panel.label), [
        "Relationships",
        "Onboarding",
        "Fulfilment",
        "Communications",
        "Library",
    ])
    assert.deepEqual(PRIVATE_WORKSPACE_PANELS.map((panel) => panel.label), [
        "Onboarding Builder",
        "Lead Gen",
        "Admin",
        "Settings",
    ])
    assert.deepEqual(WORKSPACE_PANELS, [...PUBLIC_WORKSPACE_PANELS, ...PRIVATE_WORKSPACE_PANELS])
    assert.equal(PUBLIC_WORKSPACE_PANELS.every((panel) => canAccessWorkspacePanel(panel, "staff")), true)
    assert.equal(PRIVATE_WORKSPACE_PANELS.some((panel) => canAccessWorkspacePanel(panel, "staff")), false)
    assert.equal(PRIVATE_WORKSPACE_PANELS.every((panel) => canAccessWorkspacePanel(panel, "admin")), true)
})

test("private panel icons are only shown to staff", () => {
    const privatePanel = PRIVATE_WORKSPACE_PANELS[0]
    const publicPanel = PUBLIC_WORKSPACE_PANELS[0]

    assert.equal(shouldShowPrivateWorkspacePanelIcon(privatePanel, "staff"), true)
    assert.equal(shouldShowPrivateWorkspacePanelIcon(privatePanel, "admin"), false)
    assert.equal(shouldShowPrivateWorkspacePanelIcon(privatePanel, "owner"), false)
    assert.equal(shouldShowPrivateWorkspacePanelIcon(publicPanel, "staff"), false)
})

test("search calls top-level destinations panels and hides all private records from staff", () => {
    assert.match(searchRoute, /type: "Panel"/)
    assert.doesNotMatch(searchRoute, /type: "Page"/)
    assert.match(searchRoute, /canAccessPrivatePanels && !companyError/)
    assert.match(searchRoute, /canAccessPrivatePanels && !pollError/)
})

test("private Lead Gen routes require admin access", () => {
    for (const source of [leadgenPanel, leadgenPollsPanel, leadgenPollPanel]) {
        assert.match(source, /requireWorkspace\(workspaceSlug, "admin"\)/)
    }
})

test("staff migration updates stored roles and closes the old role constraints", () => {
    assert.match(staffMigration, /set role = 'staff'/)
    assert.match(staffMigration, /check \(role in \('owner', 'admin', 'staff'\)\)/)
    assert.match(staffMigration, /default array\['owner', 'admin', 'staff'\]/)
})
