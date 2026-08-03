import Link from "next/link"

export function LibraryTabs({ workspaceSlug, active }: { workspaceSlug: string; active: "work-items" | "assets" }) {
    return <nav aria-label="Library" className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Link href={`/${workspaceSlug}/work-items`} className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === "work-items" ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300"}`}>Work Items</Link>
        <Link href={`/${workspaceSlug}/assets`} className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === "assets" ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300"}`}>Assets</Link>
    </nav>
}
