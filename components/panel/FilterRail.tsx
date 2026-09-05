"use client"

import Link from "next/link"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"

export type InstantFilterTarget = {
    param: string
    value: string | null
    defaultValue?: string | null
}

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

export function FilterRailLink({ href, selected, instant, children }: { href: string; selected: boolean; instant?: InstantFilterTarget | false; children: ReactNode }) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const currentValue = instant ? searchParams.get(instant.param) ?? instant.defaultValue ?? null : null
    const currentSelected = instant ? currentValue === instant.value : selected
    const instantParams = instant ? new URLSearchParams(searchParams.toString()) : null
    if (instant && instantParams) {
        if (instant.value === null) instantParams.delete(instant.param)
        else instantParams.set(instant.param, instant.value)
    }
    const instantQuery = instantParams?.toString()
    const navigationHref = instant ? `${pathname}${instantQuery ? `?${instantQuery}` : ""}` : href

    return <Link
        href={navigationHref}
        prefetch={instant ? false : undefined}
        data-workspace-instant-filter={instant ? "" : undefined}
        aria-current={currentSelected ? "page" : undefined}
        className={itemClass(currentSelected)}
        onClick={instant ? (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            const nextUrl = navigationHref
            if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl)
        } : undefined}
    >{children}</Link>
}

export function FilterRailButton({ selected, children, ...props }: { selected: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
    return <button type="button" aria-pressed={selected} className={itemClass(selected)} {...props}>{children}</button>
}

export function FilterRailCount({ children }: { children: ReactNode }) {
    return <span className="ml-1 tabular-nums text-neutral-500">{children}</span>
}
