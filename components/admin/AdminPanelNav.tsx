import Link from "next/link"

export function AdminPanelNav({ workspaceSlug, active }: { workspaceSlug: string; active: "overview" | "okrs" | "maintenance" | "activity" }) {
    const items = [
        { key: "overview", label: "Overview", href: `/${workspaceSlug}/admin` },
        { key: "okrs", label: "OKRs", href: `/${workspaceSlug}/admin?view=okrs` },
        { key: "maintenance", label: "Maintenance", href: `/${workspaceSlug}/admin/maintenance` },
        { key: "activity", label: "Activity", href: `/${workspaceSlug}/admin/activity` },
    ] as const
    return <nav aria-label="Admin panel" className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {items.map((item) => <Link key={item.key} href={item.href} className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === item.key ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"}`}>{item.label}</Link>)}
    </nav>
}
