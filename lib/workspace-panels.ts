import type { WorkspaceRole } from "@/lib/workspace-roles"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

export type WorkspacePanelDefinition = {
    key: string
    label: string
    route: string
    activeRoutes?: readonly string[]
    capability: WorkspaceCapability
    minimumRole?: "admin"
    description: string
    keywords: readonly string[]
    standalone?: boolean
}

export const WORKSPACE_PANELS = [
    { key: "relationships", label: "Relationships", route: "relationships", capability: "relationships.view", minimumRole: "admin", description: "Relationship Hub list", keywords: ["dashboard", "crm", "people", "accounts"] },
    { key: "onboarding", label: "Onboarding", route: "onboarding", capability: "onboarding.manage", description: "Relationship onboarding status and submissions", keywords: ["forms", "submissions", "portal"] },
    { key: "fulfilment", label: "Fulfilment", route: "work", capability: "fulfilment.manage", description: "Fulfilment relationship work items", keywords: ["tasks", "project management", "queue", "fulfilment"] },
    { key: "appointment-setting", label: "Appointment Setting", route: "appointment-setting", capability: "appointment_setting.manage", description: "Leads, bookings, setter availability, and appointment outcomes", keywords: ["appointments", "bookings", "setters", "calendar", "leads"] },
    { key: "communications", label: "Communications", route: "communications", capability: "communications.manage", description: "Relationship communication summaries", keywords: ["messages", "chat", "whatsapp", "communication"] },
    { key: "library", label: "Library", route: "work-items", activeRoutes: ["work-items", "assets"], capability: "library.manage", minimumRole: "admin", description: "Workspace work items and assets", keywords: ["tasks", "files", "uploads", "gallery"] },
    { key: "onboarding-builder", label: "Onboarding Builder", route: "onboarding-builder", capability: "onboarding_builder.manage", minimumRole: "admin", standalone: true, description: "Build workspace onboarding modules and session structure", keywords: ["onboarding modules", "session builder", "forms builder", "form fields", "welcome", "completion", "visual builder"] },
    { key: "leadgen", label: "Lead Gen", route: "leadgen", capability: "leadgen.manage", minimumRole: "admin", description: "Lead generation dashboard", keywords: ["leads", "lead generation"] },
    { key: "admin", label: "Admin", route: "admin", capability: "admin.manage", minimumRole: "admin", description: "Private OKRs, activity, maintenance, and automation-failure follow-up", keywords: ["admin tools", "okr", "objectives", "key results", "metrics", "activity console", "automation history", "maintenance", "automation failures", "admin work items", "goals"] },
    { key: "settings", label: "Settings", route: "settings", capability: "settings.manage", minimumRole: "admin", description: "Unified workspace settings", keywords: ["workspace settings", "services", "agency branding", "onboarding colours"] },
] as const satisfies readonly WorkspacePanelDefinition[]
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number]
export type WorkspacePanelKey = WorkspacePanel["key"]

export function canAccessPrivateWorkspacePanels(role: WorkspaceRole) {
    return role === "owner" || role === "admin"
}

export function canAccessWorkspacePanel(
    panel: Pick<WorkspacePanelDefinition, "capability" | "minimumRole">,
    role: WorkspaceRole,
    capabilities: ReadonlySet<WorkspaceCapability> | readonly WorkspaceCapability[] = []
) {
    if (canAccessPrivateWorkspacePanels(role)) return true
    if (panel.minimumRole === "admin") return false
    return new Set(capabilities).has(panel.capability)
}

export function workspacePanelByKey(key: WorkspacePanelKey) {
    return WORKSPACE_PANELS.find((panel) => panel.key === key)!
}

export function workspacePanelForUrl(value: string, workspaceSlug: string) {
    const pathname = new URL(value, "http://localhost").pathname
    const prefix = `/${workspaceSlug}/`
    if (!pathname.startsWith(prefix)) return null
    const route = pathname.slice(prefix.length).split("/")[0]
    return WORKSPACE_PANELS.find((panel) => panel.route === route || ("activeRoutes" in panel && (panel.activeRoutes as readonly string[]).includes(route))) ?? null
}

export function canAccessWorkspaceUrl(
    value: string,
    workspaceSlug: string,
    role: WorkspaceRole,
    capabilities: ReadonlySet<WorkspaceCapability> | readonly WorkspaceCapability[] = []
) {
    if (canAccessPrivateWorkspacePanels(role)) return true
    const pathname = new URL(value, "http://localhost").pathname.replace(/\/$/, "")
    const root = `/${workspaceSlug}`
    if (pathname === root || pathname === `${root}/no-access`) return true
    const suffix = pathname.startsWith(`${root}/`) ? pathname.slice(root.length + 1) : ""
    if (/^work-items\/[^/]+$/.test(suffix) || /^assets\/[^/]+$/.test(suffix)) {
        const set = new Set(capabilities)
        return set.has("onboarding.manage") || set.has("fulfilment.manage")
    }
    const panel = workspacePanelForUrl(value, workspaceSlug)
    return panel ? canAccessWorkspacePanel(panel, role, capabilities) : false
}

export function workspacePanelHref(workspaceSlug: string, panel: Pick<WorkspacePanel, "route">) {
    return `/${workspaceSlug}/${panel.route}`
}
