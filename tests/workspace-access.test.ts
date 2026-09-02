import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    canAccessWorkspaceUrl,
    canAccessWorkspacePanel,
    WORKSPACE_PANELS,
} from "../lib/workspace-panels.ts"
import { combineWorkspaceCapabilities, STAFF_SERVICE_PERMISSION_OPTIONS } from "../lib/workspace-capabilities.ts"
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
const workspaceTopBar = readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8")
const staffMigration = readFileSync("supabase/migrations/20260804090000_rename_workspace_member_role_to_staff.sql", "utf8")
const serviceAccessMigration = readFileSync("supabase/migrations/20260902170000_service_scoped_staff_access.sql", "utf8")
const servicePermissionMigration = readFileSync("supabase/migrations/20260902213000_service_staff_permission_controls.sql", "utf8")
const settingsPage = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")

test("workspace roles are Owner, Admin, and Staff with legacy member normalization", () => {
    assert.deepEqual(WORKSPACE_ROLES, ["owner", "admin", "staff"])
    assert.equal(normalizeWorkspaceRole("member"), "staff")
    assert.equal(workspaceRoleLabel("staff"), "Staff")
    assert.equal(workspaceRoleMeetsMinimum("staff", "admin"), false)
    assert.equal(workspaceRoleMeetsMinimum("admin", "staff"), true)
})

test("workspace panels derive Staff access from service capabilities", () => {
    assert.deepEqual(WORKSPACE_PANELS.map((panel) => panel.label), [
        "Relationships",
        "Onboarding",
        "Fulfilment",
        "Appointment Setting",
        "Communications",
        "Library",
        "Onboarding Builder",
        "Lead Gen",
        "Admin",
        "Settings",
    ])
    const byKey = new Map(WORKSPACE_PANELS.map((panel) => [panel.key, panel]))
    const metaAdsCapabilities = ["onboarding.manage", "fulfilment.manage"] as const
    const appointmentSettingCapabilities = [...metaAdsCapabilities, "appointment_setting.manage"] as const
    assert.equal(canAccessWorkspacePanel(byKey.get("onboarding")!, "staff", metaAdsCapabilities), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("fulfilment")!, "staff", metaAdsCapabilities), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("appointment-setting")!, "staff", metaAdsCapabilities), false)
    assert.equal(canAccessWorkspacePanel(byKey.get("appointment-setting")!, "staff", appointmentSettingCapabilities), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("communications")!, "staff", ["communications.manage"]), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("settings")!, "staff", appointmentSettingCapabilities), false)
    assert.equal(WORKSPACE_PANELS.every((panel) => canAccessWorkspacePanel(panel, "admin")), true)
    assert.equal(canAccessWorkspaceUrl("/acme/settings", "acme", "staff", appointmentSettingCapabilities), false)
    assert.equal(canAccessWorkspaceUrl("/acme/appointment-setting", "acme", "staff", appointmentSettingCapabilities), true)
})

test("Staff permissions from multiple assigned services add together", () => {
    assert.deepEqual(STAFF_SERVICE_PERMISSION_OPTIONS.map((option) => option.label), [
        "Communications",
        "Onboarding",
        "Fulfilment",
        "Appointment Setting",
    ])
    assert.deepEqual(combineWorkspaceCapabilities([
        ["communications.manage", "onboarding.manage"],
        ["fulfilment.manage", "appointment_setting.manage", "onboarding.manage"],
    ]), ["onboarding.manage", "fulfilment.manage", "appointment_setting.manage", "communications.manage"])
})

test("mobile workspace navigation scrolls within the dynamic viewport", () => {
    assert.match(workspaceTopBar, /h-\[calc\(100dvh-3\.5rem\)\]/)
    assert.match(workspaceTopBar, /touch-pan-y flex-col gap-2 overflow-y-auto overscroll-contain/)
    assert.match(workspaceTopBar, /md:overflow-visible md:overscroll-auto/)
})

test("search calls top-level destinations panels and hides all private records from staff", () => {
    assert.match(searchRoute, /type: "Panel"/)
    assert.doesNotMatch(searchRoute, /type: "Page"/)
    assert.match(searchRoute, /canAccessPrivatePanels && !companyError/)
    assert.match(searchRoute, /canAccessPrivatePanels && !pollError/)
    assert.match(searchRoute, /canAccessWorkspacePanel\(panel, access\.role, access\.capabilities\)/)
    assert.match(searchRoute, /accessibleRelationshipIds\(workspaceAccess\)/)
    assert.match(searchRoute, /accessibleWorkItemIds\(workspaceAccess/)
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

test("service access migration assigns capabilities and enforces record scope", () => {
    assert.match(serviceAccessMigration, /workspace_service_capabilities/)
    assert.match(serviceAccessMigration, /workspace_member_service_access/)
    assert.match(serviceAccessMigration, /workspace_invitation_service_access/)
    assert.match(serviceAccessMigration, /appointment_setting\.manage/)
    assert.match(serviceAccessMigration, /workspace_user_can_access_relationship/)
    assert.match(serviceAccessMigration, /workspace_user_can_access_work_item/)
    assert.match(serviceAccessMigration, /as restrictive for select to authenticated/)
    assert.match(serviceAccessMigration, /alter table public\.workspace_integrations enable row level security/)
    assert.match(serviceAccessMigration, /service scoped staff onboarding blocks/)
    assert.match(serviceAccessMigration, /staff cannot access legacy relationship assets/)
    assert.match(serviceAccessMigration, /staff cannot access client portal sessions/)
})

test("service permission migration makes service grants editable and requires every Staff member to have a service", () => {
    assert.match(servicePermissionMigration, /set_workspace_service_capabilities/)
    assert.match(servicePermissionMigration, /multiple assignments combine grants/i)
    assert.match(servicePermissionMigration, /create constraint trigger workspace_memberships_require_staff_service/)
    assert.match(servicePermissionMigration, /create constraint trigger workspace_member_service_access_requires_one/)
    assert.match(servicePermissionMigration, /STAFF_SERVICE_ACCESS_REQUIRED/)
    assert.match(servicePermissionMigration, /after insert on public\.onboarding_service_revisions/)
    assert.doesNotMatch(settingsPage, /WorkspaceUserAccessEditor|updateWorkspaceUserRole|Edit access/)
})
