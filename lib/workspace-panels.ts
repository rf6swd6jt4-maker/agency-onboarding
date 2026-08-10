import type { WorkspaceRole } from "@/lib/workspace-roles"

export type WorkspacePanelAccess = "public" | "private"

type WorkspacePanelDefinition = {
    key: string
    label: string
    route: string
    activeRoutes?: readonly string[]
    access: WorkspacePanelAccess
    description: string
    keywords: readonly string[]
    standalone?: boolean
}

// Public panels are available to every workspace role, including Staff.
export const PUBLIC_WORKSPACE_PANELS = [
    { key: "relationships", label: "Relationships", route: "relationships", access: "public", description: "Relationship Hub list", keywords: ["dashboard", "crm", "people", "accounts"] },
    { key: "onboarding", label: "Onboarding", route: "onboarding", access: "public", description: "Relationship onboarding status and submissions", keywords: ["forms", "submissions", "portal"] },
    { key: "fulfilment", label: "Fulfilment", route: "work", access: "public", description: "Fulfilment relationship work items", keywords: ["tasks", "project management", "queue", "fulfilment"] },
    { key: "communications", label: "Communications", route: "communications", access: "public", description: "Relationship communication summaries", keywords: ["messages", "chat", "whatsapp", "communication"] },
    { key: "library", label: "Library", route: "work-items", activeRoutes: ["work-items", "assets"], access: "public", description: "Workspace work items and assets", keywords: ["tasks", "files", "uploads", "gallery"] },
] as const satisfies readonly WorkspacePanelDefinition[]

// Private panels are visible but locked for Staff and accessible to Owner/Admin.
export const PRIVATE_WORKSPACE_PANELS = [
    { key: "onboarding-builder", label: "Onboarding Builder", route: "onboarding-builder", access: "private", standalone: true, description: "Build workspace onboarding modules and session structure", keywords: ["onboarding modules", "session builder", "forms builder", "form fields", "welcome", "completion", "visual builder"] },
    { key: "leadgen", label: "Lead Gen", route: "leadgen", access: "private", description: "Lead generation dashboard", keywords: ["leads", "lead generation"] },
    { key: "admin", label: "Admin", route: "admin", access: "private", description: "Private OKRs, activity, maintenance, and automation-failure follow-up", keywords: ["admin tools", "okr", "objectives", "key results", "metrics", "activity console", "automation history", "maintenance", "automation failures", "admin work items", "goals"] },
    { key: "settings", label: "Settings", route: "settings", access: "private", description: "Unified workspace settings", keywords: ["workspace settings", "services", "agency branding", "onboarding colours"] },
] as const satisfies readonly WorkspacePanelDefinition[]

export const WORKSPACE_PANELS = [...PUBLIC_WORKSPACE_PANELS, ...PRIVATE_WORKSPACE_PANELS] as const
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number]
export type WorkspacePanelKey = WorkspacePanel["key"]

export function canAccessPrivateWorkspacePanels(role: WorkspaceRole) {
    return role === "owner" || role === "admin"
}

export function canAccessWorkspacePanel(panel: Pick<WorkspacePanel, "access">, role: WorkspaceRole) {
    return panel.access === "public" || canAccessPrivateWorkspacePanels(role)
}

export function shouldShowPrivateWorkspacePanelIcon(panel: Pick<WorkspacePanel, "access">, role: WorkspaceRole) {
    return panel.access === "private" && role === "staff"
}

export function workspacePanelHref(workspaceSlug: string, panel: Pick<WorkspacePanel, "route">) {
    return `/${workspaceSlug}/${panel.route}`
}
