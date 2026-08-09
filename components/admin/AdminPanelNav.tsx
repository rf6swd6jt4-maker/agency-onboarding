import { PanelTabs } from "@/components/panel/PanelTabs"

export function AdminPanelNav({ workspaceSlug, active }: { workspaceSlug: string; active: "work" | "okrs" | "maintenance" | "activity" }) {
    const items = [
        { key: "work", label: "Work", href: `/${workspaceSlug}/admin` },
        { key: "okrs", label: "OKRs", href: `/${workspaceSlug}/admin?view=okrs` },
        { key: "maintenance", label: "Maintenance", href: `/${workspaceSlug}/admin/maintenance` },
        { key: "activity", label: "Activity", href: `/${workspaceSlug}/admin/activity` },
    ] as const
    return <PanelTabs items={items} active={active} ariaLabel="Admin panel" />
}
