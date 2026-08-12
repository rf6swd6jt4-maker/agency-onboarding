"use client"

import Link from "next/link"
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useId, useState } from "react"
import { AnchoredPopup } from "@/components/ui"
import type { ListAction } from "./ListActionMenu"

const REMOVE_WARNING = "Remove this item from Betelgeze? This keeps the interface clean, but the action may not be reversible from this screen."

export function MobileCardActionSurface({
    actions,
    children,
    className,
    label = "Open item actions",
    mobileListSurface = false,
}: {
    actions: Array<Partial<ListAction> | null | undefined | false>
    children: ReactNode
    className: string
    label?: string
    mobileListSurface?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const menuId = useId()
    const visibleActions = actions.filter((action): action is ListAction => {
        if (!action) return false
        return Boolean(action.label && (action.href || action.action || action.copyText))
    })

    useEffect(() => {
        function closeForOtherDropdown(event: Event) {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [menuId])

    function openMenu(trigger: HTMLElement) {
        if (visibleActions.length === 0) return
        setAnchor(trigger)
        window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
        setOpen(true)
    }

    function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement
        if (target.closest("a,button,input,select,textarea,summary")) return
        if (open) {
            setOpen(false)
            return
        }
        openMenu(event.currentTarget)
    }

    function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openMenu(event.currentTarget)
        }
    }

    function handleMobileListClick(event: ReactMouseEvent<HTMLButtonElement>) {
        if (open) {
            setOpen(false)
            return
        }
        openMenu(event.currentTarget)
    }

    return <div
        className={`${mobileListSurface ? "relative" : ""} ${className}`}
        role={mobileListSurface ? undefined : "button"}
        tabIndex={mobileListSurface ? undefined : 0}
        aria-label={mobileListSurface ? undefined : label}
        onClick={mobileListSurface ? undefined : handleClick}
        onKeyDown={mobileListSurface ? undefined : handleKeyDown}
    >
        {children}
        {mobileListSurface ? <button type="button" aria-label={label} aria-expanded={open} aria-haspopup="menu" className="absolute inset-0 z-10 sm:hidden" onClick={handleMobileListClick} /> : null}
        {open && <AnchoredPopup anchor={anchor} align="end" role="menu" onDismiss={() => setOpen(false)} className="w-52 rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/60">
            {visibleActions.map((item) => {
                const itemClassName = `block min-h-9 w-full px-3 py-2 text-left text-sm ${item.danger ? "text-red-300 hover:bg-red-950/40" : "text-neutral-200 hover:bg-neutral-900"}`
                if (item.href) {
                    if (item.href.startsWith("#")) {
                        return <a key={item.label} href={item.href} className={itemClassName} role="menuitem" onClick={() => setOpen(false)}>
                            {item.label}
                        </a>
                    }
                    return <Link key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined} className={itemClassName} role="menuitem" onClick={() => setOpen(false)}>
                        {item.label}
                    </Link>
                }
                if (item.copyText) {
                    return <button key={item.label} type="button" className={itemClassName} role="menuitem" onClick={async () => {
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
                    <button type="submit" className={itemClassName} role="menuitem" onClick={(event) => {
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

export function MobileListActionSurface({ actions, children, label }: { actions: Array<Partial<ListAction> | null | undefined | false>; children: ReactNode; label?: string }) {
    return <MobileCardActionSurface actions={actions} label={label} className="" mobileListSurface>{children}</MobileCardActionSurface>
}
