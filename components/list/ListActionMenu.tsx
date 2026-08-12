"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import { AnchoredPopup } from "@/components/ui"

export type ListAction = {
    label: string
    href?: string
    action?: () => Promise<void> | void
    copyText?: string
    danger?: boolean
    external?: boolean
    confirmMessage?: string
}

const REMOVE_WARNING = "Remove this item from Betelgeze? This keeps the interface clean, but the action may not be reversible from this screen."

export function ListActionMenu({ actions, label = "Open item actions", className = "" }: { actions: Array<Partial<ListAction> | null | undefined | false>; label?: string; className?: string }) {
    const [open, setOpen] = useState(false)
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    const menuId = useId()
    const visibleActions = actions.filter((action): action is ListAction => {
        if (!action) return false
        return Boolean(action.label && (action.href || action.action || action.copyText))
    })

    useEffect(() => {
        const closeForOtherDropdown = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [menuId])

    if (visibleActions.length === 0) {
        return <span className={`inline-flex h-8 w-8 items-center justify-center text-neutral-700 ${className}`}>
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </span>
    }

    function toggle(trigger: HTMLButtonElement) {
        setAnchor(trigger)
        setOpen((value) => {
            const next = !value
            if (next) {
                window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            }
            return next
        })
    }

    return <div className={`relative shrink-0 ${className}`}>
        <button type="button" onClick={(event) => toggle(event.currentTarget)} aria-label={label} aria-expanded={open} aria-haspopup="menu" className="inline-flex h-8 w-8 items-center justify-center text-white hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-white/30">
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </button>
        {open && <AnchoredPopup anchor={anchor} align="end" role="menu" onDismiss={() => setOpen(false)} className="w-52 rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/60">
            {visibleActions.map((item) => {
                const className = `block min-h-9 w-full px-3 py-2 text-left text-sm ${item.danger ? "text-red-300 hover:bg-red-950/40" : "text-neutral-200 hover:bg-neutral-900"}`
                if (item.href) {
                    if (item.href.startsWith("#")) {
                        return <a key={item.label} href={item.href} className={className} role="menuitem" onClick={() => setOpen(false)}>
                            {item.label}
                        </a>
                    }
                    return <Link key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined} className={className} role="menuitem" onClick={() => setOpen(false)}>
                        {item.label}
                    </Link>
                }
                if (item.copyText) {
                    return <button key={item.label} type="button" className={className} role="menuitem" onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(item.copyText!)
                        } catch {
                            window.alert("Copy failed, check browser clipboard permissions.")
                        } finally {
                            setOpen(false)
                        }
                    }}>
                        {item.label}
                    </button>
                }
                return <form key={item.label} action={item.action}>
                    <button type="submit" className={className} role="menuitem" onClick={(event) => {
                        const warning = item.confirmMessage ?? (item.danger ? REMOVE_WARNING : null)
                        if (warning && !window.confirm(warning)) {
                            event.preventDefault()
                            setOpen(false)
                        }
                    }}>
                        {item.label}
                    </button>
                </form>
            })}
        </AnchoredPopup>}
    </div>
}
