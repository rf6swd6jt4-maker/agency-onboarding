export const workItemPriorityOptions = [
    { value: 1, label: "Must do now" },
    { value: 2, label: "Can be done tomorrow" },
    { value: 3, label: "Can be done this week" },
    { value: 4, label: "Backlog" },
] as const

export function workItemPriorityLabel(priority: number) {
    return workItemPriorityOptions.find((option) => option.value === priority)?.label ?? "Backlog"
}
