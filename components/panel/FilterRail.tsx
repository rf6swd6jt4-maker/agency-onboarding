import Link from "next/link"
import type { ButtonHTMLAttributes, ReactNode } from "react"

function itemClass(selected: boolean) {
    return `shrink-0 border-b px-2 py-2 text-sm transition-colors ${selected ? "border-white text-white" : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"}`
}

export function FilterRail({ ariaLabel, children, spacing = "default" }: { ariaLabel: string; children: ReactNode; spacing?: "default" | "tight" }) {
    return <section className={`${spacing === "tight" ? "mt-2" : "mt-5"} border-y border-neutral-800/80 py-1`}>
        <nav aria-label={ariaLabel} className="flex gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
            {children}
        </nav>
    </section>
}

export function FilterRailLink({ href, selected, children }: { href: string; selected: boolean; children: ReactNode }) {
    return <Link href={href} aria-current={selected ? "page" : undefined} className={itemClass(selected)}>{children}</Link>
}

export function FilterRailButton({ selected, children, ...props }: { selected: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
    return <button type="button" aria-pressed={selected} className={itemClass(selected)} {...props}>{children}</button>
}

export function FilterRailCount({ children }: { children: ReactNode }) {
    return <span className="ml-1 tabular-nums text-neutral-500">{children}</span>
}
