export type WorkspaceOkrType = "aspirational" | "committed"

export function formatOkrDeadline(deadline: string) {
    const parsed = new Date(`${deadline}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) return deadline
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed)
}

export function okrTypeLabel(type: WorkspaceOkrType) {
    return type === "aspirational" ? "Aspirational" : "Committed"
}

export function okrDisplayTitle({ objectiveType, objective, deadline }: { objectiveType: WorkspaceOkrType; objective: string; deadline: string }) {
    return `${okrTypeLabel(objectiveType)} Objective: ${objective} by ${formatOkrDeadline(deadline)}`
}

