export type WorkspaceOkrType = "aspirational" | "committed"
export type WorkspaceOkrDisplayStatus = "Draft" | "Committed" | "In review" | "Completed" | "Cancelled"

export function formatOkrDeadline(deadline: string) {
    const parsed = new Date(`${deadline}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return deadline
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed)
}

export function okrTypeLabel(type: WorkspaceOkrType | null) {
    if (!type) return "Draft"
    return type === "aspirational" ? "Aspirational" : "Committed"
}

export function okrDisplayTitle({ objectiveType, objective, deadline }: { objectiveType: WorkspaceOkrType | null; objective: string; deadline: string }) {
    return `${okrTypeLabel(objectiveType)} Objective: ${objective} by ${formatOkrDeadline(deadline)}`
}

export function okrDisplayStatus({ status, deadline, today }: { status: "draft" | "active" | "completed" | "cancelled"; deadline: string; today: string }): WorkspaceOkrDisplayStatus {
    if (status === "draft") return "Draft"
    if (status === "completed") return "Completed"
    if (status === "cancelled") return "Cancelled"
    return deadline < today ? "In review" : "Committed"
}
