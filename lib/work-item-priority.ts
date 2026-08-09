export const workItemPriorityOptions = [
    { value: 1, label: "Must do now" },
    { value: 2, label: "Can be done tomorrow" },
    { value: 3, label: "Can be done this week" },
    { value: 4, label: "Backlog" },
] as const

export const workItemPrioritySelectionOptions = [
    { value: "system", label: "System generated" },
    ...workItemPriorityOptions.map((option) => ({ value: String(option.value), label: option.label })),
] as const

export function workItemPriorityLabel(priority: number) {
    return workItemPriorityOptions.find((option) => option.value === priority)?.label ?? "Backlog"
}

export function workItemPrioritySelectionLabel(priorityOverride: number | null) {
    return priorityOverride === null ? "System generated" : workItemPriorityLabel(priorityOverride)
}
