import { PanelTabs } from "@/components/panel/PanelTabs"

export function LeadgenTabs({ workspaceSlug, active }: { workspaceSlug: string; active: "leads" | "polls" }) {
    return <PanelTabs items={[
        { key: "leads", label: "Leads", href: `/${workspaceSlug}/leadgen` },
        { key: "polls", label: "Polls", href: `/${workspaceSlug}/leadgen/polls` },
    ]} active={active} ariaLabel="Lead Gen panel" />
}
