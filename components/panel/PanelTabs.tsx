import Link from "next/link"

export type PanelTab = {
    key: string
    label: string
    href: string
}

export function PanelTabs({ items, active, ariaLabel }: { items: readonly PanelTab[]; active: string; ariaLabel: string }) {
    return <nav aria-label={ariaLabel} className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {items.map((item) => <Link
            key={item.key}
            href={item.href}
            aria-current={active === item.key ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === item.key ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"}`}
        >
            {item.label}
        </Link>)}
    </nav>
}
