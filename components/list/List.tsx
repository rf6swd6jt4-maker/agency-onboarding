import Link from "next/link"
import type { ReactNode } from "react"

export function List({ children, ariaLabel, className = "" }: { children: ReactNode; ariaLabel?: string; className?: string }) {
    return <section role="list" aria-label={ariaLabel} className={`mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black ${className}`}>{children}</section>
}

export function ListItem({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <article role="listitem" className={`border-b border-neutral-800 transition-colors last:border-0 hover:bg-neutral-900/50 ${className}`}>{children}</article>
}

export function ListPrimaryRow({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap border-b border-neutral-900 bg-neutral-900/35 px-3.5 py-2.5 sm:px-4 ${className}`}>{children}</div>
}

export function ListSecondaryRow({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap px-3.5 py-2.5 text-sm sm:px-4 ${className}`}>{children}</div>
}

export function ListTitle({ children, href, external = false, className = "" }: { children: ReactNode; href?: string | null; external?: boolean; className?: string }) {
    const classes = `min-w-0 truncate text-base font-medium text-neutral-100 ${href ? "hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4" : ""} ${className}`
    if (!href) return <p className={classes}>{children}</p>
    if (external) return <a href={href} target="_blank" rel="noreferrer" className={classes}>{children}</a>
    return <Link href={href} className={classes}>{children}</Link>
}

export function ListTrailing({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`ml-auto flex shrink-0 items-center gap-2 sm:gap-3 ${className}`}>{children}</div>
}
