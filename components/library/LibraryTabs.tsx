import { PanelTabs } from "@/components/panel/PanelTabs"

export function LibraryTabs({ workspaceSlug, active }: { workspaceSlug: string; active: "work-items" | "assets" }) {
    return <PanelTabs items={[
        { key: "work-items", label: "Work Items", href: `/${workspaceSlug}/work-items` },
        { key: "assets", label: "Assets", href: `/${workspaceSlug}/assets` },
    ]} active={active} ariaLabel="Library panel" />
}
