"use client"

import Link from "next/link"
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react"
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
    const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
    const menuId = useId()
    const surfaceRef = useRef<HTMLDivElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const ignoreNextCardClick = useRef(false)
    const visibleActions = actions.filter((action): action is ListAction => {
        if (!action) return false
        return Boolean(action.label && (action.href || action.action || action.copyText))
    })

    const updatePosition = useCallback(() => {
        const rect = surfaceRef.current?.getBoundingClientRect()
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
        function close(event: MouseEvent) {
            if (!open) return
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            ignoreNextCardClick.current = Boolean(surfaceRef.current?.contains(target))
            setOpen(false)
        }
        function escape(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false)
        }
        function closeForOtherDropdown(event: Event) {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }
        function reposition() {
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

    function openMenu() {
        if (visibleActions.length === 0) return
        updatePosition()
        window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
        setOpen(true)
    }

    function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement
        if (ignoreNextCardClick.current) {
            ignoreNextCardClick.current = false
            return
        }
        if (target.closest("a,button,input,select,textarea,summary")) return
        if (open) {
            setOpen(false)
            return
        }
        openMenu()
    }

    function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openMenu()
        }
    }

    function handleMobileListClick() {
        if (ignoreNextCardClick.current) {
            ignoreNextCardClick.current = false
            return
        }
        if (open) {
            setOpen(false)
            return
        }
        openMenu()
    }

    return <div
        ref={surfaceRef}
        className={`${mobileListSurface ? "relative" : ""} ${className}`}
        role={mobileListSurface ? undefined : "button"}
        tabIndex={mobileListSurface ? undefined : 0}
        aria-label={mobileListSurface ? undefined : label}
        onClick={mobileListSurface ? undefined : handleClick}
        onKeyDown={mobileListSurface ? undefined : handleKeyDown}
    >
        {children}
        {mobileListSurface ? <button type="button" aria-label={label} aria-expanded={open} aria-haspopup="menu" className="absolute inset-0 z-10 sm:hidden" onClick={handleMobileListClick} /> : null}
        {open && <div ref={menuRef} role="menu" style={position ? { top: position.top, right: position.right } : undefined} className="fixed z-[9999] w-[calc(100vw-2rem)] max-w-52 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
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
        </div>}
    </div>
}

export function MobileListActionSurface({ actions, children, label }: { actions: Array<Partial<ListAction> | null | undefined | false>; children: ReactNode; label?: string }) {
    return <MobileCardActionSurface actions={actions} label={label} className="" mobileListSurface>{children}</MobileCardActionSurface>
}
