"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"

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
    const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
    const menuId = useId()
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const visibleActions = actions.filter((action): action is ListAction => {
        if (!action) return false
        return Boolean(action.label && (action.href || action.action || action.copyText))
    })

    const updatePosition = useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (!rect) return
        const estimatedHeight = Math.min(window.innerHeight - 32, visibleActions.length * 38 + 8)
        const preferredTop = rect.bottom + 8
        const top = preferredTop + estimatedHeight > window.innerHeight - 16
            ? Math.max(16, rect.top - estimatedHeight - 8)
            : preferredTop
        setPosition({
            top,
            right: Math.max(16, window.innerWidth - rect.right),
        })
    }, [visibleActions.length])

    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false)
        }
        const closeForOtherDropdown = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }
        const reposition = () => {
            if (open) updatePosition()
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        window.addEventListener("resize", reposition)
        window.addEventListener("scroll", reposition, true)
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
            window.removeEventListener("resize", reposition)
            window.removeEventListener("scroll", reposition, true)
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [menuId, open, updatePosition])

    if (visibleActions.length === 0) {
        return <span className={`inline-flex h-8 w-8 items-center justify-center text-neutral-700 ${className}`}>
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </span>
    }

    function toggle() {
        setOpen((value) => {
            const next = !value
            if (next) {
                updatePosition()
                window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            }
            return next
        })
    }

    return <div ref={menuRef} className={`relative shrink-0 ${className}`}>
        <button ref={buttonRef} type="button" onClick={toggle} aria-label={label} aria-expanded={open} aria-haspopup="menu" className="inline-flex h-8 w-8 items-center justify-center text-white hover:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-white/30">
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </button>
        {open && <div role="menu" style={position ? { top: position.top, right: position.right } : undefined} className="fixed z-[9999] w-[calc(100vw-2rem)] max-w-52 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
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
        </div>}
    </div>
}
