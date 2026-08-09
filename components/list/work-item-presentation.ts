import type { StatusTone } from "@/components/ui"
import type { RelationshipWorkItemStatus } from "@/lib/relationships"

const workItemStatuses: Record<RelationshipWorkItemStatus, { label: string; tone: StatusTone }> = {
    todo: { label: "To do", tone: "grey" },
    doing: { label: "In progress", tone: "yellow" },
    waiting: { label: "Waiting", tone: "yellow" },
    blocked: { label: "Blocked", tone: "red" },
    done: { label: "Done", tone: "green" },
    canceled: { label: "Canceled", tone: "grey" },
}

export function workItemStatusPresentation(status: RelationshipWorkItemStatus) {
    return workItemStatuses[status]
}
