export const WORKSPACE_ROLES = ["owner", "admin", "staff"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

const roleRank: Record<WorkspaceRole, number> = {
    staff: 1,
    admin: 2,
    owner: 3,
}

export function normalizeWorkspaceRole(value: unknown): WorkspaceRole | null {
    if (value === "owner" || value === "admin" || value === "staff") return value
    // Keep reads safe while environments apply the member-to-staff migration.
    if (value === "member") return "staff"
    return null
}

export function workspaceRoleLabel(value: unknown) {
    const role = normalizeWorkspaceRole(value)
    if (role === "owner") return "Owner"
    if (role === "admin") return "Admin"
    if (role === "staff") return "Staff"
    return "Unknown"
}

export function workspaceRoleMeetsMinimum(role: WorkspaceRole, minimumRole: WorkspaceRole) {
    return roleRank[role] >= roleRank[minimumRole]
}
